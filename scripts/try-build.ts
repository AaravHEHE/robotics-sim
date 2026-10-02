// Build a project folder with the browser pipeline running in Node.
//   node scripts/try-build.ts tests/fixtures/lemlib-template [--twice]
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { ProjectBuilder } from '../src/compiler/build.ts';
import { simulatedEnvNames } from '../src/sim/pros-api.ts';
import { classifyImports } from '../src/compiler/symbols.ts';
import { loadNodeBundle, readProjectDir } from './node-bundle.ts';
import { loadNodeToolchain, repoRoot } from './node-toolchain.ts';

const dir = path.resolve(repoRoot, process.argv[2] ?? 'tests/fixtures/lemlib-template');
const tc = await loadNodeToolchain();
const bundle = await loadNodeBundle();
const builder = new ProjectBuilder(tc, bundle, simulatedEnvNames());
const files = await readProjectDir(dir);
for (let i = 0; i < (process.argv.includes('--twice') ? 2 : 1); i++) {
  const r = await builder.build(files);
  console.log(`build ${i + 1}: ok=${r.ok} pch=${r.pch} ${r.totalMs.toFixed(0)} ms`);
  for (const s of r.steps) console.log(`   ${s.step.padEnd(40)} ${s.cached ? 'cached' : s.ms.toFixed(0) + ' ms'}`);
  for (const n of r.notes) console.log(`   [${n.level}] ${n.message}`);
  for (const d of r.diagnostics.slice(0, 15)) console.log(`   ${d.severity} ${d.file}:${d.line}:${d.column} ${d.message}`);
  if (r.ok && r.wasm && i === 0) {
    await writeFile(path.join(repoRoot, 'tools/last-build.wasm'), r.wasm);
    const mod = await WebAssembly.compile(r.wasm);
    const rep = classifyImports(WebAssembly.Module.imports(mod), new Set(), new Set(bundle.manifest.knownCApi));
    console.log(`   wasm ${(r.wasm.length / 1024).toFixed(0)} KB; env imports: ${rep.unsupported.length} known-API, ${rep.undefined.length} other`);
    console.log('   known-API:', rep.unsupported.map((u) => u.name).join(' '));
    if (rep.undefined.length) console.log('   other:', rep.undefined.map((u) => `${u.name} (${u.symbol})`).join(' '));
    console.log('   non-env imports:', WebAssembly.Module.imports(mod).filter((m) => m.module !== 'env').map((m) => `${m.module}.${m.name}`).join(' '));
  }
}
