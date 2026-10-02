// Debug: run out/app.wasm with a watchdog and dump scheduler state if it stalls.
import { readFile } from 'node:fs/promises';
import { runProgram } from './runtime.mjs';

const mod = await WebAssembly.compile(await readFile(new URL('./out/app.wasm', import.meta.url)));
console.log('exports', WebAssembly.Module.exports(mod).map((e) => `${e.name}:${e.kind}`).join(' '));
const timer = setTimeout(() => { console.log('STALLED'); process.exit(2); }, 10000);
const r = await runProgram(mod, { stopMs: Number(process.env.STOP ?? 15000), debug: true });
clearTimeout(timer);
console.log(r.stdout, r.error, r.log.slice(0, 30), r.ms);
