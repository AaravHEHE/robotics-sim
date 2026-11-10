// Write data/builds/<name>.motion.json: which parts of an imported CAD build move with its lift,
// and how. The CAD's own mates are not in the glTF export, so the groups come from the CAD's
// geometry: a link's pivot is read off the gears or screws it hangs on, the parts that sit along
// a link belong to it, and what hangs from its far end moves with that end. Each rule below says
// what it read; the result is checked by tests/build-motion.test.ts and by looking at the poses.
//
//   node scripts/gen-motion.ts            (all builds)   or   node scripts/gen-motion.ts fourbar
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Assembly } from '../src/app/parts/assembly.ts';
import type { MotionGroup, MotionSpec } from '../src/app/parts/build-motion.ts';
import { repoRoot } from './node-toolchain.ts';

type Rule = (asm: Assembly) => Omit<MotionSpec, 'v'>;
const centers = (asm: Assembly) => asm.parts.map((p) => p.xf!.c);

/**
 * A slide lift: stage channels nested one inch apart in y (`planes`, from the fixed base to the
 * carriage). A part belongs to the stage whose plane it is nearest (parts well past either end of
 * the stack are not the lift's); structure and hardware move, gears, motors and shafts stay. A cascade moves
 * every stage together (stage k rises k/n of the carriage's rise); a continuous lift's stages rise
 * in turn, the carriage first.
 */
function stages(asm: Assembly, planes: number[], travel: number, sequential: boolean, notes: string): Omit<MotionSpec, 'v'> {
  const c = centers(asm);
  const MOVES = /^(c-channel|angle|spacer|bearing|screw|nut|standoff|collar|washer)/;
  const lift = asm.parts.map((_, i) => i).filter((i) => MOVES.test(asm.parts[i].part) && c[i][2] >= 3 && Math.abs(c[i][0]) <= 6);
  const n = planes.length - 1;
  const sign = Math.sign(planes[n] - planes[0]);
  const along = planes.map((y) => (y - planes[0]) * sign);
  const owner = (y: number) => {
    const t = (y - planes[0]) * sign;
    let best = 0;
    for (let k = 1; k <= n; k++) if (Math.abs(t - along[k]) < Math.abs(t - along[best])) best = k;
    return t < -0.6 || t > along[n] + 0.6 ? 0 : best; // beyond the stack it is not the lift's
  };
  const groups: MotionGroup[] = [];
  for (let k = 1; k <= n; k++) {
    const parts = lift.filter((i) => owner(c[i][1]) === k);
    let profile: [number, number][];
    if (sequential) {
      // segment s moves stage n - s + 1 (carriage first) and everything above it by `travel`
      profile = [[0, 0]];
      let total = 0;
      for (let s = 1; s <= n; s++) {
        total += k >= n - s + 1 ? travel : 0;
        profile.push([s * travel, total]);
      }
    } else profile = [[0, 0], [travel, (k / n) * travel]];
    groups.push({ name: k === n ? 'carriage' : `stage ${k}`, parts, joint: { type: 'slide', dir: [0, 0, 1], ratio: 1, profile } });
  }
  return { lift: sequential ? 'continuous' : 'cascade', out: { unit: 'in', min: 0, max: sequential ? travel * n : travel }, groups, notes };
}

const rules: Record<string, Rule> = {
  // Nested channels at y = -1.3 (base), -2.2, -3.1 and -3.9 (carriage).
  cascade: (asm) => stages(asm, [-1.3, -2.2, -3.1, -3.9], 6, false, 'out = the carriage rise (in), 0..6; stage k rises k/3 of it.'),
  // Channels at y = 1.2 (base), 2.2, 3.2, 4.2 and 5.2 (carriage).
  continuous: (asm) => stages(asm, [1.2, 2.2, 3.2, 4.2, 5.2], 5, true, 'Stages rise in turn, carriage first; each segment of 5 in of out is one stage.'),
  // The LCI 7481 two-bar: a channel arm hangs from the 84T gear that its 12T pinion turns. The arm, the
  // gear and the hardware on its shaft turn together about the gear's axle; out > 0 swings the arm up and forward.
  twobar(asm) {
    const c = centers(asm);
    const gear = asm.parts.findIndex((p) => p.part === 'gear-84');
    const pivot = [c[gear][1], c[gear][2]] as [number, number];
    const near = (i: number) => Math.hypot(c[i][1] - pivot[0], c[i][2] - pivot[1]) <= 1.2;
    const arm = asm.parts.map((_, i) => i).filter((i) => {
      const n = asm.parts[i].part;
      if (n === 'c-channel-1x2x1') return Math.abs(asm.parts[i].xf!.r[8]) > 0.9; // the hanging arm, not the support beam
      return i === gear || (/^(shaft|collar|spacer|screw|nut)/.test(n) && near(i));
    });
    return { lift: 'arm', out: { unit: 'deg', min: 0, max: 120 }, groups: [{ name: 'arm', parts: arm, joint: { type: 'revolute', pivot, ratio: 1 } }], notes: 'Arm hangs down at rest (out 0); out > 0 swings it forward and up.' };
  },
  // The Team A four-bar: posts and two meshing 84T gears at y = 4.4 (z = 15 and 11.5) carry two
  // arms that run back (-y) to a coupler at y = -8.6. The arms turn about the gears; the coupler
  // translates with the top arm's end and stays level.
  fourbar(asm) {
    const c = centers(asm);
    const top = [4.4, 15] as [number, number];
    const bottom = [4.4, 11.5] as [number, number];
    const end = [-8.6, 15] as [number, number];
    const arm = (belongs: (z: number) => boolean) => asm.parts.map((_, i) => i).filter((i) => c[i][1] > -7.4 && c[i][1] < 3.5 && c[i][2] >= 10 && belongs(c[i][2]));
    const groups: MotionGroup[] = [
      { name: 'top arm', parts: arm((z) => Math.abs(z - 15) <= Math.abs(z - 11.5)), joint: { type: 'revolute', pivot: top, ratio: -1 } },
      { name: 'bottom arm', parts: arm((z) => Math.abs(z - 15) > Math.abs(z - 11.5)), joint: { type: 'revolute', pivot: bottom, ratio: -1 } },
      { name: 'coupler', parts: asm.parts.map((_, i) => i).filter((i) => c[i][1] <= -7.4), joint: { type: 'couple', pivot: top, track: end, ratio: -1 } },
    ];
    return { lift: 'fourbar', out: { unit: 'deg', min: -20, max: 60 }, groups, notes: 'Arms pivot at the 84T gears (y 4.4); out > 0 raises the coupler. Rest pose is the CAD pose (arms level).' };
  },
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(rules);
for (const name of names) {
  const rule = rules[name];
  if (!rule) throw new Error(`no rule for "${name}" (have: ${Object.keys(rules).join(', ')})`);
  const file = path.join(repoRoot, `data/builds/${name}.fixed.build.json`);
  const asm = JSON.parse(await readFile(file, 'utf8')) as Assembly;
  const spec: MotionSpec = { v: 1, ...rule(asm) };
  await writeFile(path.join(repoRoot, `data/builds/${name}.motion.json`), JSON.stringify(spec));
  console.log(`${name}: ${spec.groups.map((g) => `${g.name} ${g.parts.length}`).join(', ')}`);
}
