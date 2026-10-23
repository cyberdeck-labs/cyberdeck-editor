// Gemeinsame Link-/Tag-Logik fuer Hauptprozess (Index) und Oberflaeche (Vorschau, Editor).
// Keine Node-Abhaengigkeiten: wird von esbuild auch in den Renderer gebuendelt.
'use strict';

const MD_EXT = /\.md$/i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

const noteName = (rel) => rel.split('/').pop().replace(MD_EXT, '');
const dirOf = (rel) => { const i = rel.lastIndexOf('/'); return i < 0 ? '' : rel.slice(0, i); };
const baseOf = (rel) => rel.split('/').pop();

// Code-Bloecke und Inline-Code durch Leerzeichen ersetzen (Offsets und Zeilen bleiben gleich),
// damit [[Links]] und #tags darin nicht gezaehlt werden.
function stripCode(text) {
  const lines = text.split('\n');
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(l);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !l.slice(m[0].length).trim()) fence = null;
      lines[i] = ' '.repeat(l.length);
    } else if (m) {
      fence = m[1];
      lines[i] = ' '.repeat(l.length);
    } else if (l.includes('`')) {
      lines[i] = l.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (s) => ' '.repeat(s.length));
    }
  }
  return lines.join('\n');
}

// YAML-Frontmatter am Dateianfang: Ende-Offset und Tags (tags: [a, b] | tags: a, b | Liste)
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text);
  if (!m) return { end: 0, tags: [], aliases: [] };
  const body = m[1].split(/\r?\n/);
  const list = (key) => {
    const out = [];
    for (let i = 0; i < body.length; i++) {
      const km = new RegExp(`^${key}\\s*:\\s*(.*)$`, 'i').exec(body[i]);
      if (!km) continue;
      const v = km[1].trim();
      if (v) v.replace(/^\[|\]$/g, '').split(',').forEach((x) => { x = x.trim().replace(/^["']|["']$/g, ''); if (x) out.push(x); });
      else for (let j = i + 1; j < body.length && /^\s*-\s+/.test(body[j]); j++) out.push(body[j].replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, ''));
    }
    return out;
  };
  return { end: m[0].length, tags: list('tags?').map((t) => t.replace(/^#/, '')).filter(Boolean), aliases: list('alias(?:es)?') };
}

// Inhalt eines [[...]] zerlegen: Ziel, Ueberschrift, Alias
function splitLinkInner(inner) {
  let alias = null;
  const bar = inner.indexOf('|');
  if (bar >= 0) { alias = inner.slice(bar + 1).trim(); inner = inner.slice(0, bar); }
  let heading = null;
  const hash = inner.indexOf('#');
  if (hash >= 0) { heading = inner.slice(hash + 1).replace(/^\^/, '').trim(); inner = inner.slice(0, hash); }
  return { target: inner.trim(), heading: heading || null, alias: alias || null };
}

const WIKI_RE = /(!?)\[\[([^\[\]\n]+?)\]\]/g;
const MDLINK_RE = /(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g;

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; } return lo; };
}

// Alle Links einer Notiz (Wikilinks + relative Markdown-Links), ohne Code-Bloecke
function parseLinks(text) {
  const clean = stripCode(text);
  const lineOf = lineIndex(text);
  const out = [];
  let m;
  WIKI_RE.lastIndex = 0;
  while ((m = WIKI_RE.exec(clean))) {
    const p = splitLinkInner(m[2]);
    out.push({ ...p, embed: !!m[1], start: m.index, end: m.index + m[0].length, line: lineOf(m.index), md: false });
  }
  MDLINK_RE.lastIndex = 0;
  while ((m = MDLINK_RE.exec(clean))) {
    let url = m[3].trim().replace(/^<|>$/g, '').split(/\s+"/)[0];
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('/')) continue;
    let heading = null;
    const h = url.indexOf('#');
    if (h >= 0) { heading = url.slice(h + 1); url = url.slice(0, h); }
    try { url = decodeURIComponent(url); } catch { /* so lassen */ }
    if (!url) continue;
    out.push({ target: url, heading, alias: m[2] || null, embed: !!m[1], start: m.index, end: m.index + m[0].length, line: lineOf(m.index), md: true });
  }
  return out.sort((a, b) => a.start - b.start);
}

// #tags (mind. ein Nicht-Ziffer-Zeichen, wie in Obsidian) + Tags aus dem Frontmatter
const TAG_RE = /(^|[\s(,;])#([\p{L}\p{N}_\-/]+)/gu;
function parseTags(text) {
  const fm = parseFrontmatter(text);
  const clean = stripCode(text.slice(fm.end));
  const tags = new Set(fm.tags);
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(clean))) {
    const t = m[2].replace(/\/+$/, '');
    if (t && /[^\d]/.test(t) && !t.startsWith('/')) tags.add(t);
  }
  return [...tags];
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator('de', { numeric: true, sensitivity: 'base' }) : null;
const cmp = (a, b) => (collator ? collator.compare(a, b) : a.localeCompare(b));

// Aufloesung wie in Obsidian: per Dateiname irgendwo im Vault, Gross/Klein egal.
// Bei Mehrdeutigkeit: gleicher Ordner wie die Quelle, dann kuerzester Pfad.
class Resolver {
  constructor(noteRels = [], fileRels = []) {
    this.notes = new Map(); // name(lower) -> [rel]
    this.files = new Map(); // dateiname mit Endung (lower) -> [rel]
    this.noteSet = new Set();
    this.fileSet = new Set();
    for (const r of noteRels) this.addNote(r);
    for (const r of fileRels) this.addFile(r);
  }
  addNote(rel) {
    if (this.noteSet.has(rel)) return;
    this.noteSet.add(rel);
    const k = noteName(rel).toLowerCase();
    if (!this.notes.has(k)) this.notes.set(k, []);
    this.notes.get(k).push(rel);
  }
  removeNote(rel) {
    if (!this.noteSet.delete(rel)) return;
    const k = noteName(rel).toLowerCase();
    const l = (this.notes.get(k) || []).filter((r) => r !== rel);
    if (l.length) this.notes.set(k, l); else this.notes.delete(k);
  }
  addFile(rel) {
    if (this.fileSet.has(rel)) return;
    this.fileSet.add(rel);
    const k = baseOf(rel).toLowerCase();
    if (!this.files.has(k)) this.files.set(k, []);
    this.files.get(k).push(rel);
  }
  removeFile(rel) {
    if (!this.fileSet.delete(rel)) return;
    const k = baseOf(rel).toLowerCase();
    const l = (this.files.get(k) || []).filter((r) => r !== rel);
    if (l.length) this.files.set(k, l); else this.files.delete(k);
  }
  static pick(cands, fromRel) {
    if (!cands || !cands.length) return null;
    if (cands.length === 1) return cands[0];
    const d = fromRel ? dirOf(fromRel) : null;
    const same = cands.filter((c) => dirOf(c) === d);
    if (same.length) return same[0];
    return [...cands].sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length || cmp(a, b))[0];
  }
  // Pfad relativ zur Quellnotiz normalisieren (fuer Markdown-Links ./x.md, ../y.md)
  static join(dir, p) {
    const parts = (dir ? dir.split('/') : []).concat(p.split('/'));
    const out = [];
    for (const s of parts) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); }
    return out.join('/');
  }
  resolveNote(target, fromRel = null) {
    let t = String(target || '').trim().replace(/\\/g, '/');
    if (!t) return fromRel; // [[#Ueberschrift]] = diese Notiz
    t = t.replace(MD_EXT, '');
    if (t.includes('/')) {
      const low = t.replace(/^\/+/, '').toLowerCase();
      const rel1 = fromRel ? Resolver.join(dirOf(fromRel), t).toLowerCase() : null;
      const hits = [];
      for (const r of this.noteSet) {
        const x = r.replace(MD_EXT, '').toLowerCase();
        if (x === rel1) return r;
        if (x === low || x.endsWith('/' + low)) hits.push(r);
      }
      return Resolver.pick(hits, fromRel);
    }
    return Resolver.pick(this.notes.get(t.toLowerCase()), fromRel);
  }
  resolveFile(target, fromRel = null) {
    const t = String(target || '').trim().replace(/\\/g, '/');
    if (!t) return null;
    if (MD_EXT.test(t) || !/\.[a-z0-9]{1,6}$/i.test(t)) return this.resolveNote(t, fromRel);
    if (t.includes('/')) {
      const low = t.replace(/^\/+/, '').toLowerCase();
      const rel1 = fromRel ? Resolver.join(dirOf(fromRel), t).toLowerCase() : null;
      const hits = [];
      for (const r of this.fileSet) {
        const x = r.toLowerCase();
        if (x === rel1) return r;
        if (x === low || x.endsWith('/' + low)) hits.push(r);
      }
      return Resolver.pick(hits, fromRel);
    }
    return Resolver.pick(this.files.get(t.toLowerCase()), fromRel);
  }
}

// gueltiger Datei-/Ordnername (keine Pfadtrenner, keine Zeichen, die Links oder Windows stoeren)
function validName(name) {
  if (typeof name !== 'string') return false;
  const n = name.trim();
  return !!n && n.length <= 200 && !n.startsWith('.') && !/[\\/:*?"<>|#^[\]\x00-\x1f]/.test(n);
}

module.exports = { stripCode, parseFrontmatter, splitLinkInner, parseLinks, parseTags, Resolver, noteName, dirOf, baseOf, validName, cmp, IMG_EXT, MD_EXT };
