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
// also 3488A, jaden jones, Jason Star, Dinesh Lolla; part axes checked from their bounding boxes): two
// horizontal rollers, one above the other 3.3 in apart, each a shaft carrying two 1.625 in flex wheels
// 3.25 in apart across the robot, so the gap between wheels is about 1.65 in; the top roller is geared to
// a shaft chained to the bottom one, so they counter-rotate and pull the Pin through. The CAD files only
// hold the roller block; the pivot at its front and the stage it takes from come from the cascade build.
// Video: in the Cornfield stream QF 3-1 (about 6:35:30, 1080p overhead) 2360A's black robot with purple
// channel shows horizontal roller bars with white flex wheels across its middle and a Pin held at the
// front, which fits this layout; the overhead camera cannot show the pivot, so the range (to about 95
// degrees, the rollers horizontal to tilted up) is an estimate.
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
for (const up of [-1, 1]) {
  const z = CZ + up * HALF_STACK;
  moving.push(add('shaft', [CX, CY, z], X_AXIS, 12)); // 6 in across, through both side posts
  for (const side of [-1, 1]) moving.push(add('flex-1_625', [CX + side * HALF_GAP, CY, z], X_AXIS));
  moving.push(add('sprocket-15', [CX + 2.2, CY, z], X_AXIS)); // the chain between the two sprockets turns the rollers against each other
  for (const side of [-1, 1]) moving.push(add('collar', [CX + side * 2.5, CY, z], X_AXIS));
}
for (const side of [-1, 1]) {
  moving.push(add('angle-1x1', [CX + side * 3.0, CY, CZ], Z_AXIS, 10)); // side post
  moving.push(add('angle-1x1', [CX + side * 3.0, (CY + PIVOT_Y) / 2, CZ], Y_AXIS, 5)); // link to the pivot
}
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
  notes: 'out 0 = the CAD pose, rollers horizontal behind the stage holding the Pin; out 95 = pivoted up over the robot, Pin dropped. Estimate: see scripts/add-banshee.ts.',
};
await writeFile(path.join(repoRoot, 'data/builds/cascade.claw.motion.json'), JSON.stringify(spec));
console.log(`banshee claw: ${asm.parts.length - first} parts added (${moving.length} move), build now ${asm.parts.length} parts`);
