/* ==========================================================================
   SECTION VIEW  (plan section 5.3)
   A 2D profile under the 3D view for the section line (view.section, two points). The existing ground is dashed, the proposed ground
   solid, pads are bars at pad top, walls are heavy ticks with their heights. Sampled every 1 ft. Elevations are labeled at the ends and
   at the high and low points. Redraws when the design changes (not while a handle moves: only the numbers are cheap enough there, so
   it follows the draft build). Hidden when there is no section line.
   ========================================================================== */
const SectionView = (() => {
  const $ = (id) => document.getElementById(id);
  let canvas = null, ctx = null, last = null, raf = 0;
  const css = (name, fb) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;

  /** The profile of the line a-b: samples every 1 ft { s, x, y, ex, pr } plus the pads and walls crossed. Pure (tests call it). */
  function profile(a, b, d) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L - 1e-9));
    const samples = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n, x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
      samples.push({ s: L * f, x, y, ex: d.built.existingAt(x, y), pr: d.built.surface.at(x, y) });
    }
    const pads = [];
    for (const t of d.built.tiers) {
      for (const ring of (t.pads || [])) {
        let inside = false, s0 = 0;
        samples.forEach((p, i) => {
          const hit = pointInRing(p.x, p.y, ring);
          if (hit && !inside) { inside = true; s0 = p.s; }
          if ((!hit || i === samples.length - 1) && inside) { inside = false; pads.push({ id: t.id, s0, s1: p.s, z: t.padTop }); }
        });
      }
    }
    const walls = [];
    for (const w of d.metrics && d.metrics.walls ? d.built.walls : []) {
      for (let i = 0; i + 1 < w.line.length; i++) {
        const c = segCross(a, b, w.line[i], w.line[i + 1]);
        if (c) {
          const h = Math.abs(d.built.surface.at(c.x + 0.01 * (b[1] - a[1]) / (L || 1), c.y - 0.01 * (b[0] - a[0]) / (L || 1)) - d.built.surface.at(c.x - 0.01 * (b[1] - a[1]) / (L || 1), c.y + 0.01 * (b[0] - a[0]) / (L || 1)));
          walls.push({ id: w.id, s: c.t * L, z: d.built.surface.at(c.x, c.y), h });
        }
      }
    }
    let lo = Infinity, hi = -Infinity;
    for (const p of samples) { lo = Math.min(lo, p.ex, p.pr); hi = Math.max(hi, p.ex, p.pr); }
    for (const p of pads) { lo = Math.min(lo, p.z); hi = Math.max(hi, p.z); }
    return { length: L, samples, pads, walls, lo, hi };
  }

  function draw(pr, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ink = css('--ink', '#1b2733'), muted = css('--ink-3', '#6b7785'), accent = css('--accent', '#23508f'), line = css('--line', '#cfd6de');
    ctx.clearRect(0, 0, w, h);
    ctx.font = '11px system-ui, sans-serif';
    const padL = 58, padR = 16, padT = 16, padB = 26;
    const iw = Math.max(40, w - padL - padR), ih = Math.max(40, h - padT - padB);
    const span = Math.max(2, pr.hi - pr.lo), lo = pr.lo - span * 0.12, hi = pr.hi + span * 0.12;
    const X = (s) => padL + (s / Math.max(1, pr.length)) * iw;
    const Y = (z) => padT + (1 - (z - lo) / (hi - lo)) * ih;
    // grid and elevation labels
    ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const z = lo + ((hi - lo) * i) / ticks, y = Y(z);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + iw, y); ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillText(Units.formatElev(z), padL - 6, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const stepS = pr.length > 400 ? 100 : pr.length > 150 ? 50 : pr.length > 60 ? 20 : 10;
    for (let s = 0; s <= pr.length + 1e-6; s += stepS) ctx.fillText(Units.formatFeetInches(s), X(s), padT + ih + 6);
    // pads
    ctx.fillStyle = accent; ctx.globalAlpha = 0.25;
    for (const p of pr.pads) ctx.fillRect(X(p.s0), Y(p.z) - 2, Math.max(1, X(p.s1) - X(p.s0)), 4);
    ctx.globalAlpha = 1;
    // existing (dashed)
    const path = (key) => { ctx.beginPath(); pr.samples.forEach((p, i) => { const x = X(p.s), y = Y(p[key]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); };
    ctx.strokeStyle = muted; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); path('ex'); ctx.setLineDash([]);
    // proposed (solid)
    ctx.strokeStyle = ink; ctx.lineWidth = 2; path('pr');
    // walls
    ctx.textBaseline = 'bottom'; ctx.fillStyle = CONFIG.wallFlagColor;
    for (const wl of pr.walls) {
      ctx.strokeStyle = wl.h > num(Store.get('limits.wallFlag'), 4) ? CONFIG.wallFlagColor : ink; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(X(wl.s), Y(wl.z)); ctx.lineTo(X(wl.s), Y(wl.z - wl.h)); ctx.stroke();
      ctx.fillText(`${wl.h.toFixed(1)} ft`, X(wl.s), Y(wl.z) - 3);
    }
    // end elevations
    ctx.fillStyle = ink; ctx.textBaseline = 'bottom';
    const first = pr.samples[0], endp = pr.samples[pr.samples.length - 1];
    ctx.textAlign = 'left'; ctx.fillText(`A  ${Units.formatElev(first.pr)}`, X(0) + 3, Y(first.pr) - 4);
    ctx.textAlign = 'right'; ctx.fillText(`B  ${Units.formatElev(endp.pr)}`, X(pr.length) - 3, Y(endp.pr) - 4);
    // legend
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = muted;
    ctx.fillText('Existing (dashed)  Proposed (solid)  Pads', padL + 4, 2);
  }

  function render() {
    raf = 0;
    const panel = $('sectionPanel');
    if (!panel) return;
    const sec = Store.get('view.section');
    panel.hidden = !sec || Render.comparing();
    document.getElementById('viewport').dataset.section = panel.hidden ? 'false' : 'true';
    if (panel.hidden) { last = null; return; }
    const d = Derived.get();
    if (!d.ok) return;
    last = profile(sec[0], sec[1], d);
    const host = $('sectionHost');
    const w = Math.max(200, host.clientWidth), h = Math.max(80, host.clientHeight);
    draw(last, w, h);
    const t = $('sectionTitle');
    if (t) t.textContent = `Section A to B · ${Units.formatFeetInches(last.length)} long · every 1 ft`;
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(render); };

  function init() {
    const panel = $('sectionPanel');
    if (!panel) return;
    canvas = h('canvas', { id: 'sectionCanvas', role: 'img', 'aria-label': 'Section profile of the existing and the proposed ground' });
    ctx = canvas.getContext('2d');
    $('sectionHost').append(canvas);
    $('sectionClose').addEventListener('click', () => Store.set('view.section', null, { live: false }));
    Store.subscribe(schedule);
    Render.onRebuild(schedule);
    window.addEventListener('resize', schedule);
    schedule();
  }
  return { init, profile, render, info: () => (last ? { length: last.length, samples: last.samples.length, pads: last.pads.length, walls: last.walls.length, lo: last.lo, hi: last.hi } : null), visible: () => { const p = $('sectionPanel'); return !!p && !p.hidden; } };
})();
