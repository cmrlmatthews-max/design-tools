/* ==========================================================================
   levels.js — levels, level groups, and the drawn plate (plan sections 3.1, 4)

   Contract: docs/plate-planner-technical-plan.md sections 2, 3.1 and 4.
   Pure: no DOM, no Clipper, no mutation of inputs. Feet. Plan (x, y): x = east, y = north.

   Rule choices where the plan leaves room:
   - levelsFrom(state, project) reads the project from any of: the project
     document ({ sections: { massing: { derived } } }), a massing section
     ({ derived }), or the massing derived itself ({ levels }).
   - A drawn level has index 1, zone "typical", z 0, ftf 10, program "residential"
     (hotel mode: "hotel"), the typed core as a ring, the typed corridor spine
     (corridor.spine, else []) and no seeds.
   - Project levels keep the massing order (the Mid-Rise lists podium, bars, decks;
     `index` is an id, not an elevation). They are skipped when the zone is deck,
     crown or mechanical, when `plates` has no ring of 3 points or more, and for
     zone podium unless state.levels.showPodium.
   - Group key: FNV-1a (32 bit, 8 hex digits) over the JSON of the level's zone,
     plate rings, core ring, seed rings and spines. The plan names rings, core and seeds;
     the zone and the spines are added so a podium never merges with a bar of
     the same footprint and a fill never copies across different corridors.
     Rings are rounded to 0.01 ft, made counter-clockwise, and start at the vertex
     with the smallest x, then the smallest y. Pieces and seeds are sorted.
   - Group id "g" + key. Groups sort by the elevation of their lowest level, then index.
     Inside a group the levels sort the same way; `first` is the lowest one, the level the tool fills.
   - Group label: "Levels 7–22 (16 floors)", "Level 4 (1 floor)", "Levels 2, 4–6 (4 floors)".
   - plateFromState: shapes through shapeToRing (centered on the bounding box,
     L along the south and west, U open to the north); O = rect minus a centered
     court; polygon points are kept as given, counter-clockwise. Rings are cleaned
     with cleanRing2 and rounded to 0.001 ft. Outer rings run counter-clockwise, holes clockwise.
   ========================================================================== */

import { shapeToRing } from "../tower/geometry.js";
import { cleanRing2 } from "../shared/sketchup-format.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100 + 0;
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
const isPair = (p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]);

function need(cond, fn, what) {
  if (!cond) throw new Error(`${fn}: ${what} is missing or not valid`);
}

const SKIP_ZONES = new Set(["deck", "crown", "mechanical"]);

/* ------------------------------------------------------------ plateFromState */

const roundRing = (ring) => ring.map((p) => [r3(p[0]), r3(p[1])]);

/** The drawn plate (plan section 2, `plate`) → MultiPoly [{ outer, holes }]. Throws when the shape has no area. */
export function plateFromState(plateState) {
  need(plateState && typeof plateState === "object", "plateFromState", "plate");
  const p = plateState;
  const shape = String(p.shape || "rect").toLowerCase();
  const segments = isNum(p.segments) ? Math.max(8, Math.round(p.segments)) : 64;
  const w = isNum(p.w) ? p.w : 0, d = isNum(p.d) ? p.d : 0;
  let outer, holes = [];
  switch (shape) {
    case "circle":
      outer = shapeToRing({ type: "circle", w: w > 0 ? w : d }, { segments });
      break;
    case "l":
      outer = shapeToRing({ type: "l", w, d, arm: p.arm }, { segments });
      break;
    case "u":
      outer = shapeToRing({ type: "u", w, d, arm: p.arm }, { segments });
      break;
    case "o": {
      outer = shapeToRing({ type: "rect", w, d }, { segments });
      const cw = isNum(p.courtW) ? p.courtW : 0, cd = isNum(p.courtD) ? p.courtD : 0;
      need(cw > 0 && cd > 0, "plateFromState", "the court size (courtW and courtD)");
      if (!(cw < w && cd < d)) throw new Error(`plateFromState: the court ${cw} × ${cd} ft must be smaller than the plate ${w} × ${d} ft`);
      const hole = shapeToRing({ type: "rect", w: cw, d: cd }, { segments });
      holes = [hole];
      break;
    }
    case "polygon":
      outer = shapeToRing({ type: "polygon", points: (Array.isArray(p.points) ? p.points : []).filter(isPair) }, { segments });
      break;
    case "rect":
      outer = shapeToRing({ type: "rect", w, d }, { segments });
      break;
    default:
      throw new Error(`plateFromState: unknown plate shape "${p.shape}"`);
  }
  const o = cleanRing2(outer);
  if (!o) throw new Error(`plateFromState: the ${shape} plate has no area`);
  const hs = holes.map((h) => cleanRing2(h, { hole: true })).filter(Boolean);
  return [{ outer: roundRing(o), holes: hs.map(roundRing) }];
}

/* ---------------------------------------------------------------- levelsFrom */

function rectRing(rect) {
  const [x0, y0, x1, y1] = rect;
  const a = Math.min(x0, x1), b = Math.min(y0, y1), c = Math.max(x0, x1), e = Math.max(y0, y1);
  return [[a, b], [c, b], [c, e], [a, e]];
}

const clone = (o) => JSON.parse(JSON.stringify(o));

function massingLevels(project) {
  if (!project || typeof project !== "object") return null;
  const sec = project.sections && project.sections.massing ? project.sections.massing : project;
  const derived = sec && sec.derived ? sec.derived : sec;
  return derived && Array.isArray(derived.levels) ? derived.levels : null;
}

const hasArea = (mp) => Array.isArray(mp) && mp.some((pc) => pc && Array.isArray(pc.outer) && pc.outer.length >= 3);

/**
 * Plan 3.1. → [{ index, name, zone, z, ftf, program, plate, core, spines, seeds }]
 * Drawn source: one level from state.plate. Project source: the fillable levels of the massing.
 */
export function levelsFrom(state, project) {
  need(state && typeof state === "object", "levelsFrom", "state");
  if (state.source === "project") {
    const list = massingLevels(project);
    need(list, "levelsFrom", "the project massing levels (sections.massing.derived.levels)");
    const showPodium = !!(state.levels && state.levels.showPodium);
    const out = [];
    for (const l of list) {
      if (!l || SKIP_ZONES.has(l.zone)) continue;
      if (l.zone === "podium" && !showPodium) continue;
      if (!hasArea(l.plates)) continue;
      out.push({
        index: l.index,
        name: l.name !== undefined ? l.name : `Level ${l.index}`,
        zone: l.zone,
        z: isNum(l.z) ? l.z : 0,
        ftf: isNum(l.ftf) ? l.ftf : 10,
        program: l.program !== undefined ? l.program : "residential",
        plate: clone(l.plates),
        core: Array.isArray(l.core) && l.core.length >= 3 ? clone(l.core) : null,
        spines: Array.isArray(l.spines) ? clone(l.spines) : [],
        seeds: Array.isArray(l.seeds) ? clone(l.seeds) : [],
      });
    }
    return out;
  }
  need(state.plate, "levelsFrom", "state.plate");
  const rect = state.core && Array.isArray(state.core.rect) && state.core.rect.length === 4 && state.core.rect.every(isNum) ? state.core.rect : null;
  const spine = state.corridor && Array.isArray(state.corridor.spine) ? state.corridor.spine : [];
  return [{
    index: 1, name: "Level 1", zone: "typical", z: 0, ftf: 10,
    program: state.mode === "hotel" ? "hotel" : "residential",
    plate: plateFromState(state.plate),
    core: rect ? rectRing(rect) : null,
    spines: clone(spine),
    seeds: [],
  }];
}

/* --------------------------------------------------------------- groupLevels */

const area2 = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
};

/** A ring in a form that is equal for equal shapes: rounded to 0.01 ft, counter-clockwise, starting at the smallest x then y. */
function canonRing(ring) {
  let pts = (Array.isArray(ring) ? ring : []).filter(isPair).map((p) => [r2(p[0]), r2(p[1])]);
  pts = pts.filter((p, i) => !i || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  if (pts.length >= 3 && area2(pts) < 0) pts.reverse();
  let s = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i][0] < pts[s][0] || (pts[i][0] === pts[s][0] && pts[i][1] < pts[s][1])) s = i;
  return pts.slice(s).concat(pts.slice(0, s));
}

const sortedJson = (list) => list.map((x) => JSON.stringify(x)).sort();

function levelKeyText(l) {
  const pieces = (Array.isArray(l.plate) ? l.plate : []).map((pc) => ({ o: canonRing(pc.outer), h: sortedJson((pc.holes || []).map(canonRing)) }));
  const seeds = (Array.isArray(l.seeds) ? l.seeds : []).map((s) => ({ k: s.kind, r: canonRing(s.outer) }));
  const spines = (Array.isArray(l.spines) ? l.spines : []).map((s) => (Array.isArray(s) ? s.filter(isPair).map((p) => [r2(p[0]), r2(p[1])]) : []));
  return JSON.stringify({ zone: l.zone || "", plate: sortedJson(pieces), core: l.core ? canonRing(l.core) : null, seeds: sortedJson(seeds), spines: sortedJson(spines) });
}

function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function rangeLabel(indices) {
  const nums = [...new Set(indices)].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < nums.length;) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    parts.push(j > i ? `${nums[i]}–${nums[j]}` : `${nums[i]}`);
    i = j + 1;
  }
  return parts.join(", ");
}

/**
 * Plan 3.1: levels with the same key form one group; the tool fills the lowest and copies the result.
 * → [{ id, key, levels: [index], first, floors, label }]
 */
export function groupLevels(levels) {
  need(Array.isArray(levels), "groupLevels", "levels");
  const byText = new Map();
  for (const l of levels) {
    const text = levelKeyText(l);
    if (!byText.has(text)) byText.set(text, []);
    byText.get(text).push(l);
  }
  const order = (a, b) => (a.z - b.z) || (a.index - b.index);
  const used = new Set();
  const groups = [...byText.values()].map((list) => {
    list.sort(order);
    return list;
  }).sort((a, b) => order(a[0], b[0]));
  return groups.map((list) => {
    const hash = fnv1a(levelKeyText(list[0]));
    let key = hash;
    for (let n = 2; used.has(key); n++) key = `${hash}${n}`;   // a hash clash between different keys
    used.add(key);
    const indices = list.map((l) => l.index);
    const floors = list.length;
    const label = `${floors === 1 ? "Level" : "Levels"} ${rangeLabel(indices)} (${floors} ${floors === 1 ? "floor" : "floors"})`;
    return { id: `g${key}`, key, levels: indices, first: indices[0], floors, label };
  });
}
