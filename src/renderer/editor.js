// CodeMirror-6-Editor im Cyberpunk-Look: Markdown, [[Wikilinks]] (Farbe, Strg+Klick, Autovervollstaendigung), #tags
import { EditorView, keymap, drawSelection, highlightActiveLine, ViewPlugin, Decoration, dropCursor, highlightSpecialChars, placeholder } from '@codemirror/view';
import { EditorState, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { splitLinkInner } from '../linkutil.js';

export const refreshLinks = StateEffect.define();

const cyberHighlight = HighlightStyle.define([
  { tag: t.heading1, color: '#3cf0ff', fontSize: '1.55em', fontWeight: '700', textShadow: '0 0 10px rgba(60,240,255,.55)' },
  { tag: t.heading2, color: '#3cf0ff', fontSize: '1.32em', fontWeight: '700', textShadow: '0 0 8px rgba(60,240,255,.4)' },
  { tag: t.heading3, color: '#7ff6ff', fontSize: '1.15em', fontWeight: '700' },
  { tag: [t.heading4, t.heading5, t.heading6], color: '#9ff8ff', fontWeight: '700' },
  { tag: t.strong, color: '#ffffff', fontWeight: '700' },
  { tag: t.emphasis, color: '#ffb3ba', fontStyle: 'italic' },
  { tag: t.strikethrough, color: '#7a6a78', textDecoration: 'line-through' },
  { tag: t.link, color: '#3cf0ff' },
  { tag: t.url, color: '#8f7d8c', textDecoration: 'underline' },
  { tag: t.monospace, color: '#f7e733' },
  { tag: t.quote, color: '#d2b3cc', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.contentSeparator], color: '#ff2d3d' },
  { tag: t.meta, color: '#a0909e' },
  { tag: t.comment, color: '#7a6a78' },
  { tag: [t.keyword, t.operatorKeyword], color: '#ff2d3d' },
  { tag: [t.string, t.special(t.string)], color: '#f7e733' },
  { tag: [t.number, t.bool, t.atom], color: '#ff9e3d' },
  { tag: [t.function(t.variableName), t.propertyName], color: '#3cf0ff' },
  { tag: t.typeName, color: '#c89bff' },
]);

const cyberTheme = EditorView.theme({
  '&': { color: '#e9dde7', backgroundColor: 'transparent', height: '100%', fontSize: '15px' },
  '.cm-scroller': { fontFamily: 'STM, monospace', lineHeight: '1.65' },
  '.cm-content': { caretColor: '#ff2d3d', padding: '28px 0 40vh', maxWidth: '920px', margin: '0 auto' },
  '.cm-line': { padding: '0 36px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#ff2d3d', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'rgba(60,240,255,.2) !important' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,45,61,.05)', boxShadow: 'inset 2px 0 0 rgba(255,45,61,.6)' },
  '.cm-selectionMatch': { backgroundColor: 'rgba(247,231,51,.12)' },
  '.cm-matchingBracket': { color: '#f7e733 !important', outline: '1px solid rgba(247,231,51,.4)' },
  '.cm-wikilink': { color: '#3cf0ff', textShadow: '0 0 6px rgba(60,240,255,.45)', cursor: 'pointer' },
  '.cm-wikilink.cm-unresolved': { color: '#ff6f7b', textShadow: 'none', textDecoration: 'underline dashed rgba(255,45,61,.6)' },
  '.cm-tag': { color: '#f7e733', backgroundColor: 'rgba(247,231,51,.07)' },
  '.cm-placeholder': { color: '#5e4e5c' },
  '.cm-tooltip': { background: '#12060f', border: '1px solid #3cf0ff', color: '#e9dde7', boxShadow: '0 0 18px rgba(60,240,255,.25)' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'Rajdhani, sans-serif', fontSize: '15px', maxHeight: '18em' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '2px 10px !important' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'linear-gradient(90deg, rgba(255,45,61,.45), rgba(255,45,61,.08))', color: '#fff' },
  '.cm-completionDetail': { color: '#7a6a78', marginLeft: '10px', fontStyle: 'normal' },
  '.cm-panels': { background: '#12060f', color: '#e9dde7', borderTop: '1px solid #3a1020' },
  '.cm-panels input, .cm-panels button': { fontFamily: 'STM, monospace' },
  '.cm-searchMatch': { backgroundColor: 'rgba(247,231,51,.25)' },
}, { dark: true });

const LINK_OR_TAG = /!?\[\[([^[\]\n]+?)\]\]|(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gmu;

function linkDecorations(resolve) {
  return ViewPlugin.fromClass(class {
    constructor(v) { this.decorations = this.build(v); }
    update(u) {
      if (u.docChanged || u.viewportChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLinks)))) this.decorations = this.build(u.view);
    }
    build(v) {
      const b = new RangeSetBuilder();
      for (const { from, to } of v.visibleRanges) {
        const text = v.state.doc.sliceString(from, to);
        LINK_OR_TAG.lastIndex = 0;
        let m;
        while ((m = LINK_OR_TAG.exec(text))) {
          if (m[1] != null) {
            const ok = resolve(splitLinkInner(m[1]).target);
            b.add(from + m.index, from + m.index + m[0].length, Decoration.mark({ class: ok ? 'cm-wikilink' : 'cm-wikilink cm-unresolved' }));
          } else {
            const s = from + m.index + m[2].length;
            b.add(s, s + 1 + m[3].length, Decoration.mark({ class: 'cm-tag' }));
          }
        }
      }
      return b.finish();
    }
  }, { decorations: (p) => p.decorations });
}

// Wikilink unter einer Dokumentposition finden
export function linkAt(state, pos) {
  const line = state.doc.lineAt(pos);
  const re = /!?\[\[([^[\]\n]+?)\]\]/g;
  let m;
  while ((m = re.exec(line.text))) {
    const s = line.from + m.index;
    if (pos >= s && pos <= s + m[0].length) return splitLinkInner(m[1]);
  }
  return null;
}

function wikiCompletion(getOptions) {
  return (ctx) => {
    const m = ctx.matchBefore(/\[\[[^[\]|#\n]*/);
    if (!m) return null;
    const from = m.from + 2;
    return {
      from,
      validFor: /^[^[\]|#\n]*$/,
      options: getOptions().map((o) => ({
        label: o.label,
        detail: o.detail,
        type: o.alias ? 'variable' : 'text',
        boost: o.alias ? -1 : 0,
        apply: (view, _c, f, to) => {
          const closed = view.state.sliceDoc(to, to + 2) === ']]';
          const ins = o.insert + (closed ? '' : ']]');
          view.dispatch({ changes: { from: f, to, insert: ins }, selection: { anchor: f + o.insert.length + 2 }, userEvent: 'input.complete' });
        },
      })),
    };
  };
}

export function createEditor({ parent, doc, onChange, onLink, resolve, getOptions, onSave }) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        highlightSpecialChars(), history(), drawSelection(), dropCursor(), indentOnInput(), bracketMatching(), closeBrackets(),
        highlightActiveLine(), highlightSelectionMatches(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(cyberHighlight),
        cyberTheme,
        placeholder('Leere Notiz … [[ für Links, # für Tags'),
        linkDecorations(resolve),
        autocompletion({ override: [wikiCompletion(getOptions)], activateOnTyping: true, icons: false }),
        keymap.of([
          { key: 'Mod-s', run: () => { onSave(); return true; } },
          ...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap,
        ]),
        EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u); }),
        EditorView.domEventHandlers({
          mousedown(e, v) {
            if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false;
            const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
            if (pos == null) return false;
            const l = linkAt(v.state, pos);
            if (!l) return false;
            e.preventDefault();
            onLink(l, e);
            return true;
          },
        }),
      ],
    }),
  });
  return view;
}

export function setDoc(view, text) {
  const sel = view.state.selection.main;
  const anchor = Math.min(sel.anchor, text.length);
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor }, userEvent: 'external' });
}

export function gotoLine(view, line) {
  const l = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, line + 1)));
  view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
  view.focus();
}
