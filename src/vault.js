// Vault = Ordner mit .md-Dateien. Dateizugriff, Pfadpruefung und Link-Index (nur Hauptprozess).
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const L = require('./linkutil');

const hiddenRel = (rel) => rel.split('/').some((s) => s.startsWith('.'));

class Vault {
  constructor(root) {
    this.root = fs.realpathSync(path.resolve(root));
    this.name = path.basename(this.root);
    this.notes = new Map(); // rel -> { text, links, tags, aliases }
    this.files = new Set(); // sonstige Dateien (Bilder ...)
    this.dirs = new Set();
    this.resolver = new L.Resolver();
    this.written = new Map(); // rel -> zuletzt selbst geschriebener Text (externe Aenderung erkennen)
    this.watcher = null;
  }

  // ── Pfadpruefung: alles muss im Vault bleiben, keine versteckten Ordner (.obsidian, .trash ...)
  abs(rel, { allowRoot = false } = {}) {
    if (typeof rel !== 'string') throw new Error('Ungültiger Pfad');
    rel = rel.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!rel && !allowRoot) throw new Error('Ungültiger Pfad');
    const segs = rel ? rel.split('/') : [];
    if (segs.some((s) => !s || s === '.' || s === '..' || s.startsWith('.') || s.includes('\0'))) throw new Error('Ungültiger Pfad: ' + rel);
    const p = path.resolve(this.root, ...segs);
    if (p !== this.root && !p.startsWith(this.root + path.sep)) throw new Error('Pfad außerhalb des Vaults');
    // Symlinks duerfen nicht aus dem Vault herausfuehren
    let probe = p;
    while (probe.length > this.root.length && !fs.existsSync(probe)) probe = path.dirname(probe);
    const real = fs.realpathSync(probe);
    if (real !== this.root && !real.startsWith(this.root + path.sep)) throw new Error('Pfad außerhalb des Vaults');
    return p;
  }
  rel(abs) { return path.relative(this.root, abs).split(path.sep).join('/'); }

  // ── Einlesen
  async scan() {
    this.notes.clear(); this.files.clear(); this.dirs.clear();
    this.resolver = new L.Resolver();
    await this.walk(this.root, 0);
  }
  async walk(dirAbs, depth) {
    let ents;
    try { ents = await fsp.readdir(dirAbs, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const a = path.join(dirAbs, e.name);
      const r = this.rel(a);
      if (e.isDirectory()) { this.dirs.add(r); if (depth < 40) await this.walk(a, depth + 1); } else if (e.isFile()) await this.indexFile(r);
    }
  }
  async indexFile(rel) {
    if (hiddenRel(rel)) return;
    if (L.MD_EXT.test(rel)) {
      let text;
      try { text = await fsp.readFile(path.join(this.root, rel), 'utf8'); } catch { this.drop(rel); return; }
      this.setNote(rel, text);
    } else { this.files.add(rel); this.resolver.addFile(rel); }
  }
  setNote(rel, text) {
    const fm = L.parseFrontmatter(text);
    this.notes.set(rel, { text, links: L.parseLinks(text), tags: L.parseTags(text), aliases: fm.aliases });
    this.resolver.addNote(rel);
  }
  drop(rel) {
    const pre = rel + '/';
    for (const r of [...this.notes.keys()]) if (r === rel || r.startsWith(pre)) { this.notes.delete(r); this.resolver.removeNote(r); }
    for (const r of [...this.files]) if (r === rel || r.startsWith(pre)) { this.files.delete(r); this.resolver.removeFile(r); }
    for (const r of [...this.dirs]) if (r === rel || r.startsWith(pre)) this.dirs.delete(r);
  }

  // ── Abfragen
  snapshot() {
    const tags = {};
    for (const n of this.notes.values()) for (const t of n.tags) tags[t] = (tags[t] || 0) + 1;
    return {
      root: this.root, name: this.name,
      dirs: [...this.dirs],
      notes: [...this.notes].map(([rel, n]) => ({ rel, aliases: n.aliases })),
      files: [...this.files],
      tags,
    };
  }
  resolveLink(l, fromRel) {
    // Einbettungen/Dateien mit Endung (Bilder, PDFs ...) zuerst als Datei, sonst als Notiz ("v1.2" bleibt eine Notiz)
    if (l.md || l.embed || /\.[a-z0-9]{1,6}$/i.test(l.target)) return this.resolver.resolveFile(l.target, fromRel) || this.resolver.resolveNote(l.target, fromRel);
    return this.resolver.resolveNote(l.target, fromRel);
  }
  isAttachmentTarget(l) { return L.IMG_EXT.test(l.target) || (/\.[a-z0-9]{1,6}$/i.test(l.target) && !L.MD_EXT.test(l.target) && l.md); }

  graph() {
    const nodes = [];
    const links = [];
    const ghosts = new Map();
    const seen = new Set();
    for (const [rel, n] of this.notes) nodes.push({ id: rel, name: L.noteName(rel), tags: n.tags });
    for (const [rel, n] of this.notes) {
      for (const l of n.links) {
        const to = this.resolveLink(l, rel);
        let id;
        if (to) { if (!this.notes.has(to)) continue; id = to; } else {
          if (!l.target || this.isAttachmentTarget(l)) continue;
          id = 'ghost:' + l.target.toLowerCase();
          if (!ghosts.has(id)) ghosts.set(id, { id, name: l.target, ghost: true });
        }
        if (id === rel) continue;
        const key = rel + '\0' + id;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ source: rel, target: id, ghost: !to });
      }
    }
    return { nodes: nodes.concat([...ghosts.values()]), links };
  }

  links(rel) {
    const backlinks = [];
    for (const [from, n] of this.notes) {
      if (from === rel) continue;
      let lines = null;
      for (const l of n.links) {
        if (this.resolveLink(l, from) !== rel) continue;
        lines = lines || n.text.split('\n');
        backlinks.push({ from, line: l.line, snippet: (lines[l.line] || '').trim().slice(0, 220) });
      }
    }
    const note = this.notes.get(rel);
    const outgoing = [];
    const seen = new Set();
    if (note) {
      for (const l of note.links) {
        const to = this.resolveLink(l, rel);
        const key = to || l.target.toLowerCase();
        if (seen.has(key) || (!to && !l.target)) continue;
        seen.add(key);
        outgoing.push({ target: l.target, heading: l.heading, embed: l.embed, resolved: to, attachment: !!to && !this.notes.has(to) });
      }
    }
    return { backlinks, outgoing, tags: note ? note.tags : [] };
  }

  search(q, limit = 100) {
    q = String(q || '').trim();
    if (!q) return [];
    const out = [];
    const tagQ = /^#[^\s#]+$/.test(q) ? q.slice(1).toLowerCase() : null;
    const needle = q.toLowerCase();
    for (const [rel, n] of this.notes) {
      if (tagQ && !n.tags.some((t) => { t = t.toLowerCase(); return t === tagQ || t.startsWith(tagQ + '/'); })) continue;
      const lines = n.text.split('\n');
      const hits = [];
      let count = 0;
      for (let i = 0; i < lines.length; i++) {
        const low = lines[i].toLowerCase();
        const at = low.indexOf(needle);
        if (at < 0) continue;
        count++;
        if (hits.length < 3) {
          const s = Math.max(0, at - 50);
          hits.push({ line: i, text: (s > 0 ? '…' : '') + lines[i].slice(s, at + needle.length + 90), start: at - s + (s > 0 ? 1 : 0), len: needle.length });
        }
      }
      const nameHit = !tagQ && L.noteName(rel).toLowerCase().includes(needle);
      if (!count && !nameHit && !tagQ) continue;
      out.push({ rel, count, nameHit, hits });
    }
    out.sort((a, b) => (b.nameHit - a.nameHit) || (b.count - a.count) || L.cmp(a.rel, b.rel));
    return out.slice(0, limit);
  }

  // ── Dateioperationen
  noteRel(rel) {
    this.abs(rel);
    if (!L.MD_EXT.test(rel)) throw new Error('Nur .md-Dateien');
    return rel.replace(/\\/g, '/').replace(/^\/+/, '');
  }
  async read(rel) { rel = this.noteRel(rel); return fsp.readFile(this.abs(rel), 'utf8'); }

  // Atomar schreiben: temporaere Datei (Punkt-Datei, vom Watcher ignoriert) + rename
  async write(rel, text) {
    rel = this.noteRel(rel);
    if (typeof text !== 'string') throw new Error('Kein Text');
    const p = this.abs(rel);
    const tmp = path.join(path.dirname(p), `.${path.basename(p)}.${process.pid}.${Date.now()}.tmp`);
    this.written.set(rel, text);
    try {
      await fsp.writeFile(tmp, text, 'utf8');
      await fsp.rename(tmp, p);
    } catch (e) { fsp.unlink(tmp).catch(() => {}); throw e; }
    this.setNote(rel, text);
    return rel;
  }

  uniqueRel(dirRel, base, ext) {
    for (let i = 0; i < 1000; i++) {
      const name = i ? `${base} ${i}${ext}` : `${base}${ext}`;
      const rel = dirRel ? `${dirRel}/${name}` : name;
      if (!fs.existsSync(this.abs(rel))) return rel;
    }
    throw new Error('Kein freier Name');
  }
  async createNote(dirRel, name, text = '') {
    dirRel = dirRel || '';
    if (dirRel) this.abs(dirRel);
    name = String(name || 'Unbenannt').trim().replace(/\.md$/i, '');
    if (!L.validName(name)) throw new Error('Ungültiger Name: ' + name);
    const rel = this.uniqueRel(dirRel, name, '.md');
    await fsp.mkdir(path.dirname(this.abs(rel)), { recursive: true });
    await fsp.writeFile(this.abs(rel), text, { flag: 'wx' });
    this.setNote(rel, text);
    this.addDirs(rel);
    return rel;
  }
  // fuer nicht aufgeloeste Links: "Ordner/Name" -> Ordner/Name.md (existiert sie schon, wird sie benutzt)
  async createAt(target) {
    const t = String(target || '').trim().replace(/\\/g, '/').replace(/\.md$/i, '').replace(/^\/+/, '');
    const segs = t.split('/');
    if (!t || !segs.every(L.validName)) throw new Error('Ungültiger Name: ' + target);
    const existing = this.resolver.resolveNote(t);
    if (existing) return existing;
    const name = segs.pop();
    return this.createNote(segs.join('/'), name, '');
  }
  async createFolder(dirRel, name) {
    dirRel = dirRel || '';
    name = String(name || '').trim();
    if (!L.validName(name)) throw new Error('Ungültiger Name: ' + name);
    const rel = this.uniqueRel(dirRel, name, '');
    await fsp.mkdir(this.abs(rel), { recursive: true });
    this.dirs.add(rel);
    this.addDirs(rel + '/x');
    return rel;
  }
  addDirs(rel) { const segs = rel.split('/'); for (let i = 1; i < segs.length; i++) this.dirs.add(segs.slice(0, i).join('/')); }

  async rename(rel, newName) {
    const src = this.abs(rel);
    const st = await fsp.stat(src);
    newName = String(newName || '').trim();
    if (st.isFile() && L.MD_EXT.test(rel) && !L.MD_EXT.test(newName)) newName += '.md';
    if (!L.validName(newName.replace(/\.md$/i, ''))) throw new Error('Ungültiger Name: ' + newName);
    const dir = L.dirOf(rel);
    const dest = dir ? `${dir}/${newName}` : newName;
    if (dest === rel) return rel;
    const destAbs = this.abs(dest);
    if (fs.existsSync(destAbs) && dest.toLowerCase() !== rel.toLowerCase()) throw new Error('Existiert bereits: ' + newName);
    await fsp.rename(src, destAbs);
    const text = this.notes.get(rel)?.text;
    this.drop(rel);
    if (st.isDirectory()) { this.dirs.add(dest); await this.walk(destAbs, 0); } else if (text != null && L.MD_EXT.test(dest)) this.setNote(dest, text); else await this.indexFile(dest);
    return dest;
  }

  // Loeschen = in den .trash-Ordner des Vaults verschieben (wie Obsidian)
  async remove(rel) {
    const src = this.abs(rel);
    const trash = path.join(this.root, '.trash');
    await fsp.mkdir(trash, { recursive: true });
    const base = path.basename(src);
    const ext = path.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    let dest = path.join(trash, base);
    for (let i = 1; fs.existsSync(dest); i++) dest = path.join(trash, `${stem} ${i}${ext}`);
    await fsp.rename(src, dest);
    this.drop(rel);
    return path.relative(this.root, dest).split(path.sep).join('/');
  }

  // ── Dateiueberwachung (externe Aenderungen)
  async watch(onEvent) {
    const chokidar = require('chokidar');
    const root = this.root;
    this.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      ignored: (p) => { const r = path.relative(root, p); return !!r && r.split(path.sep).some((s) => s.startsWith('.')); },
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    });
    this.watcher.on('all', async (type, abs) => {
      const rel = this.rel(abs);
      if (!rel || rel.startsWith('..') || hiddenRel(rel)) return;
      let external = true;
      if (type === 'add' || type === 'change') {
        const before = this.notes.get(rel)?.text;
        await this.indexFile(rel);
        const now = this.notes.get(rel)?.text;
        if (now != null && (now === this.written.get(rel) || now === before)) external = false;
        this.addDirs(rel);
      } else if (type === 'addDir') { if (this.dirs.has(rel)) external = false; this.dirs.add(rel); this.addDirs(rel); await this.walk(abs, 0); } else if (type === 'unlink' || type === 'unlinkDir') {
        if (!this.notes.has(rel) && !this.files.has(rel) && !this.dirs.has(rel)) external = false;
        this.drop(rel);
      }
      onEvent({ type, rel, external });
    });
    await new Promise((r) => this.watcher.on('ready', r));
  }
  async close() { if (this.watcher) await this.watcher.close().catch(() => {}); this.watcher = null; }
}

module.exports = { Vault, hiddenRel };
