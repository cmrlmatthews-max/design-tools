/* ==========================================================================
   HELP
   A short guide for teammates, opened from the ? button in the top bar.
   ========================================================================== */
const Help = (() => {
  const SECTIONS = [
    ['Start', [
      'Pick a design from the Option menu > New from a preset, then change the numbers. The default is a 300 by 65 ft residential bar, five levels, with punched windows and inset balconies on the north and south faces.',
      'Click a face in the view to select it. The card at the top of the panel shows its orientation, level range, zone, system and window-to-wall ratio, with a street-face switch. Esc clears the selection.',
      'There are no geometry handles in this version. The massing comes from the source: a standalone shape, or the open project.',
      'Each section starts collapsed. Select a section title to open it. Your choice is remembered.',
      'Collapse all, beside the tabs, closes every section at once.',
    ]],
    ['Massing', [
      'Standalone is a rectangle, an L, a U or a courtyard (O) with an optional podium. Every shape is centered on its bounding box. The angle turns the whole massing.',
      'Project massing reads the levels of the open project (from the Mid-Rise Generator, or the Tower Generator once it writes levels). If the Tower has not written levels yet, a note says so and the standalone massing is shown.',
      'Zones: base is the podium (or the lowest level), top is the highest level, middle is everything between. Level ranges replace that split with your own list.',
      'When the project massing has a crown level, the crown is its own zone. It shows as Crown after Top in the zone list. The crown has its own system, and its default system is solid.',
      'Street faces are the faces that front a street. Automatic uses the project site roads (or the south faces on the lowest level without a site). Manual lets you pick faces in the view.',
    ]],
    ['Facade', [
      'Each zone has a system: punched windows, window wall, curtain wall, storefront or solid. The module is the panel width on the face; the tool fits a whole number of panels, so a 300 ft face at 14 ft gets 21 panels of 14.29 ft.',
      'The orientation strip (All, N, E, S, W) opens an override for one orientation of that zone. A dot marks an orientation that has one. A different system in an override starts from that system\'s defaults.',
      'Balconies are inset (cut into the wall, the door counts as glazing, the side returns are not wall area) or projected (a slab outside the face). The door replaces the window in its module. Fins, shades and bands do not change the areas.',
    ]],
    ['Numbers', [
      'Glazing counts the whole window opening, frame and mullions included. Wall area is face length times floor-to-floor on every level; parapets and screens add none. The window-to-wall ratio is glazing over wall. The building ratio and the orientation ratios leave out the crown. A note under the ratio says crown not counted.',
      'The 40 percent check value is a design value (the prescriptive path of ASHRAE 90.1-2019). The tool never says a design complies. Verify the edition and the path for each project.',
      'Ground transparency is the glass in the band over the street faces. The band, the target and the envelope values are editable design values. Every table carries a Caution line.',
    ]],
    ['The view', [
      'Keys 1 to 6 jump to Axon, N, E, S, W and Plan. D switches between Model and Diagram. The N, E, S and W views are flat elevations and match the DXF sheets.',
      'Diagram style colors the faces by system or by window-to-wall ratio (five steps, light to dark). Street faces get an orange edge.',
      'While you drag a slider the picture drops the mullions and fins. They come back when you let go.',
      'The Site button in the top bar frames the whole site. The Building button frames the building. Neither button changes the view direction.',
    ]],
    ['Site', [
      'The Site toggle in the View tab shows the project site from the Site Model. It shows the real ground, roads and water. The Site Model makes no trees yet.',
      'Site style, under the Site toggle, sets how the neighbor buildings draw. Solid draws opaque grey blocks with dark edges. Glass draws see-through blocks. Wireframe draws edges only.',
      'This tool does not drag. Move the building in the Tower Generator or the Mid-Rise Generator.',
    ]],
    ['Projects', [
      'A project holds the site, the massing and the work of other tools in one file. Use Project > New, or open a project from the Mid-Rise or the Tower.',
      'The page reads the massing, the plates (for per-unit balconies), the site and the sun, and writes a facade section back. It saves by itself a second after each change.',
    ]],
    ['Files', [
      'Option menu > Save keeps the design in this browser. Export > Export JSON downloads all saved options. Import JSON adds them back.',
      'Export > SketchUp (.json) opens in SketchUp with the CMRLM extension. Elevations (.dxf) has four sheets with panels, glass, balconies, fins and shades for Revit or AutoCAD.',
      'Export > Image saves a picture. AI-ready image and AI Prompts are a pair for ChatGPT or Gemini; the prompt keeps every window and balcony where the model shows it.',
      'The AI-ready image shows the site with the building. Set Site style to Solid before you make it.',
      'In the AI-ready image, the wall is amber. The panels keep their colors.',
      'The first prompt in AI Prompts is Hero render. It renders the hero building as photoreal and keeps the neighbors as a white model.',
    ]],
  ];
  function toggle() {
    const anchor = document.getElementById('btnHelp');
    if (!anchor) return false;
    const el = h('div', { role: 'dialog', 'aria-label': 'Help', id: 'helpPanel', class: 'help-pop' });
    el.append(h('div', { class: 'label pop-label' }, 'Facade Studio'));
    for (const [title, lines] of SECTIONS) {
      el.append(h('h3', { class: 'help-h' }, title), ...lines.map((t) => h('p', { class: 'help' }, t)));
    }
    return Pop.open(anchor, el, { align: 'right' });
  }
  return { toggle, close: () => Pop.close(), sections: () => SECTIONS.map(([t]) => t) };
})();
