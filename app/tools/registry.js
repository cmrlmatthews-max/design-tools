/* ==========================================================================
   TOOL REGISTRY
   One line per tool. The dock shows a tool only when ready is true. A tool that is not ready gets no icon and no text
   (docs/shell-plan.md section 1: no "coming soon"). A tool module loads the first time its icon is tapped (lazy).
   Order = pipeline order: Site, Tower, Parking, Grading. Plates is view only (no dock icon).
   Hidden October 28, 2026 (Cade: keep the app simple): Parking Deck and Grading Sketch. ready: false hides the dock
   icon, the background drawer, and the layers of that section. Set ready back to true to bring a tool back.
   ========================================================================== */
export const TOOLS = [
  { id: 'site', ready: true, label: 'Site Model', icon: 'site', order: 10, load: () => import('./site/index.js') },
  { id: 'tower', ready: true, label: 'Tower Generator', icon: 'tower', order: 20, load: () => import('./tower/index.js') },
  { id: 'parking', ready: false, label: 'Parking Deck', icon: 'parking', order: 30, load: () => import('./parking/index.js') },
  { id: 'grading', ready: false, label: 'Grading Sketch', icon: 'grading', order: 40, load: () => import('./grading/index.js') },
  { id: 'plates', ready: true, label: 'Plate Planner', icon: 'plates', order: 90, viewOnly: true, load: () => import('./plates/index.js') },
];

/** Which tool owns a project section (for "Edit" links on the selection card). */
/** True when a tool is in the app now. */
export const toolOn = (id) => { const t = TOOLS.find((x) => x.id === id); return !!(t && t.ready); };

export const SECTION_OWNER = { site: 'site', massing: 'tower', parking: 'parking', grading: 'grading', plates: 'plates' };
