// Erzeugt einen Test-Vault: Kopie eines vorhandenen Vaults (optional) + ~30 generierte Notizen.
// Aufruf: node scripts/make-test-vault.mjs <ziel> [quell-vault]
import fs from 'node:fs';
import path from 'node:path';

const [dest, src] = process.argv.slice(2);
if (!dest) { console.error('Ziel fehlt'); process.exit(1); }
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
if (src) fs.cpSync(src, dest, { recursive: true });

let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const w = (rel, text) => { const p = path.join(dest, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

const names = ['Netrunner', 'Firewall', 'ICE', 'Datenschatten', 'Neon-Basar', 'Chiba City', 'Matrix-Protokoll', 'Proxy-Kette', 'Synthwave', 'Cyberdeck',
  'Kernel-Panik', 'Glitch', 'Holo-Archiv', 'Schwarzmarkt', 'Drohnen-Netz', 'Kryptoschlüssel', 'Ghost Protocol', 'Megacorp', 'Implantat', 'Daemon',
  'Backdoor', 'Packet Sniffer', 'Root-Zugang', 'Neuronales Interface', 'Stadtnetz'];
const dirs = { Firewall: 'Netzwerk', ICE: 'Netzwerk', 'Proxy-Kette': 'Netzwerk', 'Packet Sniffer': 'Netzwerk', Stadtnetz: 'Netzwerk', Daemon: 'Netzwerk/Dienste', Backdoor: 'Netzwerk/Dienste',
  'Chiba City': 'Orte', 'Neon-Basar': 'Orte', Schwarzmarkt: 'Orte', Megacorp: 'Fraktionen' };
const aliases = { Firewall: ['Brandmauer'], ICE: ['Intrusion Countermeasures'], Netrunner: ['Runner', 'Decker'], Megacorp: ['Konzern'] };
const tagPool = ['netz', 'sicherheit', 'ort', 'tech', 'lore', 'projekt/aktiv', 'idee'];
const nwt = ['TCP', 'Active Directory', 'Virtualisierung'];

for (const n of names) {
  const others = names.filter((x) => x !== n);
  const links = new Set();
  const k = 1 + Math.floor(rnd() * 3);
  while (links.size < k) links.add(pick(others));
  const tags = new Set([pick(tagPool), pick(tagPool)]);
  const fm = aliases[n] ? `---\naliases: [${aliases[n].join(', ')}]\ntags: [${[...tags][0]}]\n---\n` : '';
  const body = [`# ${n}`, '', `${n} ist ein Knoten im Netz. Siehe ${[...links].map((l) => `[[${l}]]`).join(', ')}.`, '',
    `## Details`, '', `- Bezug zu [[Index]]`, rnd() < 0.3 ? `- Grundlagen: [[${pick(nwt)}]]` : `- Status: offen`, rnd() < 0.25 ? `- Geplant: [[Unbekannter Knoten ${Math.floor(rnd() * 3)}]]` : '',
    '', [...tags].map((t) => '#' + t).join(' '), ''].join('\n');
  w((dirs[n] ? dirs[n] + '/' : '') + n + '.md', fm + body);
}

w('Index.md', `# Index\n\nStartpunkt des Test-Vaults. #index\n\n${names.map((n) => `- [[${n}]]`).join('\n')}\n- [[Showcase]]\n- [[TCP|TCP aus dem NWT-Vault]]\n`);
fs.mkdirSync(path.join(dest, 'Anhänge'), { recursive: true });
const img = src && fs.existsSync(path.join(src, 'ad_einzeldomaene_tree_forest.png')) ? path.join(src, 'ad_einzeldomaene_tree_forest.png') : null;
if (img) fs.copyFileSync(img, path.join(dest, 'Anhänge', 'netzplan.png'));

w('Showcase.md', `---
tags: [demo, tech]
aliases: [Demo]
---
# Showcase

Eine Notiz mit allem: [[Firewall|Brandmauer]], [[Netrunner#Details]], [[netrunner]] (klein geschrieben), ein Link ins NWT: [[Active Directory]].
Fehlt noch: [[Quantenrouter]]. Markdown-Link: [ICE-Notiz](Netzwerk/ICE.md). Extern: https://example.com #demo #tech

## Tabelle

| Knoten | Typ | Status |
|---|---|:---:|
| [[Firewall]] | Netz | aktiv |
| [[Daemon]] | Dienst | **läuft** |
| Chiba City | Ort | ~~offline~~ |

## Mermaid

\`\`\`mermaid
graph LR
  A[Netrunner] -->|jack in| B(Cyberdeck)
  B --> C{ICE?}
  C -->|ja| D[Firewall]
  C -->|nein| E[Datenschatten]
\`\`\`

## Code

\`\`\`javascript
// Verbindung aufbauen
async function jackIn(deck, host = 'chiba.city') {
  const ice = await deck.scan(host);
  if (ice.level > 3) throw new Error('Zu viel ICE');
  return deck.connect({ host, port: 2077, stealth: true });
}
\`\`\`

\`\`\`python
def decrypt(key: bytes, data: bytes) -> str:
    return bytes(a ^ b for a, b in zip(data, key * 64)).decode("utf-8")
\`\`\`

## Aufgaben

- [x] Deck kalibrieren
- [ ] ICE umgehen
- [ ] Daten sichern

> Das Netz vergisst nichts. – #lore

## Bild

![[netzplan.png|360]]

Relatives Bild: ![Netzplan](Anhänge/netzplan.png)
`);
w('Autosave Test.md', '# Autosave Test\n\nHier wird geschrieben.\n');
w('Umbenennen Test.md', '# Umbenennen Test\n\nLink auf [[Index]].\n');
w('Extern.md', '# Extern\n\nWird von außen geändert.\n');
w('Löschen Test.md', '# Löschen Test\n');
w('Netzwerk/Grundlagen.md', '# Grundlagen\n\nUnterordner-Notiz mit [[Firewall]], [[ICE]] und [[TCP]].\n\n```bash\nnmap -sV 10.0.0.0/24 # scan\n```\n#netz\n');
w('.obsidian/app.json', '{}');
w('.trash/alt.md', '# alt\n[[Index]]\n');
let count = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('.')) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.md')) count++; } };
walk(dest);
console.log(`Test-Vault: ${dest} (${count} Notizen)`);
