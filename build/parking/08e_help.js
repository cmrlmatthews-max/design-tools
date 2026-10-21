/* ==========================================================================
   HELP
   A short guide for teammates, opened from the ? button in the top bar.
   ========================================================================== */
const Help = (() => {
  const SECTIONS = [
    ['Start', [
      'Pick a layout from the Option menu > New from a preset, then change the numbers. The default is a two-bay deck with single-helix ramps, five levels.',
      'Click a core, an entry or the speed ramp in the view to select it. Drag its handles to move or stretch it. The footprint of a standalone deck has handles too.',
      'Delete removes the selected core or entry. Esc clears the selection.',
    ]],
    ['Source', [
      'Standalone is a free deck. A wrap deck or a podium takes its footprint, floor-to-floor heights and cores from the massing in the open project. Pick the first level of the deck in the Source card.',
      'Cores from the project cannot be dragged. Make the cores editable copies them into this design so they can move.',
      'A core that sits in a drive aisle shows a warning. Move to the nearest row slides it into the closest stall row.',
    ]],
    ['Numbers', [
      'Stalls are 90 degrees in two-way bays. The short end walls are turn zones with no stalls. Cores, entries, the liner and the speed ramp cut stalls on the levels they touch.',
      'The accessible count comes from the table on the Checks tab (IBC 1106.1 seed values). The van rule, the access aisles and the R-2 rule are on the same tab. EV installed and EV ready are shares of the stalls.',
      'Clear height, ramp slope limits and the barrier height are common design values, not code values. Every table carries a Caution line. Verify against the adopted code.',
    ]],
    ['The view', [
      'Keys 1 to 6 jump to Axon, N, E, S, W and Plan. D switches between Model and Diagram. L isolates the next level. Shift+L shows all levels.',
      'Diagram style colors the stalls by kind or the ramps by slope (green under 80 percent of the limit, amber up to it, red over). The Plan view shows the stall numbers.',
      'The column overlay draws the demising lines of the units above. A conflict marks a column that lands inside a stall. Use the suggested stall width to line the columns up with the units.',
      'Snap pulls a drag to the grid, the deck edges, the stall rows, the aisle edges, the column lines and the strip. Hold Option (Alt) to skip it. Rotation snaps to 5 degrees.',
    ]],
    ['Projects', [
      'A project holds the site, the massing and the work of other tools in one file. Use Project > New, or open a project from the Mid-Rise or the Tower.',
      'The deck reads the levels and plates of the massing and writes a parking section back. It saves by itself a second after each change.',
      'Send to Facade Studio is planned and not available yet.',
    ]],
    ['Files', [
      'Option menu > Save keeps the design in this browser. Export > Export JSON downloads all saved options. Import JSON adds them back.',
      'Export > SketchUp (.json) opens in SketchUp with the CMRLM extension. DXF has the slabs, stalls, ramp faces and columns for Revit. Stall list (.csv) has one row per stall.',
      'Export > Image saves a picture. AI-ready image and AI Prompts are a pair for ChatGPT or Gemini.',
    ]],
  ];
  function toggle() {
    const anchor = document.getElementById('btnHelp');
    if (!anchor) return false;
    const el = h('div', { role: 'dialog', 'aria-label': 'Help', id: 'helpPanel', class: 'help-pop' });
    el.append(h('div', { class: 'label pop-label' }, 'Parking Deck Generator'));
    for (const [title, lines] of SECTIONS) {
      el.append(h('h3', { class: 'help-h' }, title), ...lines.map((t) => h('p', { class: 'help' }, t)));
    }
    return Pop.open(anchor, el, { align: 'right' });
  }
  return { toggle, close: () => Pop.close(), sections: () => SECTIONS.map(([t]) => t) };
})();
