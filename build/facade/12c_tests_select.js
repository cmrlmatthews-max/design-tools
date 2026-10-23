/* ==========================================================================
   TESTS: selection
   Click a face in the 3D view (a raycast on the instanced meshes), the face card, the street toggle and the Pick street faces mode,
   Open in panel, and the keys (1 to 6, D, Escape). The clicks run through Select.click, the same function the pointer handler
   calls. Restores the design when done. Without WebGL the pick tests are skipped (they pass as "no WebGL").
   ========================================================================== */
async function runSelectTests() {
  const { eq, make, $, frames, snap, visible } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  Options.holdAutosave(true);
  const fresh = () => { Select.clear(); Store.replace(fillDefaults(defaultState())); };
  const glWorks = Render.ready();
  const faceOf = (zone, orient) => Derived.get().groups.find((g) => g.zone === zone && g.orientation === orient);
  const blur = () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); };
  const key = (k, opts = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));

  try {
    await t('select and clear a face; the card shows its name', () => {
      fresh();
      const g = faceOf('middle', 'S');
      Select.select([{ kind: 'face', id: g.id }]);
      const card = $('selection-card');
      const out = [Select.count(), card.hidden, /Face F\d+ · South/.test(card.textContent)];
      Select.clear();
      return eq([out, Select.count(), card.hidden], [[1, false, true], 0, true]);
    });
    await t('only valid faces can be selected', () => {
      fresh();
      Select.select([{ kind: 'face', id: 'nope' }, { kind: 'core', id: 'S1' }]);
      return eq(Select.count(), 0);
    });
    await t('the face card shows S, 300 ft, the level range, the zone and the WWR of the south middle faces', () => {
      fresh();
      const g = faceOf('middle', 'S');
      Select.select([{ kind: 'face', id: g.id }]);
      const text = $('selection-card').textContent;
      const gi = Derived.get().groupInfo[g.id];
      const out = [/South/.test(text), /300'-0"/.test(text), /levels 2 to 4/.test(text), /Middle/.test(text), text.includes(`${(gi.wwr * 100).toFixed(1)}%`)];
      Select.clear();
      return eq(out, [true, true, true, true, true]);
    });
    await t('a click on the south face opens the face card with S, 300 ft and its WWR', () => {
      if (!glWorks) return true;
      fresh();
      const g = faceOf('middle', 'S');
      const pt = Select.screenPointFor({ kind: 'face', id: g.id });
      if (!pt) return 'no screen point for the south face';
      const hit = Select.click(pt.x, pt.y);
      const text = $('selection-card').textContent;
      const out = [hit && hit.id === g.id, Select.get()[0] && Select.get()[0].id === g.id, /South/.test(text), /300'-0"/.test(text), text.includes(`${(Derived.get().groupInfo[g.id].wwr * 100).toFixed(1)}%`)];
      Select.clear();
      return eq(out, [true, true, true, true, true]);
    });
    await t('a click on every face group picks that group', () => {
      if (!glWorks) return true;
      fresh();
      const bad = [];
      let seen = 0;
      for (const g of Derived.get().groups) {
        const pt = Select.screenPointFor({ kind: 'face', id: g.id });
        if (!pt) continue;                                            // a face behind the building cannot be picked from the axon camera
        seen++;
        const hit = Select.pickAt(pt.x, pt.y);
        if (!hit || hit.id !== g.id) bad.push(`${g.id} -> ${hit && hit.id}`);
      }
      if (seen < 6) bad.push(`only ${seen} faces can be picked`);       // the south and east faces, three zones each
      return bad.length ? bad.join(', ') : true;
    });
    await t('a click on empty ground clears the selection', () => {
      if (!glWorks) return true;
      fresh();
      const g = faceOf('middle', 'S');
      Select.select([{ kind: 'face', id: g.id }]);
      const r = Render.canvas().getBoundingClientRect();
      Select.click(r.left + 6, r.top + 6);
      return eq(Select.count(), 0);
    });
    await t('the outline is drawn for the selected face and removed when it is cleared', () => {
      if (!glWorks) return true;
      fresh();
      const g = faceOf('middle', 'S');
      Select.select([{ kind: 'face', id: g.id }]);
      const on = Select.overlayInfo().outline;
      Select.clear();
      return eq([on > 0, Select.overlayInfo().outline], [true, 0]);
    });
    await t('the street switch in the card turns the face into a manual street face (one undo)', () => {
      fresh();
      const g = faceOf('middle', 'N');
      Select.select([{ kind: 'face', id: g.id }]);
      const before = snap();
      $('selection-card').querySelector('[data-action="street"]').click();
      const out = [Store.get('street.mode'), Store.get('street.manual').includes(g.id), Derived.get().street.includes(g.id)];
      const back = TestHelp.oneStep(before);
      Select.clear();
      return eq([...out, back], ['manual', true, true, true]);
    });
    await t('Pick street faces: a click toggles a street face and does not select', () => {
      if (!glWorks) return true;
      fresh();
      const g = faceOf('middle', 'S');
      Select.select([]);
      UI.setStreetPick(true);
      const pt = Select.screenPointFor({ kind: 'face', id: g.id });
      Select.click(pt.x, pt.y);
      const on = Derived.get().street.includes(g.id);
      Select.click(pt.x, pt.y);
      const off = Derived.get().street.includes(g.id);
      UI.setStreetPick(false);
      return eq([on, off, Select.count(), Store.get('street.mode')], [true, false, 0, 'manual']);
    });
    await t('Open in panel opens the zone card of the face with its orientation chosen', () => {
      fresh();
      const g = faceOf('middle', 'S');
      Select.select([{ kind: 'face', id: g.id }]);
      $('selection-card').querySelector('[data-action="open"]').click();
      const out = [UI.activeTab(), UI.zoneTarget('middle'), visible(document.querySelector('[data-section="zone-middle"] .acc-body'))];
      UI.zoneTarget('middle');
      document.querySelector('[data-section="zone-middle"] [data-target="all"]').click();
      Select.clear();
      return eq(out, ['facade', 'S', true]);
    });
    await t('keys 2 to 5 set the elevation views, 1 the axon, 6 the plan', async () => {
      if (!glWorks) return true;
      fresh(); blur();
      const seen = [];
      for (const k of ['2', '3', '4', '5', '6', '1']) { key(k); seen.push(Render.info().preset); }
      return eq(seen, ['n', 'e', 's', 'w', 'plan', 'axon']);
    });
    await t('D switches Model and Diagram; keys are ignored while typing in a field', () => {
      fresh(); blur(); UI.setTab('massing'); TestHelp.openSection('standalone');
      key('d');
      const a = Store.get('view.style');
      const input = document.querySelector('#panelScroll input.numfield');
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true }));
      key('d');
      input.blur();
      const b = Store.get('view.style');
      key('d');
      return eq([a, b, Store.get('view.style')], ['diagram', 'diagram', 'model']);
    });
    await t('Escape clears the selection', () => {
      fresh(); blur();
      Select.select([{ kind: 'face', id: faceOf('top', 'N').id }]);
      key('Escape');
      return eq(Select.count(), 0);
    });
    await t('a change that removes the selected face clears the selection', () => {
      fresh();
      const g = faceOf('top', 'N');
      Select.select([{ kind: 'face', id: g.id }]);
      Store.set('standalone.floors', 2, { live: false });
      const n = Select.count();
      return eq(n === 0 || Derived.get().groups.some((x) => x.id === Select.get()[0].id), true);
    });
  } finally {
    Select.clear(); UI.setStreetPick(false);
    Store.replace(savedState); UI.setTab(savedTab);
    Options.holdAutosave(false);
    UI.updateHud(Derived.get());
  }
  TestHelp.merged('select', results);
  return results;
}
