# encoding: UTF-8
#
# CMRLM Design Tools - SketchUp extension loader.
# Registers the extension. SketchUp loads cmrlm_design_tools/main.rb when the extension is enabled.

require 'sketchup.rb'
require 'extensions.rb'

module CMRLM
  module DesignTools
    VERSION = '1.0.0'.freeze

    unless file_loaded?(__FILE__)
      ext = SketchupExtension.new('CMRLM Design Tools', 'cmrlm_design_tools/main')
      ext.version     = VERSION
      ext.creator     = 'CMRLM'
      ext.copyright   = '2026 CMRLM'
      ext.description = 'Imports .sketchup.json files from the CMRLM Tower Generator and Site Model ' \
                        'as native SketchUp groups, solids, terrain, tags, and materials. ' \
                        'Use Extensions > CMRLM > Import Design Tools file.'
      Sketchup.register_extension(ext, true)
      file_loaded(__FILE__)
    end
  end
end
