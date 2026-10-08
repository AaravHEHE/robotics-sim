/* eslint-disable @typescript-eslint/no-explicit-any */
// Show what a shipped sample does on the Override field: Goal changes, drops, collisions,
// and where each claw release happened relative to the nearest Goal.
//   node --experimental-wasm-jspi scripts/diag-sample.ts <sample-id>
import path from 'node:path';
import { SAMPLES } from '../src/app/samples-meta.ts';
import { loadNodeBundle, readProjectDir } from './node-bundle.ts';
import { loadNodeToolchain, repoRoot } from './node-toolchain.ts';
import { ProjectBuilder } from '../src/compiler/build.ts';
import { simulatedEnvNames } from '../src/sim/pros-api.ts';
import { runSample } from './sample-run.ts';
import { Manipulators, restingBottom } from '../src/games/override/manipulators.ts';

// log every claw release: where the claw is relative to the nearest Goal, and at what height
const proto = Manipulators.prototype as unknown as Record<string, (...a: any[]) => unknown>;
const release = proto.release;
proto.release = function (this: any, c: any, count?: number) {
  const { field, state } = this.ops;
  const e = this.effector(c.spec);
  const bottom = e.z - c.grip;
  const g = [...field.goals].sort((a: any, b: any) => Math.hypot(e.x - a.x, e.y - a.y) - Math.hypot(e.x - b.x, e.y - b.y))[0];
  const held = state.held[c.spec.name];
  const rest = held.length ? restingBottom(state.goals[g.id], g.height, true, held[0]) : NaN;
  console.log(`  release t=${this.now} ${c.spec.name} [${held.map((p: any) => p.id)}] off ${g.id} by ${Math.hypot(e.x - g.x, e.y - g.y).toFixed(2)} bottom ${bottom.toFixed(2)} window [${(rest - 2).toFixed(2)}, ${(rest + 4).toFixed(2)}] tilt ${this.tilt(c.spec).toFixed(1)} robot (${this.world.pose.x.toFixed(1)}, ${this.world.pose.y.toFixed(1)}, ${this.world.pose.theta.toFixed(0)})`);
  return release.call(this, c, count);
};

const builder = new ProjectBuilder(await loadNodeToolchain(), await loadNodeBundle(), simulatedEnvNames());
for (const id of process.argv.slice(2)) {
  const meta = SAMPLES.find((m) => m.id === id)!;
  const b = await builder.build(await readProjectDir(path.join(repoRoot, 'samples', meta.id)));
  if (!b.ok || !b.wasm) { console.log(id, 'BUILD FAIL', b.diagnostics); continue; }
  const rec = await runSample(meta, await WebAssembly.compile(b.wasm));
  const g = rec.game!;
  console.log(`== ${id}: red ${g.result?.score.red} (error ${rec.error})`);
  for (const n of g.notes) console.log('  note', n);
  for (const v of g.violations) console.log('  violation', v.t, v.rule, v.message);
  let prev = '';
  for (const s of g.snapshots) {
    const goals = Object.entries(s.state.goals).filter(([, p]) => p.length).map(([k, p]) => `${k}:${p.map((x) => x.id).join('+')}`).join(' ');
    const held = Object.entries(s.state.held).filter(([, p]) => p.length).map(([k, p]) => `${k}:${p.map((x) => x.id).join('+')}`).join(' ');
    const drops = [...s.state.floor, ...s.state.lying].filter((o) => o.id.startsWith('d')).map((o) => o.id).join(',');
    const line = `goals[${goals}] held[${held}] drops[${drops}]`;
    if (line !== prev) console.log('  t=' + s.t, line);
    prev = line;
  }
  for (const e of rec.events) console.log('  event', e.t, e.message);
  for (const c of rec.console) console.log('  out', c.t, c.text);
}
