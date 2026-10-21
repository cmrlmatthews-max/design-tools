# encoding: UTF-8
#
# CMRLM Design Tools - importer
#
# Reads a ".sketchup.json" file (format "cmrlm-design-tools/sketchup", version 1)
# and builds native SketchUp geometry. All logic lives here. The class takes the
# model and a `ui` object as arguments, so a mock SketchUp API can test it.
#
# Written for Ruby 2.7 (SketchUp 2021). Do not use newer syntax.
#
# Units: the file is in feet. SketchUp works in inches. Every length is x 12.

require 'json'

module CMRLM
  module DesignTools
    # A problem that the user must hear about, in a plain sentence.
    class ImportError < StandardError; end

    # Talks to the real SketchUp UI. Tests pass their own object with the same two methods.
    class DefaultUI
      def message(text)
        UI.messagebox(text)
      end

      def status(text)
        Sketchup.status_text = text
      rescue StandardError
        nil
      end
    end

    class Importer
      FORMAT       = 'cmrlm-design-tools/sketchup'.freeze
      FILE_VERSION = 1
      ATTR_DICT    = 'cmrlm'.freeze
      IN_PER_FT    = 12.0
      TINY         = 0.002   # inches. Points closer than this count as the same point.
      MIN_AREA     = 1.0e-6  # square inches. Smaller triangles are degenerate.
      HEIGHT_TOL   = 0.05    # inches. Allowed error when we check an extrusion.
      HEX          = /\A#[0-9a-fA-F]{6}\z/.freeze
      NODE_TYPES   = %w[group solid mesh faces lines].freeze
      MAX_ERRORS   = 5
      MAX_DEPTH    = 64

      Result = Struct.new(:root, :name, :source, :counts, :groups, :skipped, :height_warnings, :summary)

      attr_reader :model, :ui

      def initialize(model, ui = nil)
        @model = model
        @ui = ui || DefaultUI.new
      end

      # Reads a file, validates it, and imports it.
      # Returns a Result on success. Returns nil after it has shown a message on failure.
      def import_file(path)
        doc = load_file(path)
        import_doc(doc)
      rescue ImportError => e
        @ui.message(e.message)
        nil
      end

      # Imports an already-parsed document (a Hash). Same return values as import_file.
      def import_doc(doc)
        begin
          validate!(doc)
        rescue ImportError => e
          @ui.message(e.message)
          return nil
        end
        reset_state
        name = doc['name'].to_s
        name = 'Design Tools import' if name.strip.empty?

        started = false
        result = nil
        begin
          @model.start_operation("Import #{name}", true)
          started = true
          result = build(doc, name)
          @model.commit_operation
        rescue StandardError => e
          abort_quietly if started
          @ui.message(failure_message(e))
          return nil
        end

        @ui.status(result.summary)
        if result.skipped > 0
          @ui.message("#{result.summary}.\n\n" \
                      "SketchUp could not build #{count_words(result.skipped, 'face')}. " \
                      'Their points were too close together or not flat. ' \
                      'The rest of the file is fine.')
        end
        result
      end

      # ---- Reading and validation --------------------------------------

      def load_file(path)
        if path.nil? || path.to_s.empty? || !File.file?(path.to_s)
          raise ImportError, "SketchUp could not find this file:\n#{path}"
        end
        begin
          text = File.read(path.to_s, encoding: 'bom|utf-8')
        rescue SystemCallError, IOError => e
          raise ImportError, "SketchUp could not read this file:\n#{path}\n\n#{e.message}"
        end
        begin
          JSON.parse(text)
        rescue JSON::ParserError, EncodingError
          raise ImportError, 'This file is not valid JSON. SketchUp cannot read it. ' \
                             'Export the file from the Design Tools again.'
        end
      end

      # Raises ImportError with a plain sentence when the document is not usable.
      # Nothing has touched the model at this point.
      def validate!(doc)
        unless doc.is_a?(Hash)
          raise ImportError, 'This file is not a Design Tools file. Its top level is not an object.'
        end
        unless doc['format'] == FORMAT
          raise ImportError, 'This file is not a Design Tools SketchUp file. ' \
                             "Its format is #{doc['format'].inspect}. The format must be \"#{FORMAT}\"."
        end
        version = doc['version']
        unless version == FILE_VERSION
          if version.is_a?(Numeric) && version > FILE_VERSION
            raise ImportError, "This file is version #{version}. This extension reads version #{FILE_VERSION}. " \
                               'Install the newest CMRLM Design Tools extension.'
          end
          raise ImportError, "This file has the version #{version.inspect}. This extension reads version #{FILE_VERSION}."
        end
        unless doc['units'] == 'feet'
          raise ImportError, "This file uses the units #{doc['units'].inspect}. This extension reads feet only."
        end
        unless doc['root'].is_a?(Hash)
          raise ImportError, 'This file has no root group. Export the file from the Design Tools again.'
        end

        errors = structural_errors(doc)
        return if errors.empty?
        shown = errors.first(MAX_ERRORS)
        more = errors.length > shown.length ? "\n(and #{errors.length - shown.length} more)" : ''
        raise ImportError, "This file has errors. SketchUp changed nothing.\n\n#{shown.join("\n")}#{more}"
      end

      # Returns an Array of strings. Mirrors validateDoc in src/shared/sketchup-format.js,
      # except ring direction and ring area: the importer fixes those itself.
      def structural_errors(doc)
        errors = []
        err = lambda { |path, msg| errors << "#{path}: #{msg}" if errors.length < 200 }

        err.call('source', 'must be "tower" or "site"') unless %w[tower site].include?(doc['source'])
        err.call('zShift', 'must be a number') unless num?(doc['zShift'])

        tag_names = {}
        mat_names = {}
        tags = doc['tags'].nil? ? [] : doc['tags']
        mats = doc['materials'].nil? ? [] : doc['materials']
        err.call('tags', 'must be a list') unless tags.is_a?(Array)
        err.call('materials', 'must be a list') unless mats.is_a?(Array)
        tags = [] unless tags.is_a?(Array)
        mats = [] unless mats.is_a?(Array)

        tags.each_with_index do |t, i|
          unless t.is_a?(Hash)
            err.call("tags[#{i}]", 'must be an object')
            next
          end
          err.call("tags[#{i}]", 'needs a name') if t['name'].to_s.empty?
          err.call("tags[#{i}]", 'color must be #rrggbb') unless t['color'].is_a?(String) && t['color'] =~ HEX
          tag_names[t['name']] = true
        end
        mats.each_with_index do |m, i|
          unless m.is_a?(Hash)
            err.call("materials[#{i}]", 'must be an object')
            next
          end
          err.call("materials[#{i}]", 'needs a name') if m['name'].to_s.empty?
          err.call("materials[#{i}]", 'color must be #rrggbb') unless m['color'].is_a?(String) && m['color'] =~ HEX
          a = m['alpha']
          err.call("materials[#{i}]", 'alpha must be above 0 and at most 1') unless num?(a) && a > 0 && a <= 1
          mat_names[m['name']] = true
        end

        walk = nil
        walk = lambda do |n, path, depth|
          unless n.is_a?(Hash)
            err.call(path, 'node is not an object')
            next
          end
          unless NODE_TYPES.include?(n['type'])
            err.call(path, "unknown type #{n['type'].inspect}")
            next
          end
          err.call(path, 'needs a name') unless n['name'].is_a?(String) && !n['name'].empty?
          err.call(path, "tag \"#{n['tag']}\" is not in tags") if !n['tag'].nil? && !tag_names[n['tag']]
          err.call(path, "material \"#{n['material']}\" is not in materials") if !n['material'].nil? && !mat_names[n['material']]
          if depth > MAX_DEPTH
            err.call(path, 'groups are nested too deep')
            next
          end
          case n['type']
          when 'group'
            if n['children'].is_a?(Array)
              n['children'].each_with_index do |c, i|
                label = c.is_a?(Hash) && c['name'] ? c['name'] : i
                walk.call(c, "#{path}/#{label}", depth + 1)
              end
            else
              err.call(path, 'group needs children')
            end
          when 'solid'
            ring_error(n['outer'], 2, "#{path}.outer", err)
            holes = n['holes'].nil? ? [] : n['holes']
            if holes.is_a?(Array)
              holes.each_with_index { |h, i| ring_error(h, 2, "#{path}.holes[#{i}]", err) }
            else
              err.call(path, 'holes must be a list')
            end
            ok = num?(n['z0']) && num?(n['z1']) && n['z1'] - n['z0'] > 0.001
            err.call(path, 'needs z1 above z0') unless ok
          when 'mesh'
            v = n['vertices']
            t = n['triangles']
            nv = v.is_a?(Array) ? v.length : 0
            if nv == 0 || !v.all? { |p| pt?(p, 3) }
              err.call(path, 'vertices must be [x,y,z]')
            end
            if !t.is_a?(Array) || t.empty?
              err.call(path, 'needs triangles')
            else
              bad = t.any? do |tri|
                !(tri.is_a?(Array) && tri.length == 3 &&
                  tri.all? { |k| k.is_a?(Integer) && k >= 0 && k < nv })
              end
              err.call(path, 'has a bad triangle index') if bad
            end
          when 'faces'
            polys = n['polygons']
            if !polys.is_a?(Array) || polys.empty?
              err.call(path, 'needs polygons')
            else
              polys.each_with_index do |p, i|
                unless p.is_a?(Hash)
                  err.call("#{path}.polygons[#{i}]", 'must be an object')
                  next
                end
                ring_error(p['outer'], 3, "#{path}.polygons[#{i}].outer", err)
                holes = p['holes'].nil? ? [] : p['holes']
                if holes.is_a?(Array)
                  holes.each_with_index { |h, j| ring_error(h, 3, "#{path}.polygons[#{i}].holes[#{j}]", err) }
                else
                  err.call(path, 'holes must be a list')
                end
              end
            end
          when 'lines'
            ls = n['lines']
            if !ls.is_a?(Array) || ls.empty?
              err.call(path, 'needs lines')
            elsif ls.any? { |l| !(l.is_a?(Array) && l.length >= 2 && l.all? { |p| pt?(p, 3) }) }
              err.call(path, 'each line needs 2 or more [x,y,z] points')
            end
          end
        end

        if doc['root']['type'] != 'group'
          err.call('root', 'must be a group')
        else
          walk.call(doc['root'], doc['root']['name'] || 'root', 0)
        end
        errors
      end

      # ---- Building -----------------------------------------------------

      private

      def reset_state
        @counts = Hash.new(0)
        @skipped = 0
        @height_warnings = 0
        @tags = {}
        @materials = {}
        @built = 0
      end

      def abort_quietly
        @model.abort_operation
      rescue StandardError
        nil
      end

      def failure_message(error)
        "The import stopped. SketchUp undid it and changed nothing.\n\n#{error.message}"
      end

      def build(doc, name)
        create_tags(doc['tags'] || [])
        create_materials(doc['materials'] || [])

        root = build_node(doc['root'], @model.entities, 0)
        raise ImportError, 'The file has no geometry that SketchUp could build.' if root.nil?

        set_location(doc['location'])
        set_model_attributes(doc, root, name)

        groups = @counts.values.inject(0) { |s, v| s + v }
        summary = "Imported #{groups} #{groups == 1 ? 'group' : 'groups'} from #{name}"
        summary += " (#{count_words(@skipped, 'face')} skipped)" if @skipped > 0
        Result.new(root, name, doc['source'], @counts.dup, groups, @skipped, @height_warnings, summary)
      end

      def create_tags(list)
        list.each do |t|
          layer = @model.layers[t['name']] || @model.layers.add(t['name'])
          if layer.respond_to?(:color=)
            begin
              layer.color = color_of(t['color'])
            rescue StandardError
              nil
            end
          end
          layer.visible = (t['visible'] != false)
          @tags[t['name']] = layer
        end
      end

      def create_materials(list)
        list.each do |m|
          mat = @model.materials[m['name']] || @model.materials.add(m['name'])
          mat.color = color_of(m['color'])
          mat.alpha = m['alpha'].to_f
          @materials[m['name']] = mat
        end
      end

      def color_of(hex)
        Sketchup::Color.new(hex[1, 2].to_i(16), hex[3, 2].to_i(16), hex[5, 2].to_i(16))
      end

      def set_location(loc)
        return unless loc.is_a?(Hash) && num?(loc['lat']) && num?(loc['lon'])
        return unless loc['lat'].abs <= 90 && loc['lon'].abs <= 180
        begin
          info = @model.shadow_info
          info['Latitude'] = loc['lat'].to_f
          info['Longitude'] = loc['lon'].to_f
        rescue StandardError
          nil # The API refused. The geometry is still fine.
        end
      end

      def set_model_attributes(doc, root, name)
        notes = doc['notes'].is_a?(Array) ? doc['notes'].map(&:to_s).join("\n") : nil
        values = {
          'zShift' => doc['zShift'].to_f,
          'source' => doc['source'].to_s,
          'name' => name,
          'createdAt' => doc['createdAt'].to_s
        }
        values['notes'] = notes if notes && !notes.empty?
        values.each do |k, v|
          @model.set_attribute(ATTR_DICT, k, v)
          root.set_attribute(ATTR_DICT, k, v)
        end
      end

      # Builds one node inside parent_entities. Returns the group, or nil when the node
      # produced nothing (SketchUp removes empty groups, so we do it ourselves).
      def build_node(node, parent_entities, depth)
        group = parent_entities.add_group
        group.name = node['name'].to_s
        if node['tag'] && @tags[node['tag']]
          group.layer = @tags[node['tag']]
        end
        if node['material'] && @materials[node['material']]
          group.material = @materials[node['material']]
        end

        case node['type']
        when 'group'
          node['children'].each { |c| build_node(c, group.entities, depth + 1) }
        when 'solid'
          build_solid(group, node)
        when 'mesh'
          build_mesh(group, node)
        when 'faces'
          build_faces(group, node)
        when 'lines'
          build_lines(group, node)
        end

        if group.entities.length == 0
          group.erase!
          return nil
        end

        set_node_attributes(group, node['attributes'])
        @counts[node['type']] += 1
        @built += 1
        @ui.status("Importing... #{@built} groups built") if (@built % 250).zero?
        group
      end

      def set_node_attributes(group, attrs)
        return unless attrs.is_a?(Hash)
        attrs.each do |k, v|
          case v
          when String, Numeric, true, false
            group.set_attribute(ATTR_DICT, k.to_s, v)
          end
        end
      end

      # ---- solid --------------------------------------------------------

      def build_solid(group, node)
        z0 = node['z0'].to_f
        z1 = node['z1'].to_f
        outer = ring_inches(node['outer'], z0)
        if outer.nil?
          @skipped += 1
          return
        end
        holes = (node['holes'] || []).map { |h| ring_inches(h, z0) }

        skipped_before = @skipped
        ok = extrude(group, outer, holes, z0, z1, false)
        unless ok
          # The extrusion went the wrong way (the sign convention was not what we expected). Try once more.
          group.entities.clear!
          @skipped = skipped_before
          ok = extrude(group, outer, holes, z0, z1, true)
          @height_warnings += 1 unless ok
        end
        return if group.entities.length == 0

        begin
          group.set_attribute(ATTR_DICT, 'manifold', false) unless group.manifold?
        rescue NoMethodError
          nil
        end
      end

      # Builds the bottom face, erases the holes, and pushes the face up.
      # Returns true when the finished height is right (or cannot be checked).
      def extrude(group, outer, holes, z0, z1, flip)
        ents = group.entities
        face = begin
          ents.add_face(points(outer))
        rescue StandardError
          nil
        end
        if face.nil?
          @skipped += 1
          return true # Nothing to retry. The group stays empty and is erased by the caller.
        end

        holes.each do |h|
          if h.nil?
            @skipped += 1
            next
          end
          begin
            hole_face = ents.add_face(points(h))
            hole_face.erase! if hole_face
          rescue StandardError
            @skipped += 1
          end
        end
        # The outer face may be a new object after the holes were cut. Find the one that is left.
        face = ents.grep(Sketchup::Face).first || face unless holes.empty?

        # Bottom face: normal down. Then a negative push-pull rises.
        face.reverse! if face.normal.z > 0
        distance = -((z1 - z0) * IN_PER_FT)
        distance = -distance if flip
        begin
          face.pushpull(distance)
        rescue StandardError
          ents.clear!
          @skipped += 1
          return true
        end
        height_ok?(group, z0, z1)
      end

      def height_ok?(group, z0, z1)
        b = group.bounds
        (b.max.z - z1 * IN_PER_FT).abs <= HEIGHT_TOL && (b.min.z - z0 * IN_PER_FT).abs <= HEIGHT_TOL
      rescue StandardError
        true # Cannot check. Trust the push-pull.
      end

      # ---- mesh ---------------------------------------------------------

      def build_mesh(group, node)
        verts = node['vertices']
        tris = node['triangles']
        closed = node['closed'] == true
        soft = node['soft'] == true && !closed

        mesh = Geom::PolygonMesh.new(verts.length, tris.length)
        index = verts.map { |v| mesh.add_point(Geom::Point3d.new(v[0] * IN_PER_FT, v[1] * IN_PER_FT, v[2] * IN_PER_FT)) }

        added = 0
        tris.each do |t|
          a, b, c = t
          if index[a] == index[b] || index[b] == index[c] || index[a] == index[c] || degenerate?(verts[a], verts[b], verts[c])
            @skipped += 1
            next
          end
          mesh.add_polygon(index[a], index[b], index[c])
          added += 1
        end
        return if added == 0

        ents = group.entities
        begin
          ents.fill_from_mesh(mesh, true, 0)
        rescue StandardError
          ents.clear!
          fill_one_by_one(ents, verts, tris)
        end

        faces = ents.grep(Sketchup::Face)
        faces.each { |f| f.reverse! if f.normal.z < 0 } unless closed
        soften_interior_edges(ents) if soft
      end

      # Fallback when fill_from_mesh refuses the mesh: one add_face per triangle.
      def fill_one_by_one(ents, verts, tris)
        tris.each do |t|
          pts = t.map { |k| Geom::Point3d.new(verts[k][0] * IN_PER_FT, verts[k][1] * IN_PER_FT, verts[k][2] * IN_PER_FT) }
          begin
            ents.add_face(pts)
          rescue StandardError
            @skipped += 1
          end
        end
      end

      # Soft + smooth for every edge between two triangles. Boundary edges (one face) stay hard.
      def soften_interior_edges(ents)
        ents.grep(Sketchup::Edge).each do |e|
          next unless e.faces.length == 2
          e.soft = true
          e.smooth = true
        end
      end

      def degenerate?(p, q, r)
        ux = (q[0] - p[0]) * IN_PER_FT
        uy = (q[1] - p[1]) * IN_PER_FT
        uz = (q[2] - p[2]) * IN_PER_FT
        wx = (r[0] - p[0]) * IN_PER_FT
        wy = (r[1] - p[1]) * IN_PER_FT
        wz = (r[2] - p[2]) * IN_PER_FT
        cx = uy * wz - uz * wy
        cy = uz * wx - ux * wz
        cz = ux * wy - uy * wx
        Math.sqrt(cx * cx + cy * cy + cz * cz) / 2.0 < MIN_AREA
      end

      # ---- faces --------------------------------------------------------

      def build_faces(group, node)
        ents = group.entities
        node['polygons'].each do |poly|
          outer = ring_inches(poly['outer'], nil)
          if outer.nil?
            @skipped += 1
            next
          end
          face = begin
            ents.add_face(points(outer))
          rescue StandardError
            nil
          end
          if face.nil?
            @skipped += 1
            next
          end
          face.reverse! if face.normal.z < 0 # faces up

          (poly['holes'] || []).each do |h|
            ring = ring_inches(h, nil)
            if ring.nil?
              @skipped += 1
              next
            end
            begin
              hole_face = ents.add_face(points(ring))
              hole_face.erase! if hole_face
            rescue StandardError
              @skipped += 1
            end
          end
        end
      end

      # ---- lines --------------------------------------------------------

      def build_lines(group, node)
        ents = group.entities
        node['lines'].each do |line|
          pts = dedupe(line.map { |p| [p[0] * IN_PER_FT, p[1] * IN_PER_FT, p[2] * IN_PER_FT] }, false)
          next if pts.length < 2 # every segment had zero length
          add_polyline(ents, points(pts))
        end
      end

      def add_polyline(ents, pts)
        if pts.length > 2
          begin
            ents.add_curve(pts)
            return
          rescue StandardError
            nil
          end
        end
        ents.add_edges(pts)
      rescue StandardError
        nil # A bad polyline is not worth stopping the import.
      end

      # ---- helpers ------------------------------------------------------

      # Coordinates in feet -> an Array of [x, y, z] in inches, cleaned. nil when fewer than 3 points remain.
      # `z_ft` gives the height for 2-D rings; pass nil for 3-D rings.
      def ring_inches(coords, z_ft)
        pts = coords.map do |c|
          z = z_ft.nil? ? c[2] : z_ft
          [c[0] * IN_PER_FT, c[1] * IN_PER_FT, z * IN_PER_FT]
        end
        pts = dedupe(pts, true)
        pts.length < 3 ? nil : pts
      end

      # Remove points that repeat the previous point. For rings, also remove a repeated first point at the end.
      def dedupe(pts, closed)
        out = []
        pts.each do |p|
          out << p if out.empty? || dist(out[-1], p) > TINY
        end
        out.pop while closed && out.length > 1 && dist(out[0], out[-1]) <= TINY
        out
      end

      def dist(a, b)
        dx = a[0] - b[0]
        dy = a[1] - b[1]
        dz = a[2] - b[2]
        Math.sqrt(dx * dx + dy * dy + dz * dz)
      end

      def points(arrays)
        arrays.map { |p| Geom::Point3d.new(p[0], p[1], p[2]) }
      end

      def num?(v)
        v.is_a?(Numeric) && v.finite?
      end

      def pt?(p, d)
        p.is_a?(Array) && p.length == d && p.all? { |v| num?(v) }
      end

      # Adds an error when a ring is not a list of 3+ points. Direction and area are not checked.
      def ring_error(ring, dims, path, err)
        if !ring.is_a?(Array) || ring.length < 3 || !ring.all? { |p| pt?(p, dims) }
          err.call(path, "ring needs 3 or more points of #{dims} numbers")
        end
      end

      def count_words(n, noun)
        "#{n} #{n == 1 ? noun : noun + 's'}"
      end
    end
  end
end
