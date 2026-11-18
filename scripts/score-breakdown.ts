// Build a shipped sample, simulate it, and print where every point of its score comes from:
// each Pin half in each Goal (visible or hidden, whose it is, how many points), the Toggles,
// the Midfield and the Autonomous Bonus. For checking the scoring against the game manual.
//   node --experimental-wasm-jspi scripts/score-breakdown.ts <sample-id>
import path from 'node:path';
import { SAMPLES } from '../src/app/samples-meta.ts';
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
if (!b.ok || !b.wasm) throw new Error('build failed');
const rec = await runSample(meta, await WebAssembly.compile(b.wasm));
const g = rec.game!;
const r = g.result!;
const end = g.snapshots.at(-1)!.state;
console.log(`${id} (${g.mode}, ${g.alliance}): total red ${r.total.red}, blue ${r.total.blue}  (Pins/Midfield: red ${r.score.red}, blue ${r.score.blue})`);
for (const goal of r.score.goals) {
  const pieces = end.goals[goal.goal] ?? [];
  if (!pieces.length) continue;
  console.log(`  ${goal.goal} [${goal.zone}] ${pieces.map((p) => (p.kind === 'pin' ? p.colors.join('/') : 'cup-' + p.up + '-up')).join(' + ')}  => ${goal.red} red, ${goal.blue} blue, ${goal.placedPins} Placed`);
  for (const h of goal.halves) console.log(`      ${h.color.padEnd(6)} ${h.visible ? 'visible' : 'HIDDEN '} ${h.owner ? `${h.owner} +${h.points}` : 'not scored'}`);
}
console.log(`  toggles: ${r.score.toggles.map((t) => `${t.zone}=${t.color}`).join(' ')}`);
console.log(`  Midfield: robot in it ${r.inMidfield}, +${r.score.midfield.points.red} red / +${r.score.midfield.points.blue} blue`);
console.log(`  Autonomous Bonus: ${JSON.stringify(r.autonomousBonus)}`);
