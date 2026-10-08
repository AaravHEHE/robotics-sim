import { describe, expect, it } from 'vitest';
import { INCH, LB, motorSpec, resolveDynamics } from '../src/sim/dynamics-spec.ts';
import { validateProfile } from '../src/sim/profile.ts';
import { robot } from './helpers.ts';

describe('dynamics defaults', () => {
  it('fills in a robot that gives none', async () => {
    const p = await robot('override-banshee');
    const d = resolveDynamics(p);
    expect(d.mass).toBeCloseTo((p.mass ?? 12) * LB, 9);
    // a uniform box about its center
    expect(d.inertia).toBeCloseTo((d.mass * ((p.size.width * INCH) ** 2 + (p.size.length * INCH) ** 2)) / 12, 9);
    expect(d.com.z).toBeCloseTo(p.size.height * 0.3 * INCH, 9);
    expect(d.wheelsPerSide).toBe(3);
  });

  it('uses what a profile gives', async () => {
    const p = await robot('override-banshee');
    p.dynamics = { centerOfMass: { x: 1, y: -2, z: 4 }, inertia: 500, wheelFriction: 0.7, wheelsPerSide: 2, batteryResistance: 0.2 };
    const d = resolveDynamics(p);
    expect(d.com).toEqual({ x: 1 * INCH, y: -2 * INCH, z: 4 * INCH });
    expect(d.inertia).toBeCloseTo(500 * LB * INCH * INCH, 12);
    expect([d.wheelFriction, d.wheelsPerSide, d.batteryResistance]).toEqual([0.7, 2, 0.2]);
    expect(validateProfile(p)).toEqual([]);
  });

  it('rejects nonsense', async () => {
    const p = await robot('override-banshee');
    for (const bad of [{ wheelFriction: 9 }, { inertia: -1 }, { wheelsPerSide: 1.5 }, { centerOfMass: { z: 99 } }, { batteryResistance: 5 }]) {
      p.dynamics = bad;
      expect(validateProfile(p).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
    p.dynamics = undefined;
    p.mass = -3;
    expect(validateProfile(p).length).toBeGreaterThan(0);
  });

  it('V5 motors: torque and speed scale with the cartridge, at the 11 W rating', () => {
    for (const c of ['red', 'green', 'blue'] as const) {
      const m = motorSpec(c);
      // peak mechanical power of a linear torque-speed curve is stall torque x free speed / 4
      expect((m.stallTorque * m.freeSpeed) / 4).toBeGreaterThan(5);
      expect((m.stallTorque * m.freeSpeed) / 4).toBeLessThan(12);
    }
    expect(motorSpec('red').stallTorque).toBeGreaterThan(motorSpec('green').stallTorque);
    expect(motorSpec('green').freeSpeed).toBeGreaterThan(motorSpec('red').freeSpeed);
  });
});

describe('recorded dynamics', () => {
  it('one row per frame has a value for every column, and follows the robot', async () => {
    const { World } = await import('../src/sim/world.ts');
    const { DYN_COLUMNS } = await import('../src/sim/recording.ts');
    const { field } = await import('./helpers.ts');
    const w = new World(await robot('tank-6m-450'), await field(), { x: 0, y: 0, theta: 0 });
    expect(w.dynSample()).toHaveLength(DYN_COLUMNS.length);
    expect(w.dynSample()[0]).toBe(0);
    for (let i = 0; i < 100; i++) w.step(1);
    const row = w.dynSample();
    expect(row).toHaveLength(DYN_COLUMNS.length);
    expect(row.every(Number.isFinite)).toBe(true);
  });
});
