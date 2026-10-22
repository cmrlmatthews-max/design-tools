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
    ]],
    ['Plate tab', [
      'A drawn plate is a rectangle, L, U, courtyard (O), circle or a polygon. Draw outline starts a polygon in the Plan view: tap the points, tap the first point or press Enter to finish.',
      'With a project open, the plate comes from the massing: levels with the same plate share one fill. A group such as Levels 7 to 22 (16 floors) is edited once and the edit applies to every floor of the group. The podium toggle adds the podium levels.',
      'The Corridor card sets the kind (bar, single-loaded, point or automatic), the clear width, the wall thickness and the side. The Blocks card sets the core, the stairs, the elevators and the support blocks. Add starts a rectangle in the Plan view.',
    ]],
    ['Units tab', [
      'The unit mix is a table of types with a width range, an area range and a share. The fill turns the shares into counts along each run of the plate. A type that does not fit the depth of a run drops out of that run, and the other shares renormalize.',
      'Click a unit to select it. The card shows the type, area, width, exposures and flags. Change the type from the card: the run re-solves around it. Lock keeps the outline and the type through a re-fill.',
      'Drag a bay line (the dot on the line between two units) to move it along the run. The two units change width and keep their sum. A drag stops at the limit of the unit type. Both units become locks. Re-fill recomputes every unlocked unit from the mix.',
      CONFIG.accessibleCaution,
    ]],
    ['Checks tab', [
      'The list shows each warning: a type that does not fit, a run too short for any unit, a mix miss of more than one unit, a core that blocks the corridor, an area that does not close, and a massing that changed after the fill.',
      CONFIG.distanceCaution,
      CONFIG.widthCaution,
    ]],
    ['The view', [
      'Model draws white slabs with dark demising lines and dashed corridor wall lines. Diagram colors each unit by type. Labels show the type and area where the zoom allows. A red outline marks a flagged unit. A dashed amber outline marks a locked unit. An A marks an accessible unit.',
      'Levels in 3D stacks every filled level of the project at its height. The grid and the snap set the step for moving blocks and bay lines. Hold Option to skip snapping.',
    ]],
    ['Site', [
      'The Site toggle in the View tab shows the project site from the Site Model. It shows the real ground, roads, water, and trees. Neighbor buildings are solid grey blocks with dark edges. Buildings removed in the Site Model do not show here. This tool does not drag. Move the building in the Tower Generator or the Mid-Rise Generator.',
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
