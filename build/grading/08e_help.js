/* ==========================================================================
   HELP
   A short guide for teammates, opened from the ? button in the top bar. Opens with the caution that this is a sketch.
   ========================================================================== */
const Help = (() => {
  const SECTIONS = [
    ['Read this first', [
      CONFIG.sketchCaution,
      'Use the sketch to talk with the civil engineer early: where the buildings sit, how much the ground changes, where a wall is needed. The civil engineer makes the grading plan.',
    ]],
    ['Start', [
      'Pick a design from the Option menu > New from a preset, then change the numbers. The default is a 300 by 65 ft bar on ground that falls 5 percent to the south, with one balanced floor elevation.',
      'The HUD shows cut, fill, net (fill minus cut) and the tallest wall. Volumes round to 10 cy there; the Checks tab shows them to 0.1 cy. Tap the HUD to see the tiers, the routes and the warnings.',
      'Click a drive, lot, wall, route, building or the property line in the view to select it. The card at the top of the panel names it. Esc clears the selection.',
    ]],
    ['Buildings', [
      'Each building has a footprint and one or more tiers along its long axis. A tier floor (FFE) is Balance, which sets the pad so cut and fill under it are equal, or a typed elevation to 0.01 ft.',
      'When the ground changes more than the largest step along a building, the card suggests more tiers. Apply makes that many balanced tiers of equal length.',
      CONFIG.stepCaution,
    ]],
    ['Site work', [
      'Add starts a drawing in the Plan view. Tap the points. Tap the last point again, or press Enter, to finish. Esc cancels. A lot and a property line close themselves. Hold Option to skip snapping. Points snap to the 1 ft grid, pad edges and corners, the property line and drive ends.',
      'To edit, select an item and drag a vertex. Drag a small dot between two vertices to add a vertex. Delete removes the selection. Keys: W draws a wall, R draws a route, 1 to 6 change the view, D switches Model and Cut and fill.',
      'Drives and lots hold a slope and a cross slope from a start elevation. Walls take their height from the difference between the two sides of the proposed ground. Automatic walls follow the property line where the daylight slope would leave the site. Accept each one you want to keep.',
      CONFIG.gradeCaution,
      CONFIG.wallCaution,
    ]],
    ['Routes and limits', [
      'A route is colored green where it meets the walk limit, amber where it needs a ramp, and red where it is over the ramp limit. Cross slope has its own limit.',
      CONFIG.routeCaution,
      CONFIG.daylightCaution,
    ]],
    ['Earthwork', [
      'Cut and fill come from a grid of the existing and the proposed ground, each cell split into sub-cells. More sub-cells are slower and a little closer to a surface model. While a handle moves the page uses one sub-cell and then catches up.',
      CONFIG.earthCaution,
    ]],
    ['The view', [
      'Cut and fill colors the proposed ground by how far it is above (blue, fill) or below (red, cut) the existing ground, in steps of 1, 2, 4 and 8 ft. Contours: existing dashed, proposed solid. The Plan view shows elevation labels.',
      'Draw section (View tab) takes two points. A profile appears under the view with the existing ground dashed, the proposed ground solid, the pads and the walls.',
      'Vertical exaggeration changes only the picture. Every number uses the true heights.',
    ]],
    ['Site', [
      'The Site toggle in the View tab shows the project site from the Site Model. It shows neighbor buildings, roads, water, and trees. They are solid grey blocks with dark edges. The sketch keeps its own ground, existing and proposed. This tool does not drag. Move a building in the tool that owns it.',
    ]],
    ['Projects', [
      'A project holds the site, the massing and the work of other tools in one file. With a project open, the site gives the existing ground, and the Mid-Rise massing and the Parking Deck can be buildings here.',
      'The page writes a grading section back with the floor elevations, so the other tools can read them. It saves by itself a second after each change.',
    ]],
    ['Files', [
      'Option menu > Save keeps the design in this browser. Export > Export JSON downloads all saved options. Import JSON adds them back.',
      'Export > SketchUp opens in SketchUp with the CMRLM extension. Revit points is a CSV of x, y, z for a toposurface. Contours (DXF) has contours, pads, walls, drives, lots and routes. Notes is a plain-text summary with the cautions.',
      'Export > Image saves a picture. AI-ready image and AI Prompts are a pair for ChatGPT or Gemini; the prompt keeps the ground, the walls and the pads where the model shows them.',
    ]],
  ];
  function toggle() {
    const anchor = document.getElementById('btnHelp');
    if (!anchor) return false;
    const el = h('div', { role: 'dialog', 'aria-label': 'Help', id: 'helpPanel', class: 'help-pop' });
    el.append(h('div', { class: 'label pop-label' }, CONFIG.title));
    for (const [title, lines] of SECTIONS) {
      el.append(h('h3', { class: 'help-h' }, title), ...lines.map((t) => h('p', { class: t.startsWith('Caution:') ? 'help caution' : 'help' }, t)));
    }
    return Pop.open(anchor, el, { align: 'right' });
  }
  return { toggle, close: () => Pop.close(), sections: () => SECTIONS.map(([t]) => t) };
})();
