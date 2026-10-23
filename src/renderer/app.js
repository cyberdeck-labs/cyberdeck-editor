// Cyberdeck Editor – Oberflaeche (Renderer, sandboxed). Dateizugriff nur ueber window.cdeApi (IPC).
import { createEditor, setDoc, gotoLine, refreshLinks } from './editor.js';
import { renderMarkdown, postProcess } from './preview.js';
import { Graph, localGraph, filterGhosts } from './graph.js';
import { Resolver, noteName, dirOf, cmp, MD_EXT, IMG_EXT } from '../linkutil.js';

const api = window.cdeApi;
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + String(e.reason && e.reason.message || e.reason)));
const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

const S = {
  snap: null, resolver: new Resolver(), noteKey: '', options: [], tabs: [], active: null, lastNote: null, recent: [],
  expanded: new Set(), graph: null, ghosts: true, depth: 1, local: null, localRel: null, tabSeq: 0, searchSeq: 0, update: null,
};
const noteTabs = () => S.tabs.filter((t) => t.type === 'note');
const currentRel = () => (S.active && S.active.type === 'note' ? S.active.rel : S.lastNote);
const currentDir = () => { const r = currentRel(); return r ? dirOf(r) : ''; };

// ───────────── Kleinkram: Toast, Modals, Kontextmenue
function toast(msg, kind = '') {
  const t = h('div', { class: 'toast ' + kind }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}
function modal(build) {
  return new Promise((res) => {
    const back = h('div', { class: 'modal-back' });
    const box = h('div', { class: 'modal' });
    back.append(box);
    $('#modal-root').append(back);
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } };
    const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); res(v); };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(null); });
    build(box, close);
  });
}
function promptModal(title, value = '', hint = '') {
  return modal((box, close) => {
    const inp = h('input', { class: 'inp', value, spellcheck: 'false' });
    const ok = () => close(inp.value.trim() || null);
    box.append(h('div', { class: 'mtitle' }, title), hint ? h('div', { class: 'mhint' }, hint) : null, inp,
      h('div', { class: 'mbtns' }, h('button', { class: 'btn', onclick: () => close(null) }, 'Abbrechen'), h('button', { class: 'btn pri', onclick: ok }, 'OK')));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    setTimeout(() => { inp.focus(); inp.select(); });
  });
}
function confirmModal(text, okLabel = 'OK', danger = false) {
  return modal((box, close) => {
    const okb = h('button', { class: 'btn pri' + (danger ? ' danger' : ''), onclick: () => close(true) }, okLabel);
    box.append(h('div', { class: 'mtitle' }, danger ? 'ACHTUNG' : 'BESTÄTIGEN'), h('div', { class: 'mtext' }, text),
      h('div', { class: 'mbtns' }, h('button', { class: 'btn', onclick: () => close(false) }, 'Abbrechen'), okb));
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(true); } });
    setTimeout(() => okb.focus());
  }).then((v) => !!v);
}
function showMenu(x, y, items) {
  const m = $('#ctxmenu');
  m.textContent = '';
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.append(h('div', { class: 'sep' })); continue; }
    m.append(h('div', { class: 'mi' + (it[2] ? ' ' + it[2] : ''), onclick: () => { hideMenu(); it[1](); } }, it[0]));
  }
  m.style.display = 'block';
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 6) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
}
const hideMenu = () => { $('#ctxmenu').style.display = 'none'; };

// ───────────── Vault-Zustand
function setSnapshot(snap) {
  const rootChanged = !S.snap || S.snap.root !== snap.root;
  if (rootChanged) {
    for (const t of [...S.tabs]) closeTab(t, { nosave: true });
    S.expanded = new Set(); S.lastNote = null; S.recent = []; S.localRel = null; S.graph = null;
  }
  S.snap = snap;
  S.resolver = new Resolver(snap.notes.map((n) => n.rel), snap.files);
  const key = snap.notes.map((n) => n.rel).join('\n') + '\0' + snap.files.length;
  const linksChanged = key !== S.noteKey;
  S.noteKey = key;
  const counts = new Map();
  for (const n of snap.notes) { const k = noteName(n.rel).toLowerCase(); counts.set(k, (counts.get(k) || 0) + 1); }
  S.options = [];
  for (const n of snap.notes) {
    const name = noteName(n.rel);
    const ins = counts.get(name.toLowerCase()) > 1 ? n.rel.replace(MD_EXT, '') : name;
    S.options.push({ label: name, detail: dirOf(n.rel), insert: ins });
    for (const a of n.aliases || []) S.options.push({ label: a, detail: '→ ' + name, insert: ins + '|' + a, alias: true });
  }
  S.options.sort((a, b) => cmp(a.label, b.label));
  $('#vaultname').textContent = snap.name;
  const noteSet = new Set(snap.notes.map((n) => n.rel));
  for (const t of noteTabs()) {
    t.gone = !noteSet.has(t.rel);
    if (linksChanged) { t.view.dispatch({ effects: refreshLinks.of(null) }); if (t.mode === 'preview') renderPreview(t, true); }
  }
  renderTree(); renderTags(); renderTabs(); updateWelcome();
}
async function refreshNow() {
  if (!S.snap) return;
  try { setSnapshot(await api.snapshot()); await refreshGraph(); await refreshSide(); } catch (e) { console.error(e); }
}
let refreshTimer = null;
const scheduleRefresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshNow, 250); };

async function onFsEvent(ev) {
  if (ev.type === 'change' && ev.external) {
    const t = noteTabs().find((x) => x.rel === ev.rel);
    if (t) {
      if (t.dirty || t.timer) toast(`Konflikt: „${noteName(t.rel)}“ wurde extern geändert – deine Version bleibt.`, 'err');
      else {
        try {
          const text = await api.read(t.rel);
          if (text !== t.view.state.doc.toString()) { setDoc(t.view, text); t.saved = text; if (t.mode === 'preview') renderPreview(t, true); toast(`Extern geändert: „${noteName(t.rel)}“ neu geladen`); t.reloads = (t.reloads || 0) + 1; }
        } catch { /* gleich wieder weg */ }
      }
    }
  }
  scheduleRefresh();
}

// ───────────── Dateibaum
function buildTree() {
  const root = { rel: '', dirs: new Map(), files: [] };
  const dirNode = (rel) => {
    let n = root;
    if (!rel) return n;
    let acc = '';
    for (const seg of rel.split('/')) {
      acc = acc ? acc + '/' + seg : seg;
      if (!n.dirs.has(seg)) n.dirs.set(seg, { name: seg, rel: acc, dirs: new Map(), files: [] });
      n = n.dirs.get(seg);
    }
    return n;
  };
  for (const d of S.snap.dirs) dirNode(d);
  for (const n of S.snap.notes) dirNode(dirOf(n.rel)).files.push({ rel: n.rel, name: noteName(n.rel), md: true });
  for (const f of S.snap.files) dirNode(dirOf(f)).files.push({ rel: f, name: f.split('/').pop(), md: false });
  return root;
}
function renderTree() {
  const tree = $('#tree');
  const st = tree.scrollTop;
  tree.textContent = '';
  if (!S.snap) return;
  const cur = currentRel();
  const walk = (node, depth) => {
    for (const d of [...node.dirs.values()].sort((a, b) => cmp(a.name, b.name))) {
      const open = S.expanded.has(d.rel);
      tree.append(h('div', { class: 'row dir' + (open ? ' open' : ''), style: `padding-left:${8 + depth * 14}px`, 'data-rel': d.rel, 'data-dir': '1', title: d.rel,
        onclick: () => { if (open) S.expanded.delete(d.rel); else S.expanded.add(d.rel); renderTree(); } },
      h('span', { class: 'caret' }, open ? '▾' : '▸'), h('span', { class: 'nm' }, d.name)));
      if (open) walk(d, depth + 1);
    }
    for (const f of node.files.sort((a, b) => cmp(a.name, b.name))) {
      tree.append(h('div', { class: 'row file' + (f.md ? '' : ' att') + (f.rel === cur ? ' active' : ''), style: `padding-left:${22 + depth * 14}px`, 'data-rel': f.rel, title: f.rel,
        onclick: () => (f.md ? openNote(f.rel) : api.openFile(f.rel)) }, h('span', { class: 'nm' }, f.name)));
    }
  };
  walk(buildTree(), 0);
  tree.scrollTop = st;
  $('#tree-count').textContent = `${S.snap.notes.length} NOTIZEN`;
}
function expandTo(rel) { const segs = rel.split('/'); for (let i = 1; i < segs.length; i++) S.expanded.add(segs.slice(0, i).join('/')); }

function treeMenu(e) {
  e.preventDefault();
  if (!S.snap) return;
  const row = e.target.closest('.row');
  const rel = row ? row.dataset.rel : '';
  const isDir = !row || !!row.dataset.dir;
  const dir = isDir ? rel : dirOf(rel);
  showMenu(e.clientX, e.clientY, [
    ['Neue Notiz', () => newNote(dir)],
    ['Neuer Ordner', () => newFolder(dir)],
    row && '-',
    row && ['Umbenennen', () => renameEntry(rel, isDir)],
    row && ['Löschen (.trash)', () => deleteEntry(rel, isDir), 'danger'],
    '-',
    ['Im Dateimanager zeigen', () => api.showInFolder(rel)],
  ]);
}

async function newNote(dir = currentDir(), name = null) {
  if (!S.snap) return toast('Erst einen Vault öffnen', 'err');
  name = name || await promptModal('NEUE NOTIZ', 'Unbenannt', dir ? `Ordner: ${dir}` : 'Ordner: (Vault-Wurzel)');
  if (!name) return null;
  try {
    const rel = await api.createNote(dir, name);
    expandTo(rel);
    await refreshNow();
    return openNote(rel);
  } catch (e) { toast(e.message, 'err'); return null; }
}
async function newFolder(dir = '') {
  const name = await promptModal('NEUER ORDNER', 'Neuer Ordner', dir ? `In: ${dir}` : 'In: (Vault-Wurzel)');
  if (!name) return;
  try { const rel = await api.createFolder(dir, name); expandTo(rel + '/x'); await refreshNow(); } catch (e) { toast(e.message, 'err'); }
}
async function renameEntry(rel, isDir, name = null) {
  const cur = isDir ? rel.split('/').pop() : (MD_EXT.test(rel) ? noteName(rel) : rel.split('/').pop());
  name = name || await promptModal('UMBENENNEN', cur, rel);
  if (!name || name === cur) return null;
  const affected = noteTabs().filter((t) => t.rel === rel || t.rel.startsWith(rel + '/'));
  for (const t of affected) await save(t);
  try {
    const dest = await api.rename(rel, name);
    for (const t of affected) t.rel = dest + t.rel.slice(rel.length);
    if (S.lastNote && (S.lastNote === rel || S.lastNote.startsWith(rel + '/'))) S.lastNote = dest + S.lastNote.slice(rel.length);
    if (S.expanded.delete(rel)) S.expanded.add(dest);
    S.localRel = null;
    await refreshNow();
    toast(`Umbenannt: ${dest}`);
    return dest;
  } catch (e) { toast(e.message, 'err'); return null; }
}
async function deleteEntry(rel, isDir) {
  if (!await confirmModal(`„${rel}“${isDir ? ' (Ordner mit Inhalt)' : ''} in den Papierkorb des Vaults (.trash) verschieben?`, 'Löschen', true)) return;
  for (const t of noteTabs().filter((x) => x.rel === rel || x.rel.startsWith(rel + '/'))) closeTab(t, { nosave: true });
  try { await api.remove(rel); await refreshNow(); toast('In .trash verschoben'); } catch (e) { toast(e.message, 'err'); }
}

// ───────────── Tabs
function renderTabs() {
  const bar = $('#tabs');
  bar.textContent = '';
  for (const t of S.tabs) {
    const title = t.type === 'graph' ? 'GRAPH' : noteName(t.rel);
    bar.append(h('div', { class: 'tab' + (t === S.active ? ' active' : '') + (t.type === 'graph' ? ' gtab' : '') + (t.gone ? ' gone' : ''), title: t.rel || 'Globaler Graph',
      onmousedown: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t); } else if (e.button === 0) activate(t); } },
    h('span', { class: 'ttl' }, title), t.dirty ? h('span', { class: 'dot' }, '●') : null,
    h('span', { class: 'x', onmousedown: (e) => { e.stopPropagation(); closeTab(t); } }, '✕')));
  }
  const a = S.active;
  const mb = $('#modebtn');
  mb.style.visibility = a && a.type === 'note' ? 'visible' : 'hidden';
  if (a && a.type === 'note') mb.textContent = a.mode === 'edit' ? '◉ VORSCHAU' : '✎ BEARBEITEN';
}
function activate(t, focus = true) {
  if (!t) return;
  S.active = t;
  for (const x of S.tabs) x.el.classList.toggle('active', x === t);
  if (t.type === 'note') {
    S.lastNote = t.rel;
    S.recent = [t.rel, ...S.recent.filter((r) => r !== t.rel)].slice(0, 30);
    if (focus && t.mode === 'edit') setTimeout(() => t.view.focus());
  } else if (t.type === 'graph') { t.graph.resize(); t.graph.setCurrent(S.lastNote); }
  renderTabs(); renderTree(); updateStatus(); updateWelcome(); refreshSide();
}
async function closeTab(t, { nosave = false } = {}) {
  const i = S.tabs.indexOf(t);
  if (i < 0) return;
  if (t.type === 'note') { if (!nosave) await save(t); clearTimeout(t.timer); t.view.destroy(); } else if (t.graph) t.graph.destroy();
  t.el.remove();
  S.tabs.splice(i, 1);
  if (S.active === t) { S.active = null; activate(S.tabs[Math.min(i, S.tabs.length - 1)]); }
  renderTabs(); updateWelcome(); updateStatus();
}
function cycleTab(d) { if (S.tabs.length < 2) return; const i = S.tabs.indexOf(S.active); activate(S.tabs[(i + d + S.tabs.length) % S.tabs.length]); }

async function openNote(rel, opts = {}) {
  let t = noteTabs().find((x) => x.rel === rel);
  if (!t) {
    let text;
    try { text = await api.read(rel); } catch (e) { toast('Kann nicht öffnen: ' + e.message, 'err'); return null; }
    t = noteTabs().find((x) => x.rel === rel) || makeNoteTab(rel, text);
  }
  expandTo(rel);
  activate(t, opts.line == null && !opts.heading);
  if (opts.line != null) { if (t.mode === 'preview') togglePreview(t, 'edit'); gotoLine(t.view, opts.line); }
  if (opts.heading) jumpHeading(t, opts.heading);
  return t;
}
function makeNoteTab(rel, text) {
  const ed = h('div', { class: 'ed' });
  const pv = h('div', { class: 'pv markdown hidden' });
  const el = h('div', { class: 'view note' }, ed, pv);
  $('#views').append(el);
  const t = { id: ++S.tabSeq, type: 'note', rel, el, ed, pv, mode: 'edit', saved: text, dirty: false, timer: null, saves: 0 };
  t.view = createEditor({
    parent: ed, doc: text,
    onChange: (u) => { if (u.transactions.some((tr) => tr.isUserEvent('external'))) return; scheduleSave(t); updateStatus(); },
    onLink: (l) => openLink(l.target, l.heading, t.rel),
    resolve: (target) => !target || !!S.resolver.resolveNote(target, t.rel) || (IMG_EXT.test(target) && !!S.resolver.resolveFile(target, t.rel)),
    getOptions: () => S.options,
    onSave: () => save(t, true),
  });
  pv.addEventListener('click', (e) => onPreviewClick(e, t));
  S.tabs.push(t);
  return t;
}
function jumpHeading(t, heading) {
  const want = heading.trim().toLowerCase();
  if (t.mode === 'preview') {
    const el = [...t.pv.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((x) => x.textContent.trim().toLowerCase() === want);
    if (el) el.scrollIntoView({ block: 'start' });
    return;
  }
  const lines = t.view.state.doc.toString().split('\n');
  const i = lines.findIndex((l) => { const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(l); return m && m[1].trim().toLowerCase() === want; });
  if (i >= 0) gotoLine(t.view, i);
}

// ───────────── Speichern (Autosave ~500 ms, atomar im Hauptprozess)
function scheduleSave(t) {
  if (!t.dirty) { t.dirty = true; renderTabs(); }
  setSaveState('● UNGESPEICHERT', 'warn');
  clearTimeout(t.timer);
  t.timer = setTimeout(() => save(t), 500);
}
async function save(t, manual = false) {
  if (!t || t.type !== 'note') return;
  clearTimeout(t.timer);
  t.timer = null;
  if (t.saving) await t.saving;
  const text = t.view.state.doc.toString();
  if (text === t.saved) { if (t.dirty) { t.dirty = false; renderTabs(); } if (manual) setSaveState('✓ GESPEICHERT', 'ok'); return; }
  t.saving = api.write(t.rel, text).then(() => {
    t.saved = text; t.saves++; t.gone = false;
    t.dirty = t.view.state.doc.toString() !== text;
    setSaveState('✓ GESPEICHERT', 'ok');
  }).catch((e) => { setSaveState('✕ FEHLER', 'err'); toast('Speichern fehlgeschlagen: ' + e.message, 'err'); });
  await t.saving;
  t.saving = null;
  renderTabs();
  if (t.dirty) scheduleSave(t);
}
const flushAll = () => Promise.all(noteTabs().map((t) => save(t)));

// ───────────── Vorschau
function renderPreview(t, keepScroll = false) {
  const st = t.pv.scrollTop;
  t.pv.innerHTML = renderMarkdown(t.view.state.doc.toString(), { rel: t.rel, resolver: S.resolver });
  t.pvDone = postProcess(t.pv).catch((e) => { console.error(e); return -1; });
  if (keepScroll) t.pv.scrollTop = st;
}
function togglePreview(t = S.active, mode = null) {
  if (!t || t.type !== 'note') return;
  t.mode = mode || (t.mode === 'edit' ? 'preview' : 'edit');
  if (t.mode === 'preview') renderPreview(t);
  t.ed.classList.toggle('hidden', t.mode === 'preview');
  t.pv.classList.toggle('hidden', t.mode !== 'preview');
  if (t.mode === 'edit') t.view.focus();
  renderTabs();
}
function onPreviewClick(e, t) {
  const a = e.target.closest('a');
  if (!a) return;
  e.preventDefault();
  if (a.classList.contains('wikilink')) openLink(a.dataset.wl || '', a.dataset.h || null, t.rel);
  else if (a.classList.contains('tag')) runSearch('#' + a.dataset.tag);
  else if (a.classList.contains('attachment')) { const rel = decodeURIComponent(a.getAttribute('href').replace('cde://vault/', '')); api.openFile(rel); } else if (/^(https?|mailto):/i.test(a.getAttribute('href') || '')) api.openExternal(a.getAttribute('href'));
}

// Link oeffnen; nicht aufgeloest -> Anlegen anbieten
async function openLink(target, heading, fromRel) {
  if (!target) { if (heading && S.active && S.active.type === 'note') jumpHeading(S.active, heading); return null; }
  let rel = S.resolver.resolveNote(target, fromRel);
  if (!rel && /\.[a-z0-9]{1,6}$/i.test(target) && !MD_EXT.test(target)) { const f = S.resolver.resolveFile(target, fromRel); if (f) api.openFile(f); else toast('Datei fehlt: ' + target, 'err'); return null; }
  if (!rel) {
    if (!await confirmModal(`Die Notiz „${target}“ existiert noch nicht. Jetzt anlegen?`, 'Notiz anlegen')) return null;
    try { rel = await api.createAt(target); } catch (e) { toast(e.message, 'err'); return null; }
    expandTo(rel);
    await refreshNow();
    toast('Angelegt: ' + rel);
  }
  return openNote(rel, { heading });
}

// ───────────── Graph
function openGraph() {
  if (!S.snap) return toast('Erst einen Vault öffnen', 'err');
  let t = S.tabs.find((x) => x.type === 'graph');
  if (!t) {
    const canvas = h('canvas', { class: 'gcanvas' });
    const ghostBox = h('input', { type: 'checkbox' });
    ghostBox.checked = S.ghosts;
    ghostBox.onchange = () => { S.ghosts = ghostBox.checked; $('#lg-ghosts').checked = S.ghosts; S.localRel = null; updateGraphs(); };
    const stat = h('span', { class: 'gstat' });
    const el = h('div', { class: 'view graphview' },
      h('div', { class: 'gtools' }, h('span', { class: 'gtitle' }, 'GLOBALER GRAPH'), h('label', { class: 'chk' }, ghostBox, ' GEISTER-KNOTEN'),
        h('button', { class: 'btn sm', onclick: () => t.graph.fit() }, 'EINPASSEN'), stat,
        h('span', { class: 'ghint' }, 'Ziehen = verschieben · Rad = Zoom · Klick = öffnen · Doppelklick = einpassen')),
      canvas);
    $('#views').append(el);
    t = { id: ++S.tabSeq, type: 'graph', el, canvas, stat, ghostBox };
    S.tabs.push(t);
    t.graph = new Graph(canvas, { onOpen: openNode });
    activate(t);
    t.graph.resize();
    updateGraphs();
  } else activate(t);
  return t;
}
function openNode(n) { if (n.ghost) openLink(n.name, null, S.lastNote); else openNote(n.id); }
async function refreshGraph() {
  if (!S.snap) return;
  S.graph = await api.graph();
  updateGraphs();
}
function updateGraphs() {
  if (!S.graph) return;
  const gt = S.tabs.find((x) => x.type === 'graph');
  if (gt) {
    const d = filterGhosts(S.graph, S.ghosts);
    gt.graph.setData(d, S.lastNote);
    gt.stat.textContent = `${d.nodes.filter((n) => !n.ghost).length} NOTIZEN · ${d.nodes.filter((n) => n.ghost).length} GEISTER · ${d.links.length} LINKS`;
  }
  updateLocalGraph();
}
function updateLocalGraph() {
  const rel = currentRel();
  if (!S.local || !S.graph) return;
  if (!rel) { S.local.reset(); S.local.setData({ nodes: [], links: [] }, null); return; }
  if (S.localRel !== rel) { S.local.reset(); S.localRel = rel; }
  S.local.setData(localGraph(S.graph, rel, S.depth, S.ghosts), rel);
}

// ───────────── Rechte Seite: lokaler Graph, Backlinks, ausgehende Links
function linkSnippet(s) {
  const out = [];
  let last = 0;
  const re = /!?\[\[[^[\]\n]+?\]\]/g;
  let m;
  while ((m = re.exec(s))) { out.push(s.slice(last, m.index), h('span', { class: 'wl' }, m[0])); last = m.index + m[0].length; }
  out.push(s.slice(last));
  return out;
}
let sideSeq = 0;
async function refreshSide() {
  const rel = currentRel();
  const seq = ++sideSeq;
  $('#side-title').textContent = rel ? noteName(rel) : '—';
  updateLocalGraph();
  const bl = $('#backlinks');
  const og = $('#outgoing');
  if (!rel || !S.snap) { bl.textContent = ''; og.textContent = ''; $('#bl-count').textContent = ''; $('#og-count').textContent = ''; return; }
  let data;
  try { data = await api.links(rel); } catch { return; }
  if (seq !== sideSeq) return;
  const groups = new Map();
  for (const b of data.backlinks) { if (!groups.has(b.from)) groups.set(b.from, []); groups.get(b.from).push(b); }
  $('#bl-count').textContent = groups.size;
  bl.textContent = '';
  if (!groups.size) bl.append(h('div', { class: 'empty' }, 'Keine Backlinks'));
  for (const [from, items] of [...groups].sort((a, b) => cmp(a[0], b[0]))) {
    bl.append(h('div', { class: 'bl' }, h('div', { class: 'bl-file', onclick: () => openNote(from), title: from }, noteName(from)),
      items.slice(0, 4).map((b) => h('div', { class: 'bl-snip', onclick: () => openNote(from, { line: b.line }) }, linkSnippet(b.snippet)))));
  }
  og.textContent = '';
  $('#og-count').textContent = data.outgoing.length;
  if (!data.outgoing.length) og.append(h('div', { class: 'empty' }, 'Keine Links'));
  for (const o of data.outgoing) {
    if (o.resolved && !o.attachment) og.append(h('div', { class: 'og ok', onclick: () => openNote(o.resolved, { heading: o.heading }), title: o.resolved }, '→ ' + noteName(o.resolved) + (o.heading ? ' › ' + o.heading : '')));
    else if (o.attachment) og.append(h('div', { class: 'og att', onclick: () => api.openFile(o.resolved), title: o.resolved }, '⧉ ' + o.resolved.split('/').pop()));
    else og.append(h('div', { class: 'og miss', onclick: () => openLink(o.target, o.heading, rel), title: 'Nicht vorhanden – Klick zum Anlegen' }, '+ ' + o.target));
  }
  if (data.tags.length) og.append(h('div', { class: 'og-tags' }, data.tags.map((t) => h('span', { class: 'tagchip', onclick: () => runSearch('#' + t) }, '#' + t))));
}

// ───────────── Linke Seite: Panels, Suche, Tags
function showPanel(p) {
  for (const b of document.querySelectorAll('#lefttabs button')) b.classList.toggle('active', b.dataset.p === p);
  for (const el of document.querySelectorAll('#left .panel')) el.classList.toggle('hidden', el.id !== 'p-' + p);
}
async function runSearch(q = null) {
  showPanel('search');
  const inp = $('#search-input');
  if (q != null) inp.value = q;
  const query = inp.value.trim();
  const box = $('#search-results');
  const seq = ++S.searchSeq;
  if (!query || !S.snap) { box.textContent = ''; return []; }
  let res;
  try { res = await api.search(query); } catch (e) { toast(e.message, 'err'); return []; }
  if (seq !== S.searchSeq) return res;
  box.textContent = '';
  box.append(h('div', { class: 'sr-count' }, `${res.length} ${res.length === 1 ? 'NOTIZ' : 'NOTIZEN'}`));
  for (const r of res) {
    box.append(h('div', { class: 'sr' },
      h('div', { class: 'sr-file', onclick: () => openNote(r.rel), title: r.rel }, h('span', {}, noteName(r.rel)), r.count ? h('span', { class: 'sr-n' }, r.count) : null),
      r.hits.map((m) => h('div', { class: 'sr-hit', onclick: () => openNote(r.rel, { line: m.line }) }, m.text.slice(0, m.start), h('mark', {}, m.text.slice(m.start, m.start + m.len)), m.text.slice(m.start + m.len)))));
  }
  return res;
}
function renderTags() {
  const box = $('#tag-list');
  box.textContent = '';
  const tags = Object.entries(S.snap ? S.snap.tags : {}).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
  if (!tags.length) box.append(h('div', { class: 'empty' }, 'Keine #tags gefunden'));
  for (const [t, n] of tags) box.append(h('div', { class: 'tagrow', onclick: () => runSearch('#' + t) }, h('span', { class: 'tg' }, '#' + t), h('span', { class: 'tn' }, n)));
}

// ───────────── Schnellwechsler (Strg+O)
function fuzzy(q, s) {
  q = q.toLowerCase();
  const t = s.toLowerCase();
  let score = 0;
  let ti = 0;
  let last = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    const i = t.indexOf(ch, ti);
    if (i < 0) return -1;
    if (i === last + 1) score += 6;
    else score += 1 - Math.min(2, (i - ti) * 0.1);
    if (i === 0) score += 8;
    else if (/[\s/_\-.]/.test(t[i - 1])) score += 4;
    last = i;
    ti = i + 1;
  }
  if (t.startsWith(q)) score += 12;
  else if (t.includes(q)) score += 6;
  return score - t.length * 0.02;
}
function quickSwitcher() {
  if (!S.snap) return toast('Erst einen Vault öffnen', 'err');
  if ($('.modal.switcher')) return;
  return modal((box, close) => {
    box.classList.add('switcher');
    const inp = h('input', { class: 'inp', placeholder: 'Notiz suchen …', spellcheck: 'false' });
    const list = h('div', { class: 'qs-list' });
    box.append(h('div', { class: 'mtitle' }, 'SCHNELLWECHSLER', h('span', { class: 'mkeys' }, '↑↓ wählen · Enter öffnen · Esc')), inp, list);
    const cands = S.snap.notes.flatMap((n) => [{ rel: n.rel, name: noteName(n.rel) }, ...(n.aliases || []).map((a) => ({ rel: n.rel, name: a, alias: true }))]);
    const rank = new Map(S.recent.map((r, i) => [r, i]));
    let items = [];
    let sel = 0;
    const draw = () => {
      list.textContent = '';
      items.forEach((c, i) => list.append(h('div', { class: 'qs-item' + (i === sel ? ' sel' : ''), onmousedown: (e) => { e.preventDefault(); pick(i); } },
        h('span', { class: 'qn' }, c.name), c.alias ? h('span', { class: 'qa' }, 'ALIAS') : null, h('span', { class: 'qp' }, dirOf(c.rel)))));
      const q = inp.value.trim();
      if (!items.length && q) list.append(h('div', { class: 'qs-empty' }, `Enter: neue Notiz „${q}“ anlegen`));
      list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    };
    const update = () => {
      const q = inp.value.trim();
      if (!q) items = cands.filter((c) => !c.alias).sort((a, b) => (rank.has(a.rel) ? rank.get(a.rel) : 1e9) - (rank.has(b.rel) ? rank.get(b.rel) : 1e9) || cmp(a.name, b.name));
      else {
        const seen = new Set();
        items = cands.map((c) => ({ ...c, s: Math.max(fuzzy(q, c.name) * 1.4, fuzzy(q, c.rel)) })).filter((c) => c.s >= 0).sort((a, b) => b.s - a.s)
          .filter((c) => (seen.has(c.rel) ? false : seen.add(c.rel)));
      }
      items = items.slice(0, 50);
      sel = 0;
      draw();
    };
    const pick = async (i) => {
      const c = items[i];
      const q = inp.value.trim();
      close(true);
      if (c) openNote(c.rel);
      else if (q) { try { const rel = await api.createAt(q); expandTo(rel); await refreshNow(); openNote(rel); } catch (e) { toast(e.message, 'err'); } }
    };
    inp.addEventListener('input', update);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); } else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); } else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
    });
    update();
    setTimeout(() => inp.focus());
  });
}

// ───────────── Statusleiste, Willkommen
function setSaveState(text, kind = '') { const el = $('#st-save'); el.textContent = text; el.className = kind; }
function updateStatus() {
  const t = S.active;
  if (t && t.type === 'note') {
    const text = t.view.state.doc.toString();
    $('#st-file').textContent = t.rel;
    $('#st-words').textContent = `${(text.match(/\S+/g) || []).length} WÖRTER · ${text.length} ZEICHEN`;
  } else { $('#st-file').textContent = t ? 'GRAPH' : ''; $('#st-words').textContent = ''; }
}
function updateWelcome() {
  const w = $('#welcome');
  w.classList.toggle('hidden', S.tabs.length > 0);
  $('#welcome-novault').classList.toggle('hidden', !!S.snap);
  $('#welcome-vault').classList.toggle('hidden', !S.snap);
  if (S.snap) $('#welcome-stats').textContent = `${S.snap.notes.length} Notizen · ${Object.keys(S.snap.tags).length} Tags · ${S.snap.dirs.length} Ordner`;
}
async function chooseVault() {
  await flushAll();
  try { const snap = await api.chooseVault(); if (snap) { setSnapshot(snap); await refreshGraph(); refreshSide(); } } catch (e) { toast(e.message, 'err'); }
}

// ───────────── Tastenkuerzel
function onKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') hideMenu();
  if (!mod || e.altKey) return;
  const k = e.key.toLowerCase();
  const inModal = !!$('.modal-back');
  if (inModal && k !== 'o') return;
  if (k === 'tab') cycleTab(e.shiftKey ? -1 : 1);
  else if (k === 'n' && !e.shiftKey) newNote();
  else if (k === 'w') { if (S.active) closeTab(S.active); }
  else if (k === 'g') openGraph();
  else if (k === 'o') quickSwitcher();
  else if (k === 'f' && e.shiftKey) { const i = $('#search-input'); showPanel('search'); i.focus(); i.select(); }
  else if (k === 'e') togglePreview();
  else if (k === 's') save(S.active, true);
  else return;
  e.preventDefault();
  e.stopPropagation();
}

// ───────────── Start
async function init() {
  $('#wmin').onclick = () => api.win('min');
  $('#wmax').onclick = () => api.win('max');
  $('#wclose').onclick = () => api.win('close');
  $('#btn-open').onclick = chooseVault;
  $('#welcome-open').onclick = chooseVault;
  $('#btn-graph').onclick = openGraph;
  $('#btn-switch').onclick = quickSwitcher;
  $('#modebtn').onclick = () => togglePreview();
  $('#new-note').onclick = () => newNote();
  $('#new-folder').onclick = () => newFolder(currentDir());
  $('#collapse').onclick = () => { S.expanded.clear(); renderTree(); };
  for (const b of document.querySelectorAll('#lefttabs button')) b.onclick = () => { showPanel(b.dataset.p); if (b.dataset.p === 'search') $('#search-input').focus(); };
  let st = null;
  $('#search-input').addEventListener('input', () => { clearTimeout(st); st = setTimeout(() => runSearch(), 200); });
  $('#tree').addEventListener('contextmenu', treeMenu);
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#ctxmenu')) hideMenu(); });
  window.addEventListener('keydown', onKey, true);
  $('#depth').onchange = (e) => { S.depth = Number(e.target.value); S.localRel = null; updateLocalGraph(); };
  $('#lg-ghosts').onchange = (e) => { S.ghosts = e.target.checked; const g = S.tabs.find((x) => x.type === 'graph'); if (g) g.ghostBox.checked = S.ghosts; S.localRel = null; updateGraphs(); };
  $('#lg-open').onclick = openGraph;
  S.local = new Graph($('#localgraph'), { local: true, onOpen: openNode });

  api.onVault(async (snap) => { const changed = !S.snap || S.snap.root !== snap.root; setSnapshot(snap); if (changed || !S.graph) { await refreshGraph(); refreshSide(); } });
  api.onFs(onFsEvent);
  api.onUpdate((u) => { S.update = u; const el = $('#st-update'); el.textContent = u.text; el.className = 'upd ' + u.state; el.title = u.detail || ''; });
  api.onVersions((v) => { $('#st-ver').textContent = `v${v.app} · CHROMIUM ${v.chromium.split('.')[0]}`; });
  api.onMaximized((m) => document.body.classList.toggle('maxed', m));
  api.onFlush(async () => { await flushAll(); api.win('closed-ok'); });
  $('#st-update').onclick = () => { if (S.update && S.update.state === 'ready') api.installUpdate(); };

  showPanel('files');
  const snap = await api.current();
  if (snap) { setSnapshot(snap); await refreshGraph(); await refreshSide(); }
  updateWelcome();
  api.ready();
  window.cde.ready = true;
}

// Schnittstelle fuer Tests (EDITOR_TEST) und Fehlersuche
window.cde = {
  ready: false, S, openNote, openLink, openGraph, quickSwitcher, runSearch, togglePreview, newNote, renameEntry, deleteEntry, refreshNow, save, flushAll, closeTab, activate, showPanel,
  info: () => ({ vault: S.snap && S.snap.name, notes: S.snap && S.snap.notes.length, tabs: S.tabs.map((t) => t.rel || t.type), active: S.active && (S.active.rel || S.active.type) }),
  setDepth: (d) => { S.depth = d; $('#depth').value = String(d); S.localRel = null; updateLocalGraph(); },
};
init().catch((e) => { console.error(e); toast('Startfehler: ' + e.message, 'err'); window.cde.ready = true; });
