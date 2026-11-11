// Moving the CAD builds with their lifts (src/app/parts/build-motion.ts, specs in
// data/builds/*.motion.json made by scripts/gen-motion.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Assembly } from '../src/app/parts/assembly.ts';
import { poseBuild, profileAt, turnYZ, validateMotion, type MotionSpec } from '../src/app/parts/build-motion.ts';

const asm = (n: string) => JSON.parse(readFileSync(`data/builds/${n}.fixed.build.json`, 'utf8')) as Assembly;
const spec = (n: string) => JSON.parse(readFileSync(`data/builds/${n}.motion.json`, 'utf8')) as MotionSpec;
const group = (s: MotionSpec, name: string) => s.groups.find((g) => g.name === name)!;
const center = (a: Assembly, i: number) => a.parts[i].xf!.c;

describe.each(['fourbar', 'twobar', 'cascade', 'continuous', 'dr4b'])('%s motion', (name) => {
  it('is a valid spec for its build', () => {
    expect(validateMotion(spec(name), asm(name))).toEqual([]);
  });

  it('leaves the build as the CAD has it at rest, and does not change its input', () => {
    const a = asm(name);
    const s = spec(name);
    const before = JSON.stringify(a);
    expect(poseBuild(a, s, 0).parts.map((p) => p.xf!.c.map((v) => Math.round(v * 1e6) / 1e6))).toEqual(
      a.parts.map((p) => p.xf!.c.map((v) => Math.round(v * 1e6) / 1e6)),
    );
    poseBuild(a, s, s.out.max);
    expect(JSON.stringify(a)).toBe(before);
  });

  it('moves something when the lift moves, and keeps every part finite', () => {
    const a = asm(name);
    const s = spec(name);
    const up = poseBuild(a, s, s.out.max);
    expect(up.parts.some((p, i) => p.xf!.c.some((v, k) => Math.abs(v - center(a, i)[k]) > 0.5))).toBe(true);
    for (const p of up.parts) expect([...p.xf!.c, ...p.xf!.r].every(Number.isFinite)).toBe(true);
  });
});

describe('four-bar', () => {
  const a = asm('fourbar');
  const s = spec('fourbar');

  it('turns each arm about its pivot by the lift angle (moving the arm end up)', () => {
    const out = 30;
    const up = poseBuild(a, s, out);
    const i = group(s, 'top arm').parts[0];
    const [y, z] = turnYZ(center(a, i)[1], center(a, i)[2], 4.4, 15, -out);
    expect(center(up, i)[1]).toBeCloseTo(y, 6);
    expect(center(up, i)[2]).toBeCloseTo(z, 6);
  });

  it('keeps the coupler level: it translates, it does not turn', () => {
    const up = poseBuild(a, s, 40);
    for (const i of group(s, 'coupler').parts) expect(up.parts[i].xf!.r).toEqual(a.parts[i].xf!.r);
    // and it moves as the end of the arm does (a four-bar's coupler travels on a circle the arm's size)
    const i = group(s, 'coupler').parts[0];
    const [ty, tz] = turnYZ(-8.6, 15, 4.4, 15, -40);
    expect(center(up, i)[1] - center(a, i)[1]).toBeCloseTo(ty + 8.6, 6);
    expect(center(up, i)[2] - center(a, i)[2]).toBeCloseTo(tz - 15, 6);
  });
});

describe('slide lifts', () => {
  it('a cascade carries each stage k/n of the carriage rise', () => {
    const a = asm('cascade');
    const s = spec('cascade');
    const up = poseBuild(a, s, 6);
    const n = s.groups.length;
    s.groups.forEach((g, idx) => {
      const k = idx + 1;
      for (const i of g.parts) expect(center(up, i)[2] - center(a, i)[2]).toBeCloseTo((k / n) * 6, 6);
    });
  });

  it('a continuous lift raises one stage at a time, the carriage first', () => {
    const a = asm('continuous');
    const s = spec('continuous');
    const carriage = group(s, 'carriage').parts[0];
    const stage1 = group(s, 'stage 1').parts[0];
    const first = poseBuild(a, s, 5); // one segment: only the carriage has moved
    expect(center(first, carriage)[2] - center(a, carriage)[2]).toBeCloseTo(5, 6);
    expect(center(first, stage1)[2] - center(a, stage1)[2]).toBeCloseTo(0, 6);
    const full = poseBuild(a, s, s.out.max);
    expect(center(full, carriage)[2] - center(a, carriage)[2]).toBeCloseTo(20, 6);
    expect(center(full, stage1)[2] - center(a, stage1)[2]).toBeCloseTo(5, 6);
  });

  it('profileAt interpolates and clamps', () => {
    expect(profileAt([[0, 0], [10, 4]], 5)).toBe(2);
    expect(profileAt([[0, 0], [10, 4]], 20)).toBe(4);
    expect(profileAt([[0, 0], [10, 4]], -3)).toBe(0);
  });
});

describe('DR4B', () => {
  const a = asm('dr4b');
  const s = spec('dr4b');
  const links = s.groups.filter((g) => g.name.startsWith('link'));

  it('has eight links, each turning about its rear end by the lift output', () => {
    expect(links.length).toBe(8);
    const up = poseBuild(a, s, 20);
    for (const g of links) {
      const j = g.joint as Extract<typeof g.joint, { type: 'revolute' }>;
      const i = g.parts[0];
      const [y, z] = turnYZ(center(a, i)[1], center(a, i)[2], j.pivot[0], j.pivot[1], -20);
      expect(center(up, i)[1]).toBeCloseTo(y, 6);
      expect(center(up, i)[2]).toBeCloseTo(z, 6);
    }
  });

  it('keeps the mid platform and the carriage level, each riding the front end of its link set', () => {
    const up = poseBuild(a, s, 20);
    for (const name of ['mid platform', 'carriage']) {
      const g = group(s, name);
      for (const i of g.parts) expect(up.parts[i].xf!.r).toEqual(a.parts[i].xf!.r);
      expect(g.parts.length).toBeGreaterThan(3);
    }
    // the platform rises with the lower set, which flattens: it goes up
    const platform = group(s, 'mid platform').parts[0];
    expect(center(up, platform)[2]).toBeGreaterThan(center(a, platform)[2]);
  });
});
