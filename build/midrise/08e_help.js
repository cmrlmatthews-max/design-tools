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
      'Each section starts collapsed. Select a section title to open it. Your choice is remembered.',
      'Collapse all, beside the tabs, closes every section at once.',
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
      'The Site button in the top bar frames the whole site. The Building button frames the building. Neither button changes the view direction.',
    ]],
    ['Site', [
      'The Site toggle in the View tab shows the project site from the Site Model. It shows the real ground, roads and water. The Site Model makes no trees yet.',
      'Site style, under the Site toggle, sets how the neighbor buildings draw. Solid draws opaque grey blocks with dark edges. Glass draws see-through blocks. Wireframe draws edges only.',
      'Buildings removed in the Site Model do not show here. Drag the building on the ground to move it. Use the rotation handle to turn it.',
      'In the Site tab, Base elevation has two modes. Follow ground sets the base to the lowest ground under the building. Typed keeps the value you enter.',
    ]],
    ['Projects', [
      'A project holds the site, this building and the work of other tools in one file. Use Project > New, or send a site here from the Site Model.',
      'In a project, the Site tab sets where the building sits. Center on site puts it in the middle and its floor at the ground. Context from site loads the neighbors.',
      'A project opens with the site in Glass. A pinned project opens with the site in Solid.',
      'Pin placement, in the top bar, locks the building and sets the site style to Solid. Unpin frees the building and sets the site style to Glass.',
      'A pinned building does not move by drag or by the rotation handle. Typed values still work.',
      'The project saves by itself a second after each change. Export > Send to Plate Planner, Parking Deck, Facade Studio, or Grading Sketch saves it and opens that tool.',
    ]],
    ['Files', [
      'Option menu > Save keeps the design in this browser. Export > Export JSON downloads all saved options. Import JSON adds them back.',
      'Export > SketchUp (.json) opens in SketchUp with the CMRLM extension. Export > Image saves a picture. AI-ready image and AI Prompts are a pair for ChatGPT or Gemini.',
      'The AI-ready image shows the site with the building. Set Site style to Solid before you make it.',
      'In the AI-ready image, the building is amber. The neighbors and the ground stay as drawn.',
      'The first prompt in AI Prompts is Hero render. It renders the hero building as photoreal and keeps the neighbors as a white model.',
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
