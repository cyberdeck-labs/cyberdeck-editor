# Cyberdeck Editor

Cyberpunk-styled Markdown notes – compatible with Obsidian vaults (plain `.md` files, no custom format).

- Vault = any folder of `.md` files; changes made outside (e.g. in Obsidian) are picked up live
- File tree, tabs, CodeMirror editor with Markdown highlighting, autosave
- Preview (Ctrl+E): tables, code highlighting, task lists, Mermaid diagrams, images and `![[embeds]]`
- `[[Wikilinks]]` incl. `[[Note|Alias]]` and `[[Note#Heading]]`, autocompletion, create missing notes with one click
- Backlinks and outgoing links, #tags
- **Graph**: global and local graph of all notes and links (Ctrl+G)
- Quick switcher (Ctrl+O) and full-text search (Ctrl+Shift+F)
- Linux (AppImage) and Windows (installer), automatic updates via GitHub Releases

## Shortcuts
Ctrl+N new note · Ctrl+O open · Ctrl+Shift+F search · Ctrl+E preview · Ctrl+G graph · Ctrl+S save · Ctrl+W close tab · Ctrl+Tab switch tab

## Development
```
npm ci
npm start              # builds the UI (esbuild) and starts the app
npm run dist:linux     # AppImage
bash scripts/e2e.sh    # headless test (21 checks)
```

## License
GPL-3.0 – © 2026 Cyberdeck Labs
