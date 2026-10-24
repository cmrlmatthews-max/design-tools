/* ==========================================================================
   PIPELINE
   state (+ project) -> FillMod.buildPlates (levels, groups, plate, corridor, blocks, runs, units) -> PlateMetricsMod.computeMetrics
   -> PlateDerivedMod.platesDerived (the clean geometry the page draws and the exports write).
   One cached run per change. Every module is pure (src/plate/*); this file only calls them in order and normalizes what the page
   needs: the HUD numbers, the warnings, the scene (levels with colored, flagged, locked units), the groups and the bounds.
   buildPlates is the only function that reads the project. Never throws: a failure becomes one error warning and an empty result.
   ========================================================================== */
const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
const mapWarning = (w) => ({ id: w.code || w.id, level: w.severity || w.level || 'warn', text: w.message || w.text || String(w.code || w.id || ''), where: w.where || null });
/** The unit-count word for a mode. */
const unitWordOf = (mode) => (mode === 'hotel' ? 'keys' : 'units');
const sortWarnings = (list) => list.map((w, i) => [w, i]).sort((a, b) => ((SEVERITY_ORDER[a[0].level] ?? 1) - (SEVERITY_ORDER[b[0].level] ?? 1)) || (a[1] - b[1])).map((x) => x[0]);

const emptyHud = () => ({
  units: 0, nrsf: 0, gsf: 0, efficiency: 0, avgUnit: 0, corners: 0, exposures: { N: 0, E: 0, S: 0, W: 0 }, accessible: 0, corridorFt: 0,
  corridorPerUnit: null, stairDoors: 0, stairPathFt: null, deadEnds: [], deadEndMax: null, support: null, mix: [], hotel: null, closure: null,
  floors: 1, building: null, warnCount: 0, inRange: null, areaHigh: 0, dropped: [], deep: [], core: null,
});

function emptyDerived(message) {
  return {
    ok: false, state: null, built: null, metrics: null, derived: null, warnings: [{ id: 'internal', level: 'error', text: message || 'The plates could not be built for these settings.', where: null }],
    scene: { levels: [], contextRings: [], groups: [] }, groups: [], editing: null, hud: emptyHud(), bounds: computeBounds([], 0), rotation: 0, notes: [], stale: false,
  };
}

/** Plan boxes for framing: model (the plates), union (the plates and a margin), site (the plates and the context), all. Heights are above z 0. */
function computeBounds(rings, height) {
  const work = boxOfRings(rings) || { minX: -60, maxX: 60, minY: -40, maxY: 40 };
  const pad = Math.max(14, Math.min(60, 0.06 * Math.max(work.maxX - work.minX, work.maxY - work.minY)));
  const h = Math.max(1, height);
  const mk = (b) => ({ ...b, height: h });
  const union = growBox(work, pad), site = growBox(work, pad * 3);
  return { model: mk(work), union: mk(union), site: mk(site), all: mk(site) };
}

/** Type color / name by key (id or name) for the state's mode. */
function typeLookup(s) {
  const table = PlateDerivedMod.typeTable(s);
  return (key) => PlateDerivedMod.typeRow(table, key);
}

const sameRing = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  const key = (r) => { let sx = 0, sy = 0; for (const p of r) { sx += p[0]; sy += p[1]; } return [sx, sy]; };
  const ka = key(a), kb = key(b);
  if (Math.abs(ka[0] - kb[0]) > 0.01 || Math.abs(ka[1] - kb[1]) > 0.01) return false;
  return Math.abs(Math.abs(ringArea(a)) - Math.abs(ringArea(b))) < 0.05;
};

/** The locks that apply to a group: the group's locks for a project, the state's locks for a drawn plate. */
function locksFor(s, gid) {
  if (s.source === 'project') { const g = s.levels && s.levels.groups && s.levels.groups[gid]; return g && Array.isArray(g.locks) ? g.locks : []; }
  return Array.isArray(s.locks) ? s.locks : [];
}

/** True when a unit of the fill is out of the range its type allows. */
function unitFlagged(s, row, u, areaHigh) {
  if (!row) return true;
  if (areaHigh) return false;                 // rework plan 7.1: a large unit of a deep run has its own orange mark
  const list = (s.mix && s.mix[s.mode]) || [];
  const t = list.find((x) => x.id === row.id);
  if (!t) return false;
  if (s.mode === 'hotel') {
    if (!u.bay || typeof u.bay.from !== 'number') return false;
    const w = Math.abs(u.bay.to - u.bay.from);
    return w < t.widthMin * (t.bays || 1) - 0.25 || w > t.widthMax * (t.bays || 1) + 0.25;
  }
  if (u.accessible) return false;
  return u.area < t.areaMin - 0.5 || u.area > t.areaMax + 0.5;
}

/** The normalized scene: one entry per level with colored, flagged and locked units and the corridor wall lines. */
function sceneOf(s, built, derived, editingIndex) {
  const look = typeLookup(s);
  const recs = new Map();
  for (const r of PlateDerivedMod.levelRecords(built)) recs.set(r.index, r);
  const wall = PlateDerivedMod.wallThickness(s);
  const levels = derived.levels.map((L) => {
    const rec = recs.get(L.index) || {};
    const gid = rec.groupId;
    const locks = locksFor(s, gid);
    const fillUnits = rec.fill && Array.isArray(rec.fill.units) && rec.fill.units.length === L.units.length ? rec.fill.units : null;
    const units = L.units.map((u, k) => {
      const row = look(u.type);
      const lock = locks.find((l) => sameRing(l.outer, u.outer)) || null;
      const areaHigh = Array.isArray(u.flags) && u.flags.includes('area-high');
      return {
        k, id: u.id, type: row ? row.id : u.type, typeName: u.type, color: row ? row.color : '#9aa3ad', outer: u.outer, area: u.area,
        exposures: u.exposures, corner: u.corner, accessible: u.accessible, bay: u.bay, ring: u.ring, demising: u.demising,
        locked: !!lock, lockId: lock ? lock.id : null, flagged: unitFlagged(s, row, u, areaHigh), areaHigh, runId: fillUnits ? fillUnits[k].runId || null : null,
      };
    });
    return {
      index: L.index, name: L.name, z: L.z, ftf: L.ftf, groupId: gid || null, editing: L.index === editingIndex,
      plate: L.plate, corridor: L.corridor, core: L.core.outer, stairs: L.core.stairs, elevators: L.core.elevators, support: L.support,
      coreRooms: L.core.rooms || [], coreMode: rec.fill ? rec.fill.coreMode || null : null, maxDepth: rec.fill ? rec.fill.maxDepth || null : null,
      units, wallLines: PlateDerivedMod.corridorWallLines(L, wall),
    };
  });
  return levels;
}

/** The HUD figures of the editing group (one level) and of the whole building, from the metrics so they always add up. */
function summarize(s, metrics, group) {
  const row = group ? group.row : null;
  if (!row) return emptyHud();
  const b = metrics.building;
  const mixRows = row.mix ? row.mix.byType.map((r) => ({ type: r.type, count: r.count, target: r.target, diff: r.diff, avgArea: r.avgArea })) : [];
  const fill = group.fill || null;
  const prog = fill && fill.coreProgram ? fill.coreProgram : null;
  const dropped = [...new Set([...(row.dropped || []), ...(fill && Array.isArray(fill.dropped) ? fill.dropped : [])].map((d) => d.id))];
  return {
    units: row.units, nrsf: row.nrsf, gsf: row.gsf, efficiency: row.efficiency, avgUnit: row.avgUnitArea, corners: row.corners, exposures: row.exposures,
    accessible: row.accessible, corridorFt: row.corridor.lengthFt, corridorPerUnit: row.corridor.perUnit,
    stairDoors: row.stairDoors.count, stairPathFt: row.stairDoors.pathFt, deadEnds: row.stairDoors.deadEnds || [], deadEndMax: row.stairDoors.deadEndMax,
    support: row.support, mix: mixRows, hotel: row.hotel, closure: row.closure, floors: group.floors, bays: row.bays,
    inRange: typeof row.inRange === 'number' ? row.inRange : null, areaHigh: row.areaHighCount || 0, avgArea: row.avgArea, targetAvgArea: row.targetAvgArea,
    dropped, deep: fill && Array.isArray(fill.deep) ? fill.deep.map((d) => d.id) : [],
    core: fill ? { mode: fill.coreMode || null, cabs: prog ? prog.cabs : null, autoCabs: prog ? prog.autoCabs : null, service: prog ? prog.service : null, rooms: (fill.coreRooms || []).length } : null,
    building: { units: b.units, nrsf: b.nrsf, gsf: b.gsf, efficiency: b.efficiency, floors: metrics.floors, accessible: b.accessible, corridorFt: b.corridorFt, mix: b.mix, supportSf: b.supportSf,
      inRange: typeof b.inRange === 'number' ? b.inRange : null, areaHigh: b.areaHighCount || 0, avgArea: b.avgArea, targetAvgArea: b.targetAvgArea },
    warnCount: 0,
  };
}

/** Everything the UI, the renderer, the exports and the compare view need for one state (no caching). */
function computeDerived(s, { project = null, fillStamp = null, currentStamp = null, quality = 'full' } = {}) {
  try {
    const built = FillMod.buildPlates(s, { project, quality });
    if (fillStamp !== null && fillStamp !== undefined) built.massingUpdatedAt = fillStamp;
    if (currentStamp !== null && currentStamp !== undefined) built.currentMassingUpdatedAt = currentStamp;
    const metrics = PlateMetricsMod.computeMetrics(s, built);
    const warnings = sortWarnings((metrics.warnings || []).map(mapWarning));
    const derived = PlateDerivedMod.platesDerived(s, built, metrics);
    const groups = metrics.groups.map((g) => ({ id: g.id, label: g.label || g.id, first: g.first, levels: g.levels, floors: g.floors, row: g.row }));
    const sel = s.levels && s.levels.selected;
    const group = groups.find((g) => g.id === sel) || groups[0] || null;
    if (group) { const bg = built.groups.find((g) => g.id === group.id); group.fill = bg ? bg.fill : null; }
    const editIndex = group ? group.levels[0] !== undefined ? group.levels[0] : group.first : 1;
    const levels = sceneOf(s, built, derived, editIndex);
    const editing = levels.find((l) => l.editing) || levels[0] || null;
    // Context: the plates of the other groups as faint outlines (project source), in the plate frame.
    const contextRings = [];
    for (const L of levels) if (L.groupId !== (editing && editing.groupId) && L.index === (groups.find((g) => g.id === L.groupId) || {}).first) contextRings.push(outerRingsOf(L.plate));
    const hud = summarize(s, metrics, group);
    hud.warnCount = warnings.length;          // rework plan 7.3: the badge counts the whole list (checks() output, de-duplicated by code and where)
    const stack = levels.length ? Math.max(...levels.map((l) => l.z + l.ftf)) : 0;
    const rings = levels.flatMap((l) => outerRingsOf(l.plate));
    const bounds = computeBounds(rings, Math.max(stack, CONFIG.slabHeight + 2));
    return {
      ok: true, state: s, built, metrics, derived, warnings, groups, group, editing, hud, bounds, rotation: 0,
      scene: { levels, contextRings, groups }, notes: built.notes || [], stale: warnings.some((w) => w.id === 'stale-massing'), source: built.source,
    };
  } catch (e) {
    console.error(e);
    const d = emptyDerived(s && s.source === 'project' ? 'The open project has no massing levels to fill. Open a project that has a massing, or switch to a drawn plate.' : 'The plates could not be built for these settings.');
    d.state = s;
    return d;
  }
}

const Derived = (() => {
  let gKey = null, geomId = 0, counter = 0, cache = null;
  // Geometry key: everything that changes the build or the numbers. The name and the view only change drawing.
  const geomKeyOf = (s) => { const { view, name, ...rest } = s; return JSON.stringify(rest); };
  const qualityNow = () => (Store.gestureActive() && !Store.gesturePath().startsWith('view') ? 'draft' : 'full');
  function get() {
    const s = Store.raw();
    const q = qualityNow();
    const gk = `${geomKeyOf(s)}|${ProjectUI.dataKey()}|${ProjectUI.fillStamp()}|${q}`;
    if (gk !== gKey || !cache) {
      gKey = gk; geomId++;
      cache = { id: ++counter, geomId, ...computeDerived(s, { project: ProjectUI.dataDoc(), fillStamp: ProjectUI.fillStamp(), currentStamp: ProjectUI.massingStamp(), quality: q }) };
    }
    return cache;
  }
  /** What to draw: the draft or the full build. */
  function display() {
    const d = get();
    return { key: `${d.geomId}`, quality: Store.gestureActive() ? 'draft' : 'full' };
  }
  return { get, display };
})();

/* ==========================================================================
   ADVICE  (rework plan section 6)
   The efficiency advisor makes real test fits, so it can take a few hundred milliseconds. It never runs in a drag: it waits until the
   state stops changing (ADVICE_MS after the last change), then computes once for the current Derived result and tells the listeners.
   Until then the last list stays (flagged as not fresh). Pure input: Derived.get(); it never writes to the Store.
   ========================================================================== */
const Advice = (() => {
  const ADVICE_MS = 350;
  let list = [], key = null, timer = null, started = false, error = null;
  const listeners = [];
  const notify = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  function computeNow() {
    const d = Derived.get();
    if (!d.ok || !d.built || !d.metrics) { list = []; key = d.id; error = null; notify(); return list; }
    try {
      list = AdvisorMod.advise(d.state, d.built, d.metrics, { fillPlate: FillMod.buildPlates });
      error = null;
    } catch (e) { console.error(e); list = []; error = e && e.message ? e.message : 'failed'; }
    key = d.id;
    notify();
    return list;
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (Store.gestureActive()) return;                      // never in the drag path
    timer = setTimeout(() => { timer = null; if (Store.gestureActive()) return schedule(); if (key !== Derived.get().id) computeNow(); }, ADVICE_MS);
  }
  function start() {
    if (started) return;
    started = true;
    Store.subscribe(() => schedule());
    schedule();
  }
  return {
    start, computeNow, schedule,
    /** { list, fresh } : fresh is true when the list belongs to the current build. */
    get: () => ({ list, fresh: key === Derived.get().id, error }),
    onChange: (fn) => listeners.push(fn),
  };
})();
