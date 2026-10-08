// Trace a shipped sample: robot pose, what it holds, and the floor objects near a point.
//   node --experimental-wasm-jspi scripts/trace-sample.ts <sample-id> <x> <y> [everyMs] [fromMs] [toMs]
import path from 'node:path';
import { SAMPLES } from '../src/app/samples-meta.ts';
import { loadNodeBundle, readProjectDir } from './node-bundle.ts';
import { loadNodeToolchain, repoRoot } from './node-toolchain.ts';
import { ProjectBuilder } from '../src/compiler/build.ts';
import { simulatedEnvNames } from '../src/sim/pros-api.ts';
import { OverrideGame } from '../src/games/override/game.ts';
import type { World } from '../src/sim/world.ts';
import { runSample } from './sample-run.ts';

const [id, px, py, every = '250', from = '0', to = '1e9'] = process.argv.slice(2);
let clock = 0;
const step = OverrideGame.prototype.step;
OverrideGame.prototype.step = function (this: OverrideGame, dtMs: number) {
  step.call(this, dtMs);
  clock += dtMs;
  if (clock % +every || clock < +from || clock > +to) return;
  const w = (this as unknown as { world: World }).world;
  const near = [...this.state.floor, ...this.state.lying]
    .filter((o) => Math.hypot(o.x - +px, o.y - +py) < 8)
    .map((o) => `${o.id}(${o.x.toFixed(1)},${o.y.toFixed(1)})`);
  const held = Object.entries(this.state.held).filter(([, p]) => p.length).map(([k, p]) => `${k}:${p.length}`);
  console.log(`t=${clock} robot (${w.pose.x.toFixed(1)}, ${w.pose.y.toFixed(1)}, ${w.pose.theta.toFixed(0)}) held[${held}] near[${near}] att[${w.attachments.map((a) => a.bottom.toFixed(1))}]`);
};
const meta = SAMPLES.find((m) => m.id === id)!;
const builder = new ProjectBuilder(await loadNodeToolchain(), await loadNodeBundle(), simulatedEnvNames());
const b = await builder.build(await readProjectDir(path.join(repoRoot, 'samples', meta.id)));
await runSample(meta, await WebAssembly.compile(b.wasm!));
