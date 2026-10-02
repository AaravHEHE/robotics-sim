// Download the pinned toolchain into tools/llvm-wasm (verifying hashes) and publish
// gzip copies into public/toolchain/ for the site. Usage: node scripts/fetch-toolchain.ts
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { TOOLCHAIN_FILES, TOOLCHAIN_RELEASE } from './toolchain-pin.ts';

const root = path.resolve(import.meta.dirname, '..');
const toolsDir = path.join(root, 'tools/llvm-wasm');
const publicDir = path.join(root, 'public/toolchain');
await mkdir(toolsDir, { recursive: true });
await mkdir(publicDir, { recursive: true });

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

for (const [name, hash] of Object.entries(TOOLCHAIN_FILES)) {
  const local = path.join(toolsDir, name);
  let data: Uint8Array | null = existsSync(local) ? await readFile(local) : null;
  if (!data || sha256(data) !== hash) {
    console.log(`downloading ${name}`);
    const res = await fetch(TOOLCHAIN_RELEASE + name);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    data = new Uint8Array(await res.arrayBuffer());
    if (sha256(data) !== hash) throw new Error(`${name}: sha256 mismatch`);
    await writeFile(local, data);
  }
  if (name === 'llvm.js' || name === 'versions.json') {
    await copyFile(local, path.join(publicDir, name));
  } else {
    const out = path.join(publicDir, name + '.gz');
    if (!existsSync(out)) {
      await writeFile(out, gzipSync(data, { level: 9 }));
      console.log(`wrote public/toolchain/${name}.gz`);
    }
  }
}
console.log('toolchain ready');
