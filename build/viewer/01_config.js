/* ==========================================================================
   CONFIG
   The inlined src modules (shared, tower prompts, viewer) are wrapped in functions so their names do not clash with the
   rest of the file; build.py puts them in dependency order at the marker below.
   The Model Viewer is view only: it never calls writeSection or saveProject (docs/model-viewer-technical-plan.md, section 1).
   ========================================================================== */
//@@MODULES@@

const CONFIG = {
  tool: 'viewer',
  caution: 'Caution: the numbers come from design-stage tools. The viewer checks no code.',
  heroColor: '#E0A458',      // the AI-ready image: the project building draws in this color, everything else stays white
  heroColorName: 'amber',
  modelColor: '#f6f6f3',
  whiteColor: '#f6f6f3',
  uiKey: 'viewer.ui.v1',
  toolPath: (tool, id) => `../${tool}/?project=${encodeURIComponent(id)}`,
};
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const TEST_MODE = /[?&]test\b/.test(location.search);
