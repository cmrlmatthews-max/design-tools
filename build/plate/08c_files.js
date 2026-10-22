/* ==========================================================================
   FILE EXPORTS  (plan sections 4 and 5)
   Export menu > Rooms (.csv), DXF (.dxf), SketchUp (.json), Notes (.md). Each one reads the same build the screen shows
   (Derived.get().built and .derived) through the src/plate writers: PlateExportsMod.roomsCsv / plateDxf / notesMarkdown and
   SkPlate.plateToSketchup. The file format helpers for the SketchUp document are src/shared/sketchup-format.js (SkFmt).
   Every action returns { ok, filename, blob, ... } and takes `{ deliver }` so tests can catch the file instead of downloading it.
   ========================================================================== */
const FileExports = (() => {
  const slug = (name) => String(name || 'plate').trim().replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'plate';
  const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  function save(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);   // revoking sooner can break some downloads
  }
  const fail = (what, e) => { console.error(e); Toast.show(`The ${what} could not be built for these settings.`, 'bad'); return { ok: false, errors: [String(e && e.message)] }; };
  const noPlates = () => { const d = Derived.get(); if (d.ok && d.derived && d.derived.levels.length) return false; Toast.show('Nothing to export yet. The plates are empty.', 'warn'); return true; };
  const meta = (s) => ({ name: s.name, date: stamp(), source: s.source, createdAt: new Date().toISOString() });
  const placementNow = () => { const p = ProjectUI.placement(); return p; };

  /* ---- Rooms CSV ---- */
  const roomsText = () => PlateExportsMod.roomsCsv(Derived.get().derived, placementNow());
  function rooms({ deliver } = {}) {
    if (noPlates()) return { ok: false, errors: ['empty'] };
    let text;
    try { text = roomsText(); } catch (e) { return fail('rooms file', e); }
    const name = `${slug(Store.get('name'))}-${stamp()}-rooms.csv`;
    const blob = new Blob([text], { type: 'text/csv' });
    (deliver || save)(blob, name);
    if (!deliver) Toast.show(`Saved ${name}`);
    return { ok: true, filename: name, blob, text };
  }

  /* ---- DXF ---- */
  const dxfText = () => PlateExportsMod.plateDxf(Derived.get().derived, Store.raw());
  function dxf({ deliver } = {}) {
    if (noPlates()) return { ok: false, errors: ['empty'] };
    let text;
    try { text = dxfText(); } catch (e) { return fail('DXF file', e); }
    const name = `${slug(Store.get('name'))}-${stamp()}-plates.dxf`;
    const blob = new Blob([text], { type: 'application/dxf' });
    (deliver || save)(blob, name);
    if (!deliver) Toast.show(`Saved ${name}`);
    return { ok: true, filename: name, blob, text };
  }

  /* ---- SketchUp ---- */
  function sketchupDoc(state, built) {
    const s = state || Store.raw();
    const d = built ? { built, metrics: PlateMetricsMod.computeMetrics(s, built) } : Derived.get();
    return SkPlate.plateToSketchup(s, d.built, d.metrics, { name: s.name, createdAt: new Date().toISOString() });
  }
  const sketchupName = (state) => SkFmt.sketchupFilename((state || Store.raw()).name);
  function sketchup({ deliver } = {}) {
    if (noPlates()) return { ok: false, errors: ['empty'] };
    let d;
    try { d = sketchupDoc(); } catch (e) { return fail('SketchUp file', e); }
    const v = SkFmt.validateDoc(d);
    if (!v.ok) { console.error(v.errors); Toast.show('The SketchUp file did not pass its own check, so it was not saved.', 'bad'); return { ok: false, errors: v.errors }; }
    if (!v.counts.solid && !v.counts.mesh) { Toast.show('Nothing to export yet.', 'warn'); return { ok: false, errors: ['empty'] }; }
    const name = sketchupName();
    const blob = SkFmt.docToBlob(d);
    (deliver || save)(blob, name);
    if (!deliver) Toast.show(`Saved ${name}. In SketchUp: Extensions > CMRLM > Import Design Tools file.`);
    return { ok: true, filename: name, blob, counts: v.counts };
  }

  /* ---- Notes ---- */
  const notesText = () => { const d = Derived.get(), s = Store.raw(); return PlateExportsMod.notesMarkdown(s, d.built, d.metrics, meta(s)); };
  function notes({ deliver } = {}) {
    if (noPlates()) return { ok: false, errors: ['empty'] };
    let text;
    try { text = notesText(); } catch (e) { return fail('notes file', e); }
    const name = `${slug(Store.get('name'))}-${stamp()}-plate-notes.md`;
    const blob = new Blob([text], { type: 'text/markdown' });
    (deliver || save)(blob, name);
    if (!deliver) Toast.show(`Saved ${name}`);
    return { ok: true, filename: name, blob, text };
  }
  return { roomsText, rooms, dxfText, dxf, sketchupDoc, sketchupName, sketchup, notesText, notes, save };
})();
