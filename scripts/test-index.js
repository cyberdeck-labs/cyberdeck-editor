// Schnelltest fuer Link-Logik und Vault-Index ohne Electron: node scripts/test-index.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../src/linkutil');
const { Vault } = require('../src/vault');

let n = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('PASS', name); });

(async () => {
  await ok('parseLinks: Alias, Ueberschrift, Einbettung, Code ignoriert', () => {
    const l = L.parseLinks('A [[Note|Alias]] [[Other#Head]] ![[img.png]]\n`[[nope]]`\n```\n[[nope2]]\n```\n[md](sub/x.md) [ext](https://e.com)');
    assert.deepStrictEqual(l.map((x) => [x.target, x.heading, x.alias, x.embed, x.md]), [
      ['Note', null, 'Alias', false, false], ['Other', 'Head', null, false, false], ['img.png', null, null, true, false], ['sub/x', null, 'md', false, true]].map((a, i) => (i === 3 ? ['sub/x.md', null, 'md', false, true] : a)));
  });
  await ok('parseTags: Text + Frontmatter, keine Zahlen/Ueberschriften', () => {
    const t = L.parseTags('---\ntags: [a, b]\n---\n# Titel\n#c und #123 und x#d #e/f\n`#code`');
    assert.deepStrictEqual(t.sort(), ['a', 'b', 'c', 'e/f']);
  });
  await ok('Resolver: Gross/Klein, Ordner, Mehrdeutigkeit', () => {
    const r = new L.Resolver(['A/Note.md', 'B/Note.md', 'Top.md', 'B/Deep/Top.md'], ['img/x.png']);
    assert.strictEqual(r.resolveNote('top'), 'Top.md');
    assert.strictEqual(r.resolveNote('note', 'B/y.md'), 'B/Note.md');
    assert.strictEqual(r.resolveNote('A/Note'), 'A/Note.md');
    assert.strictEqual(r.resolveFile('X.PNG'), 'img/x.png');
    assert.strictEqual(r.resolveNote('fehlt'), null);
  });
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'cde-idx-'));
  try {
    fs.mkdirSync(path.join(dir, 'Sub'));
    fs.mkdirSync(path.join(dir, '.obsidian'));
    fs.writeFileSync(path.join(dir, '.obsidian', 'x.md'), '[[A]]');
    fs.writeFileSync(path.join(dir, 'A.md'), '# A\n[[b]] [[Ghost]] #tag1');
    fs.writeFileSync(path.join(dir, 'Sub', 'B.md'), 'Link zurueck auf [[A|Alpha]]');
    const v = new Vault(dir);
    await v.scan();
    await ok('Vault: .obsidian ignoriert, Notizen + Tags', () => {
      const s = v.snapshot();
      assert.deepStrictEqual(s.notes.map((x) => x.rel).sort(), ['A.md', 'Sub/B.md']);
      assert.deepStrictEqual(s.tags, { tag1: 1 });
    });
    await ok('Vault: Backlinks, ausgehend, Graph mit Geist', () => {
      const l = v.links('A.md');
      assert.strictEqual(l.backlinks[0].from, 'Sub/B.md');
      assert.ok(l.backlinks[0].snippet.includes('[[A|Alpha]]'));
      assert.deepStrictEqual(l.outgoing.map((o) => o.resolved), ['Sub/B.md', null]);
      const g = v.graph();
      assert.strictEqual(g.nodes.filter((x) => x.ghost).length, 1);
      assert.strictEqual(g.links.length, 3);
    });
    await ok('Vault: atomares Schreiben, inkrementeller Index', async () => {
      await v.write('Sub/B.md', 'jetzt [[Ghost]]');
      assert.strictEqual(fs.readFileSync(path.join(dir, 'Sub', 'B.md'), 'utf8'), 'jetzt [[Ghost]]');
      assert.strictEqual(fs.readdirSync(path.join(dir, 'Sub')).filter((f) => f.endsWith('.tmp')).length, 0);
      assert.strictEqual(v.links('A.md').backlinks.length, 0);
    });
    await ok('Vault: Anlegen aus Link, Umbenennen, Papierkorb', async () => {
      const rel = await v.createAt('Ghost');
      assert.strictEqual(rel, 'Ghost.md');
      assert.strictEqual(v.graph().nodes.filter((x) => x.ghost).length, 0);
      const r2 = await v.rename('Ghost.md', 'Geist');
      assert.strictEqual(r2, 'Geist.md');
      assert.ok(fs.existsSync(path.join(dir, 'Geist.md')));
      const t = await v.remove('Geist.md');
      assert.strictEqual(t, '.trash/Geist.md');
      assert.ok(!v.notes.has('Geist.md'));
    });
    await ok('Vault: Pfade ausserhalb werden abgelehnt', async () => {
      for (const p of ['../x.md', '/etc/passwd', '.obsidian/x.md', 'a/../../x.md', 'Sub/../../x.md']) await assert.rejects(() => v.read(p));
      await assert.rejects(() => v.write('../evil.md', 'x'));
      await assert.rejects(() => v.createNote('', '../evil'));
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log(`${n} Tests bestanden`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
