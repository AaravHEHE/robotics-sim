import { describe, expect, it } from 'vitest';
import { PhysicsOverlay, readoutText } from '../src/app/physics-overlay.ts';
import { DYN_COLUMNS, type Recording } from '../src/sim/recording.ts';
import { World } from '../src/sim/world.ts';
import { field, robot } from './helpers.ts';

/** A recording made by driving a robot into the far wall, the way the runtime makes one. */
async function wallRun(): Promise<{ rec: Recording; profile: Awaited<ReturnType<typeof robot>> }> {
  const profile = await robot('tank-6m-450');
  const w = new World(profile, await field(), { x: 0, y: 52, theta: 0 });
  for (const p of [...profile.drivetrain.left, ...profile.drivetrain.right]) w.motor(p).cmd = 127 * Math.sign(p);
  const frames: number[] = [];
  const dyn: number[] = [];
  for (let t = 0; t <= 1500; t++) {
    if (t % 10 === 0) {
      dyn.push(...w.dynSample());
      frames.push(t, w.pose.x, w.pose.y, w.pose.theta, w.vL, w.vR);
    }
    w.step(1);
  }
  const rec = { frameEveryMs: 10, stride: 6, frames: Float64Array.from(frames), dyn: Float64Array.from(dyn), contacts: w.contacts, mechanisms: [], events: [], motions: [], console: [], lcd: [], autonStart: 0, autonEnd: null, stop: 1500, error: null, wallMs: 0, game: null } as Recording;
  return { rec, profile };
}

describe('physics overlay', () => {
  it('shows arrows, a center-of-mass marker, impacts and a readout from a recording', async () => {
    const { rec, profile } = await wallRun();
    expect(rec.dyn!.length).toBe((rec.frames.length / rec.stride) * DYN_COLUMNS.length);
    const o = new PhysicsOverlay();
    o.setRecording(rec, profile);
    expect(o.available).toBe(true);
    // nothing is drawn, and nothing returned, while it is off
    expect(o.update(25, 250)).toBeNull();
    o.visible = true;
    const mid = o.update(25, 250)!;
    expect(mid.speed).toBeGreaterThan(20);
    expect(mid.batteryV).toBeLessThan(12.8);
    expect(mid.currentA[0]).toBeGreaterThan(0);
    expect(mid.kineticJ).toBeGreaterThan(0);
    expect(readoutText(mid)).toMatch(/battery \d+\.\d\d V/);
    // the impact marker is on screen just after the hit, and gone long after
    const hit = rec.contacts![0];
    o.update(hit.t / 10, hit.t + 50);
    expect(o.group.children.find((c) => c.children.length > 0)).toBeTruthy();
    o.update(149, hit.t + 5000);
    expect(o.group.children.every((c) => c.type !== 'Group' || c.children.length === 0)).toBe(true);
  });

  it('is not available for a recording without dynamics', async () => {
    const { rec, profile } = await wallRun();
    const o = new PhysicsOverlay();
    o.setRecording({ ...rec, dyn: undefined }, profile);
    expect(o.available).toBe(false);
    o.visible = true;
    expect(o.update(10, 100)).toBeNull();
  });
});
