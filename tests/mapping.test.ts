// Auton mapping: coordinates, measurements, field elements, and shareable plans.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import {
  clampToField, decodePlan, encodePlan, measure, nearestPoi, normHeading, pointsOfInterest, segments, snap, turnBetween, validatePlan, type MapPlan,
} from '../src/app/mapping.ts';
import type { FieldDef } from '../src/sim/field.ts';

const field = async (id = 'override') => JSON.parse(await readFile(path.join(repoRoot, `data/fields/${id}.json`), 'utf8')) as FieldDef;

describe('measuring on the field', () => {
  it('headings are clockwise from +y (the far wall), in [0, 360)', () => {
    expect(measure({ x: 0, y: 0 }, { x: 0, y: 10 }).heading).toBeCloseTo(0);
    expect(measure({ x: 0, y: 0 }, { x: 10, y: 0 }).heading).toBeCloseTo(90);
    expect(measure({ x: 0, y: 0 }, { x: 0, y: -10 }).heading).toBeCloseTo(180);
    expect(measure({ x: 0, y: 0 }, { x: -10, y: 0 }).heading).toBeCloseTo(270);
    expect(measure({ x: 0, y: 0 }, { x: -1e-12, y: 10 }).heading).toBe(0); // never 360
    expect(measure({ x: 1, y: 2 }, { x: 4, y: 6 }).dist).toBeCloseTo(5);
    expect(normHeading(-90)).toBe(270);
    expect(normHeading(720)).toBe(0);
  });

  it('the shortest turn: right is positive, left negative', () => {
    expect(turnBetween(0, 90)).toBe(90);
    expect(turnBetween(90, 0)).toBe(-90);
    expect(turnBetween(350, 10)).toBeCloseTo(20);
    expect(turnBetween(10, 350)).toBeCloseTo(-20);
    expect(turnBetween(0, 180)).toBe(180);
  });

  it('snapping and keeping points on the field', async () => {
    expect(snap(12.3, 0.5)).toBe(12.5);
    expect(snap(-12.3, 6)).toBe(-12);
    expect(snap(1.234, 0)).toBe(1.234);
    const half = (await field()).perimeter.inside / 2;
    expect(clampToField({ x: 100, y: -100 }, await field())).toEqual({ x: half, y: -half });
  });

  it('a route: distance and heading per segment, and the turn at each point', () => {
    const s = segments([{ id: 'a', x: 0, y: 0, heading: 90 }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 10, y: 10 }]);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ dist: 10, turn: 0 });
    expect(s[0].heading).toBeCloseTo(90);
    expect(s[1].dist).toBeCloseTo(10);
    expect(s[1].turn).toBeCloseTo(-90); // arrived facing 90, now 0: a left turn
    expect(segments([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 5 }])[0].turn).toBeNull();
  });
});

describe('field elements', () => {
  it('Override: Goals, Toggles with their ends, Loader openings, stacks, Pins and the starts of the layout', async () => {
    const f = await field();
    const h2h = pointsOfInterest(f, 'h2h');
    const count = (k: string) => h2h.filter((p) => p.kind === k).length;
    expect(count('goal')).toBe(9);
    expect(count('toggle')).toBe(12);
    expect(count('loader')).toBe(4);
    expect(count('start')).toBe(8);
    expect(count('stack') + count('pin')).toBe(f.layouts!.h2h.items.filter((i) => i.type !== 'goal').length);
    const r1 = h2h.find((p) => p.id === 'goal:R1')!;
    expect(r1).toMatchObject({ x: -47.091, y: -23.547 });
    // R1 to N_R1: straight up the field
    const n = h2h.find((p) => p.id === 'goal:N_R1')!;
    expect(measure(r1, n).dist).toBeCloseTo(47.094, 2);
    expect(measure(r1, n).heading).toBeCloseTo(0);
    expect(pointsOfInterest(f, 'skills').filter((p) => p.kind === 'start')).toHaveLength(2);
    expect(nearestPoi({ x: -46, y: -24 }, h2h, 3)?.id).toBe('goal:R1');
    expect(nearestPoi({ x: -35, y: -35 }, h2h, 1)).toBeNull();
  });

  it('the empty field has nothing to measure to', async () => {
    expect(pointsOfInterest(await field('generic-12ft'), 'h2h')).toEqual([]);
  });
});

describe('plans', () => {
  const plan: MapPlan = {
    v: 1,
    name: 'Red 1 three-stack',
    field: 'override',
    layout: 'h2h',
    created: 1790000000000,
    points: [
      { id: 'p1', x: -60.705, y: -37, heading: 90, label: 'start' },
      { id: 'p2', x: -47.09, y: -33.5 },
      { id: 'p3', x: -47.09, y: -47.09, label: 'stack' },
    ],
  };

  it('a link round-trips the plan (to 0.1 in)', () => {
    const back = decodePlan(encodePlan(plan));
    expect(back.name).toBe(plan.name);
    expect(back.field).toBe('override');
    expect(back.points).toHaveLength(3);
    expect(back.points[0]).toMatchObject({ x: -60.7, y: -37, heading: 90, label: 'start' });
    expect(back.points[1]).toEqual({ id: 'p2', x: -47.1, y: -33.5 });
    expect(back.points[2].label).toBe('stack');
  });

  it('links stay short: 60 points fit in under 2 KB', () => {
    const many = { ...plan, points: Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, x: -70 + i * 2.3, y: 50 - i * 1.7 })) };
    const text = encodePlan(many);
    expect(text.length).toBeLessThan(2000);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/); // safe in a URL
  });

  it('a broken or tampered link gives a readable error', () => {
    expect(() => decodePlan('not-a-plan')).toThrow(/readable plan/);
    const text = encodePlan(plan);
    expect(() => decodePlan(text.slice(0, text.length / 2))).toThrow(/readable plan/);
  });

  it('validation', () => {
    expect(validatePlan(plan)).toEqual([]);
    expect(validatePlan({ ...plan, v: 2 })).toContain('Unknown plan version 2.');
    expect(validatePlan({ ...plan, points: [{ id: 'x', x: NaN, y: 0 }] }).join()).toMatch(/Point 1/);
    expect(validatePlan({ ...plan, points: Array.from({ length: 201 }, (_, i) => ({ id: `${i}`, x: 0, y: 0 })) }).join()).toMatch(/Too many/);
    expect(validatePlan(null)).toEqual(['Not a plan.']);
  });
});
