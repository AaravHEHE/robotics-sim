// Build a project folder and simulate it in Node, printing a summary.
//   node --experimental-wasm-jspi scripts/try-run.ts <project-dir> <robot-id> [autonMs]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ProjectBuilder } from '../src/compiler/build.ts';
import { simulatedEnvNames } from '../src/sim/pros-api.ts';
import type { FieldDef } from '../src/sim/field.ts';
import type { RobotProfile } from '../src/sim/profile.ts';
import { runProgram } from '../src/sim/runtime.ts';
import { loadNodeBundle, readProjectDir } from './node-bundle.ts';
import { loadNodeToolchain, repoRoot } from './node-toolchain.ts';

const dir = path.resolve(repoRoot, process.argv[2] ?? 'tests/fixtures/lemlib-template');
const robotId = process.argv[3] ?? 'lemlib-template';
const autonMs = Number(process.argv[4] ?? 15000);
const profile = JSON.parse(await readFile(path.join(repoRoot, 'data/robots', robotId + '.json'), 'utf8')) as RobotProfile;
const field = JSON.parse(await readFile(path.join(repoRoot, 'data/fields/generic-12ft.json'), 'utf8')) as FieldDef;

const tc = await loadNodeToolchain();
const builder = new ProjectBuilder(tc, await loadNodeBundle(), simulatedEnvNames());
const b = await builder.build(await readProjectDir(dir));
console.log(`build ok=${b.ok} ${b.totalMs.toFixed(0)} ms`);
for (const d of b.diagnostics.filter((x) => x.severity === 'error').slice(0, 10)) console.log(`  ${d.file}:${d.line} ${d.message}`);
if (!b.ok || !b.wasm) process.exit(1);

const mod = await WebAssembly.compile(b.wasm);
const rec = await runProgram(mod, { profile, field, start: { x: 0, y: 0, theta: 0 }, autonMs });
console.log(`run: ${rec.wallMs.toFixed(0)} ms wall, stop ${rec.stop} ms, auton ${rec.autonStart} -> ${rec.autonEnd ?? '(still running)'}${rec.error ? '\nERROR ' + rec.error : ''}`);
for (const e of rec.events) console.log(`  [${e.level} ${e.t}] ${e.message}`);
for (const m of rec.motions) console.log(`  motion ${m.label.padEnd(15)} ${m.t0}-${m.t1} target ${m.target ? `${m.target.x.toFixed(1)},${m.target.y.toFixed(1)}${m.target.theta !== undefined ? ' @' + m.target.theta.toFixed(0) : ''}` : '-'}`);
const n = rec.frames.length / rec.stride;
for (const t of [0, 0.25, 0.5, 0.75, 1]) {
  const i = Math.min(n - 1, Math.floor(t * (n - 1)));
  const f = rec.frames.subarray(i * rec.stride, i * rec.stride + 4);
  console.log(`  t=${f[0]} pose (${f[1].toFixed(2)}, ${f[2].toFixed(2)}) theta ${f[3].toFixed(1)}`);
}
if (process.env.TRACE) {
  const [a, b2, step] = process.env.TRACE.split(',').map(Number);
  for (let i = 0; i < n; i++) {
    const t = rec.frames[i * rec.stride];
    if (t >= a && t <= b2 && t % step === 0) console.log(`    ${t}: x ${rec.frames[i * rec.stride + 1].toFixed(2)} y ${rec.frames[i * rec.stride + 2].toFixed(2)} th ${rec.frames[i * rec.stride + 3].toFixed(1)} vL ${rec.frames[i * rec.stride + 4].toFixed(1)} vR ${rec.frames[i * rec.stride + 5].toFixed(1)}`);
  }
}
console.log(`  console: ${rec.console.length} lines; first: ${rec.console.slice(0, 3).map((c) => JSON.stringify(c.text)).join(' ')}`);
if (process.env.SHOW_CONSOLE) for (const c of rec.console) console.log(`    [${c.t}] ${c.text}`);
console.log(`  lcd updates: ${rec.lcd.length}; last: ${rec.lcd.slice(-3).map((l) => `${l.line}:${l.text}`).join(' | ')}`);
