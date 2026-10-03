import { describe, expect, it } from 'vitest';
import { MoveToPoint, Turn } from '../src/sim/motion.ts';
import { maxSpeed, validateProfile } from '../src/sim/profile.ts';
import { validateField } from '../src/sim/field.ts';
import { OdomFrame, World } from '../src/sim/world.ts';
import { field, robot } from './helpers.ts';

async function world(id = 'tank-6m-450') {
  return new World(await robot(id), await field(), { x: 0, y: 0, theta: 0 });
}

function runUntil(w: World, done: () => boolean, maxMs = 10000): number {
  let t = 0;
  while (!done() && t < maxMs) {
    w.step(1);
    t++;
  }
  return t;
}

describe('presets and field', () => {
  it('all presets and the generic field validate', async () => {
    for (const id of ['tank-6m-450', 'lemlib-template', 'ez-example']) expect(validateProfile(await robot(id))).toEqual([]);
    expect(validateField(await field())).toEqual([]);
  });

  it('rejects broken profiles with readable messages', async () => {
    const p = await robot('tank-6m-450');
    const bad = { ...p, drivetrain: { ...p.drivetrain, left: [1, 2, 30] }, devices: [...p.devices, { type: 'imu', port: 4 }] };
    const errs = validateProfile(bad);
    expect(errs.some((e) => e.includes('drivetrain.left'))).toBe(true);
  });
});

describe('drivetrain kinematics', () => {
  it('full forward voltage reaches the profile top speed', async () => {
    const w = await world();
    for (const p of [...w.profile.drivetrain.left, ...w.profile.drivetrain.right]) {
      const m = w.motor(p);
      m.cmd = 127 * Math.sign(p);
    }
    runUntil(w, () => false, 900); // top speed, before reaching the far wall
    expect(w.speed).toBeCloseTo(maxSpeed(w.profile), 6); // 450 rpm * 3.25" * pi / 60 = 76.6 in/s
    expect(w.pose.theta).toBeCloseTo(0, 9);
    expect(w.pose.x).toBeCloseTo(0, 9);
  });

  it('wheels stall against a wall, so reversing pulls away at once', async () => {
    const w = await world();
    const all = (cmd: number) => {
      for (const p of [...w.profile.drivetrain.left, ...w.profile.drivetrain.right]) w.motor(p).cmd = cmd * Math.sign(p);
    };
    all(127);
    runUntil(w, () => false, 2500); // pinned against the far wall
    expect(w.speed).toBeCloseTo(0, 6);
    const y = w.pose.y;
    all(-80);
    runUntil(w, () => false, 250);
    expect(y - w.pose.y).toBeGreaterThan(2);
  });

  it('motors with the wrong reversal drive the wrong way', async () => {
    const w = await world();
    // profile says left motors must be reversed in code; command them unreversed
    for (const p of w.profile.drivetrain.left) w.motor(p).cmd = 127;
    for (const p of w.profile.drivetrain.right) w.motor(p).cmd = 127;
    runUntil(w, () => false, 300);
    expect(Math.abs(w.pose.theta)).toBeGreaterThan(10); // spins instead of driving straight
  });

  it('walls stop the robot', async () => {
    const w = await world();
    for (const p of [...w.profile.drivetrain.left, ...w.profile.drivetrain.right]) w.motor(p).cmd = 127 * Math.sign(p);
    runUntil(w, () => false, 5000);
    const half = w.field.perimeter.inside / 2;
    expect(w.pose.y + w.profile.size.length / 2).toBeCloseTo(half, 6);
    expect(w.collisions.length).toBe(1);
  });
});

describe('idealized motions', () => {
  it('moveToPoint 24 in forward: arrives within 0.5 in, no faster than physics allows', async () => {
    const w = await world();
    const m = new MoveToPoint(0, 24, 5000, { forwards: true, maxSpeed: 127, minSpeed: 0, earlyExitRange: 0 });
    w.controller = m;
    const tMotion = runUntil(w, () => m.done);
    w.controller = null;
    const t = tMotion + runUntil(w, () => Math.abs(w.speed) < 1e-9, 2000);
    expect(Math.abs(w.pose.y - 24)).toBeLessThan(0.5);
    // rest-to-rest can't beat accelerating then decelerating at maxAccel
    const a = w.profile.drivetrain.maxAccel;
    expect(t / 1000).toBeGreaterThan(2 * Math.sqrt(24 / a) * 0.95);
  });

  it('turn 90 degrees in place', async () => {
    const w = await world();
    const m = new Turn('turnToHeading', () => 90, 3000, { direction: 0, maxSpeed: 127, minSpeed: 0, earlyExitRange: 0 });
    w.controller = m;
    runUntil(w, () => m.done);
    w.controller = null;
    runUntil(w, () => Math.abs(w.omega) < 1e-9, 2000);
    expect(Math.abs(w.pose.theta - 90)).toBeLessThan(1.5);
    expect(Math.hypot(w.pose.x, w.pose.y)).toBeLessThan(1e-6);
  });

  it('forced clockwise turn goes the long way', async () => {
    const w = await world();
    const m = new Turn('turnToHeading', () => -90, 5000, { direction: 1, maxSpeed: 127, minSpeed: 0, earlyExitRange: 0 });
    w.controller = m;
    runUntil(w, () => m.done);
    expect(w.pose.theta).toBeGreaterThan(260);
  });
});

describe('odometry frames', () => {
  it('maps between field and a re-based odometry frame', () => {
    const f = new OdomFrame();
    f.anchor({ x: 10, y: -20, theta: 90 }, { x: 0, y: 0, theta: 0 });
    // 5 in in front of the robot (robot faces +x on the field) is odom (0, 5)
    const o = f.toOdom({ x: 15, y: -20, theta: 90 });
    expect(o.x).toBeCloseTo(0, 9);
    expect(o.y).toBeCloseTo(5, 9);
    expect(o.theta).toBeCloseTo(0, 9);
    const back = f.toField(o);
    expect(back.x).toBeCloseTo(15, 9);
    expect(back.y).toBeCloseTo(-20, 9);
  });
});
