/* ==========================================================================
   FILE EXPORTS  (plan sections 4 and 5.2)
   Export menu > SketchUp (.json), Revit points (.csv), Contours (.dxf), Notes (.md). Each one reads the same build the screen shows
   (Derived.get().built) through the src/grading writers: SkGrading.gradingToSketchup, GradExportsMod.revitCsv / gradingDxf / notesMarkdown.
   The file format helpers for the SketchUp document are src/shared/sketchup-format.js (SkFmt). Every action returns { ok, filename, blob, ... }
   and takes `{ deliver }` so tests can catch the file instead of downloading it.
   ========================================================================== */
const FileExports = (() => {
  const slug = (name) => String(name || 'grading').trim().replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'grading';
  const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  function save(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);   // revoking sooner can break some downloads
  }
  const fail = (what, e) => { console.error(e); Toast.show(`The ${what} could not be built for these settings.`, 'bad'); return { ok: false, errors: [String(e && e.message)] }; };
  const meta = (s) => ({ name: s.name, date: stamp(), source: s.source, groundNote: s.ground.mode === 'site' ? 'Existing ground from the project site (NAVD88 feet).' : 'Existing ground is the typed plane (local feet).' });

  /* ---- SketchUp ---- */
  function sketchupDoc(state, built) {
    const s = state || Store.raw();
    const d = built ? { built, metrics: GradMetricsMod.computeMetrics(s, built) } : Derived.get();
    return SkGrading.gradingToSketchup(s, d.built, d.metrics, { name: s.name });
  }
  const sketchupName = (state) => SkFmt.sketchupFilename((state || Store.raw()).name);
  function sketchup({ deliver } = {}) {
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

  /* ---- Revit points ---- */
  const revitText = () => GradExportsMod.revitCsv(Derived.get().built);
  function revit({ deliver } = {}) {
    let text;
    try { text = revitText(); } catch (e) { return fail('points file', e); }
    const name = `${slug(Store.get('name'))}-${stamp()}-ground-points.csv`;
    const blob = new Blob([text], { type: 'text/csv' });
    (deliver || save)(blob, name);
    if (!deliver) Toast.show(`Saved ${name}. In Revit: Toposurface > Create from Import > Specify Points File.`);
    return { ok: true, filename: name, blob, text };
  }

  /* ---- DXF ---- */
  const dxfText = () => { const d = Derived.get(); return GradExportsMod.gradingDxf(Store.raw(), d.built, d.metrics); };
  function dxf({ deliver } = {}) {
    let text;
    try { text = dxfText(); } catch (e) { return fail('DXF file', e); }
    const name = `${slug(Store.get('name'))}-${stamp()}-grading.dxf`;
    const blob = new Blob([text], { type: 'application/dxf' });
    (deliver || save)(blob, name);
    if (!deliver) Toast.show(`Saved ${name}`);
    return { ok: true, filename: name, blob, text };
  }

  /* ---- Notes ---- */
  const notesText = () => { const d = Derived.get(), s = Store.raw(); return GradExportsMod.notesMarkdown(s, d.built, d.metrics, meta(s)); };
  function notes({ deliver } = {}) {
    let text;
    try { text = notesText(); } catch (e) { return fail('notes file', e); }
    const name = `${slug(Store.get('name'))}-${stamp()}-grading-notes.md`;
    const blob = new Blob([text], { type: 'text/markdown' });
    (deliver || save)(blob, name);
    if (!deliver) Toast.show(`Saved ${name}`);
    return { ok: true, filename: name, blob, text };
  }
  return { sketchupDoc, sketchupName, sketchup, revitText, revit, dxfText, dxf, notesText, notes, save };
})();
