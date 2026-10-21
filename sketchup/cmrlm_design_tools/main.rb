# encoding: UTF-8
#
# CMRLM Design Tools - menu and import command.
# The geometry logic is in importer.rb.

require 'sketchup.rb'
require_relative 'importer'

module CMRLM
  module DesignTools
    PREF_SECTION = 'CMRLM_DesignTools'.freeze
    PANEL_TITLE  = 'Import Design Tools file'.freeze
    PANEL_FILTER = 'Design Tools|*.sketchup.json;*.json||'.freeze

    # Asks for a file, imports it, and zooms to the new root group.
    def self.import_command
      model = Sketchup.active_model
      dir = ''
      begin
        dir = Sketchup.read_default(PREF_SECTION, 'last_dir', '').to_s
      rescue StandardError
        dir = ''
      end

      path = UI.openpanel(PANEL_TITLE, dir, PANEL_FILTER)
      return if path.nil? # The user cancelled.

      begin
        Sketchup.write_default(PREF_SECTION, 'last_dir', File.dirname(path))
      rescue StandardError
        nil
      end

      result = Importer.new(model).import_file(path)
      return if result.nil? # The importer has shown the reason.

      begin
        model.active_view.zoom(result.root)
      rescue StandardError
        nil # Zoom is a convenience. The import is done.
      end
      Sketchup.status_text = result.summary
    end

    unless file_loaded?(__FILE__)
      UI.menu('Extensions').add_submenu('CMRLM').add_item('Import Design Tools file…') do
        CMRLM::DesignTools.import_command
      end
      file_loaded(__FILE__)
    end
  end
end
