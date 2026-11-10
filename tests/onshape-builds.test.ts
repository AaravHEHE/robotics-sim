// The two CAD recreations (data/builds/*.build.json, made by scripts/import-onshape.ts from
// Onshape assemblies) are valid parts builds, sit on the floor inside a sensible box, and
// have no gear train that cannot turn.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bounds, validateAssembly, type Assembly, type Catalog } from '../src/app/parts/assembly.ts';
import { gearReport } from '../src/app/parts/gear-trains.ts';

const cat = JSON.parse(readFileSync('data/parts/vex-parts.json', 'utf8')) as Catalog;
const load = (n: string) => JSON.parse(readFileSync(`data/builds/${n}.build.json`, 'utf8')) as Assembly;

describe.each([
  ['cascade', 329],
  ['dr4b', 247],
])('%s build from Onshape', (name, parts) => {
  const asm = load(name);

  it('is a valid build with every part in the catalog', () => {
    expect(validateAssembly(asm, cat)).toEqual([]);
    expect(asm.parts.length).toBe(parts);
  });

  it('stands on the floor and fits a sensible box', () => {
    const b = bounds(asm, cat)!;
    expect(b.min[2]).toBeGreaterThan(-0.6); // wheels' bottoms at z = 0
    expect(b.min[2]).toBeLessThan(0.6);
    expect(b.max[0] - b.min[0]).toBeLessThan(30);
    expect(b.max[1] - b.min[1]).toBeLessThan(30);
    expect(b.max[2] - b.min[2]).toBeLessThan(50); // the 50 in height limit
  });

  it('has no gear train that cannot turn (an odd loop of meshing gears)', () => {
    const r = gearReport(asm, cat);
    expect(r.gears.length).toBeGreaterThan(5);
    expect(r.trains.filter((t) => !t.free)).toEqual([]);
  });
});
