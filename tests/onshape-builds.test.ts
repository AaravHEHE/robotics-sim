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
  ['dr6b', 43],
  ['sixbar', 171],
  ['fourbar', 127],
  ['twobar', 19],
  ['continuous', 306],
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
    expect(r.gears.length).toBeGreaterThanOrEqual(2);
    expect(r.trains.filter((t) => !t.free)).toEqual([]);
  });
});

// The corrected builds (scripts/fix-cad-logic.ts): every gear train has an odd number of gears and can
// turn; the cascade's intake has a bridge between its two stages.
describe.each(['cascade', 'dr4b', 'dr6b', 'sixbar', 'fourbar', 'twobar', 'continuous'])('%s build after the logic fixes', (name) => {
  const asm = JSON.parse(readFileSync(`data/builds/${name}.fixed.build.json`, 'utf8')) as Assembly;

  it('is valid and keeps every imported part', () => {
    expect(validateAssembly(asm, cat)).toEqual([]);
    expect(asm.parts.length).toBeGreaterThanOrEqual(load(name).parts.length);
  });

  it('has only odd gear trains, and each can turn', () => {
    const r = gearReport(asm, cat);
    expect(r.trains.filter((t) => !t.free)).toEqual([]);
    expect(r.trains.filter((t) => t.members.length % 2 === 0)).toEqual([]);
  });
});

it('the cascade intake bridge spans the gap between the side ramps and the second stage', () => {
  const asm = JSON.parse(readFileSync('data/builds/cascade.fixed.build.json', 'utf8')) as Assembly;
  const bridge = asm.parts.find((p) => p.part === 'custom-box' && p.size?.[2] === 0.12)!; // the claw's parts (scripts/add-banshee.ts) come after it
  expect(bridge.part).toBe('custom-box');
  const b = bounds({ v: 1, parts: [bridge] }, cat)!;
  // CAD y 1.0 .. -7.6 (the robot's origin is 3.69 in off the CAD's y), rising toward the back
  expect(b.max[1]).toBeGreaterThan(-3.69 + 0.5);
  expect(b.min[1]).toBeLessThan(-7.6 + 3.69 + 0.5);
});

// CAD parts with no catalog match keep their own shape (scripts/onshape/gltf-extract.py writes the triangles,
// the importer keeps them in the build's `meshes`).
describe('custom meshes', () => {
  it('the piston claw build has curved finger meshes, and every mesh part has its triangles', () => {
    const claw = load('claw-piston');
    expect(validateAssembly(claw, cat)).toEqual([]);
    const meshParts = claw.parts.filter((p) => p.part === 'custom-mesh');
    expect(meshParts.length).toBe(4);
    for (const p of meshParts) {
      const m = claw.meshes![p.mesh!];
      expect(m.i.length / 3).toBeGreaterThan(100);
      expect(p.size!.every((v) => v > 0)).toBe(true);
    }
    expect(claw.parts.some((p) => p.part === 'piston-25')).toBe(true); // the 25 mm cylinder
  });

  it('leaves the game Cup out of the claw (it is a field object)', () => {
    expect(JSON.stringify(load('claw-piston'))).not.toMatch(/9250/);
  });

  it('the DR4B and cascade bodies draw their custom parts from meshes', () => {
    for (const n of ['dr4b', 'cascade']) {
      const a = JSON.parse(readFileSync(`data/builds/${n}.fixed.build.json`, 'utf8')) as Assembly;
      expect(validateAssembly(a, cat)).toEqual([]);
      expect(a.parts.filter((p) => p.part === 'custom-mesh').length).toBeGreaterThan(2);
    }
  });

  it('rejects a mesh part whose mesh is missing, or a mesh with a bad triangle', () => {
    const claw = JSON.parse(JSON.stringify(load('claw-piston'))) as Assembly;
    const key = claw.parts.find((p) => p.part === 'custom-mesh')!.mesh!;
    claw.meshes![key].i[0] = 1e9;
    expect(validateAssembly(claw, cat).join(' ')).toMatch(/not valid triangles/);
    delete claw.meshes![key];
    expect(validateAssembly(claw, cat).join(' ')).toMatch(/needs its mesh/);
  });
});
