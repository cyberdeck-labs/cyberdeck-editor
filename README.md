# Cyberdeck Editor

Markdown-Notizen im Cyberpunk-Stil – kompatibel mit Obsidian-Vaults (normale `.md`-Dateien, kein eigenes Format).

- Vault = beliebiger Ordner mit `.md`-Dateien, Änderungen von außen (z. B. Obsidian) werden live übernommen
- Dateibaum, Tabs, CodeMirror-Editor mit Markdown-Hervorhebung, automatisches Speichern
- Vorschau (Strg+E): Tabellen, Code-Hervorhebung, Aufgabenlisten, Mermaid-Diagramme, Bilder und `![[Einbettungen]]`
- `[[Wikilinks]]` inkl. `[[Notiz|Alias]]` und `[[Notiz#Überschrift]]`, Autovervollständigung, fehlende Notizen per Klick anlegen
- Backlinks und ausgehende Links, #Tags
- **Graph**: globaler und lokaler Graph aller Notizen und Links (Strg+G)
- Schnellwechsler (Strg+O) und Volltextsuche (Strg+Shift+F)
- Linux (AppImage) und Windows (Installer), automatische Updates über GitHub-Releases

## Tastenkürzel
Strg+N neue Notiz · Strg+O öffnen · Strg+Shift+F suchen · Strg+E Vorschau · Strg+G Graph · Strg+S speichern · Strg+W Tab schließen · Strg+Tab Tab wechseln

## Entwickeln
```
npm ci
npm start              # baut die Oberfläche (esbuild) und startet
npm run dist:linux     # AppImage
bash scripts/e2e.sh    # Headless-Test (21 Prüfungen)
```

## Lizenz
GPL-3.0 – © 2026 Cyberdeck Labs
