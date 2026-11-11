// Add a Banshee roller claw to the cascade build (data/builds/cascade.fixed.build.json) and write the
// claw's motion (data/builds/cascade.claw.motion.json).
//
//   node scripts/add-banshee.ts            (after scripts/reimport-builds.sh; safe to run twice)
//
// What a Banshee claw is (the cascade bots at Cornfield Clash, such as 2360A, run one): the flex-wheel
// intake feeds a Pin through the robot to the back, where it passes between two counter-rotating
// rollers; the roller pair then pivots up to drop the Pin.
//
// Layout read from public Onshape CADs of the claw ("Banshee Claw" in Caleb Hunter's "Vex Override",
// also 3488A, jaden jones, Jason Star, Dinesh Lolla): two vertical shafts 3.25 in apart, each carrying a
// 1.625 in flex wheel above and one below the Pin (3.3 in apart, so the gap between wheels is about
// 1.65 in), a sprocket on each shaft for the chain that turns both, the Pin held between the shafts. The
// CAD files only hold the roller block; the pivot at its front and the stage it takes from come from the
// cascade build. The video of the event is an overhead camera, too far to see the rollers, so the pivot
// range (to about 95 degrees, the rollers vertical to horizontal) is an estimate.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Assembly, Placed, Rot3 } from '../src/app/parts/assembly.ts';
import type { MotionSpec } from '../src/app/parts/build-motion.ts';
import { repoRoot } from './node-toolchain.ts';

const file = path.join(repoRoot, 'data/builds/cascade.fixed.build.json');
const asm = JSON.parse(await readFile(file, 'utf8')) as Assembly & { source?: Record<string, unknown> };
if (asm.source?.banshee) asm.parts.length = asm.source.banshee as number; // drop an earlier run's parts
const first = asm.parts.length;

const CX = 0.25; // the cascade's rear feed wheels are centred about here (x)
const PIVOT_Y = -12.0; // just behind the last feed wheel (y -10.8, radius 0.8)
const CY = -13.2; // the roller block, centred behind the pivot
const CZ = 6.7; // the height the Pin leaves the stage at
const HALF_GAP = 1.63; // shafts 3.25 in apart
const HALF_STACK = 1.65; // wheels 3.3 in apart

const X_AXIS: Rot3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]; // the part's length / axis along the robot x
const Z_AXIS: Rot3 = [0, 1, 0, 0, 0, 1, 1, 0, 0]; // along the robot z (vertical)
const Y_AXIS: Rot3 = [0, -1, 0, 1, 0, 0, 0, 0, 1]; // along the robot y

const add = (part: string, c: [number, number, number], r: Rot3, length?: number): number => {
  const p: Placed = { part, pos: [0, 0, 0], rot: [0, 0, 0], xf: { c, r } };
  if (length !== undefined) p.length = length;
  asm.parts.push(p);
  return asm.parts.length - 1;
};

const moving: number[] = [];
for (const side of [-1, 1]) {
  const x = CX + side * HALF_GAP;
  moving.push(add('shaft', [x, CY, CZ], Z_AXIS, 12)); // 6 in, through both frame angles
  for (const up of [-1, 1]) moving.push(add('flex-1_625', [x, CY, CZ + up * HALF_STACK], Z_AXIS));
  moving.push(add('sprocket-15', [x, CY, CZ], Z_AXIS)); // the chain between the two sprockets turns both rollers
  for (const up of [-1, 1]) moving.push(add('collar', [x, CY, CZ + up * 2.2], Z_AXIS));
  moving.push(add('angle-1x1', [CX + side * 3.0, CY, CZ], Z_AXIS, 10)); // side post
  moving.push(add('angle-1x1', [CX + side * 3.0, (CY + PIVOT_Y) / 2, CZ], Y_AXIS, 5)); // link to the pivot
}
for (const up of [-1, 1]) moving.push(add('angle-1x1', [CX, CY, CZ + up * 2.4], X_AXIS, 10)); // top and bottom frame
// the pivot the block hangs from: fixed to the robot, so it is not in the moving group
add('shaft', [CX, PIVOT_Y, CZ], X_AXIS, 12);
for (const side of [-1, 1]) add('collar', [CX + side * 3.4, PIVOT_Y, CZ], X_AXIS);

asm.source = { ...(asm.source ?? {}), banshee: first };
await writeFile(file, JSON.stringify(asm));

const spec: MotionSpec = {
  v: 1,
  lift: 'banshee',
  out: { unit: 'deg', min: 0, max: 95 },
  groups: [{ name: 'banshee roller block', parts: moving, joint: { type: 'revolute', pivot: [PIVOT_Y, CZ], ratio: -1 } }],
  notes: 'out 0 = the CAD pose, rollers vertical behind the stage holding the Pin; out 95 = pivoted up over the robot, Pin dropped. Estimate: see scripts/add-banshee.ts.',
};
await writeFile(path.join(repoRoot, 'data/builds/cascade.claw.motion.json'), JSON.stringify(spec));
console.log(`banshee claw: ${asm.parts.length - first} parts added (${moving.length} move), build now ${asm.parts.length} parts`);
