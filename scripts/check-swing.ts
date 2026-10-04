// Find heading swings (a turn that goes past its target and comes back) in every shipped
// sample, to catch motion-model regressions the eye would see in the viewer.
//   node --experimental-wasm-jspi scripts/check-swing.ts [sample-id]
import path from 'node:path';
import { SAMPLES } from '../src/app/samples-meta.ts';
import { loadNodeBundle, readProjectDir } from './node-bundle.ts';
import { loadNodeToolchain, repoRoot } from './node-toolchain.ts';
import { ProjectBuilder } from '../src/compiler/build.ts';
import { simulatedEnvNames } from '../src/sim/pros-api.ts';
import { runSample } from './sample-run.ts';

const only = process.argv[2];
const builder = new ProjectBuilder(await loadNodeToolchain(), await loadNodeBundle(), simulatedEnvNames());
for (const meta of SAMPLES) {
  if (only && meta.id !== only) continue;
  const b = await builder.build(await readProjectDir(path.join(repoRoot, 'samples', meta.id)));
  if (!b.ok || !b.wasm) { console.log(meta.id, 'BUILD FAIL'); continue; }
  const rec = await runSample(meta, await WebAssembly.compile(b.wasm));
  const n = rec.frames.length / rec.stride;
  const th = (k: number) => rec.frames[k * rec.stride + 3];
  // monotone legs with 0.2° hysteresis
  const legs: { t: number; from: number; to: number }[] = [];
  let dir = 0, start = th(0), ext = th(0), tExt = 0;
  for (let k = 1; k < n; k++) {
    const a = th(k);
    if (dir >= 0 && a > ext) { ext = a; tExt = k; if (dir === 0 && a - start > 0.2) dir = 1; }
    else if (dir <= 0 && a < ext) { ext = a; tExt = k; if (dir === 0 && start - a > 0.2) dir = -1; }
    else if (dir !== 0 && Math.abs(a - ext) > 0.2) {
      legs.push({ t: tExt * rec.frameEveryMs, from: start, to: ext });
      start = ext; ext = a; tExt = k; dir = -dir;
    }
  }
  const swings: string[] = [];
  for (let i = 1; i < legs.length; i++) {
    const prev = Math.abs(legs[i - 1].to - legs[i - 1].from);
    const back = Math.abs(legs[i].to - legs[i].from);
    if (prev > 10 && back > 0.5 && back < 25) swings.push(`t=${legs[i - 1].t} ${legs[i - 1].from.toFixed(0)}→${legs[i - 1].to.toFixed(1)} back ${back.toFixed(1)}°`);
  }
  console.log(`${meta.id}: ${swings.length} swings${rec.error ? ' ERROR ' + rec.error : ''}`);
  for (const s of swings) console.log('   ', s);
}
