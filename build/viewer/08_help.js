/* ==========================================================================
   HELP
   A short guide, opened from the ? button in the top bar. It opens with the caution.
   ========================================================================== */
const Help = (() => {
  const SECTIONS = [
    ['Read this first', [
      CONFIG.caution,
      'The Model Viewer shows every section of a project in one model. It is view only. It never changes the project. To change something, use the Edit in link of its layer.',
    ]],
    ['Open a project', [
      'Choose Project, then a project from the list. A tool can also open the viewer with the project already chosen.',
      'Import opens a project file in the viewer only. The file is not saved to your project list, so the Edit in links are off for it.',
      'Export downloads the open project as a file.',
    ]],
    ['Layers', [
      'Each layer is one section of the project: the site, the massing, the units, the cores and corridors, the parking, the facade, and the grading. A layer with no data shows No data and a link to the tool that makes it.',
      'Where a Plate Planner section covers a group of levels, its units draw instead of the massing slab on those levels.',
    ]],
    ['Levels', [
      'Choose a level, or move the slider, to cut the model there. Solids above the level hide. The cut level draws in plan colors, with the units colored by type.',
      'Show in plan looks straight down at the cut. All levels removes the cut.',
    ]],
    ['View', [
      'Model draws plain solids. Diagram colors them. Color by sets the colors: program, unit type, or one color for each layer.',
      'Site style sets how the neighbor buildings draw: solid, glass, or wireframe.',
      'Sun uses the dates and times that the Tower Generator saved. Pick Sun off to return to the default light.',
    ]],
    ['Tap', [
      'Tap a unit, a level, a stall, a face, or a wall to see its numbers in a card. The card has the Edit in link of its tool.',
    ]],
    ['Summary and warnings', [
      'The Summary tab lists the numbers of each section. The numbers are the numbers that the tools saved.',
      'A warning means that a section looks older than the massing it was made from. Open that tool to update it.',
    ]],
    ['Pictures and files', [
      'Export > Image saves a picture with the project name and the key numbers. AI-ready image saves a plain picture. The project building is amber and everything else is white.',
      'AI Prompts has a prompt to pair with the AI-ready image. Copy it and paste both into ChatGPT or Gemini.',
      'Export > SketchUp saves the layers that are on as one group for each layer. Import it with the CMRLM SketchUp extension.',
    ]],
  ];
  function toggle() {
    const anchor = $('btnHelp');
    if (!anchor) return false;
    const el = h('div', { role: 'dialog', 'aria-label': 'Help', id: 'helpPanel', class: 'help-pop' });
    el.append(h('div', { class: 'label pop-label' }, 'Model Viewer'));
    for (const [title, lines] of SECTIONS) {
      el.append(h('h3', { class: 'help-h' }, title), ...lines.map((t) => h('p', { class: t.startsWith('Caution:') ? 'help caution' : 'help' }, t)));
    }
    return Pop.open(anchor, el, { align: 'right' });
  }
  return { toggle, close: () => Pop.close(), sections: () => SECTIONS.map(([t]) => t) };
})();
