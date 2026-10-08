// The VEX parts kit: the parts data, grid placement, and what a build suggests for the profile.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { bounds, partSize, placement, rotation, suggestProfile, validateAssembly, type Assembly, type Catalog } from '../src/app/parts/assembly.ts';

const catalog = async () => JSON.parse(await readFile(path.join(repoRoot, 'data/parts/vex-parts.json'), 'utf8')) as Catalog;

describe('VEX parts data', () => {
  it('every part has a unique id, a name and positive dimensions', async () => {
    const cat = await catalog();
    expect(cat.pitch).toBe(0.5);
    expect(new Set(cat.parts.map((p) => p.id)).size).toBe(cat.parts.length);
    for (const d of cat.parts) {
      expect(d.name, d.id).toBeTruthy();
      const s = partSize(d, {});
      expect(s.every((v) => v > 0 && v < 30), `${d.id} ${s}`).toBe(true);
      if (d.lengths) expect(d.lengths).toContain(d.length);
    }
    // a 25-hole 1x2x1 C-channel: 12.5 in long, 1 in wide, 0.5 in flanges
    expect(partSize(cat.parts.find((d) => d.id === 'c-channel-1x2x1')!, { length: 25 })).toEqual([12.5, 1, 0.5]);
    // gear pitch diameter = teeth / 24 in
    expect(partSize(cat.parts.find((d) => d.id === 'gear-36')!, {})[1]).toBeCloseTo(36 / 24 + 1 / 12);
  });
});

describe('placing parts on the hole grid', () => {
  it('quarter turns are exact rotations', () => {
    expect(rotation([0, 0, 1])).toEqual([0, -1, 0, 1, 0, 0, 0, 0, 1]);
    expect(rotation([0, 0, 4])).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('a part sits with its lowest corner on its hole position, however it is turned', async () => {
    const cat = await catalog();
    const ch = cat.parts.find((d) => d.id === 'c-channel-1x2x1')!;
    const flat = placement(ch, { part: ch.id, length: 25, pos: [2, 4, 1], rot: [0, 0, 0] });
    expect(flat.min).toEqual([1, 2, 0.5]);
    expect(flat.max).toEqual([13.5, 3, 1]);
    // turned to run front to back
    const turned = placement(ch, { part: ch.id, length: 25, pos: [2, 4, 1], rot: [0, 0, 1] });
    expect(turned.min.map((v) => +v.toFixed(9))).toEqual([1, 2, 0.5]);
    expect(turned.max.map((v) => +v.toFixed(9))).toEqual([2, 14.5, 1]);
  });

  it('bounds and the profile it suggests: size, track width and wheels', async () => {
    const cat = await catalog();
    // two 25-hole rails 15 in apart (front to back), two crossbars, four 3.25 in wheels
    const asm: Assembly = {
      v: 1,
      parts: [
        { part: 'c-channel-1x2x1', length: 25, pos: [0, 0, 1], rot: [0, 0, 1] },
        { part: 'c-channel-1x2x1', length: 25, pos: [28, 0, 1], rot: [0, 0, 1] },
        { part: 'c-channel-1x2x1', length: 30, pos: [0, 0, 2], rot: [0, 0, 0] },
        { part: 'omni-3.25', pos: [-3, 2, 0], rot: [0, 0, 0] },
        { part: 'omni-3.25', pos: [-3, 16, 0], rot: [0, 0, 0] },
        { part: 'omni-3.25', pos: [30, 2, 0], rot: [0, 0, 0] },
        { part: 'omni-3.25', pos: [30, 16, 0], rot: [0, 0, 0] },
      ],
    };
    expect(validateAssembly(asm, cat)).toEqual([]);
    const b = bounds(asm, cat)!;
    expect(b.min[2]).toBe(0);
    const s = suggestProfile(asm, cat);
    expect(Math.abs(s.size!.width - (b.max[0] - b.min[0]))).toBeLessThanOrEqual(0.125); // to the nearest ¼ in
    expect(s.trackWidth).toBeCloseTo(16.5, 1); // wheel centers at -0.97 and 15.53
    expect(s.wheelDiameter).toBe(3.25);
  });

  it('rejects broken builds', async () => {
    const cat = await catalog();
    expect(validateAssembly({ v: 1, parts: [{ part: 'nope', pos: [0, 0, 0], rot: [0, 0, 0] }] }, cat).join()).toMatch(/unknown part/);
    expect(validateAssembly({ v: 1, parts: [{ part: 'shaft', pos: [0.5, 0, 0], rot: [0, 0, 0] }] }, cat).join()).toMatch(/whole hole/);
    expect(validateAssembly({ v: 2 }, cat)).toEqual(['Not a parts build.']);
  });
});

describe('every part in the catalog can be drawn', () => {
  it('builds a shape with meshes that fits its box', async () => {
    const THREE = await import('three');
    const { partShape } = await import('../src/app/parts/geometry.ts');
    const cat = await catalog();
    expect(cat.parts.length).toBeGreaterThan(120);
    for (const kind of ['pulley', 'sprocket', 'chain', 'rope', 'rack', 'band']) expect(cat.parts.some((d) => d.kind === kind), kind).toBe(true);
    for (const d of cat.parts) {
      const o = partShape(d, { length: d.length });
      let meshes = 0;
      o.traverse((m) => (meshes += (m as InstanceType<typeof THREE.Mesh>).isMesh ? 1 : 0));
      expect(meshes, d.id).toBeGreaterThan(0);
      o.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
      const want = partSize(d, { length: d.length });
      // within its box (rollers and teeth may poke out a little)
      expect(size.x, d.id).toBeLessThanOrEqual(want[0] + 0.5);
      expect(Math.max(size.y, size.z), d.id).toBeLessThanOrEqual(Math.max(want[1], want[2]) + 0.6);
      // small hardware is placed by its box, so it must fill exactly that box
      if (['screw', 'nut', 'washer', 'collar', 'spacer', 'bearing', 'gusset', 'standoff'].includes(d.kind)) {
        const b = new THREE.Box3().setFromObject(o);
        for (let i = 0; i < 3; i++) {
          expect(b.min.getComponent(i), `${d.id} min ${'xyz'[i]}`).toBeGreaterThanOrEqual(-0.03);
          expect(b.max.getComponent(i), `${d.id} max ${'xyz'[i]}`).toBeLessThanOrEqual(want[i] + 0.03);
          expect(b.max.getComponent(i) - b.min.getComponent(i), `${d.id} size ${'xyz'[i]}`).toBeGreaterThanOrEqual(want[i] * 0.85 - 0.03);
        }
      }
    }
  });

  it('has the hardware that holds a robot together', async () => {
    const cat = await catalog();
    for (const id of ['screw', 'screw-1', 'nut', 'nut-nylock', 'washer', 'washer-teflon', 'collar', 'collar-clamp', 'spacer-0.25', 'spacer-thin-032', 'bearing-flat', 'pillow-block', 'standoff-coupler', 'gusset-angle', 'l-bracket']) {
      expect(cat.parts.some((d) => d.id === id), id).toBe(true);
    }
    // 8-32 hardware: the nut is 11/32 in across the flats, a screw's shank is its length
    expect(partSize(cat.parts.find((d) => d.id === 'screw-1')!, {})[0]).toBeCloseTo(1.09, 6);
    expect(partSize(cat.parts.find((d) => d.id === 'nut')!, {})[1]).toBeCloseTo(0.344 / Math.cos(Math.PI / 6), 6);
  });
});
