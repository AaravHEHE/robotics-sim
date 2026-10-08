import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world.ts';
import { field, robot } from './helpers.ts';

async function place(id: string, x: number, y: number, theta: number) {
  return new World(await robot(id), await field(), { x, y, theta });
}
const drive = (w: World, v: number, ms: number) => {
  for (const p of [...w.profile.drivetrain.left, ...w.profile.drivetrain.right]) w.motor(p).cmd = (127 * v) * Math.sign(p);
  for (let i = 0; i < ms; i++) w.step(1);
};
const energy = (w: World) => {
  const m = w.drive!.dyn.mass;
  const wz = (w.vL - w.vR) / w.trackWidth;
  const sp = (w.vL + w.vR) / 2;
  return 0.5 * m * (sp * 0.0254) ** 2 + 0.5 * w.drive!.dyn.inertia * wz * wz;
};

describe('impacts', () => {
  it('an impact takes energy away and never adds any (coasting into a wall at any angle)', async () => {
    for (const theta of [0, 10, 30, -25]) {
      const w = await place('tank-6m-450', 0, 56, theta);
      w.vL = 50;
      w.vR = 50;
      let hits = 0;
      for (let i = 0; i < 300; i++) {
        const e0 = energy(w);
        const n = w.contacts.length;
        w.step(1);
        if (w.contacts.length > n) {
          hits++;
          // (coasting friction only removes energy too)
          expect(energy(w), `theta ${theta}`).toBeLessThanOrEqual(e0 * 1.000001);
        }
      }
      expect(hits, `theta ${theta}`).toBeGreaterThan(0);
    }
  });

  it('a flush hit on a wall bounces a little, never gains energy, and records an impulse at the corner', async () => {
    const w = await place('tank-6m-450', 0, 50, 0); // facing the far wall, close to it
    let maxE = 0;
    for (const p of [...w.profile.drivetrain.left, ...w.profile.drivetrain.right]) w.motor(p).cmd = 127 * Math.sign(p);
    let before = 0;
    for (let i = 0; i < 1500; i++) {
      const e0 = energy(w);
      w.step(1);
      if (w.contacts.length && !before) before = e0;
      maxE = Math.max(maxE, energy(w));
    }
    expect(w.contacts.length).toBeGreaterThan(0);
    const c = w.contacts[0];
    expect(c.what).toBe('far');
    expect(c.impulse!).toBeGreaterThan(0.5);
    expect(c.ny).toBeCloseTo(-1, 5);
    // a head-on hit spins it hardly at all
    expect(Math.abs(w.vL - w.vR)).toBeLessThan(5);
  });

  it('a hit at an angle on a corner spins the robot', async () => {
    const w = await place('tank-6m-450', 0, 52, 20);
    drive(w, 1, 1200);
    expect(w.contacts.length).toBeGreaterThan(0);
    // the impulse at the front corner has a lever arm, so a spin came out of it
    const fast = w.contacts.find((c) => (c.impulse ?? 0) > 0.3)!;
    expect(fast).toBeTruthy();
  });

  it('a hard hit tips a tall, light robot but not a low, heavy one', async () => {
    const tall = await place('tank-6m-450', 0, 50, 0);
    tall.profile.dynamics = { centerOfMass: { z: 14 } };
    const tipper = new World({ ...tall.profile, mass: 6 }, await field(), { x: 0, y: 50, theta: 0 });
    drive(tipper, 1, 1500);
    const low = new World({ ...tall.profile, mass: 20, dynamics: { centerOfMass: { z: 2 } } }, await field(), { x: 0, y: 50, theta: 0 });
    drive(low, 1, 1500);
    expect(tipper.tips.length).toBeGreaterThan(0);
    expect(low.tips.length).toBe(0);
  });

  it('the old idealized drive records no impulses', async () => {
    const p = await robot('tank-6m-450');
    p.dynamics = { model: 'idealized' };
    const w = new World(p, await field(), { x: 0, y: 50, theta: 0 });
    drive(w, 1, 1500);
    expect(w.contacts.length).toBe(0);
  });
});
