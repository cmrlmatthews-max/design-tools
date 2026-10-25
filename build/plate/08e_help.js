/* ==========================================================================
   HELP
   A short guide for teammates, opened from the ? button in the top bar. Opens with the caution that this is a test fit, and states the
   area rule that every unit area follows.
   ========================================================================== */
const Help = (() => {
  const SECTIONS = [
    ['Read this first', [
      CONFIG.testFitCaution,
      'Use the Plate Planner to test how many units or keys a floor plate holds, and how they sit around the corridor. The design team makes the unit plans.',
    ]],
    ['The area rule', [
      CONFIG.areaRule,
      'In short: unit area runs to the centerline of the demising walls, to the corridor face of the corridor wall, and to the inside face of the exterior wall. The exterior wall is 1.0 ft thick by default. The corridor wall (0.5 ft) counts in the unit.',
      'NRSF is the sum of the unit areas. Efficiency is NRSF divided by the plate area (GSF). Both follow this rule, so they are not a leasing area or a BOMA area.',
    ]],
    ['Start', [
      'The plate starts blank. You draw the units. Pick a plate from the Option menu > New from a preset to start from a finished layout. The Double-loaded bar preset has 17 units, NRSF 15,078 sf, efficiency 77.3 percent.',
      'The Plan view is the default. The HUD shows units (or keys), NRSF, efficiency, the open area, the units in range and the warnings. Tap the HUD for the mix, the corridor, the stair door path, dead ends, support space and the building totals.',
      'Keys: P Paint, S Suggest, R Rectangle, G Polygon, V Select. 1 to 6 change the view (Plan is 6). D switches Model and Diagram. Delete removes the selected unit or block. Esc dismisses, then clears.',
      'Each section starts collapsed. Select a section title to open it. Your choice is remembered.',
    ]],
    ['Draw units', [
      'Paint is the default tool. Press on an open stretch along a facade and drag. The unit fills the band along the run. The label shows the area and the type match, for example "812 sf, 1BR, in range". Release to make the unit. Tap an open stretch to select it.',
      'Suggest: select an open stretch or an empty corner zone, then tap Suggest. Ghost units show a layout in dashed type colors. Tap a ghost to accept it. Tap Accept all to accept every ghost. Tap Dismiss or press Esc to remove them.',
      'Rectangle and Polygon draw a free unit. The tool cuts the shape to the unit zone. A shape under 50 sf makes no unit. Rectangle: press, drag and release, or tap two corners. Polygon: tap the points, then tap the first point or press Enter.',
      'Select: tap a unit. The card shows the type chips, the area, the match, Split, Merge and Delete. Drag the dot on a bay line to move it along the run. The two units keep their sum. The two widths show beside the line.',
      'Unit outlines show the match. A normal outline is in range. An orange outline is a large unit. A blue outline is a small unit. An open stretch is a very light band. An empty corner zone is a faint dashed outline.',
      'Clear level removes every unit of the level. A dialog asks first. One Undo brings the units back. Undo and Redo work for every edit.',
      'On an iPad, use one finger to paint and draw. Use two fingers to pan and zoom. Handles are 44 pt.',
    ]],
    ['Plate tab', [
      'A drawn plate is a rectangle, L, U, courtyard (O), circle or a polygon. Draw outline starts a polygon in the Plan view: tap the points, tap the first point or press Enter to finish.',
      'With a project open, the plate comes from the massing: levels with the same plate share one fill. A group such as Levels 7 to 22 (16 floors) is edited once and the edit applies to every floor of the group. The podium toggle adds the podium levels.',
      'The Corridor card sets the kind (bar, single-loaded, point or automatic), the clear width, the wall thickness and the side. The Blocks card sets the core, the stairs, the elevators and the support blocks. Add starts a rectangle in the Plan view.',
      'Unit depth cap, in the Corridor card, stops the units at a depth from 24 to 40 ft. The strip between the cap and the corridor becomes storage. With a project open, the cap applies to the selected level group.',
    ]],
    ['The core', [
      'A point plate gets an automatic core. The core program sets the elevators: multifamily needs the larger of 2 and the unit count divided by 90, rounded up. A hotel needs the larger of 2 and the key count divided by 100, rounded up. A service elevator is added at 20 floors or more (a hotel always has one).',
      'Stairs sit at the two ends of the core. Every square foot of the core is a named room: Stair, Elev, Svc, Trash, Elec and Shaft (a hotel adds Linen, Ice and Data). A bar plate has no core block. Its elevators sit beside the corridor.',
      'Core mode is Auto, Manual or None. Tap the core to select it. Drag it to move it. Drag a corner handle to resize it (0.5 ft steps, 10 by 10 ft at least). The mode changes to Manual. Reset core to auto gives the core back to the tool. The card has an elevator count with plus, minus and Auto.',
      'If a manual core is too small for its rooms, the card says "Rooms do not fit". The core stays one block.',
      CoreMod.CORE_CAUTION,
    ]],
    ['Units tab', [
      'The unit mix is a table of types with a width range, an area range and a share. The shares set the count that Suggest aims for along each run. They do not fill the plate. Paint ignores the shares and picks the type that fits the area best.',
      'Match: a unit is in range when its area is inside the range of its type. A unit above the range is large. A unit below the range is small. The HUD shows how many units are in range.',
      'Change the type of a selected unit from its card. The outline stays. Split cuts a unit into two at its middle. Merge \u2190 and Merge \u2192 join the unit with its neighbor on that side.',
      CONFIG.accessibleCaution,
    ]],
    ['Checks tab', [
      'The Efficiency card comes first. It lists what the advisor finds, the largest gain first: a plate that is too deep, a type that is too shallow for the runs, a core that is larger than its program, or low efficiency. Each line gives numbers from a real test fit. The target unit depth field sets the depth that the advisor aims for (30 ft multifamily, 26 ft hotel).',
      'The Warnings card lists each warning once: a type that does not fit, a unit that a block or the core cuts, a unit that a block hides, a mix miss of more than one unit, a core that blocks the corridor and an area that does not close. The badge in the HUD counts this list. The HUD shows the first three and a link to the rest.',
      CONFIG.distanceCaution,
      CONFIG.widthCaution,
    ]],
    ['The view', [
      'Model draws white slabs with dark demising lines and dashed corridor wall lines. Diagram colors each unit by type. Labels show the type and area where the zoom allows. An orange outline marks a large unit. A blue outline marks a small unit. An A marks an accessible unit.',
      'Support space has a light hatch and a word for its kind. Each room of an automatic core is a separate rectangle with a short label.',
      'Levels in 3D stacks every level of the project at its height. The grid and the snap set the step for moving blocks and bay lines. Hold Option to skip snapping.',
      'The Site button in the top bar frames the whole site. The Building button frames the plate. Neither button changes the view direction.',
    ]],
    ['Site', [
      'The Site toggle in the View tab shows the project site from the Site Model. It shows the real ground, roads and water. The Site Model makes no trees yet.',
      'Site style, under the Site toggle, sets how the neighbor buildings draw. Solid draws opaque grey blocks with dark edges. Glass draws see-through blocks. Wireframe draws edges only.',
      'Buildings removed in the Site Model do not show here. This tool does not drag. Move the building in the Tower Generator or the Mid-Rise Generator.',
    ]],
    ['Projects', [
      'A project holds the site, the massing and the work of other tools in one file. The Plate Planner reads the massing levels and writes a plates section with the units, so the Parking Deck and the Facade Studio can read it.',
      'The page saves by itself a second after each change. Each level group keeps its own drawn units. If the massing changes, check the units against the new plate.',
    ]],
    ['Files', [
      'Option menu > Save keeps the design in this browser. Export > Export JSON downloads all saved options. Import JSON adds them back.',
      'Export > Rooms is a CSV of every unit. DXF has the plate, units, corridor, core and support on layers. SketchUp opens with the CMRLM extension. Notes is a plain-text summary with the cautions. Image saves a picture of the view.',
      'Send to Parking Deck and Send to Facade Studio save the project and open that tool on it.',
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
