/* ==========================================================================
   TESTS: SketchUp export (runAllTests in 12b merges the results)
   ========================================================================== */
async function runSketchupTests() {
  const results = [];
  const t = async (name, fn) => {
    let r;
    try { r = await fn(); } catch (e) { r = `threw ${e && e.message}`; }
    results.push({ name, ok: r === true, detail: r === true ? '' : String(r) });
  };
  const savedState = Store.snapshot();
  Options.holdAutosave(true);
  try {
    await t('the Export menu has "SketchUp (.json)" with the extension hint', async () => {
      const btn = document.getElementById('btnExport');
      btn.click();
      await new Promise((r) => setTimeout(r, 60));
      const mi = document.getElementById('miSketchup');
      const text = mi ? mi.textContent : '';
      Pop.close();
      return mi && /SketchUp \(\.json\)/.test(text) && /Import with the CMRLM SketchUp extension/.test(text) ? true : `got ${JSON.stringify(text)}`;
    });
    await t('__tower.sketchupDoc() validates, is a tower document, and its floors match the plates', async () => {
      Store.replace(defaultState());
      const d = window.__tower.sketchupDoc();
      const v = SkFmt.validateDoc(d);
      if (!v.ok) return v.errors.join('; ');
      const plates = Derived.get().plates.filter((p) => !p.void).length;
      const floors = [];
      (function walk(n) { if (n.attributes && n.attributes.floor != null) floors.push(n); (n.children || []).forEach(walk); })(d.root);
      return d.source === 'tower' && d.zShift === 0 && floors.length === plates ? true : `source ${d.source}, floors ${floors.length}, plates ${plates}`;
    });
    await t('Export downloads <option>-<date>.sketchup.json as JSON that validates', async () => {
      Store.replace({ ...defaultState(), name: 'Option A' });
      let got = null;
      const r = SketchupExport.download({ deliver: (blob, name) => { got = { blob, name }; } });
      if (!r.ok || !got) return `download failed ${JSON.stringify(r.errors)}`;
      const text = await got.blob.text();
      const back = JSON.parse(text);
      const ok = /^option-a-\d{4}-\d{2}-\d{2}\.sketchup\.json$/.test(got.name) && got.name === SkFmt.sketchupFilename('Option A') && got.blob.type === 'application/json' && SkFmt.validateDoc(back).ok;
      return ok ? true : `name ${got.name}, type ${got.blob.type}`;
    });
  } finally {
    Select.clear();
    Store.replace(savedState);
    Options.holdAutosave(false);
  }
  return results;
}
