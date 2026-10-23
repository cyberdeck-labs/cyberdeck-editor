// Vorschau: markdown-it (+ Tabellen, Tasks, Wikilinks, Einbettungen), highlight.js offline, Mermaid offline, DOMPurify
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import { Resolver, dirOf, IMG_EXT, MD_EXT, noteName } from '../linkutil.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const vaultUrl = (rel) => 'cde://vault/' + rel.split('/').map(encodeURIComponent).join('/');
const isExternal = (u) => /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//');

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
  highlight(code, lang) {
    lang = (lang || '').trim().split(/\s+/)[0].toLowerCase();
    let html;
    if (lang && hljs.getLanguage(lang)) { try { html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch { /* unten */ } }
    if (!html) html = esc(code);
    return `<pre class="hljs"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${html}</code></pre>`;
  },
});

// ```mermaid -> Platzhalter, wird nach dem Einfuegen gerendert
const fence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
  const info = (tokens[idx].info || '').trim().toLowerCase();
  if (info === 'mermaid') return `<pre class="mermaid-src">${esc(tokens[idx].content)}</pre>`;
  return fence(tokens, idx, opts, env, self);
};

// [[Ziel#Ueberschrift|Alias]] und ![[Einbettung]]
md.inline.ruler.before('link', 'wikilink', (state, silent) => {
  const s = state.src;
  let p = state.pos;
  let embed = false;
  if (s.charCodeAt(p) === 0x21) { if (s.charCodeAt(p + 1) !== 0x5b || s.charCodeAt(p + 2) !== 0x5b) return false; embed = true; p++; } else if (s.charCodeAt(p) !== 0x5b || s.charCodeAt(p + 1) !== 0x5b) return false;
  const end = s.indexOf(']]', p + 2);
  if (end < 0) return false;
  const inner = s.slice(p + 2, end);
  if (!inner.trim() || /[[\]\n]/.test(inner)) return false;
  if (!silent) {
    const tok = state.push('wikilink', '', 0);
    const parts = splitInner(inner);
    tok.meta = { ...parts, embed };
  }
  state.pos = end + 2;
  return true;
});
function splitInner(inner) {
  let alias = null;
  const bar = inner.indexOf('|');
  if (bar >= 0) { alias = inner.slice(bar + 1).trim(); inner = inner.slice(0, bar); }
  let heading = null;
  const h = inner.indexOf('#');
  if (h >= 0) { heading = inner.slice(h + 1).replace(/^\^/, '').trim(); inner = inner.slice(0, h); }
  return { target: inner.trim(), heading, alias };
}
md.renderer.rules.wikilink = (tokens, idx, _o, env) => {
  const { target, heading, alias, embed } = tokens[idx].meta;
  const r = env.resolver;
  if (embed && (IMG_EXT.test(target))) {
    const f = r.resolveFile(target, env.rel);
    const w = alias && /^\d+(x\d+)?$/.test(alias) ? ` width="${alias.split('x')[0]}"` : '';
    return f ? `<img src="${vaultUrl(f)}" alt="${esc(alias && !w ? alias : target)}"${w}>` : `<span class="embed-missing">⚠ ${esc(target)}</span>`;
  }
  const to = r.resolveNote(target, env.rel) || (/\.[a-z0-9]{1,6}$/i.test(target) ? r.resolveFile(target, env.rel) : null);
  const label = alias || (target ? target + (heading ? ' › ' + heading : '') : heading || '');
  if (to && !MD_EXT.test(to)) return `<a class="attachment" href="${vaultUrl(to)}">${esc(label)}</a>`;
  const a = `<a href="#" class="wikilink${to ? '' : ' unresolved'}" data-wl="${esc(target)}"${heading ? ` data-h="${esc(heading)}"` : ''}>${esc(label)}</a>`;
  return embed ? `<div class="embed-note">⧉ ${a}</div>` : a;
};

// relative Bilder ueber cde://vault
md.renderer.rules.image = (tokens, idx, _o, env) => {
  const tok = tokens[idx];
  let src = tok.attrGet('src') || '';
  const alt = tok.children ? tok.children.map((c) => c.content).join('') : tok.content;
  if (!isExternal(src) && !src.startsWith('data:')) {
    let dec = src;
    try { dec = decodeURIComponent(src); } catch { /* so lassen */ }
    const f = env.resolver.resolveFile(dec, env.rel) || Resolver.join(dirOf(env.rel), dec);
    src = vaultUrl(f);
  }
  return `<img src="${esc(src)}" alt="${esc(alt)}">`;
};

// interne Markdown-Links [x](andere.md) wie Wikilinks behandeln
const linkOpen = md.renderer.rules.link_open || ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
  const tok = tokens[idx];
  const href = tok.attrGet('href') || '';
  if (!isExternal(href) && !href.startsWith('#')) {
    let [p, h] = href.split('#');
    try { p = decodeURIComponent(p); } catch { /* so lassen */ }
    const to = env.resolver.resolveFile(p, env.rel);
    if (to && !MD_EXT.test(to)) { tok.attrSet('href', vaultUrl(to)); tok.attrSet('class', 'attachment'); return linkOpen(tokens, idx, opts, env, self); }
    tok.attrSet('href', '#');
    tok.attrSet('class', 'wikilink' + (to ? '' : ' unresolved'));
    tok.attrSet('data-wl', to ? to.replace(MD_EXT, '') : p.replace(MD_EXT, ''));
    if (h) tok.attrSet('data-h', h);
  } else if (isExternal(href)) tok.attrSet('class', 'external');
  return linkOpen(tokens, idx, opts, env, self);
};

// - [ ] / - [x] Aufgaben
md.core.ruler.after('inline', 'tasks', (state) => {
  const t = state.tokens;
  for (let i = 2; i < t.length; i++) {
    if (t[i].type !== 'inline' || t[i - 1].type !== 'paragraph_open' || t[i - 2].type !== 'list_item_open') continue;
    const m = /^\[([ xX])\]\s+/.exec(t[i].content);
    const first = t[i].children && t[i].children[0];
    if (!m || !first || first.type !== 'text' || !first.content.startsWith(m[0].trimEnd())) continue;
    first.content = first.content.slice(m[0].trimEnd().length).replace(/^\s+/, '');
    const cb = new state.Token('html_inline', '', 0);
    cb.content = `<input type="checkbox" disabled${m[1] !== ' ' ? ' checked' : ''}> `;
    t[i].children.unshift(cb);
    t[i - 2].attrJoin('class', 'task');
  }
});

// #tags in normalem Text hervorheben
md.core.ruler.push('tags', (state) => {
  for (const blk of state.tokens) {
    if (blk.type !== 'inline' || !blk.children) continue;
    const out = [];
    let inLink = 0;
    for (const c of blk.children) {
      if (c.type === 'link_open') inLink++;
      if (c.type === 'link_close') inLink--;
      if (c.type !== 'text' || inLink || !c.content.includes('#')) { out.push(c); continue; }
      const re = /(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;
      let last = 0;
      let m;
      while ((m = re.exec(c.content))) {
        const s = m.index + m[1].length;
        if (s > last) { const tt = new state.Token('text', '', 0); tt.content = c.content.slice(last, s); out.push(tt); }
        const h = new state.Token('html_inline', '', 0);
        h.content = `<a href="#" class="tag" data-tag="${esc(m[2])}">#${esc(m[2])}</a>`;
        out.push(h);
        last = s + 1 + m[2].length;
      }
      if (last === 0) { out.push(c); continue; }
      if (last < c.content.length) { const tt = new state.Token('text', '', 0); tt.content = c.content.slice(last); out.push(tt); }
    }
    blk.children = out;
  }
});

const PURIFY = {
  ADD_ATTR: ['target', 'data-wl', 'data-h', 'data-tag', 'data-lang'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|cde):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed'],
};

export function renderMarkdown(text, env) {
  // YAML-Frontmatter als kleine Tabelle statt als Text
  let fm = '';
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text);
  if (m) { fm = `<pre class="frontmatter">${esc(m[1])}</pre>`; text = text.slice(m[0].length); }
  const html = fm + md.render(text, env);
  return DOMPurify.sanitize(html, PURIFY);
}

let mermaidP = null;
let mid = 0;
function getMermaid() {
  if (!mermaidP) {
    mermaidP = import('mermaid').then((m) => {
      const mm = m.default;
      mm.initialize({
        startOnLoad: false, securityLevel: 'strict', theme: 'base', fontFamily: 'Rajdhani, sans-serif',
        themeVariables: {
          darkMode: true, background: '#07020a', primaryColor: '#1a0812', primaryTextColor: '#e9dde7', primaryBorderColor: '#3cf0ff',
          lineColor: '#ff2d3d', secondaryColor: '#12060f', tertiaryColor: '#0d0410', textColor: '#e9dde7', mainBkg: '#1a0812',
          nodeBorder: '#3cf0ff', clusterBkg: '#0d0410', clusterBorder: '#ff2d3d', edgeLabelBackground: '#12060f', fontSize: '15px',
        },
      });
      return mm;
    });
  }
  return mermaidP;
}

export async function postProcess(el) {
  const blocks = [...el.querySelectorAll('pre.mermaid-src')];
  if (!blocks.length) return 0;
  const mm = await getMermaid();
  let ok = 0;
  for (const b of blocks) {
    try {
      const { svg } = await mm.render('mmd' + (++mid), b.textContent);
      const d = document.createElement('div');
      d.className = 'mermaid';
      d.innerHTML = svg;
      b.replaceWith(d);
      ok++;
    } catch (e) {
      b.classList.add('mermaid-error');
      b.title = String(e && e.message || e);
      document.getElementById('dmmd' + mid)?.remove();
    }
  }
  return ok;
}

export { noteName };
