// Node benchmark: build shim + PCH, compile + link the test project, run it twice.
// Usage: node --experimental-wasm-jspi bench-node.mjs   (flag only needed on Node < 25)
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Toolchain, parseTar } from './toolchain.mjs';
import { buildShim, compileProject } from './pipeline.mjs';
import { runProgram } from './runtime.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const tools = path.join(root, 'tools/llvm-wasm');

async function readTree(dir, base = dir) {
  const out = {};
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) Object.assign(out, await readTree(p, base));
    else out[path.relative(base, p).replaceAll('\\', '/')] = await readFile(p, 'utf8');
  }
  return out;
}

const fmt = (ms) => `${ms.toFixed(0)} ms`;
const t0 = performance.now();
const factory = (await import(new URL('../../tools/llvm-wasm/llvm.js', import.meta.url))).default;
const module = await WebAssembly.compile(await readFile(path.join(tools, 'llvm.wasm')));
const sysroot = [...parseTar(await readFile(path.join(tools, 'include.tar'))), ...parseTar(await readFile(path.join(tools, 'lib.tar')))];
const tc = new Toolchain({ factory, module, sysroot });
console.log('toolchain ready', fmt(performance.now() - t0));

const shimFiles = await readTree(path.join(root, 'shim'));
const opt = process.env.OPT ?? '-O1';
const tS = performance.now();
const shim = await buildShim(tc, shimFiles, { opt });
console.log(`shim+PCH built in ${fmt(performance.now() - tS)}; PCH ${(shim.pch.length / 1e6).toFixed(1)} MB`, shim.timings);
const outDir = path.join(here, 'out');
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'sim.pch'), shim.pch);
for (const [p, d] of Object.entries(shim.objects)) await writeFile(path.join(outDir, path.basename(p)), d);

const headers = Object.fromEntries(Object.entries(shimFiles).filter(([p]) => p.startsWith('include/')));
const project = await readTree(path.join(here, 'test-project'));
// Manifest for the browser harness: everything except the big binaries.
await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify({
  headers, project, objects: Object.keys(shim.objects).map((p) => path.basename(p)),
}));
const loc = Object.values(project).reduce((n, s) => n + s.split('\n').length, 0);
console.log(`test project: ${Object.keys(project).length} files, ${loc} lines`);

for (const usePch of [false, true]) {
  const tC = performance.now();
  const r = await compileProject(tc, { ...shim, headers }, project, { opt, usePch });
  const total = performance.now() - tC;
  console.log(`\n== compile+link (PCH ${usePch ? 'on' : 'off'}, ${opt}): ${fmt(total)} ok=${r.ok}`);
  for (const s of r.steps) console.log(`   ${s.step.padEnd(28)} ${fmt(s.ms.total)} (run ${fmt(s.ms.run)})`);
  if (r.diagnostics.trim()) console.log(r.diagnostics);
  if (!r.ok) process.exit(1);
  if (usePch) {
    await writeFile(path.join(outDir, 'app.wasm'), r.wasm);
    console.log(`app.wasm ${(r.wasm.length / 1024).toFixed(0)} KB`);
    const appModule = await WebAssembly.compile(r.wasm);
    const hashes = [];
    for (let i = 0; i < 2; i++) {
      const run = await runProgram(appModule, { stopMs: 15000 });
      const h = createHash('sha256').update(run.log.join('\n') + JSON.stringify(run.frames)).digest('hex').slice(0, 16);
      hashes.push(h);
      console.log(`\n== run ${i + 1}: 15 s simulated in ${fmt(run.ms)}, ${run.log.length} events, hash ${h}${run.error ? ' ERROR ' + run.error : ''}`);
      if (i === 0) {
        console.log(run.stdout);
        console.log(run.log.filter((l) => !/motor (10|-?[1-6]) /.test(l) || /move (0|80|-127)$/.test(l)).slice(0, 40).join('\n'));
        console.log('final pose', run.finalPose);
      }
    }
    console.log(`deterministic: ${hashes[0] === hashes[1]}`);
  }
}
