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
      'Pick a plate from the Option menu > New from a preset, then change the numbers. The default is a 300 by 65 ft double-loaded bar: 17 units, NRSF 15,078 sf, efficiency 77.3 percent.',
      'The Plan view is the default. The HUD shows units (or keys), NRSF, efficiency and the warnings. Tap the HUD for the mix, the corridor, the stair door path, dead ends, support space and the building totals.',
      'Keys: 1 to 6 change the view (Plan is 6), D switches Model and Diagram, L locks the selected unit, F re-fills, Delete removes a selected block, Esc clears.',
      'Each section starts collapsed. Select a section title to open it. Your choice is remembered.',
      'Collapse all, beside the tabs, closes every section at once.',
    ]],
    ['Plate tab', [
      'A drawn plate is a rectangle, L, U, courtyard (O), circle or a polygon. Draw outline starts a polygon in the Plan view: tap the points, tap the first point or press Enter to finish.',
      'With a project open, the plate comes from the massing: levels with the same plate share one fill. A group such as Levels 7 to 22 (16 floors) is edited once and the edit applies to every floor of the group. The podium toggle adds the podium levels.',
      'The Corridor card sets the kind (bar, single-loaded, point or automatic), the clear width, the wall thickness and the side. The Blocks card sets the core, the stairs, the elevators and the support blocks. Add starts a rectangle in the Plan view.',
      'Unit depth cap, in the Corridor card, stops the units at a depth from 24 to 40 ft. The strip between the cap and the corridor becomes storage. With a project open, the cap applies to the selected level group.',
    ]],
    ['The core', [
      'A point plate gets an automatic core. The core program sets the elevators: multifamily needs the larger of 2 and the unit count divided by 90, rounded up. A hotel needs the larger of 2 and the key count divided by 100, rounded up. A service elevator is added at 20 floors or more (a hotel always has one). The unit count is an estimate that the tool makes before the fill.',
      'Stairs sit at the two ends of the core. Every square foot of the core is a named room: Stair, Elev, Svc, Trash, Elec and Shaft (a hotel adds Linen, Ice and Data). A bar plate has no core block. Its elevators sit beside the corridor.',
      'Core mode is Auto, Manual or None. Drag the core in the plan to set it by hand: the mode changes to Manual. Reset core to auto gives the core back to the fill. The Passenger elevators field is blank for automatic and shows the automatic count.',
      CoreMod.CORE_CAUTION,
    ]],
    ['Units tab', [
      'The unit mix is a table of types with a width range, an area range and a share. The fill turns the shares into counts along each run of the plate. A type that is too shallow for a run drops out of that run, and the other shares renormalize.',
      'Deep runs: when a run is so deep that a type cannot keep its area range, the fill keeps the type and sets its width from the width range. These units have an orange outline and the word large. The advisor in the Checks tab tells you how to narrow the plate.',
      'Click a unit to select it. The card shows the type, area, width, exposures and flags. Change the type from the card: the run re-solves around it. Lock keeps the outline and the type through a re-fill.',
      'Drag a bay line (the dot on the line between two units) to move it along the run. The two units change width and keep their sum. A drag stops at the width range of each unit type. The two new widths show beside the line. Both units become locks. Re-fill recomputes every unlocked unit from the mix.',
      'Split cuts the selected unit into two units of half the width. Each half takes the type whose width range holds the half width. Merge \u2190 and Merge \u2192 join the unit with its neighbor on that side. All the new units are locks.',
      'An unfilled run has a dashed outline and the words Unfilled and its length. Tap it. Pick 1, 2 or 3 units, or pick a type: the run splits evenly into locked units. Only the counts that fit a width range are active.',
      'Draw unit (Units tab, Locks and re-fill): tap two cut lines on one run. The unit fills the band between them and takes the type that fits best. Undo and Redo work for every edit.',
      CONFIG.accessibleCaution,
    ]],
    ['Checks tab', [
      'The Efficiency card comes first. It lists what the advisor finds, the largest gain first: a plate that is too deep, a type that is too shallow for the runs, a core that is larger than its program, runs that stay unfilled, or low efficiency. Each line gives numbers from a real test fit. The target unit depth field sets the depth that the advisor aims for (30 ft multifamily, 26 ft hotel).',
      'The Warnings card lists each warning once: a type that does not fit, a large unit in a deep run, a run too short for any unit, a mix miss of more than one unit, a core that blocks the corridor, an area that does not close, and a massing that changed after the fill. The badge in the HUD counts this list. The HUD shows the first three and a link to the rest.',
      CONFIG.distanceCaution,
      CONFIG.widthCaution,
    ]],
    ['The view', [
      'Model draws white slabs with dark demising lines and dashed corridor wall lines. Diagram colors each unit by type. Labels show the type and area where the zoom allows. A red outline marks a flagged unit. An orange outline marks a large unit. A dashed amber outline marks a locked unit. An A marks an accessible unit.',
      'Support space has a light hatch and a word for its kind. An unfilled run has no hatch: it has a dashed outline and a light fill. Each room of an automatic core is a separate rectangle with a short label.',
      'Levels in 3D stacks every filled level of the project at its height. The grid and the snap set the step for moving blocks and bay lines. Hold Option to skip snapping.',
      'The Site button in the top bar frames the whole site. The Building button frames the plate. Neither button changes the view direction.',
    ]],
    ['Site', [
      'The Site toggle in the View tab shows the project site from the Site Model. It shows the real ground, roads and water. The Site Model makes no trees yet.',
      'Site style, under the Site toggle, sets how the neighbor buildings draw. Solid draws opaque grey blocks with dark edges. Glass draws see-through blocks. Wireframe draws edges only.',
      'Buildings removed in the Site Model do not show here. This tool does not drag. Move the building in the Tower Generator or the Mid-Rise Generator.',
    ]],
    ['Projects', [
      'A project holds the site, the massing and the work of other tools in one file. The Plate Planner reads the massing levels and writes a plates section with the units, so the Parking Deck and the Facade Studio can read it.',
      'The page saves by itself a second after each change. If the massing changes after the last fill, a notice says so. Re-fill takes the new massing.',
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
