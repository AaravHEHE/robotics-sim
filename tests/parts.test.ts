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
