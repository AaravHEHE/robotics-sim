// Node smoke test: can the llvm-wasm binary run clang at all?
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Toolchain, parseTar } from './toolchain.mjs';

const tools = fileURLToPath(new URL('../../tools/llvm-wasm/', import.meta.url));
const t0 = performance.now();
const factory = (await import(new URL('../../tools/llvm-wasm/llvm.js', import.meta.url))).default;
const module = await WebAssembly.compile(await readFile(tools + 'llvm.wasm'));
const sysroot = [...parseTar(await readFile(tools + 'include.tar')), ...parseTar(await readFile(tools + 'lib.tar'))];
console.log(`load+compile llvm.wasm: ${(performance.now() - t0).toFixed(0)} ms, sysroot files: ${sysroot.length}`);

const tc = new Toolchain({ factory, module, sysroot });
for (const args of [process.argv.slice(2).length ? process.argv.slice(2) : ['clang', '--version']]) {
  const r = await tc.run(args);
  console.log('exit', r.code, r.ms);
  console.log(r.stdout, r.stderr);
}
