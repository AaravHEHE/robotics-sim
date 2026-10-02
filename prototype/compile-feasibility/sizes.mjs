// Report raw / gzip / brotli sizes of everything a visitor must download, and write
// gzip copies into out/ (the browser harness decompresses with DecompressionStream,
// so we don't depend on the static host compressing .wasm/.tar/.pch).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(here, 'out');
await mkdir(out, { recursive: true });
const items = [
  ['llvm.wasm', path.join(root, 'tools/llvm-wasm/llvm.wasm')],
  ['include.tar', path.join(root, 'tools/llvm-wasm/include.tar')],
  ['lib.tar', path.join(root, 'tools/llvm-wasm/lib.tar')],
  ['sim.pch', path.join(out, 'sim.pch')],
];
let tot = [0, 0, 0];
const mb = (n) => (n / 1e6).toFixed(1).padStart(6) + ' MB';
console.log('file          raw        gzip-9     brotli-11');
for (const [name, p] of items) {
  const buf = await readFile(p);
  const gz = gzipSync(buf, { level: 9 });
  const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
  await writeFile(path.join(out, name + '.gz'), gz);
  tot = [tot[0] + buf.length, tot[1] + gz.length, tot[2] + br.length];
  console.log(name.padEnd(12), mb(buf.length), mb(gz.length), mb(br.length));
}
console.log('TOTAL       ', mb(tot[0]), mb(tot[1]), mb(tot[2]));
