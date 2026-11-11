// Mount the piston claw CAD (data/builds/claw-piston.build.json, a public Onshape claw with a 25 mm cylinder
// between two finger tails) on the 4-bar and the 6-bar, and write each claw's motion.
//
//   node scripts/gen-motion.ts fourbar sixbar     (the lift motion first)
//   node scripts/add-claws.ts                     (safe to run twice)
//
// The claw is mounted behind the coupler (the rear piston claw the presets describe), fingers toward the
// robot's back. Its parts are added to the build and to the coupler's group, so they ride with the lift;
// the claw's own motion (data/builds/<name>.claw.motion.json) opens the fingers about their hinge screws
// and slides the cylinder, as scripts/gen-motion.ts does for the DR4B's lobster claw: the CAD pose is closed
// (cylinder extended), out = degrees open, 0 to 22 (25 mm stroke over a 1.22 in lever arm).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Assembly, Placed } from '../src/app/parts/assembly.ts';
import type { MotionGroup, MotionSpec } from '../src/app/parts/build-motion.ts';
import { repoRoot } from './node-toolchain.ts';

const read = async <T>(f: string) => JSON.parse(await readFile(path.join(repoRoot, f), 'utf8')) as T;
const claw = await read<Assembly>('data/builds/claw-piston.build.json');
const ctr = claw.parts[30].xf!.c; // the 7 in channel everything hangs from
const HINGE_L: [number, number] = [-1.22, -0.06]; // screws 1 and 18 of the CAD
const HINGE_R: [number, number] = [1.8, -0.06];
const TAIL_L: [number, number] = [-2.44, 0.5]; // screws 5 and 22: where the cylinder pulls the tails
const TAIL_R: [number, number] = [2.99, 0.5];
const STROKE = 0.49;

type Mount = { name: string; group: string; at: (asm: Assembly, group: number[]) => [number, number, number] };
const mounts: Mount[] = [
  {
    name: 'fourbar',
    group: 'coupler',
    // behind the coupler bar, halfway up it
    at: (asm, g) => {
      const c = g.map((i) => asm.parts[i].xf!.c);
      return [c.reduce((s, v) => s + v[0], 0) / c.length, Math.min(...c.map((v) => v[1])) - 1.4, (Math.min(...c.map((v) => v[2])) + Math.max(...c.map((v) => v[2]))) / 2];
    },
  },
  { name: 'sixbar', group: 'coupler', at: (asm, g) => mounts[0].at(asm, g) },
];

for (const m of mounts) {
  const bf = path.join(repoRoot, `data/builds/${m.name}.fixed.build.json`);
  const mf = path.join(repoRoot, `data/builds/${m.name}.motion.json`);
  const asm = JSON.parse(await readFile(bf, 'utf8')) as Assembly & { source?: Record<string, unknown> };
  const lift = JSON.parse(await readFile(mf, 'utf8')) as MotionSpec;
  const prev = (asm.source?.claw as number | undefined) ?? asm.parts.length;
  asm.parts.length = prev; // drop an earlier run's claw
  for (const g of lift.groups) g.parts = g.parts.filter((i) => i < prev);
  const carrier = lift.groups.find((g) => g.name === m.group)!;
  const [mx, my, mz] = m.at(asm, carrier.parts);
  const first = asm.parts.length;
  const d: [number, number, number] = [mx - ctr[0], my - ctr[1], mz - ctr[2]];
  for (const p of claw.parts) {
    const q = structuredClone(p) as Placed;
    q.xf = { c: [p.xf!.c[0] + d[0], p.xf!.c[1] + d[1], p.xf!.c[2] + d[2]], r: p.xf!.r };
    asm.parts.push(q);
  }
  if (claw.meshes) asm.meshes = { ...(asm.meshes ?? {}), ...claw.meshes };
  const at = (i: number) => first + i;
  const near = (i: number, pt: [number, number]) => Math.hypot(claw.parts[i].xf!.c[0] - pt[0], claw.parts[i].xf!.c[1] - pt[1]) < 0.5;
  const skip = /^(c-channel|piston|custom-box)/;
  const idx = claw.parts.map((_, i) => i);
  const left = idx.filter((i) => !skip.test(claw.parts[i].part) && (claw.parts[i].part === 'custom-mesh' ? claw.parts[i].xf!.c[0] < 0 : near(i, TAIL_L)));
  const right = idx.filter((i) => !skip.test(claw.parts[i].part) && (claw.parts[i].part === 'custom-mesh' ? claw.parts[i].xf!.c[0] > 0 : near(i, TAIL_R)));
  const body = idx.filter((i) => claw.parts[i].part === 'piston-25' && claw.parts[i].xf!.c[0] > 0);
  const rod = idx.filter((i) => claw.parts[i].part === 'piston-25' && claw.parts[i].xf!.c[0] <= 0);
  const hl: [number, number] = [HINGE_L[0] + d[0] - ctr[0] + ctr[0], HINGE_L[1] + d[1]];
  const hr: [number, number] = [HINGE_R[0] + d[0], HINGE_R[1] + d[1]];
  void TAIL_L;
  const groups: MotionGroup[] = [
    { name: 'left finger', parts: left.map(at), joint: { type: 'yaw', pivot: hl, ratio: -1 } },
    { name: 'right finger', parts: right.map(at), joint: { type: 'yaw', pivot: hr, ratio: 1 } },
    { name: 'cylinder body', parts: body.map(at), joint: { type: 'slide', dir: [1, 0, 0], ratio: 1, profile: [[0, 0], [22, -STROKE]] } },
    { name: 'cylinder rod', parts: rod.map(at), joint: { type: 'slide', dir: [1, 0, 0], ratio: 1, profile: [[0, 0], [22, STROKE]] } },
  ];
  const spec: MotionSpec = { v: 1, lift: 'claw', out: { unit: 'deg', min: 0, max: 22 }, groups, notes: 'out = degrees open (0 = the CAD pose, closed). Piston claw CAD (claw-piston) mounted behind the coupler by scripts/add-claws.ts.' };
  carrier.parts.push(...claw.parts.map((_, i) => at(i)));
  asm.source = { ...(asm.source ?? {}), claw: first };
  await writeFile(bf, JSON.stringify(asm));
  await writeFile(mf, JSON.stringify(lift));
  await writeFile(path.join(repoRoot, `data/builds/${m.name}.claw.motion.json`), JSON.stringify(spec));
  console.log(`${m.name}: claw mounted at ${[mx, my, mz].map((v) => v.toFixed(1)).join(', ')} (${claw.parts.length} parts); fingers ${left.length}+${right.length}, cylinder ${body.length}+${rod.length}`);
}
