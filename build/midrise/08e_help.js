/* ==========================================================================
   HELP
   A short guide for teammates, opened from the ? button in the top bar.
   ========================================================================== */
const Help = (() => {
  const SECTIONS = [
    ['Start', [
      'Pick a layout with Templates (Form tab), or the Option menu > New from a preset. Then change the numbers.',
      'Click a bar in the view to select it. Drag its handles to move, turn, stretch or raise it. Shift-click adds more to the selection.',
      'Cmd+D duplicates the selected bar. B adds a bar. Delete removes the selection. Esc clears it.',
    ]],
    ['Numbers', [
      'Units come from the bar length, the unit width and the corridor type. Corners cost units where bars meet or bend.',
      'Parking required comes from units and the program ratios. Parking provided counts surface stalls, a drawn lot, the deck and parking podium levels.',
      'Every count is an estimate. The stair and elevator counts are a seed, not a code count. Check the construction hint against the adopted code.',
    ]],
    ['The view', [
      'Keys 1 to 6 jump to Axon, N, E, S, W and Plan. D switches between Model and Diagram.',
      'Diagram style and the Plan view show spines, unit ticks, corner zones, courtyard sizes and stall counts.',
      'Snap pulls a drag to the grid, the site lines and the edges and centers of other bars. Hold Option (Alt) to skip it.',
    ]],
    ['Site', [
      'The Site toggle in the View tab shows the project site from the Site Model. It shows the real ground, roads, water, and trees. Neighbor buildings are solid grey blocks with dark edges. Drag the building on the ground to move it. Use the rotation handle to turn it. The base elevation, the ground height under the building, follows the ground.',
    ]],
    ['Projects', [
      'A project holds the site, this building and the work of other tools in one file. Use Project > New, or send a site here from the Site Model.',
      'In a project, the Site tab sets where the building sits. Center on site puts it in the middle and its floor at the ground. Context from site loads the neighbors.',
      'The project saves by itself a second after each change. Export > Send to Plate Planner or Parking Deck saves it and opens that tool.',
    ]],
    ['Files', [
      'Option menu > Save keeps the design in this browser. Export > Export JSON downloads all saved options. Import JSON adds them back.',
      'Export > SketchUp (.json) opens in SketchUp with the CMRLM extension. Export > Image saves a picture. AI-ready image and AI Prompts are a pair for ChatGPT or Gemini.',
    ]],
  ];
  function toggle() {
    const anchor = document.getElementById('btnHelp');
    if (!anchor) return false;
    const el = h('div', { role: 'dialog', 'aria-label': 'Help', id: 'helpPanel', class: 'help-pop' });
    el.append(h('div', { class: 'label pop-label' }, 'Mid-Rise Generator'));
    for (const [title, lines] of SECTIONS) {
      el.append(h('h3', { class: 'help-h' }, title), ...lines.map((t) => h('p', { class: 'help' }, t)));
    }
    return Pop.open(anchor, el, { align: 'right' });
  }
  return { toggle, close: () => Pop.close(), sections: () => SECTIONS.map(([t]) => t) };
})();
