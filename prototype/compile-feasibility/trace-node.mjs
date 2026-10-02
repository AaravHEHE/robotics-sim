import { readFile } from 'node:fs/promises';
import { trace } from './trace.mjs';

const mod = await WebAssembly.compile(await readFile(new URL('./out/app.wasm', import.meta.url)));
console.log(JSON.stringify(await trace(mod)));
