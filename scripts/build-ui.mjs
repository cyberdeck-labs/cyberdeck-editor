// Buendelt die Oberflaeche (src/renderer -> src/dist) mit esbuild. Mermaid wird als eigener Chunk nachgeladen.
import * as esbuild from 'esbuild';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'src', 'dist');
rmSync(out, { recursive: true, force: true });
const r = await esbuild.build({
  entryPoints: [path.join(root, 'src', 'renderer', 'app.js')],
  outdir: out,
  bundle: true,
  format: 'esm',
  splitting: true,
  minify: true,
  sourcemap: false,
  target: 'chrome140',
  chunkNames: 'chunks/[name]-[hash]',
  legalComments: 'none',
  logLevel: 'warning',
  metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});
const bytes = Object.values(r.metafile.outputs).reduce((s, o) => s + o.bytes, 0);
console.log(`UI gebaut: ${Object.keys(r.metafile.outputs).length} Dateien, ${(bytes / 1048576).toFixed(1)} MB -> src/dist`);
