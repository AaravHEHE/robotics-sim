// Load the toolchain from tools/llvm-wasm for Node scripts and tests.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseTar } from '../src/compiler/tar.ts';
import { Toolchain, type LlvmFactory } from '../src/compiler/toolchain.ts';

export const repoRoot = path.resolve(import.meta.dirname, '..');

export async function loadNodeToolchain(): Promise<Toolchain> {
  const dir = path.join(repoRoot, 'tools/llvm-wasm');
  const factory = (await import(pathToFileURL(path.join(dir, 'llvm.js')).href)).default as LlvmFactory;
  const module = await WebAssembly.compile(await readFile(path.join(dir, 'llvm.wasm')));
  const readonly = [
    ...parseTar(await readFile(path.join(dir, 'include.tar'))),
    ...parseTar(await readFile(path.join(dir, 'lib.tar'))),
  ];
  return new Toolchain({ factory, module, readonly });
}
