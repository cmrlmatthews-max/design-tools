# encoding: UTF-8
#
# A minimal fake of the SketchUp Ruby API. It covers only what importer.rb uses,
# and it RECORDS calls so tests can check them. It is not SketchUp: it cannot
# prove the real API behaves this way. See docs/sketchup-spec.md section 6.
#
# Conventions copied from SketchUp (as far as we know them):
#   - Point units are inches.
#   - A face normal follows the right-hand rule on the vertex order.
#   - Face#pushpull(d) moves the face along its normal by d.
#   - Materials#add / Layers#add make a NEW item with a unique name when the name exists.

require 'set'

class Numeric
  def feet
    self * 12.0
  end
end

module Geom
  class Point3d
    attr_reader :x, :y, :z

    def initialize(x = 0, y = 0, z = 0)
      @x = x.to_f
      @y = y.to_f
      @z = z.to_f
    end

    def to_a
      [@x, @y, @z]
    end

    def ==(other)
      other.respond_to?(:to_a) && to_a == other.to_a
    end

    def distance(other)
      Math.sqrt((x - other.x)**2 + (y - other.y)**2 + (z - other.z)**2)
    end

    def inspect
      "Pt(#{x.round(3)}, #{y.round(3)}, #{z.round(3)})"
    end
  end

  class Vector3d
    attr_reader :x, :y, :z

    def initialize(x, y, z)
      @x = x
      @y = y
      @z = z
    end
  end

  class PolygonMesh
    attr_reader :points, :polygons

    def initialize(npoints = 0, npolys = 0)
      @points = []
      @polygons = []
      @lookup = {}
    end

    # Like the real one: 1-based index, and an identical point returns the existing index.
    def add_point(pt)
      key = pt.to_a
      return @lookup[key] if @lookup[key]
      @points << pt
      @lookup[key] = @points.length
    end

    def add_polygon(*idx)
      raise ArgumentError, 'polygon needs 3 or more indices' if idx.length < 3
      @polygons << idx
      @polygons.length
    end

    def count_points
      @points.length
    end

    def count_polygons
      @polygons.length
    end
  end
end

module Sketchup
  # Test switches. Tests reset them in setup.
  module Mock
    class << self
      attr_accessor :pushpull_sign, :manifold, :add_face_failure, :fill_from_mesh_fails, :fail_at_group_named

      def reset!
        @pushpull_sign = 1            # -1 simulates the opposite sign convention
        @manifold = true
        @add_face_failure = nil       # lambda(points) -> true to make add_face raise
        @fill_from_mesh_fails = false
        @fail_at_group_named = nil    # group name: raise when it is added (tests the abort path)
      end
    end
    reset!
  end

  def self.status_text=(text)
    (@status ||= []) << text
  end

  def self.status_log
    @status ||= []
  end

  class Color
    attr_reader :red, :green, :blue, :alpha

    def initialize(r = 0, g = 0, b = 0, a = 255)
      @red = r
      @green = g
      @blue = b
      @alpha = a
    end

    def to_a
      [red, green, blue]
    end
  end

  class Material
    attr_accessor :name, :color, :alpha
  end

  class Materials
    include Enumerable
    attr_reader :add_calls

    def initialize
      @items = []
      @add_calls = 0
    end

    def each(&block)
      @items.each(&block)
    end

    def [](name)
      @items.find { |m| m.name == name }
    end

    def add(name)
      @add_calls += 1
      m = Material.new
      m.name = unique(name)
      @items << m
      m
    end

    def length
      @items.length
    end

    def snapshot
      @items.dup
    end

    def restore(items)
      @items = items
    end

    private

    def unique(name)
      return name unless self[name]
      n = 1
      n += 1 while self["#{name}##{n}"]
      "#{name}##{n}"
    end
  end

  class Layer
    attr_accessor :name, :color, :visible

    def initialize(name)
      @name = name
      @visible = true
    end
  end

  class Layers
    include Enumerable

    def initialize
      @items = [Layer.new('Layer0')]
    end

    def each(&block)
      @items.each(&block)
    end

    def [](key)
      key.is_a?(Integer) ? @items[key] : @items.find { |l| l.name == key }
    end

    def add(name)
      l = Layer.new(self[name] ? "#{name}#1" : name)
      @items << l
      l
    end

    def length
      @items.length
    end

    def snapshot
      @items.dup
    end

    def restore(items)
      @items = items
    end
  end

  class Edge
    attr_reader :faces, :start, :stop
    attr_accessor :soft, :smooth

    def initialize(a, b)
      @start = a
      @stop = b
      @faces = []
      @soft = false
      @smooth = false
    end
  end

  class Face
    attr_reader :points, :erased, :owner, :moved_from
    attr_accessor :edges

    def initialize(points, owner)
      @points = points.dup
      @owner = owner
      @erased = false
      @reversed = 0
      @pushpulls = []
      @edges = []
      @moved_from = nil
    end

    def valid?
      !@erased
    end

    def reversed_count
      @reversed
    end

    def pushpulls
      @pushpulls
    end

    # Newell's method: right-hand rule on the vertex order.
    def normal
      nx = ny = nz = 0.0
      n = @points.length
      n.times do |i|
        p = @points[i]
        q = @points[(i + 1) % n]
        nx += (p.y - q.y) * (p.z + q.z)
        ny += (p.z - q.z) * (p.x + q.x)
        nz += (p.x - q.x) * (p.y + q.y)
      end
      len = Math.sqrt(nx * nx + ny * ny + nz * nz)
      len = 1.0 if len.zero?
      Geom::Vector3d.new(nx / len, ny / len, nz / len)
    end

    def reverse!
      @points.reverse!
      @reversed += 1
      self
    end

    def pushpull(distance)
      @pushpulls << distance
      n = normal
      @moved_from ||= @points.dup
      d = distance * Sketchup::Mock.pushpull_sign
      @points = @points.map { |p| Geom::Point3d.new(p.x + n.x * d, p.y + n.y * d, p.z + n.z * d) }
      self
    end

    def erase!
      @erased = true
      @owner.remove(self)
    end

    def all_points
      @points + (@moved_from || [])
    end
  end

  class BoundingBox
    attr_reader :min, :max

    def initialize(pts)
      @min = Geom::Point3d.new(pts.map(&:x).min || 0, pts.map(&:y).min || 0, pts.map(&:z).min || 0)
      @max = Geom::Point3d.new(pts.map(&:x).max || 0, pts.map(&:y).max || 0, pts.map(&:z).max || 0)
    end
  end

  class Entities
    include Enumerable
    attr_reader :faces_added, :curves, :edge_lists, :meshes_filled, :owner

    def initialize(owner = nil)
      @owner = owner
      @items = []
      @faces_added = 0
      @curves = []
      @edge_lists = []
      @meshes_filled = []
    end

    def each(&block)
      @items.each(&block)
    end

    def length
      @items.length
    end
    alias size length

    def to_a
      @items.dup
    end

    def remove(item)
      @items.delete(item)
    end

    def clear!
      @items.clear
    end

    def add_group(*_args)
      g = Group.new(self)
      @items << g
      g
    end

    def add_face(*args)
      pts = args.length == 1 && args[0].is_a?(Array) ? args[0] : args
      raise ArgumentError, 'Points are not valid' if pts.length < 3
      pts = pts.map { |p| p.is_a?(Array) ? Geom::Point3d.new(*p) : p }
      pts.each_with_index do |p, i|
        q = pts[(i + 1) % pts.length]
        raise ArgumentError, 'Duplicate points in array' if p.distance(q) < 0.001
      end
      hook = Sketchup::Mock.add_face_failure
      raise ArgumentError, 'Points are not planar' if hook && hook.call(pts)
      f = Face.new(pts, self)
      @faces_added += 1
      @items << f
      f
    end

    def add_curve(*args)
      pts = args.length == 1 && args[0].is_a?(Array) ? args[0] : args
      raise ArgumentError, 'Duplicate points in array' if consecutive_duplicates?(pts)
      @curves << pts
      pts.each_cons(2) { |a, b| @items << Edge.new(a, b) }
      pts
    end

    def add_edges(*args)
      pts = args.length == 1 && args[0].is_a?(Array) ? args[0] : args
      raise ArgumentError, 'Duplicate points in array' if consecutive_duplicates?(pts)
      @edge_lists << pts
      pts.each_cons(2) { |a, b| @items << Edge.new(a, b) }
      pts
    end

    def fill_from_mesh(mesh, weld, flags)
      raise ArgumentError, 'mesh refused' if Sketchup::Mock.fill_from_mesh_fails
      @meshes_filled << { points: mesh.count_points, polygons: mesh.count_polygons, weld: weld, flags: flags }
      edges = {}
      mesh.polygons.each do |poly|
        pts = poly.map { |i| mesh.points[i - 1] }
        f = Face.new(pts, self)
        @items << f
        poly.each_with_index do |i, k|
          j = poly[(k + 1) % poly.length]
          key = [i, j].sort
          e = (edges[key] ||= Edge.new(mesh.points[key[0] - 1], mesh.points[key[1] - 1]).tap { |ed| @items << ed })
          e.faces << f
          f.edges << e
        end
      end
      true
    end

    def consecutive_duplicates?(pts)
      pts.each_cons(2).any? { |a, b| a.distance(b) < 0.001 }
    end
  end

  class Group
    attr_reader :entities, :parent, :attributes, :erased
    attr_reader :name
    attr_accessor :layer, :material

    def initialize(parent)
      @parent = parent
      @entities = Entities.new(self)
      @attributes = {}
      @erased = false
    end

    # A test can set Sketchup::Mock.fail_at_group_named to make naming one group raise.
    def name=(value)
      raise 'Simulated SketchUp failure' if Sketchup::Mock.fail_at_group_named && value == Sketchup::Mock.fail_at_group_named
      @name = value
    end

    def set_attribute(dict, key, value)
      (@attributes[dict] ||= {})[key] = value
    end

    def get_attribute(dict, key, default = nil)
      (@attributes[dict] || {}).fetch(key, default)
    end

    def manifold?
      Sketchup::Mock.manifold
    end

    def erase!
      @erased = true
      @parent.remove(self)
    end

    def valid?
      !@erased
    end

    def bounds
      BoundingBox.new(descendant_points)
    end

    def descendant_points
      pts = []
      entities.each do |e|
        case e
        when Face then pts.concat(e.all_points)
        when Group then pts.concat(e.descendant_points)
        when Edge then pts << e.start << e.stop
        end
      end
      pts
    end

    # ---- helpers for tests ----
    def groups
      entities.grep(Group)
    end

    def faces
      entities.grep(Face)
    end

    def edges
      entities.grep(Edge)
    end
  end

  class View
    attr_reader :zoomed

    def zoom(entity)
      @zoomed = entity
    end
  end

  class Model
    attr_reader :layers, :materials, :entities, :operations, :attributes, :shadow_info, :active_view

    def initialize
      @layers = Layers.new
      @materials = Materials.new
      @entities = Entities.new(self)
      @operations = []     # [[:start, name, disable_ui], [:commit], [:abort]]
      @attributes = {}
      @shadow_info = {}
      @active_view = View.new
      @open = false
    end

    def remove(item)
      @entities.remove(item)
    end

    def start_operation(name, disable_ui = false, *_rest)
      raise 'operation already open' if @open
      @open = true
      @operations << [:start, name, disable_ui]
      @snapshot = { layers: @layers.snapshot, materials: @materials.snapshot, entities: @entities.to_a,
                    attributes: Marshal.load(Marshal.dump(@attributes)), shadow: @shadow_info.dup }
      true
    end

    def commit_operation
      raise 'no operation open' unless @open
      @open = false
      @operations << [:commit]
      true
    end

    def abort_operation
      raise 'no operation open' unless @open
      @open = false
      @operations << [:abort]
      @layers.restore(@snapshot[:layers])
      @materials.restore(@snapshot[:materials])
      @entities.clear!
      @snapshot[:entities].each { |e| @entities.instance_variable_get(:@items) << e }
      @attributes = @snapshot[:attributes]
      @shadow_info.replace(@snapshot[:shadow])
      true
    end

    def operation_open?
      @open
    end

    def set_attribute(dict, key, value)
      (@attributes[dict] ||= {})[key] = value
    end

    def get_attribute(dict, key, default = nil)
      (@attributes[dict] || {}).fetch(key, default)
    end

    # True when nothing is left in the model except the defaults.
    def pristine?
      @entities.length.zero? && @layers.length == 1 && @materials.length.zero? &&
        @attributes.empty? && @shadow_info.empty?
    end
  end
end

module UI
  class << self
    def messages
      @messages ||= []
    end

    def messagebox(text, *_rest)
      messages << text
      1
    end

    def reset!
      @messages = []
    end
  end
end

# The `ui` object that the importer takes. Records everything.
class RecordingUI
  attr_reader :messages, :statuses

  def initialize
    @messages = []
    @statuses = []
  end

  def message(text)
    @messages << text
  end

  def status(text)
    @statuses << text
  end
end
