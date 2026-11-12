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
// Video: 2360A's own "Early Season Robot Explanation" (YouTube QsyXX17kHh8, 2:07-2:24) shows the claw up close:
// a polycarbonate plate with a circle cut out, a flex-wheel roller above and one below the hole, one motor on the
// side, purple side posts. The Pin comes through the robot lying along it and through the hole; their "Matchloading"
// short (Bsow-D58j9g) shows the cascade lifting it lying flat, then the block swinging about its top edge so the Pin
// points down over the Goal and drops. The pivot range (0 to 90 degrees) is read from that; the hinge height is an
// estimate (the plate's top edge).
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
const PY = -11.9; // the polycarbonate plate, just behind the last feed wheel (y -10.8, radius 0.8)
const CY = -12.5; // the rollers, just behind the plate
const CZ = 6.7; // the height the Pin leaves the stage at: the middle of the plate's hole
const HINGE_Z = CZ + 3.2; // the block hangs from a hinge along the plate's top edge
const HALF_GAP = 1.63; // the two flex wheels on each roller, 3.25 in apart
const HALF_STACK = 1.65; // rollers 3.3 in apart, one above and one below the hole
const HOLE = 1.6; // half the hole's width (2360A: "a circle cut out", about 3 in)
const HALF_PLATE = 3.0; // a 6 in square plate

const X_AXIS: Rot3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]; // the part's length / axis along the robot x
const Z_AXIS: Rot3 = [0, 1, 0, 0, 0, 1, 1, 0, 0]; // along the robot z (vertical)
const XZ_PLATE: Rot3 = [1, 0, 0, 0, 0, -1, 0, 1, 0]; // a sheet standing across the robot (its face toward -y)

const add = (part: string, c: [number, number, number], r: Rot3, length?: number, size?: [number, number, number]): number => {
  const p: Placed = { part, pos: [0, 0, 0], rot: [0, 0, 0], xf: { c, r } };
  if (length !== undefined) p.length = length;
  if (size) p.size = size;
  asm.parts.push(p);
  return asm.parts.length - 1;
};

const moving: number[] = [];
// the plate, as four strips round the square that stands in for its round hole
const T = 0.06;
const band = HALF_PLATE - HOLE;
moving.push(add('polycarbonate', [CX, PY, CZ + HOLE + band / 2], XZ_PLATE, undefined, [2 * HALF_PLATE, band, T]));
moving.push(add('polycarbonate', [CX, PY, CZ - HOLE - band / 2], XZ_PLATE, undefined, [2 * HALF_PLATE, band, T]));
for (const side of [-1, 1]) moving.push(add('polycarbonate', [CX + side * (HOLE + band / 2), PY, CZ], XZ_PLATE, undefined, [band, 2 * HOLE, T]));
for (const up of [-1, 1]) {
  const z = CZ + up * HALF_STACK;
  moving.push(add('shaft', [CX, CY, z], X_AXIS, 12)); // 6 in across, through both side posts
  for (const side of [-1, 1]) moving.push(add('flex-1_625', [CX + side * HALF_GAP, CY, z], X_AXIS));
  moving.push(add('sprocket-15', [CX + 2.2, CY, z], X_AXIS)); // the chain between the two sprockets turns the rollers against each other
  for (const side of [-1, 1]) moving.push(add('collar', [CX + side * 2.5, CY, z], X_AXIS));
}
for (const side of [-1, 1]) moving.push(add('angle-1x1', [CX + side * 3.0, CY, CZ], Z_AXIS, 12)); // purple side posts
// one motor on the side drives the top roller (2360A: "the motor could hold it")
moving.push(add('v5-motor', [CX - 4.3, CY, CZ + HALF_STACK], X_AXIS));
// the hinge the block hangs from: fixed to the robot, so it is not in the moving group
add('shaft', [CX, PY, HINGE_Z], X_AXIS, 14);
for (const side of [-1, 1]) add('collar', [CX + side * 3.4, PY, HINGE_Z], X_AXIS);

asm.source = { ...(asm.source ?? {}), banshee: first };
await writeFile(file, JSON.stringify(asm));

const spec: MotionSpec = {
  v: 1,
  lift: 'banshee',
  out: { unit: 'deg', min: 0, max: 90 },
  groups: [{ name: 'banshee roller block', parts: moving, joint: { type: 'revolute', pivot: [PY, HINGE_Z], ratio: -1 } }],
  notes: 'out 0 = rollers behind the stage, the Pin lying through the hole along the robot; out 90 = the block swung back and up about its top hinge, the Pin pointing down to drop onto a Goal (2360A explanation video and Matchloading short).',
};
await writeFile(path.join(repoRoot, 'data/builds/cascade.claw.motion.json'), JSON.stringify(spec));
console.log(`banshee claw: ${asm.parts.length - first} parts added (${moving.length} move), build now ${asm.parts.length} parts`);
