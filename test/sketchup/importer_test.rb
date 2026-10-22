# encoding: UTF-8
#
# Tests for sketchup/cmrlm_design_tools/importer.rb against a mock SketchUp API.
# Run: ruby test/sketchup/importer_test.rb
#
# The mock records calls. It proves the importer's logic. It does not prove the
# real SketchUp API behaves the way the mock does. SketchUp itself: test on the Mac.

Encoding.default_external = Encoding::UTF_8
require 'minitest/autorun'
require 'json'
require 'tmpdir'
require 'open3'
require_relative 'mock_sketchup'
require_relative '../../sketchup/cmrlm_design_tools/importer'

ROOT_DIR = File.expand_path('../..', __dir__)
FIXTURES = File.join(__dir__, 'fixtures')
EXAMPLES = File.join(ROOT_DIR, 'examples', 'sketchup')

module Helpers
  Importer = CMRLM::DesignTools::Importer

  def fixture(name)
    File.join(FIXTURES, name)
  end

  def read_fixture(name)
    JSON.parse(File.read(fixture(name)))
  end

  # Imports a file path. Returns [model, ui, result].
  def import_path(path, model = nil)
    model ||= Sketchup::Model.new
    ui = RecordingUI.new
    result = Importer.new(model, ui).import_file(path)
    [model, ui, result]
  end

  def import_doc(doc, model = nil)
    model ||= Sketchup::Model.new
    ui = RecordingUI.new
    result = Importer.new(model, ui).import_doc(doc)
    [model, ui, result]
  end

  def with_json_file(obj, name = 'doc.sketchup.json')
    Dir.mktmpdir do |dir|
      path = File.join(dir, name)
      File.write(path, obj.is_a?(String) ? obj : JSON.generate(obj))
      yield path
    end
  end

  # Finds a group by name anywhere under a group or model.
  def find_group(container, name)
    entities = container.entities
    entities.grep(Sketchup::Group).each do |g|
      return g if g.name == name
      hit = find_group(g, name)
      return hit if hit
    end
    nil
  end

  def count_groups(container)
    container.entities.grep(Sketchup::Group).inject(0) { |s, g| s + 1 + count_groups(g) }
  end

  def live_faces(group)
    group.entities.grep(Sketchup::Face)
  end

  # A small valid document. `children` are nodes placed under the root.
  def mini_doc(children, tags: [], materials: [], name: 'Mini', source: 'site', location: nil, z_shift: 0)
    {
      'format' => 'cmrlm-design-tools/sketchup', 'version' => 1, 'source' => source, 'name' => name,
      'createdAt' => '2026-10-21T00:00:00Z', 'units' => 'feet', 'location' => location, 'zShift' => z_shift,
      'notes' => [], 'tags' => tags, 'materials' => materials,
      'root' => { 'type' => 'group', 'name' => name, 'children' => children }
    }
  end

  def solid_node(name, x, y, w, h, z0, z1, extra = {})
    { 'type' => 'solid', 'name' => name, 'outer' => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
      'holes' => [], 'z0' => z0, 'z1' => z1 }.merge(extra)
  end

  def bounds_z(group)
    b = group.bounds
    [b.min.z, b.max.z]
  end

  def assert_close(expected, actual, tol = 1e-6, msg = nil)
    assert_in_delta expected, actual, tol, msg
  end
end

class ImporterTestCase < Minitest::Test
  include Helpers

  def setup
    Sketchup::Mock.reset!
  end
end

# ------------------------------------------------------------------------------
class TowerImportTest < ImporterTestCase
  def setup
    super
    @model, @ui, @result = import_path(fixture('tower-small.sketchup.json'))
    @root = @model.entities.grep(Sketchup::Group).first
  end

  def test_import_succeeds_with_no_messages
    refute_nil @result
    assert_empty @ui.messages
    assert_equal 'Imported 10 groups from Option A', @result.summary
    assert_equal [@result.summary], @ui.statuses.last(1)
  end

  def test_one_operation_committed
    assert_equal [[:start, 'Import Option A', true], [:commit]], @model.operations
    refute @model.operation_open?
  end

  def test_root_group_is_the_only_top_level_entity
    assert_equal 1, @model.entities.length
    assert_equal 'Option A', @root.name
    assert_same @root, @result.root
  end

  def test_group_tree
    assert_equal ['Podium', 'Segment 1 · Residential', 'Crown', 'Context'], @root.groups.map(&:name)
    podium = find_group(@root, 'Podium')
    floor1 = find_group(podium, 'Floor 1')
    assert_equal ['Floor 1 piece 1'], floor1.groups.map(&:name)
    seg = find_group(@root, 'Segment 1 · Residential')
    assert_equal ['Floor 2', 'Floor 3'], seg.groups.map(&:name)
    assert_equal ['Block 1'], find_group(@root, 'Context').groups.map(&:name)
    assert_equal 10, count_groups(@model) # root + 9 below
    assert_equal 10, @result.groups
  end

  def test_counts_by_type
    assert_equal 5, @result.counts['group']
    assert_equal 4, @result.counts['solid']
    assert_equal 1, @result.counts['mesh']
  end

  def test_tags_created_with_color_and_visibility
    names = @model.layers.map(&:name)
    %w[Residential Retail Crown Context].each { |n| assert_includes names, n }
    res = @model.layers['Residential']
    assert_equal [0x4f, 0x7f, 0xd1], res.color.to_a
    assert res.visible
  end

  def test_tags_are_on_groups_only
    assert_equal 'Retail', find_group(@root, 'Floor 1').layer.name
    assert_equal 'Residential', find_group(@root, 'Floor 2').layer.name
    assert_equal 'Crown', find_group(@root, 'Crown').layer.name
    assert_equal 'Context', find_group(@root, 'Context').layer.name
    # Groups with no tag in the file stay Untagged.
    assert_nil @root.layer
    assert_nil find_group(@root, 'Podium').layer
    assert_nil find_group(@root, 'Floor 1 piece 1').layer
    # Raw geometry has no tag at all: the mock Face and Edge have no layer accessor.
    f = live_faces(find_group(@root, 'Floor 2')).first
    refute_respond_to f, :layer=
  end

  def test_materials_created_with_color_and_alpha
    ctx = @model.materials['Context']
    assert_equal [0xcc, 0xcc, 0xcc], ctx.color.to_a
    assert_in_delta 0.5, ctx.alpha
    assert_in_delta 1.0, @model.materials['Residential'].alpha
    assert_equal 3, @model.materials.length
  end

  def test_materials_on_groups_not_faces
    assert_equal 'Residential', find_group(@root, 'Floor 2').material.name
    assert_equal 'Context', find_group(@root, 'Context').material.name
    f = live_faces(find_group(@root, 'Floor 2')).first
    refute_respond_to f, :material=
  end

  def test_solid_pushpull_distances_are_feet_times_12_and_rise
    expected = {
      'Floor 1 piece 1' => [-180.0, 0.0, 180.0],           # z 0 -> 15 ft
      'Floor 2' => [-126.0, 15 * 12.0, 25.5 * 12.0],        # z 15 -> 25.5 ft
      'Floor 3' => [-126.0, 25.5 * 12.0, 36 * 12.0],
      'Block 1' => [-480.0, 0.0, 480.0]
    }
    expected.each do |name, (dist, zmin, zmax)|
      g = find_group(@root, name)
      face = live_faces(g).first
      assert_equal [dist], face.pushpulls, name
      assert_equal 1, face.reversed_count, "#{name}: bottom face normal must be flipped down before push-pull"
      lo, hi = bounds_z(g)
      assert_close zmin, lo, 1e-6, "#{name} bottom"
      assert_close zmax, hi, 1e-6, "#{name} top"
    end
  end

  def test_solid_coordinates_are_inches
    g = find_group(@root, 'Floor 2')
    b = g.bounds
    assert_close 100 * 12.0, b.max.x
    assert_close 60 * 12.0, b.max.y
    assert_close 0.0, b.min.x
  end

  def test_hole_face_is_erased
    g = find_group(@root, 'Floor 1 piece 1')
    assert_equal 2, g.entities.faces_added          # outer + hole
    assert_equal 1, live_faces(g).length            # hole face erased
    assert_equal 0, find_group(@root, 'Floor 2').entities.faces_added - 1
  end

  def test_attributes_on_groups
    f1 = find_group(@root, 'Floor 1')
    assert_equal 1, f1.get_attribute('cmrlm', 'floor')
    assert_equal 'Retail', f1.get_attribute('cmrlm', 'program')
    assert_equal 6000, f1.get_attribute('cmrlm', 'area_sf')
  end

  def test_model_and_root_attributes
    [@model, @root].each do |t|
      assert_equal 0.0, t.get_attribute('cmrlm', 'zShift')
      assert_equal 'tower', t.get_attribute('cmrlm', 'source')
      assert_equal 'Option A', t.get_attribute('cmrlm', 'name')
      assert_equal '2026-10-21T16:05:00Z', t.get_attribute('cmrlm', 'createdAt')
    end
  end

  def test_no_location_leaves_shadow_info_alone
    assert_empty @model.shadow_info
  end

  def test_manifold_attribute_absent_when_manifold
    g = find_group(@root, 'Floor 2')
    assert_nil g.get_attribute('cmrlm', 'manifold')
  end

  def test_closed_mesh_is_not_soft_and_keeps_winding
    crown = find_group(@root, 'Crown')
    assert_equal 6, live_faces(crown).length
    assert(crown.edges.none? { |e| e.soft || e.smooth })
    assert(live_faces(crown).all? { |f| f.reversed_count.zero? }, 'closed meshes keep their winding')
  end
end

# ------------------------------------------------------------------------------
class SiteImportTest < ImporterTestCase
  def setup
    super
    @model, @ui, @result = import_path(fixture('site-small.sketchup.json'))
    @root = @model.entities.grep(Sketchup::Group).first
    @ground = find_group(@root, 'Ground')
  end

  def test_import_succeeds
    refute_nil @result
    assert_empty @ui.messages
    assert_equal 'Imported 10 groups from Site at 1 Test Way', @result.summary
    assert_equal [:start, :commit], @model.operations.map(&:first)
  end

  def test_ground_mesh_filled_once_with_weld
    filled = @ground.entities.meshes_filled
    assert_equal 1, filled.length
    assert_equal 16, filled[0][:points]
    assert_equal 18, filled[0][:polygons]
    assert filled[0][:weld]
    assert_equal 18, live_faces(@ground).length
  end

  def test_ground_faces_all_face_up
    assert(live_faces(@ground).all? { |f| f.normal.z >= 0 })
    flipped = live_faces(@ground).count { |f| f.reversed_count > 0 }
    assert_equal 2, flipped, 'the clockwise first cell (2 triangles) must be flipped'
  end

  def test_interior_edges_soft_and_smooth_boundary_hard
    edges = @ground.edges
    assert_equal 33, edges.length # 4x4 grid: 24 grid edges + 9 diagonals
    interior, boundary = edges.partition { |e| e.faces.length == 2 }
    assert_equal 33 - 12, interior.length
    assert_equal 12, boundary.length
    assert(interior.all? { |e| e.soft && e.smooth }, 'interior edges soft and smooth')
    assert(boundary.none? { |e| e.soft || e.smooth }, 'boundary edges hard')
  end

  def test_ground_tag_and_material
    assert_equal 'Ground', @ground.layer.name
    assert_equal 'Ground', @ground.material.name
  end

  def test_draped_road_faces_are_up_and_keep_their_height
    road = find_group(@root, 'Main St')
    faces = live_faces(road)
    assert_equal 1, faces.length
    assert faces[0].normal.z > 0.999
    zs = faces[0].points.map(&:z)
    # z = 10 + x/50*2 + y/50 + 0.1 ft, at the 4 corners; the point (10,70) is the lowest
    assert_close((10 + 10 / 50.0 * 2 + 70 / 50.0 + 0.1) * 12.0, zs.min, 1e-3)
    assert_equal 'Roads', find_group(@root, 'Roads').layer.name
    assert_equal 'Pavement', find_group(@root, 'Roads').material.name
  end

  def test_centerlines_use_hidden_tag
    line = find_group(@root, 'Road centerlines')
    assert_equal 'Road centerlines', line.layer.name
    refute @model.layers['Road centerlines'].visible
    assert @model.layers['Roads'].visible
    assert_equal 1, line.entities.edge_lists.length  # 2-point line -> add_edges
    assert_equal 1, line.edges.length
  end

  def test_boundary_polyline_is_one_curve
    b = find_group(@root, 'Site boundary')
    assert_equal 1, b.entities.curves.length
    assert_equal 5, b.entities.curves[0].length
    assert_equal 4, b.edges.length
    assert_close 150 * 12.0, b.bounds.max.x
  end

  def test_water_faces_and_alpha
    water = find_group(@root, 'Water')
    pond = find_group(water, 'Pond')
    assert_equal 1, live_faces(pond).length
    assert_equal 'Water', water.layer.name
    assert_in_delta 0.85, @model.materials['Water'].alpha
    assert_close 20 * 12.0, live_faces(pond).first.points.first.z
  end

  def test_building_solid_with_hole_and_attributes
    b = find_group(@root, 'Building 0001 (estimated)')
    assert_equal 1, live_faces(b).length
    assert_equal 2, b.entities.faces_added
    assert_equal [-(30 * 12.0)], live_faces(b).first.pushpulls
    lo, hi = bounds_z(b)
    assert_close 14 * 12.0, lo
    assert_close 44 * 12.0, hi
    assert_equal 30, b.get_attribute('cmrlm', 'height_ft')
    assert_equal 'estimated', b.get_attribute('cmrlm', 'height_source')
    assert_equal 'abc-123', b.get_attribute('cmrlm', 'overture_id')
    assert_equal 'Buildings', find_group(@root, 'Buildings').layer.name
    assert_equal 'Building', find_group(@root, 'Buildings').material.name
  end

  def test_z_shift_attribute_on_model_and_root
    [@model, @root].each do |t|
      assert_equal(-12.5, t.get_attribute('cmrlm', 'zShift'))
      assert_equal 'site', t.get_attribute('cmrlm', 'source')
      assert_equal 'Site at 1 Test Way', t.get_attribute('cmrlm', 'name')
      assert_equal '2026-10-21T17:00:00Z', t.get_attribute('cmrlm', 'createdAt')
    end
    assert_match(/add 12\.5 ft/, @model.get_attribute('cmrlm', 'notes'))
  end

  def test_location_set
    assert_equal 33.92, @model.shadow_info['Latitude']
    assert_equal(-84.34, @model.shadow_info['Longitude'])
  end

  def test_location_refused_by_api_is_ignored
    model = Sketchup::Model.new
    def model.shadow_info
      raise 'shadow_info refused'
    end
    _m, ui, result = import_path(fixture('site-small.sketchup.json'), model)
    refute_nil result
    assert_empty ui.messages
    assert_equal [:start, :commit], model.operations.map(&:first)
  end

  def test_location_out_of_range_is_ignored
    doc = read_fixture('site-small.sketchup.json')
    doc['location'] = { 'lat' => 95, 'lon' => 10 }
    model, _ui, result = import_doc(doc)
    refute_nil result
    assert_empty model.shadow_info
  end

  def test_every_suite_source_imports
    %w[tower site midrise parking facade grading plate].each do |src|
      doc = mini_doc([solid_node('Unit 1', 0, 0, 30, 40, 0, 10)], source: src)
      _model, ui, result = import_doc(doc)
      refute_nil result, "source #{src} must import"
      assert_empty ui.messages, "source #{src}: no message"
    end
  end
end

# ------------------------------------------------------------------------------
class BadFileTest < ImporterTestCase
  def assert_rejected(path, pattern)
    model, ui, result = import_path(path)
    assert_nil result
    assert_equal 1, ui.messages.length, 'one message'
    assert_match pattern, ui.messages[0]
    assert_empty model.operations, 'no operation may start'
    assert model.pristine?, 'the model must be unchanged'
  end

  def test_bad_format
    assert_rejected fixture('bad-format.sketchup.json'), /not a Design Tools SketchUp file.*"something-else"/m
  end

  def test_bad_version
    assert_rejected fixture('bad-version.sketchup.json'), /version 2.*reads version 1.*newest/m
  end

  def test_old_or_odd_version
    doc = read_fixture('tower-small.sketchup.json')
    doc['version'] = 'x'
    model, ui, result = import_doc(doc)
    assert_nil result
    assert_match(/reads version 1/, ui.messages[0])
    assert model.pristine?
  end

  def test_bad_units
    assert_rejected fixture('bad-units.sketchup.json'), /"meters".*feet only/m
  end

  def test_bad_json
    assert_rejected fixture('bad-json.sketchup.json'), /not valid JSON/
  end

  def test_missing_root
    assert_rejected fixture('missing-root.sketchup.json'), /no root group/
  end

  def test_unknown_tag_reference
    assert_rejected fixture('bad-tag-ref.sketchup.json'), /changed nothing.*tag "Nope" is not in tags/m
  end

  def test_missing_file
    assert_rejected '/no/such/file.sketchup.json', /could not find/
  end

  def test_nil_path
    model, ui, result = import_path(nil)
    assert_nil result
    assert_match(/could not find/, ui.messages[0])
    assert model.pristine?
  end

  def test_not_an_object
    with_json_file('[1,2,3]') do |path|
      assert_rejected path, /top level is not an object/
    end
  end

  def test_root_not_a_group
    doc = read_fixture('tower-small.sketchup.json')
    doc['root'] = solid_node('S', 0, 0, 10, 10, 0, 5)
    with_json_file(doc) { |path| assert_rejected path, %r{root: must be a group} }
  end

  def test_structural_errors_listed_and_nothing_changes
    doc = read_fixture('tower-small.sketchup.json')
    doc['root']['children'] << { 'type' => 'solid', 'name' => 'Bad', 'outer' => [[0, 0], [1, 1]], 'holes' => [], 'z0' => 5, 'z1' => 5 }
    doc['root']['children'] << { 'type' => 'mesh', 'name' => 'BadMesh', 'vertices' => [[0, 0, 0]], 'triangles' => [[0, 1, 2]] }
    doc['root']['children'] << { 'type' => 'sphere', 'name' => 'S' }
    doc['tags'][0]['color'] = 'blue'
    model, ui, result = import_doc(doc)
    assert_nil result
    msg = ui.messages[0]
    assert_match(/ring needs 3 or more points/, msg)
    assert_match(/needs z1 above z0/, msg)
    assert_match(/bad triangle index/, msg)
    assert_match(/unknown type "sphere"/, msg)
    assert_match(/color must be #rrggbb/, msg)
    assert_empty model.operations
    assert model.pristine?
  end

  def test_error_during_build_aborts_and_restores_model
    Sketchup::Mock.fail_at_group_named = 'Floor 3'
    model, ui, result = import_path(fixture('tower-small.sketchup.json'))
    assert_nil result
    assert_equal [[:start, 'Import Option A', true], [:abort]], model.operations
    assert_match(/SketchUp undid it and changed nothing.*Simulated SketchUp failure/m, ui.messages[0])
    assert model.pristine?, 'tags, materials, groups and attributes must all be rolled back'
  end

  def test_empty_import_aborts
    doc = mini_doc([{ 'type' => 'group', 'name' => 'Empty', 'children' => [] }])
    model, ui, result = import_doc(doc)
    assert_nil result
    assert_equal [:start, :abort], model.operations.map(&:first)
    assert_match(/no geometry/, ui.messages[0])
    assert model.pristine?
  end

  def test_bom_is_accepted
    text = "\uFEFF" + File.read(fixture('tower-small.sketchup.json'), encoding: 'UTF-8')
    with_json_file(text) do |path|
      _model, ui, result = import_path(path)
      refute_nil result
      assert_empty ui.messages
    end
  end
end

# ------------------------------------------------------------------------------
class SkippedFaceTest < ImporterTestCase
  def square3(x, z = 0)
    [[x, 0, z], [x + 10, 0, z], [x + 10, 10, z], [x, 10, z]]
  end

  def test_failed_add_face_is_skipped_and_counted
    # Fail every face whose first point has x == 20.
    Sketchup::Mock.add_face_failure = ->(pts) { (pts[0].x - 240.0).abs < 1e-6 }
    polys = [0, 10, 20, 30].map { |x| { 'outer' => square3(x), 'holes' => [] } }
    doc = mini_doc([{ 'type' => 'faces', 'name' => 'Roads', 'polygons' => polys }])
    model, ui, result = import_doc(doc)
    refute_nil result
    assert_equal 1, result.skipped
    assert_equal 3, live_faces(find_group(model.entities.grep(Sketchup::Group).first, 'Roads')).length
    assert_equal [:start, :commit], model.operations.map(&:first), 'the import is not aborted'
    assert_equal 'Imported 2 groups from Mini (1 face skipped)', result.summary
    assert_equal 'Imported 2 groups from Mini (1 face skipped)', ui.statuses.last
    assert_equal 1, ui.messages.length
    assert_match(/1 face skipped/, ui.messages[0])
  end

  def test_several_failures_reported_with_plural
    # Fail every face that lies at z = 0. The solid starts at z = 5 ft, so it is fine.
    Sketchup::Mock.add_face_failure = ->(pts) { pts[0].z.zero? }
    polys = [0, 10].map { |x| { 'outer' => square3(x), 'holes' => [] } }
    doc = mini_doc([{ 'type' => 'faces', 'name' => 'Roads', 'polygons' => polys }, solid_node('Fine', 0, 0, 5, 5, 5, 10)])
    model, ui, result = import_doc(doc)
    assert_equal 2, result.skipped
    assert_match(/\(2 faces skipped\)/, result.summary)
    assert_match(/2 faces skipped/, ui.messages[0])
    refute_nil find_group(model.entities.grep(Sketchup::Group).first, 'Fine')
    assert_equal [:start, :commit], model.operations.map(&:first)
  end

  def test_all_duplicate_points_ring_is_skipped_without_calling_add_face
    same = [[5, 5, 0], [5, 5, 0.0001], [5, 5, 0]]
    polys = [{ 'outer' => same, 'holes' => [] }, { 'outer' => square3(0), 'holes' => [] }]
    doc = mini_doc([{ 'type' => 'faces', 'name' => 'F', 'polygons' => polys }])
    model, _ui, result = import_doc(doc)
    assert_equal 1, result.skipped
    f = find_group(model.entities.grep(Sketchup::Group).first, 'F')
    assert_equal 1, f.entities.faces_added
  end

  def test_duplicate_neighbour_points_are_cleaned_not_skipped
    ring = [[0, 0, 0], [0, 0, 0], [10, 0, 0], [10, 10, 0], [10, 10, 0.00001], [0, 10, 0], [0, 0, 0]]
    doc = mini_doc([{ 'type' => 'faces', 'name' => 'F', 'polygons' => [{ 'outer' => ring, 'holes' => [] }] }])
    model, _ui, result = import_doc(doc)
    assert_equal 0, result.skipped
    f = find_group(model.entities.grep(Sketchup::Group).first, 'F')
    assert_equal 4, live_faces(f).first.points.length
  end

  def test_solid_with_failing_outer_is_skipped_and_group_removed
    Sketchup::Mock.add_face_failure = ->(pts) { (pts[0].x - 1200.0).abs < 1e-6 }
    doc = mini_doc([solid_node('Good', 0, 0, 10, 10, 0, 10), solid_node('Bad', 100, 0, 10, 10, 0, 10)])
    model, _ui, result = import_doc(doc)
    assert_equal 1, result.skipped
    root = model.entities.grep(Sketchup::Group).first
    assert_equal ['Good'], root.groups.map(&:name)
    assert_equal 2, result.groups # root + Good; the empty group is not counted
  end

  def test_failed_hole_keeps_the_solid
    Sketchup::Mock.add_face_failure = ->(pts) { pts.length == 4 && pts.all? { |p| p.x > 24 && p.x < 96 } }
    node = solid_node('S', 0, 0, 10, 10, 0, 10, 'holes' => [[[3, 3], [3, 6], [6, 6], [6, 3]]])
    model, _ui, result = import_doc(mini_doc([node]))
    assert_equal 1, result.skipped
    refute_nil find_group(model.entities.grep(Sketchup::Group).first, 'S')
  end

  def test_degenerate_triangles_in_a_mesh_are_skipped
    mesh = { 'type' => 'mesh', 'name' => 'M', 'soft' => true, 'closed' => false,
             'vertices' => [[0, 0, 0], [10, 0, 0], [10, 10, 0], [20, 20, 0], [30, 30, 0], [40, 40, 0]],
             'triangles' => [[0, 1, 2], [3, 4, 5]] } # second triangle is collinear
    model, _ui, result = import_doc(mini_doc([mesh]))
    assert_equal 1, result.skipped
    m = find_group(model.entities.grep(Sketchup::Group).first, 'M')
    assert_equal 1, live_faces(m).length
  end

  def test_pushpull_failure_skips_the_solid
    face_class = Sketchup::Face
    face_class.class_eval do
      alias_method :__pp, :pushpull
      def pushpull(_d)
        raise ArgumentError, 'Cannot push-pull'
      end
    end
    begin
      keep = { 'type' => 'lines', 'name' => 'Keep', 'lines' => [[[0, 0, 0], [5, 0, 0]]] }
      model, _ui, result = import_doc(mini_doc([solid_node('S', 0, 0, 10, 10, 0, 10), solid_node('T', 20, 0, 5, 5, 0, 5), keep]))
      assert_equal 2, result.skipped
      assert_equal ['Keep'], model.entities.grep(Sketchup::Group).first.groups.map(&:name), 'both solids removed'
    ensure
      face_class.class_eval do
        alias_method :pushpull, :__pp
        remove_method :__pp
      end
    end
  end
end

# ------------------------------------------------------------------------------
class GeometryRuleTest < ImporterTestCase
  def test_numeric_feet_in_mock_matches_importer_scale
    assert_equal 12.0, 1.feet
    assert_equal 150.0, 12.5.feet
  end

  def test_feet_to_inches_conversion_on_every_node_type
    mesh = { 'type' => 'mesh', 'name' => 'M', 'soft' => false, 'closed' => false,
             'vertices' => [[1, 2, 3], [4, 2, 3], [4, 5, 3]], 'triangles' => [[0, 1, 2]] }
    lines = { 'type' => 'lines', 'name' => 'L', 'lines' => [[[0, 0, 1], [10, 0, 1]]] }
    faces = { 'type' => 'faces', 'name' => 'F', 'polygons' => [{ 'outer' => [[0, 0, 2], [5, 0, 2], [5, 5, 2]], 'holes' => [] }] }
    doc = mini_doc([solid_node('S', 1, 2, 3, 4, 5, 7), mesh, lines, faces])
    model, _ui, _r = import_doc(doc)
    root = model.entities.grep(Sketchup::Group).first
    sb = find_group(root, 'S').bounds
    assert_equal [12.0, 24.0, 60.0], sb.min.to_a
    assert_equal [48.0, 72.0, 84.0], sb.max.to_a
    mb = find_group(root, 'M').bounds
    assert_equal [12.0, 24.0, 36.0], mb.min.to_a
    assert_equal [48.0, 60.0, 36.0], mb.max.to_a
    assert_equal [120.0, 0.0, 12.0], find_group(root, 'L').bounds.max.to_a
    assert_equal [60.0, 60.0, 24.0], find_group(root, 'F').bounds.max.to_a
  end

  def test_clockwise_outer_ring_is_not_flipped_twice
    node = solid_node('CW', 0, 0, 10, 10, 0, 10)
    node['outer'] = node['outer'].reverse # clockwise seen from above
    model, _ui, _r = import_doc(mini_doc([node]))
    g = find_group(model.entities.grep(Sketchup::Group).first, 'CW')
    f = live_faces(g).first
    assert_equal 0, f.reversed_count, 'normal already points down'
    assert_equal [-120.0], f.pushpulls
    assert_equal [0.0, 120.0], bounds_z(g)
  end

  def test_opposite_pushpull_sign_is_detected_and_corrected
    Sketchup::Mock.pushpull_sign = -1
    model, ui, result = import_doc(mini_doc([solid_node('S', 0, 0, 10, 10, 2, 12)]))
    g = find_group(model.entities.grep(Sketchup::Group).first, 'S')
    assert_equal [24.0, 144.0], bounds_z(g), 'the solid still rises from z0 to z1'
    assert_equal 0, result.height_warnings
    assert_equal 1, live_faces(g).length
    assert_empty ui.messages
  end

  def test_not_manifold_marks_attribute_and_keeps_group
    Sketchup::Mock.manifold = false
    model, _ui, _r = import_doc(mini_doc([solid_node('S', 0, 0, 10, 10, 0, 10)]))
    g = find_group(model.entities.grep(Sketchup::Group).first, 'S')
    refute_nil g
    assert_equal false, g.get_attribute('cmrlm', 'manifold', :missing)
  end

  def test_soft_flag_ignored_for_closed_mesh
    mesh = { 'type' => 'mesh', 'name' => 'M', 'soft' => true, 'closed' => true,
             'vertices' => [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], 'triangles' => [[0, 1, 2], [0, 2, 3]] }
    model, _ui, _r = import_doc(mini_doc([mesh]))
    m = find_group(model.entities.grep(Sketchup::Group).first, 'M')
    assert(m.edges.none?(&:soft))
  end

  def test_soft_false_open_mesh_is_not_softened_but_faces_up
    mesh = { 'type' => 'mesh', 'name' => 'M', 'soft' => false, 'closed' => false,
             'vertices' => [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], 'triangles' => [[0, 2, 1], [0, 3, 2]] }
    model, _ui, _r = import_doc(mini_doc([mesh]))
    m = find_group(model.entities.grep(Sketchup::Group).first, 'M')
    assert(m.edges.none?(&:soft))
    assert(live_faces(m).all? { |f| f.normal.z > 0 })
  end

  def test_fill_from_mesh_refusal_falls_back_to_faces
    Sketchup::Mock.fill_from_mesh_fails = true
    model, _ui, result = import_path(fixture('site-small.sketchup.json'))
    ground = find_group(model.entities.grep(Sketchup::Group).first, 'Ground')
    assert_equal 18, live_faces(ground).length
    assert_equal 0, result.skipped
    assert(live_faces(ground).all? { |f| f.normal.z >= 0 })
  end

  def test_zero_length_segments_removed_from_lines
    lines = { 'type' => 'lines', 'name' => 'L', 'lines' => [
      [[0, 0, 0], [0, 0, 0.00001], [10, 0, 0], [10, 0, 0], [10, 10, 0]],  # curve after cleaning: 3 points
      [[5, 5, 5], [5, 5, 5.00001]],                                          # all zero length: skipped
      [[0, 0, 0], [0, 0, 0], [3, 0, 0]]                                      # 2 points after cleaning
    ] }
    model, _ui, result = import_doc(mini_doc([lines]))
    l = find_group(model.entities.grep(Sketchup::Group).first, 'L')
    assert_equal [3], l.entities.curves.map(&:length)
    assert_equal [2], l.entities.edge_lists.map(&:length)
    assert_equal 0, result.skipped, 'lines never count as skipped faces'
  end

  def test_group_with_only_failed_children_is_removed
    Sketchup::Mock.add_face_failure = ->(_p) { true }
    doc = mini_doc([{ 'type' => 'group', 'name' => 'A', 'children' => [solid_node('S', 0, 0, 5, 5, 0, 5)] },
                    { 'type' => 'lines', 'name' => 'Keep', 'lines' => [[[0, 0, 0], [5, 0, 0]]] }])
    model, _ui, result = import_doc(doc)
    root = model.entities.grep(Sketchup::Group).first
    assert_equal ['Keep'], root.groups.map(&:name)
    assert_equal 2, result.groups
    assert_equal 1, result.skipped
  end

  def test_existing_material_and_tag_are_reused_by_name
    model = Sketchup::Model.new
    old = model.materials.add('Residential')
    old.color = Sketchup::Color.new(1, 2, 3)
    layer = model.layers.add('Residential')
    layer.visible = false
    adds_before = model.materials.add_calls
    _m, _ui, result = import_path(fixture('tower-small.sketchup.json'), model)
    refute_nil result
    assert_equal ['Residential', 'Retail', 'Context'].sort, model.materials.map(&:name).sort
    assert_equal adds_before + 2, model.materials.add_calls, 'only the 2 new materials are added'
    assert_same old, model.materials['Residential']
    assert_equal [0x4f, 0x7f, 0xd1], old.color.to_a, 'file colour wins'
    assert_equal 1, model.layers.count { |l| l.name == 'Residential' }
    assert layer.visible, 'file visibility wins'
    assert_same old, find_group(model.entities.grep(Sketchup::Group).first, 'Floor 2').material
  end

  def test_unsupported_attribute_values_are_ignored
    node = solid_node('S', 0, 0, 5, 5, 0, 5, 'attributes' => { 'a' => 'x', 'b' => 2, 'c' => true, 'd' => nil, 'e' => [1], 'f' => { 'g' => 1 } })
    model, _ui, _r = import_doc(mini_doc([node]))
    g = find_group(model.entities.grep(Sketchup::Group).first, 'S')
    assert_equal({ 'a' => 'x', 'b' => 2, 'c' => true }, g.attributes['cmrlm'])
  end

  def test_progress_status_is_reported_on_big_files
    nodes = (0...600).map { |i| solid_node("B#{i}", i * 12, 0, 10, 10, 0, 10) }
    _model, ui, result = import_doc(mini_doc(nodes))
    assert ui.statuses.any? { |s| s.start_with?('Importing...') }
    assert_equal 601, result.groups
  end
end

# ------------------------------------------------------------------------------
class ExamplesTest < ImporterTestCase
  def count_nodes(node, counts)
    counts[node['type']] += 1
    (node['children'] || []).each { |c| count_nodes(c, counts) }
    counts
  end

  files = Dir.glob(File.join(EXAMPLES, '*.sketchup.json')).sort
  if files.empty?
    define_method(:test_no_exporter_examples_yet) { skip 'no files in examples/sketchup yet' }
  end

  files.each do |path|
    define_method("test_example_#{File.basename(path, '.sketchup.json').gsub(/\W/, '_')}") do
      doc = JSON.parse(File.read(path))
      model, ui, result = import_path(path)
      refute_nil result, "#{File.basename(path)}: #{ui.messages.first}"
      assert_equal [:start, :commit], model.operations.map(&:first)
      assert_empty ui.messages, 'no problems expected for an exporter sample'
      assert_equal 0, result.skipped
      expected = count_nodes(doc['root'], Hash.new(0))
      assert_equal expected.values.inject(0, :+), result.groups, 'one SketchUp group per node'
      expected.each { |type, n| assert_equal n, result.counts[type], "#{type} count" }
      assert_equal doc['zShift'], model.get_attribute('cmrlm', 'zShift')
      assert_equal doc['name'], model.entities.grep(Sketchup::Group).first.name
      doc['tags'].each { |t| refute_nil model.layers[t['name']], "tag #{t['name']}" }
      doc['materials'].each { |m| refute_nil model.materials[m['name']], "material #{m['name']}" }
      if doc['location']
        assert_equal doc['location']['lat'], model.shadow_info['Latitude']
      end
    end
  end
end

# ------------------------------------------------------------------------------
class SpeedAndSyntaxTest < ImporterTestCase
  def test_large_site_overhead_is_small_in_the_mock
    n = 101
    verts = []
    n.times { |j| n.times { |i| verts << [i * 30.0, j * 30.0, 10 + Math.sin(i / 7.0) * 3] } }
    tris = []
    (n - 1).times do |j|
      (n - 1).times do |i|
        a = j * n + i
        tris << [a, a + 1, a + n + 1] << [a, a + n + 1, a + n]
      end
    end
    nodes = [{ 'type' => 'mesh', 'name' => 'Ground', 'soft' => true, 'closed' => false, 'vertices' => verts, 'triangles' => tris }]
    1000.times { |i| nodes << solid_node("Bldg #{i}", (i % 50) * 60, (i / 50) * 60, 40, 40, 10, 40) }
    doc = mini_doc(nodes)
    t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    _model, ui, result = import_doc(doc)
    dt = Process.clock_gettime(Process::CLOCK_MONOTONIC) - t0
    assert_equal 20_000, tris.length
    assert_equal 1002, result.groups
    assert_empty ui.messages
    assert_operator dt, :<, 20.0, "importer overhead with the mock was #{dt.round(1)} s"
    puts "\n  [info] 20,000 triangles + 1,000 solids through the mock: #{dt.round(2)} s (SketchUp itself will be slower)"
  end

  def test_every_ruby_file_passes_syntax_check
    files = Dir.glob(File.join(ROOT_DIR, 'sketchup', '**', '*.rb')) + Dir.glob(File.join(ROOT_DIR, 'test', 'sketchup', '*.rb'))
    assert_operator files.length, :>=, 5
    files.each do |f|
      out, status = Open3.capture2e(RbConfig.ruby, '-c', f)
      assert status.success?, "#{f}: #{out}"
    end
  end

  def test_no_ruby_3_only_syntax_in_extension_files
    # SketchUp 2021 runs Ruby 2.7. These patterns would fail there.
    Dir.glob(File.join(ROOT_DIR, 'sketchup', '**', '*.rb')).each do |f|
      src = File.read(f, encoding: 'UTF-8')
      refute_match(/\bdef\s+\w+(\(.*\))?\s*=\s/, src, "#{f}: endless method")
      refute_match(/\.except\(/, src, "#{f}: Hash#except is Ruby 3")
      refute_match(/\bin\s*\{/, src, "#{f}: pattern matching")
      refute_match(/\(\.\.\.\)/, src, "#{f}: argument forwarding with ...")
    end
  end
end
