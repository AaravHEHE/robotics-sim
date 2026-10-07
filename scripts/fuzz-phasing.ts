// Drive every Override robot preset at random (drive, turn, lifts, wrists, claws, intakes)
// from random starts and check after every step that nothing phases through anything.
//   node scripts/fuzz-phasing.ts [runs per robot] [ms per run] [robot file filter] [only run #]
// With a run number it replays that one run and prints each problem when it first appears.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { OverrideGame } from '../src/games/override/game.ts';
import { phasing } from '../src/games/override/overlaps.ts';
import { toField } from '../src/sim/lift.ts';
import { isMotorized, isPneumatic, type RobotProfile } from '../src/sim/profile.ts';
import { World } from '../src/sim/world.ts';
import type { FieldDef } from '../src/sim/field.ts';
import { repoRoot } from './node-toolchain.ts';

const runs = Number(process.argv[2] ?? 20);
const ms = Number(process.argv[3] ?? 8000);
const robotFilter = process.argv[4] ?? '';
const onlyRun = process.argv[5] === undefined ? null : Number(process.argv[5]);
const field = JSON.parse(await readFile(path.join(repoRoot, 'data/fields/override.json'), 'utf8')) as FieldDef;

let seed = 1;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const robots = (await readdir(path.join(repoRoot, 'data/robots'))).filter((f) => f.startsWith('override-') && f.includes(robotFilter));
let total = 0;
for (const file of robots) {
  const r = JSON.parse(await readFile(path.join(repoRoot, 'data/robots', file), 'utf8')) as RobotProfile;
  const worst = new Map<string, { depth: number; run: number; t: number }>();
  const spansOf = new Map<string, { first: number; last: number; steps: number }>();
  for (let run = 0; run < runs; run++) {
    if (onlyRun !== null && run !== onlyRun) continue;
    seed = run * 7919 + 17;
    const seen = new Set<string>();
    const spans = spansOf;
    const starts = (field.startPositions ?? []).filter((p) => p.layouts.includes('h2h'));
    const sp = starts[Math.floor(rand() * starts.length)];
    if (onlyRun !== null) console.log(`run ${run} from ${sp.id}`);
    const world = new World(r, field, { x: sp.x, y: sp.y, theta: sp.theta });
    const game = await OverrideGame.create(field, 'h2h', world);
    for (let t = 1; t <= ms; t++) {
      if (t % 250 === 1) {
        // a new random command: drive / turn, a lift or wrist somewhere in its range, a claw or intake
        const fwd = (rand() * 2 - 1) * 127;
        const turn = rand() < 0.4 ? (rand() * 2 - 1) * 100 : 0;
        for (const p of r.drivetrain.left) world.motor(p).cmd = Math.sign(p) * Math.max(-127, Math.min(127, fwd + turn));
        for (const p of r.drivetrain.right) world.motor(p).cmd = Math.sign(p) * Math.max(-127, Math.min(127, fwd - turn));
        for (const m of r.mechanisms) {
          if (rand() < 0.5) continue;
          if (isPneumatic(m)) world.adiOut.set(m.adi!.toUpperCase(), rand() < 0.5);
          else if (isMotorized(m)) for (const p of m.motors!) world.motor(Math.abs(p)).cmd = Math.round((rand() * 2 - 1) * 127);
        }
      }
      world.step(1);
      game.step(1);
      const held = world.attachments.map((a) => {
        const [x, y] = toField(world.pose, a);
        return { name: a.id.split(':')[1], x, y, r: a.r, bottom: a.bottom, fixedOnly: a.fixedOnly, nest: a.nest };
      });
      for (const p of phasing(field, game.state, world.footprint(), held)) {
        if (onlyRun !== null) {
          const span = spans.get(p.what);
          if (span) Object.assign(span, { last: t, steps: span.steps + 1 });
          else spans.set(p.what, { first: t, last: t, steps: 1 });
        }
        if (onlyRun !== null && !seen.has(p.what)) {
          seen.add(p.what);
          console.log(`  t=${t} ${p.what} ${p.depth.toFixed(2)} robot (${world.pose.x.toFixed(1)}, ${world.pose.y.toFixed(1)}, ${world.pose.theta.toFixed(0)}) v ${world.speed.toFixed(0)} held [${held.map((h) => h.bottom.toFixed(1))}]`);
        }
        // one entry per kind of problem (piece ids vary from run to run)
        const kind = p.what.replace(/\b(s|d|pin|cup)\d+\b/g, '#').replace(/preload/g, '#');
        const w = worst.get(kind);
        if (!w || p.depth > w.depth) worst.set(kind, { depth: p.depth, run, t });
      }
    }
  }
  for (const [what, sp] of spansOf) console.log(`  ${what}: t=${sp.first}..${sp.last}, ${sp.steps} steps`);
  total += worst.size;
  console.log(`${file}: ${worst.size} kinds of problem in ${runs} runs`);
  for (const [k, w] of worst) console.log(`    worst ${w.depth.toFixed(2)}in (run ${w.run}, t=${w.t})  ${k}`);
}
process.exitCode = total ? 1 : 0;
