/* ==========================================================================
   FILE EXPORTS: SketchUp, DXF, stall CSV  (plan sections 3 and 4)
   Export menu > "SketchUp (.json)" downloads <option>-<date>.sketchup.json, which the CMRLM SketchUp extension imports. The
   document is built by src/parking/sketchup.js (SkPark). "DXF (.dxf)" is the R12 file from src/parking/exports.js; "Stall list
   (.csv)" is one row per stall. All three read the same final stalls the screen shows (Derived.get().built); the file format
   helpers are src/shared/sketchup-format.js.
   ========================================================================== */

const SketchupExport = (() => {
  /** The document for the design on screen (or for `state`/`built` when given). */
  function doc(state, built) {
    const s = state || Store.raw();
    const d = built || Derived.get();
    return SkPark.parkingToSketchup(s, d.built, d.metrics, { name: s.name });
  }
  function filename(state) { return SkFmt.sketchupFilename((state || Store.raw()).name); }
  function save(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);   // revoking sooner can break some downloads
  }
  /** Build, check and download. `deliver(blob, filename)` replaces the browser download (tests). → { ok, filename, blob, errors } */
  function download({ deliver } = {}) {
    let d;
    try { d = doc(); } catch (e) { console.error(e); Toast.show('The SketchUp file could not be built for these settings.', 'bad'); return { ok: false, errors: [String(e && e.message)] }; }
    const v = SkFmt.validateDoc(d);
    if (!v.ok) { console.error(v.errors); Toast.show('The SketchUp file did not pass its own check, so it was not saved.', 'bad'); return { ok: false, errors: v.errors }; }
    if (!v.counts.solid && !v.counts.mesh) { Toast.show('Nothing to export yet: the design has no levels.', 'warn'); return { ok: false, errors: ['empty'] }; }
    const name = filename();
    const blob = SkFmt.docToBlob(d);
    (deliver || save)(blob, name);
    if (!deliver) Toast.show(`Saved ${name}. In SketchUp: Extensions > CMRLM > Import Design Tools file.`);
    return { ok: true, filename: name, blob, counts: v.counts };
  }

  /* ---- DXF and CSV ---- */
  const slug = (name) => String(name || 'deck').trim().replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'deck';
  const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const dxfText = () => {
    const d = Derived.get();
    return ExportsMod.parkingDxf(Store.raw(), d.built, { ramps: d.ramps, columnPoints: d.columns.points, clearHeights: d.clear });
  };
  const csvText = () => ExportsMod.stallCsv(Store.raw(), Derived.get().built);
  function fileOut(kind, { deliver } = {}) {
    let text;
    try { text = kind === 'dxf' ? dxfText() : csvText(); } catch (e) { console.error(e); Toast.show(`The ${kind.toUpperCase()} file could not be built for these settings.`, 'bad'); return { ok: false, errors: [String(e && e.message)] }; }
    const name = `${slug(Store.get('name'))}-${stamp()}${kind === 'dxf' ? '.dxf' : '-stalls.csv'}`;
    const blob = new Blob([text], { type: kind === 'dxf' ? 'application/dxf' : 'text/csv' });
    (deliver || save)(blob, name);
    if (!deliver) Toast.show(`Saved ${name}`);
    return { ok: true, filename: name, blob, text };
  }
  return { doc, filename, download, dxf: (o) => fileOut('dxf', o), csv: (o) => fileOut('csv', o), dxfText, csvText };
})();
