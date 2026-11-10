// Correct the logic errors in an imported CAD build and write data/builds/<name>.fixed.build.json
// (the imported build is left alone, so the 1:1 copy of the CAD stays available).
//
//   node scripts/fix-cad-logic.ts data/builds/dr4b.build.json            gear parity
//   node scripts/fix-cad-logic.ts data/builds/cascade.build.json --bridge=<json>   also an intake bridge
//
// Gear rule (chosen by the project owner): every gear train has an ODD number of gears. A train of
// two (or four, six) gears turns its output the opposite way to its input, so one idler is added at
// the end of each even train, meshing the last gear, in whichever direction around it is free.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { partSize, placement, type Assembly, type Catalog, type Placed } from '../src/app/parts/assembly.ts';
import { gearReport } from '../src/app/parts/gear-trains.ts';
import { repoRoot } from './node-toolchain.ts';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) throw new Error('usage: node scripts/fix-cad-logic.ts <build.json> [--bridge=<json of a Placed>]');
const asm = JSON.parse(await readFile(file, 'utf8')) as Assembly & { source?: Record<string, unknown> };
const cat = JSON.parse(await readFile(path.join(repoRoot, 'data/parts/vex-parts.json'), 'utf8')) as Catalog;
const def = (id: string) => cat.parts.find((d) => d.id === id)!;
const fixes: string[] = [];
type V3 = [number, number, number];

const boxOf = (p: Placed) => placement(def(p.part), p);
const overlaps = (a: { min: V3; max: V3 }, b: { min: V3; max: V3 }, pad = -0.05) => [0, 1, 2].every((i) => a.min[i] < b.max[i] + pad && b.min[i] < a.max[i] + pad);

/** One idler on the far side of a leaf gear (a gear meshing only one other), in a free direction. */
function addIdler(report: ReturnType<typeof gearReport>, train: number[]): string {
  const neighbors = (g: number) => report.meshes.filter(([a, b]) => a === g || b === g).map(([a, b]) => (a === g ? b : a));
  const leaves = train.filter((g) => neighbors(g).length === 1);
  const gi = (i: number) => report.gears.find((g) => g.index === i)!;
  for (const leafIdx of leaves) {
    const leaf = gi(leafIdx);
    const from = gi(neighbors(leafIdx)[0]);
    const ax = leaf.axis;
    // directions in the gear plane: continuing the line, then turning either way, then back around
    const d0 = [leaf.center[0] - from.center[0], leaf.center[1] - from.center[1], leaf.center[2] - from.center[2]];
    const al = d0[0] * ax[0] + d0[1] * ax[1] + d0[2] * ax[2];
    const line = [d0[0] - al * ax[0], d0[1] - al * ax[1], d0[2] - al * ax[2]];
    const len = Math.hypot(...line);
    const u = line.map((v) => v / len) as V3;
    const w: V3 = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]];
    const dist = (36 + leaf.teeth) / 48;
    for (const ang of [0, 20, -20, 40, -40, 60, -60, 80, -80, 100, -100, 120, -120, 140, -140, 160, -160, 180]) {
      const a = (ang * Math.PI) / 180;
      const dir = u.map((v, i) => v * Math.cos(a) + w[i] * Math.sin(a)) as V3;
      const c = leaf.center.map((v, i) => v + dir[i] * dist) as V3;
      const src = asm.parts[leafIdx];
      const idler: Placed = { part: 'gear-36', pos: [0, 0, 0], rot: [0, 0, 0], xf: { c, r: structuredClone(src.xf!.r) } };
      const shaft: Placed = { part: 'shaft', length: 6, pos: [0, 0, 0], rot: [0, 0, 0], xf: { c, r: structuredClone(src.xf!.r) } };
      const ib = boxOf(idler);
      const clash = ib.min[2] < 0.1 || asm.parts.some((p, i) => i !== leafIdx && i !== neighbors(leafIdx)[0] && overlaps(ib, boxOf(p)));
      if (clash) continue;
      asm.parts.push(idler, shaft);
      return `train of ${train.length} gears ending at ${asm.parts[leafIdx].part}#${leafIdx}: added a 36T idler at (${c.map((v) => v.toFixed(2)).join(', ')}) in`;
    }
  }
  return `train of ${train.length} gears (${train.map((i) => `${asm.parts[i].part}#${i}`).join(', ')}): no free spot for an idler, left as it is`;
}

const before = gearReport(asm, cat);
for (const t of before.trains) if (t.members.length % 2 === 0) fixes.push(addIdler(before, t.members));

// a part given on the command line (an intake bridge between two stages), placed as measured
const bridge = args.find((a) => a.startsWith('--bridge='))?.slice(9);
if (bridge) {
  const p = JSON.parse(bridge) as Placed & { note?: string };
  const note = p.note ?? 'bridge';
  delete p.note;
  const size = partSize(def(p.part), p);
  asm.parts.push(p);
  fixes.push(`${note}: ${p.part} ${size.map((v) => v.toFixed(2)).join(' x ')} in at (${p.xf!.c.map((v) => v.toFixed(2)).join(', ')})`);
}

const after = gearReport(asm, cat);
asm.source = { ...asm.source, fixes, fixedFrom: path.basename(file) };
const out = file.replace(/\.build\.json$/, '.fixed.build.json');
await writeFile(out, JSON.stringify(asm));
console.log(`${out}\n${fixes.map((f) => `  - ${f}`).join('\n') || '  nothing to fix'}`);
console.log(`gear trains: ${before.trains.map((t) => t.members.length).join(', ')}  ->  ${after.trains.map((t) => t.members.length).join(', ')}`);
if (after.isolated.length) console.log(`still meshing with nothing (left alone, they may sit on a shaft or chain): ${after.isolated.map((i) => `${asm.parts[i].part}#${i}`).join(', ')}`);
