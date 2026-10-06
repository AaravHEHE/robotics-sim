// Where each claw of a robot preset is (robot frame) at each lift setting, and the claw height
// that places a held stack onto a Goal already holding n Pins (for planning sample routes).
//   node scripts/plan-reach.ts <robot-id>
import { existsSync, readFileSync } from 'node:fs';
import { clawEffector } from '../src/sim/lift.ts';
import type { ClawSpec, MechanismSpec, RobotProfile } from '../src/sim/profile.ts';
import { restingBottom } from '../src/games/override/manipulators.ts';
import type { Piece } from '../src/games/override/elements.ts';

const id = process.argv[2];
if (!id || !existsSync(`data/robots/${id}.json`)) {
  console.error('usage: node scripts/plan-reach.ts <robot-id>   (a file in data/robots, e.g. override-banshee)');
  process.exit(1);
}
const profile = JSON.parse(readFileSync(`data/robots/${id}.json`, 'utf8')) as RobotProfile;
const lifts = profile.mechanisms.filter((m) => m.kind === 'lift') as Array<MechanismSpec & { range?: [number, number]; name: string; lift: string }>;
for (const l of lifts) {
  // a lift without hard stops: a piston lift goes 0..1, a bar or cascade a sensible sweep
  if (!l.range) {
    l.range = l.lift === 'piston' ? [0, 1] : l.lift === 'cascade' ? [0, 1000] : [0, 90];
    console.log(`(${l.name} has no range: showing ${l.range[0]}..${l.range[1]})`);
  }
}
for (const claw of profile.mechanisms.filter((m) => m.kind === 'claw') as ClawSpec[]) {
  console.log(`claw ${claw.name}`);
  const grid = (i: number, vals: Record<string, number>): void => {
    if (i === lifts.length) {
      const e = clawEffector(profile, claw, (m) => vals[(m as { name: string }).name] ?? 0);
      console.log(`  ${Object.entries(vals).map(([k, v]) => `${k}=${v}`).join(' ')}  y ${e.y.toFixed(2)} z ${e.z.toFixed(2)}`);
      return;
    }
    const [lo, hi] = lifts[i].range!;
    const step = (hi - lo) / (Number(process.env.STEPS ?? 10));
    for (let v = lo; v <= hi + 1e-9; v += step) grid(i + 1, { ...vals, [lifts[i].name]: Math.round(v) });
  };
  grid(0, {});
}
const pin = (): Piece => ({ kind: 'pin', id: 'p', colors: ['yellow', 'yellow'] });
const cup = (): Piece => ({ kind: 'cup', id: 'c', up: 'clear' });
// a Goal's stack with n Pins: Pin, then Cup + Pin for each further one
const goalWith = (n: number): Piece[] => (n ? [pin(), ...Array.from({ length: n - 1 }, () => [cup(), pin()]).flat()] : []);
console.log(`alliance Goal (3.248) empty: a Pin's bottom rests at ${restingBottom([], 3.248, true, pin()).toFixed(2)}`);
for (let n = 1; n <= 4; n++) {
  console.log(`alliance Goal (3.248) with ${n} Pin${n > 1 ? 's' : ''}: a Cup (+ Pin) set on top rests with its bottom at ${restingBottom(goalWith(n), 3.248, true, cup()).toFixed(2)}`);
}
