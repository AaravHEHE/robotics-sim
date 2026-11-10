// Report the gear trains of a parts build: which gears mesh, which trains can turn (no odd
// loop), and which gears mesh with nothing.
//   node scripts/check-gears.ts data/builds/dr4b.build.json
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gearReport } from '../src/app/parts/gear-trains.ts';
import type { Assembly, Catalog } from '../src/app/parts/assembly.ts';
import { repoRoot } from './node-toolchain.ts';

const file = process.argv[2];
if (!file) throw new Error('usage: node scripts/check-gears.ts <build.json>');
const asm = JSON.parse(await readFile(file, 'utf8')) as Assembly;
const cat = JSON.parse(await readFile(path.join(repoRoot, 'data/parts/vex-parts.json'), 'utf8')) as Catalog;
const r = gearReport(asm, cat);
const name = (i: number) => `${asm.parts[i].part}#${i}`;
console.log(`${r.gears.length} gears, ${r.meshes.length} meshes, ${r.trains.length} trains`);
for (const t of r.trains) console.log(`  ${t.free ? 'ok    ' : 'LOCKED'} ${t.members.length} gears: ${t.members.map(name).join(' - ')}`);
if (r.isolated.length) console.log(`gears that mesh with nothing: ${r.isolated.map(name).join(', ')}`);
process.exitCode = r.trains.some((t) => !t.free) ? 1 : 0;
