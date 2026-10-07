// Find objects phasing through each other in every shipped Override sample: floor pieces
// inside other pieces, inside the robot, inside Goals / Loaders / walls, and stacks that
// break the nesting rules (a Pin on a Pin, a Cup on a Cup). Checked after every simulator
// step, so a piece that passes through something for a moment is caught too.
//   node --experimental-wasm-jspi scripts/check-phasing.ts [sample-id]
import path from 'node:path';
import { SAMPLES } from '../src/app/samples-meta.ts';
import { loadNodeBundle, readProjectDir } from './node-bundle.ts';
import { loadNodeToolchain, repoRoot } from './node-toolchain.ts';
import { ProjectBuilder } from '../src/compiler/build.ts';
import { simulatedEnvNames } from '../src/sim/pros-api.ts';
import { OverrideGame } from '../src/games/override/game.ts';
import { phasing } from '../src/games/override/overlaps.ts';
import { runSample } from './sample-run.ts';
import { toField } from '../src/sim/lift.ts';
import type { World } from '../src/sim/world.ts';

const only = process.argv[2];
const builder = new ProjectBuilder(await loadNodeToolchain(), await loadNodeBundle(), simulatedEnvNames());

type Issue = { t: number; what: string; depth: number };
let current: Issue[] = [];
let clock = 0;
const step = OverrideGame.prototype.step;
OverrideGame.prototype.step = function (this: OverrideGame, dtMs: number) {
  step.call(this, dtMs);
  clock += dtMs;
  const world = (this as unknown as { world: World }).world;
  const held = world.attachments.map((a) => {
    const [x, y] = toField(world.pose, a);
    return { name: a.id.split(':')[1], x, y, r: a.r, bottom: a.bottom, fixedOnly: a.fixedOnly, nest: a.nest };
  });
  for (const p of phasing(this.field, this.state, world.footprint(), held)) {
    current.push({ t: clock, ...p });
  }
};

let failed = 0;
for (const meta of SAMPLES) {
  if (meta.field !== 'override' || (only && meta.id !== only)) continue;
  const b = await builder.build(await readProjectDir(path.join(repoRoot, 'samples', meta.id)));
  if (!b.ok || !b.wasm) { console.log(meta.id, 'BUILD FAIL'); failed++; continue; }
  current = [];
  clock = 0;
  // checking every step is slow: give the run more real time than the app does
  const rec = await runSample(meta, await WebAssembly.compile(b.wasm), { wallLimitMs: 600_000 });
  // one line per kind of problem: when it first happened, how often, and the worst depth
  const byWhat = new Map<string, { first: number; n: number; worst: number }>();
  for (const i of current) {
    const e = byWhat.get(i.what) ?? { first: i.t, n: 0, worst: 0 };
    e.n++;
    e.worst = Math.max(e.worst, i.depth);
    byWhat.set(i.what, e);
  }
  if (byWhat.size || rec.error) failed++;
  console.log(`${meta.id}: ${byWhat.size} problems${rec.error ? ' ERROR ' + rec.error : ''}  score ${JSON.stringify(rec.game?.result?.score.red)}`);
  for (const [what, e] of byWhat) console.log(`    t=${e.first}ms x${e.n} worst ${e.worst.toFixed(2)}in  ${what}`);
}
process.exitCode = failed ? 1 : 0;
