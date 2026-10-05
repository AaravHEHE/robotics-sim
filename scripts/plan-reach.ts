// Where each claw of a robot preset is (robot frame) at each lift setting, and the claw height
// that places a held stack onto a Goal already holding n Pins (for planning sample routes).
//   node scripts/plan-reach.ts <robot-id>
import { readFileSync } from 'node:fs';
import { clawEffector } from '../src/sim/lift.ts';
import type { ClawSpec, MechanismSpec, RobotProfile } from '../src/sim/profile.ts';
import { restingBottom } from '../src/games/override/manipulators.ts';
import type { Piece } from '../src/games/override/elements.ts';

const id = process.argv[2];
const profile = JSON.parse(readFileSync(`data/robots/${id}.json`, 'utf8')) as RobotProfile;
const lifts = profile.mechanisms.filter((m) => m.kind === 'lift') as Array<MechanismSpec & { range: [number, number]; name: string }>;
for (const claw of profile.mechanisms.filter((m) => m.kind === 'claw') as ClawSpec[]) {
  console.log(`claw ${claw.name}`);
  const grid = (i: number, vals: Record<string, number>): void => {
    if (i === lifts.length) {
      const e = clawEffector(profile, claw, (m) => vals[(m as { name: string }).name] ?? 0);
      console.log(`  ${Object.entries(vals).map(([k, v]) => `${k}=${v}`).join(' ')}  y ${e.y.toFixed(2)} z ${e.z.toFixed(2)}`);
      return;
    }
    const [lo, hi] = lifts[i].range;
    const step = (hi - lo) / (Number(process.env.STEPS ?? 10));
    for (let v = lo; v <= hi + 1e-9; v += step) grid(i + 1, { ...vals, [lifts[i].name]: Math.round(v) });
  };
  grid(0, {});
}
const pin = (): Piece => ({ kind: 'pin', id: 'p', colors: ['yellow', 'yellow'] });
const cup = (): Piece => ({ kind: 'cup', id: 'c', up: 'clear' });
let stack: Piece[] = [];
for (let n = 0; n < 5; n++) {
  console.log(`alliance Goal (3.248) with ${n} Pins: a Pin's bottom rests at ${restingBottom(stack, 3.248, true, pin()).toFixed(2)}; with ${n} Pins + Cup on top... a Cup's bottom at ${restingBottom(stack.length ? stack : [pin()], 3.248, true, cup()).toFixed(2)}`);
  stack = [...stack, ...(stack.length ? [cup(), pin()] : [pin()])];
}
