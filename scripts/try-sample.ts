// Build a shipped sample and simulate it exactly as the app would, printing the game
// result (for tuning sample routes and their golden scores).
//   node --experimental-wasm-jspi scripts/try-sample.ts <sample-id>
//   TRACE=ms  also prints the pose, held pieces and score every `ms` milliseconds.
import path from 'node:path';
import { SAMPLES } from '../src/app/samples-meta.ts';
import { stateAt } from '../src/games/override/replay.ts';
import { loadNodeBundle, readProjectDir } from './node-bundle.ts';
import { loadNodeToolchain, repoRoot } from './node-toolchain.ts';
import { ProjectBuilder } from '../src/compiler/build.ts';
import { simulatedEnvNames } from '../src/sim/pros-api.ts';
import { runSample } from './sample-run.ts';

const id = process.argv[2];
const meta = SAMPLES.find((s) => s.id === id);
if (!meta) throw new Error(`no sample ${id}; have ${SAMPLES.map((s) => s.id).join(', ')}`);
const builder = new ProjectBuilder(await loadNodeToolchain(), await loadNodeBundle(), simulatedEnvNames());
const b = await builder.build(await readProjectDir(path.join(repoRoot, 'samples', id)));
for (const d of b.diagnostics.filter((x) => x.severity === 'error').slice(0, 10)) console.log(`  ${d.file}:${d.line} ${d.message}`);
if (!b.ok || !b.wasm) process.exit(1);
const rec = await runSample(meta, await WebAssembly.compile(b.wasm));
console.log(`run: stop ${rec.stop} ms, auton ${rec.autonStart} -> ${rec.autonEnd ?? '(still running)'}${rec.error ? '\nERROR ' + rec.error : ''}`);
for (const e of rec.events) console.log(`  [${e.level} ${e.t}] ${e.message}`);
for (const m of rec.motions) console.log(`  motion ${m.label.padEnd(15)} ${m.t0}-${m.t1} target ${m.target ? `${m.target.x.toFixed(1)},${m.target.y.toFixed(1)}` : '-'}`);
for (const c of rec.console) console.log(`  console [${c.t}] ${c.text}`);
const g = rec.game;
if (g) {
  const trace = Number(process.env.TRACE ?? 0);
  if (trace) {
    for (let t = 0; t <= rec.stop; t += trace) {
      const i = Math.min(rec.frames.length / rec.stride - 1, Math.round(t / rec.frameEveryMs)) * rec.stride;
      const s = stateAt(g, t);
      const held = Object.entries(s.held).filter(([, v]) => v.length).map(([k, v]) => `${k}:${v.map((p) => (p.kind === 'pin' ? p.colors.join('/') : 'cup-' + p.up)).join('+')}`);
      const mech = rec.mechanisms.map((m, k) => `${m}=${rec.frames[i + 6 + k].toFixed(0)}`).join(' ');
      const tg = s.toggles.map((x) => x.angle.toFixed(0) + (x.touched ? '*' : '')).join(',');
      console.log(`  t=${t} tg[${tg}] (${rec.frames[i + 1].toFixed(1)}, ${rec.frames[i + 2].toFixed(1)}) θ${rec.frames[i + 3].toFixed(0)} ${mech} ${held.join(' ')}`);
    }
  }
  const s = g.snapshots.at(-1)!.state;
  for (const [goal, ps] of Object.entries(s.goals)) if (ps.length) console.log(`  goal ${goal}: ${ps.map((p) => (p.kind === 'pin' ? p.colors.join('/') : 'cup-' + p.up)).join(' + ')}`);
  const r = g.result!;
  console.log(`  toggles: ${r.score.toggles.map((t) => `${t.zone}=${t.color}`).join(' ')}`);
  console.log(`  SCORE red ${r.score.red} blue ${r.score.blue}  bonus ${JSON.stringify(r.autonomousBonus)} awp ${r.awp ? `${r.awp.scoredPins} pins/${r.awp.goalsWithTwo} goals std=${r.awp.standard}` : '-'} midfield ${r.inMidfield} perimeter ${r.touchingPerimeter}`);
}
