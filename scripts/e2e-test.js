// Headless-Ende-zu-Ende-Test. Aufruf (siehe README):
//   EDITOR_TEST=scripts/e2e-test.js EDITOR_VAULT=<test-vault> EDITOR_OUT=<ordner> electron . --ozone-platform=headless
// Schreibt Screenshots (PNG) und <ordner>/e2e-test.json mit den Ergebnissen.
'use strict';
module.exports = async ({ ev, shot, sleep, waitFor, wc, getVault, fs, path }) => {
  const R = { checks: {}, shots: [], errors: [] };
  const root = getVault().root;
  const disk = (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } };
  const check = async (name, fn) => {
    try { const v = await fn(); R.checks[name] = v && v.pass !== undefined ? v : { pass: !!v, value: v }; } catch (e) { R.checks[name] = { pass: false, error: String(e.message || e) }; }
  };
  const key = async (keyCode, modifiers = ['control']) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await sleep(350);
  };
  const confirm = () => ev("const b = document.querySelector('.modal .btn.pri'); if (b) b.click(); return !!b;");
  await waitFor('cde.S.graph && cde.S.snap');
  wc.focus();

  // 1) Editor
  await ev("await cde.openNote('Showcase.md');");
  await sleep(900);
  R.shots.push(await shot('01-editor'));
  await check('local_graph_painted_on_first_open', async () => {
    const v = await ev("const c = cde.S.local.c; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return { litPixels: n, nodes: cde.S.local.nodes.length };");
    return { pass: v.litPixels > 1000 && v.nodes > 3, value: v };
  });

  await check('ctrl_click_editor_link', async () => {
    const r = await ev(`const el = [...document.querySelectorAll('.view.active .cm-wikilink')].find(e => e.textContent.includes('Firewall'));
      const b = el.getBoundingClientRect(); return { x: Math.round(b.left + 8), y: Math.round(b.top + b.height / 2) };`);
    wc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1, modifiers: ['control'] });
    wc.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1, modifiers: ['control'] });
    await sleep(700);
    const a = await ev('return cde.S.active.rel');
    return { pass: a === 'Netzwerk/Firewall.md', value: a };
  });

  await check('wikilink_resolution', async () => {
    const v = await ev(`const r = cde.S.resolver; return {
      lower: r.resolveNote('showcase'), upper: r.resolveNote('NETRUNNER'), path: r.resolveNote('Netzwerk/Firewall'), sub: r.resolveNote('daemon'),
      md: r.resolveFile('Netzwerk/ICE.md'), img: r.resolveFile('netzplan.png'), missing: r.resolveNote('Quantenrouter') };`);
    const pass = v.lower === 'Showcase.md' && v.upper === 'Netrunner.md' && v.path === 'Netzwerk/Firewall.md' && v.sub === 'Netzwerk/Dienste/Daemon.md'
      && v.md === 'Netzwerk/ICE.md' && v.img === 'Anhänge/netzplan.png' && v.missing === null;
    return { pass, value: v };
  });

  await check('backlinks_index', async () => {
    const v = await ev("const l = await cdeApi.links('Netzwerk/Firewall.md'); return { n: l.backlinks.length, from: [...new Set(l.backlinks.map(b => b.from))], snip: l.backlinks[0] && l.backlinks[0].snippet };");
    return { pass: v.from.includes('Showcase.md') && v.from.includes('Index.md') && v.from.includes('Netzwerk/Grundlagen.md'), value: { count: v.n, files: v.from.length, example: v.snip } };
  });

  await check('autocomplete_after_brackets', async () => {
    await ev("await cde.openNote('Autosave Test.md');");
    await sleep(300);
    wc.focus();
    await ev("const t = cde.S.active; const v = t.view; v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } });");
    const diag = await ev("return { active: cde.S.active.rel, focus: document.activeElement.className, modal: !!document.querySelector('.modal-back') }");
    wc.insertText('\n[[');
    await sleep(150);
    wc.insertText('Brand');
    await sleep(800);
    const opts = await ev("return [...document.querySelectorAll('.cm-tooltip-autocomplete li')].map(li => li.textContent).slice(0, 5);");
    await key('Return', []);
    await sleep(300);
    const line = await ev("const d = cde.S.active.view.state.doc; return d.line(d.lines).text;");
    return { pass: opts.some((o) => o.includes('Brandmauer')) && line === '[[Firewall|Brandmauer]]', value: { opts, line, diag } };
  });

  await check('autosave_atomic_write', async () => {
    await ev("const v = cde.S.active.view; v.dispatch({ changes: { from: v.state.doc.length, insert: '\\nAUTOSAVE-MARKER-123' }, userEvent: 'input.type' });");
    const immediate = (disk('Autosave Test.md') || '').includes('AUTOSAVE-MARKER-123');
    await sleep(1700);
    const txt = disk('Autosave Test.md') || '';
    const tmpLeft = fs.readdirSync(root).filter((f) => f.endsWith('.tmp'));
    const dirty = await ev('return cde.S.active.dirty');
    return { pass: !immediate && txt.includes('AUTOSAVE-MARKER-123') && txt.includes('[[Firewall|Brandmauer]]') && !tmpLeft.length && !dirty, value: { writtenBefore500ms: immediate, onDisk: txt.includes('AUTOSAVE-MARKER-123'), brand: txt.includes('[[Firewall|Brandmauer]]'), dirty, tmpLeft } };
  });

  // 2) Vorschau
  await ev("await cde.openNote('Showcase.md');");
  await key('E');
  await check('preview_render', async () => {
    await ev('await cde.S.active.pvDone;');
    await sleep(600);
    const v = await ev(`const pv = cde.S.active.pv; const img = pv.querySelector('img');
      return { mode: cde.S.active.mode, table: !!pv.querySelector('table td'), mermaid: !!pv.querySelector('.mermaid svg'), mermaidErr: !!pv.querySelector('.mermaid-error'),
        hljs: pv.querySelectorAll('pre.hljs .hljs-keyword').length, tasks: pv.querySelectorAll('li.task input[type=checkbox]').length,
        imgs: [...pv.querySelectorAll('img')].map(i => i.naturalWidth), alias: (pv.querySelector('a.wikilink[data-wl=Firewall]') || {}).textContent,
        unresolved: [...pv.querySelectorAll('a.unresolved')].map(a => a.dataset.wl), scripts: pv.querySelectorAll('script').length };`);
    return { pass: v.mode === 'preview' && v.table && v.mermaid && !v.mermaidErr && v.hljs > 2 && v.tasks === 3 && v.imgs.length === 2 && v.imgs.every((x) => x > 0) && v.alias === 'Brandmauer', value: v };
  });
  await ev("const pv = cde.S.active.pv; pv.scrollTop = pv.querySelector('h2').offsetTop - 20;");
  await sleep(400);
  R.shots.push(await shot('02-preview'));

  await check('sanitize_preview', async () => {
    // DOMPurify-Pruefung ueber eine temporaere Notiz
    await ev(`const t = await cde.newNote('', 'XSS Test'); const v = t.view; v.dispatch({ changes: { from: 0, insert: '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>[a](javascript:alert(1))' }, userEvent: 'input.type' }); cde.togglePreview(t, 'preview');`);
    await sleep(600);
    const r = await ev("const pv = cde.S.active.pv; return { xss: window.__xss || 0, onerror: !!pv.querySelector('[onerror]'), script: !!pv.querySelector('script'), js: [...pv.querySelectorAll('a')].some(a => (a.getAttribute('href')||'').startsWith('javascript')) };");
    await ev("await cde.closeTab(cde.S.active);");
    return { pass: !r.xss && !r.onerror && !r.script && !r.js, value: r };
  });

  await check('create_from_unresolved_link', async () => {
    await ev("await cde.openNote('Showcase.md'); if (cde.S.active.mode !== 'preview') cde.togglePreview(cde.S.active, 'preview');");
    await sleep(300);
    await ev("cde.S.active.pv.querySelector('a.wikilink.unresolved[data-wl=Quantenrouter]').click();");
    await sleep(300);
    const asked = await ev("return document.querySelector('.modal .mtext')?.textContent || '';");
    await confirm();
    await sleep(900);
    const active = await ev('return cde.S.active.rel');
    const onDisk = disk('Quantenrouter.md') !== null;
    await ev("await cde.openNote('Showcase.md');");
    await sleep(300);
    const nowResolved = await ev("return !cde.S.active.pv.querySelector('a.unresolved[data-wl=Quantenrouter]');");
    return { pass: asked.includes('Quantenrouter') && active === 'Quantenrouter.md' && onDisk && nowResolved, value: { asked, active, onDisk, nowResolved } };
  });

  // 3) Globaler Graph
  await key('G');
  await sleep(1800);
  await check('graph_global', async () => {
    const v = await ev("const g = cde.S.tabs.find(t => t.type === 'graph'); return { active: cde.S.active.type, nodes: g.graph.nodes.length, ghosts: g.graph.nodes.filter(n => n.ghost).length, links: g.graph.links.length, placed: g.graph.nodes.every(n => Number.isFinite(n.x)) };");
    return { pass: v.active === 'graph' && v.nodes > 30 && v.ghosts > 0 && v.links > 40 && v.placed, value: v };
  });
  await check('graph_hover_and_click_opens', async () => {
    const p = await ev("const g = cde.S.tabs.find(t => t.type === 'graph').graph; const n = g.nodes.find(n => n.id === 'Netrunner.md'); const s = g.toScreen(n); const r = g.c.getBoundingClientRect(); return { x: Math.round(r.left + s.x), y: Math.round(r.top + s.y) };");
    wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    await sleep(500);
    R.shots.push(await shot('03-graph-global'));
    const hover = await ev("return cde.S.tabs.find(t => t.type === 'graph').graph.hover?.id");
    wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await sleep(600);
    const a = await ev('return cde.S.active.rel');
    return { pass: hover === 'Netrunner.md' && a === 'Netrunner.md', value: { hover, opened: a } };
  });
  await check('ghost_toggle', async () => {
    const v = await ev("const g = cde.S.tabs.find(t => t.type === 'graph'); g.ghostBox.click(); const n1 = g.graph.nodes.filter(n => n.ghost).length; g.ghostBox.click(); const n2 = g.graph.nodes.filter(n => n.ghost).length; return { off: n1, on: n2 };");
    return { pass: v.off === 0 && v.on > 0, value: v };
  });

  // 4) Lokaler Graph + Backlinks
  await ev("await cde.openNote('Netzwerk/Firewall.md'); cde.setDepth(2);");
  await sleep(1500);
  await check('local_graph', async () => {
    const v = await ev("const g = cde.S.local; return { center: g.current, nodes: g.nodes.length, d1: (cde.setDepth(1), cde.S.local.nodes.length), backlinks: document.querySelectorAll('#backlinks .bl').length };");
    await ev('cde.setDepth(2);');
    return { pass: v.center === 'Netzwerk/Firewall.md' && v.nodes > v.d1 && v.d1 > 2 && v.backlinks >= 3, value: v };
  });
  await sleep(1200);
  R.shots.push(await shot('04-local-graph-backlinks'));

  // 5) Schnellwechsler + Suche
  await key('O');
  await ev("const i = document.querySelector('.switcher .inp'); i.value = 'ntrn'; i.dispatchEvent(new Event('input'));");
  await sleep(400);
  await check('quick_switcher_fuzzy', async () => {
    const v = await ev("return [...document.querySelectorAll('.qs-item .qn')].map(e => e.textContent).slice(0, 5);");
    return { pass: v[0] === 'Netrunner', value: v };
  });
  R.shots.push(await shot('05-quick-switcher'));
  await key('Escape', []);
  await key('F', ['control', 'shift']);
  await check('fulltext_search', async () => {
    const focused = await ev("return document.activeElement.id");
    await ev("const i = document.querySelector('#search-input'); i.value = 'jack in'; i.dispatchEvent(new Event('input'));");
    await sleep(700);
    const v = await ev("return { files: [...document.querySelectorAll('.sr-file span:first-child')].map(e => e.textContent), marks: document.querySelectorAll('#search-results mark').length };");
    const tag = await ev("const r = await cde.runSearch('#netz'); return r.length;");
    return { pass: focused === 'search-input' && v.files.includes('Showcase') && v.marks > 0 && tag > 3, value: { ...v, tagResults: tag } };
  });
  await ev("await cde.runSearch('Firewall');");
  await sleep(500);
  R.shots.push(await shot('06-search'));

  // 6) Dateioperationen + externe Aenderungen
  await check('rename', async () => {
    await ev("await cde.openNote('Umbenennen Test.md');");
    const dest = await ev("return await cde.renameEntry('Umbenennen Test.md', false, 'Umbenannt Neu');");
    await sleep(500);
    const tab = await ev("return cde.S.tabs.some(t => t.rel === 'Umbenannt Neu.md')");
    return { pass: dest === 'Umbenannt Neu.md' && disk('Umbenannt Neu.md') !== null && disk('Umbenennen Test.md') === null && tab, value: { dest, tabUpdated: tab } };
  });
  await check('external_change_reload', async () => {
    await ev("await cde.openNote('Extern.md');");
    await sleep(300);
    fs.writeFileSync(path.join(root, 'Extern.md'), '# Extern\n\nVON AUSSEN GEÄNDERT [[Index]]\n');
    await waitFor("cde.S.tabs.find(t => t.rel === 'Extern.md').view.state.doc.toString().includes('VON AUSSEN')", 6000);
    fs.writeFileSync(path.join(root, 'Netzwerk', 'Extern Neu.md'), '# Neu\n[[Firewall]]\n');
    await waitFor("cde.S.snap.notes.some(n => n.rel === 'Netzwerk/Extern Neu.md')", 6000);
    const bl = await ev("const l = await cdeApi.links('Netzwerk/Firewall.md'); return l.backlinks.some(b => b.from === 'Netzwerk/Extern Neu.md');");
    fs.unlinkSync(path.join(root, 'Netzwerk', 'Extern Neu.md'));
    await waitFor("!cde.S.snap.notes.some(n => n.rel === 'Netzwerk/Extern Neu.md')", 6000);
    return { pass: bl, value: { reloadedOpenTab: true, newFileIndexed: true, backlinkFromNewFile: bl, deletedFileRemoved: true } };
  });
  await check('delete_to_trash', async () => {
    const p = ev("return await cde.deleteEntry('Löschen Test.md', false);");
    await sleep(300);
    await confirm();
    await p;
    await sleep(400);
    return { pass: disk('Löschen Test.md') === null && fs.existsSync(path.join(root, '.trash', 'Löschen Test.md')), value: fs.readdirSync(path.join(root, '.trash')) };
  });
  await check('path_validation', async () => {
    const v = await ev(`const out = {}; for (const p of ['../outside.md', '/etc/passwd.md', '.obsidian/x.md', 'a/../../b.md']) { try { await cdeApi.read(p); out[p] = 'READ!'; } catch (e) { out[p] = 'blocked'; } }
      try { await cdeApi.write('../evil.md', 'x'); out.write = 'WROTE!'; } catch { out.write = 'blocked'; } return out;`);
    return { pass: Object.values(v).every((x) => x === 'blocked') && !fs.existsSync(path.join(root, '..', 'evil.md')), value: v };
  });
  await check('hidden_dirs_ignored', async () => {
    const v = await ev("return { dirs: cde.S.snap.dirs.filter(d => d.startsWith('.')), notes: cde.S.snap.notes.filter(n => n.rel.split('/').some(s => s.startsWith('.'))).length };");
    return { pass: !v.dirs.length && !v.notes, value: v };
  });
  await check('shortcuts', async () => {
    const out = {};
    await key('Tab');
    out.ctrlTab = await ev('return cde.S.active.rel || cde.S.active.type');
    const before = await ev('return cde.S.tabs.length');
    await key('W');
    out.ctrlW = (await ev('return cde.S.tabs.length')) === before - 1;
    await key('N');
    out.ctrlN = await ev("return !!document.querySelector('.modal .inp')");
    await key('Escape', []);
    return { pass: !!out.ctrlTab && out.ctrlW && out.ctrlN, value: out };
  });
  await ev('await cde.flushAll();');
  R.errors = await ev('return window.__errors || []');
  R.passed = Object.values(R.checks).filter((c) => c.pass).length;
  R.total = Object.keys(R.checks).length;
  return R;
};
