import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { MoveToPoint, MoveToPose, Turn } from '../src/sim/motion.ts';
import { maxSpeed, validateProfile } from '../src/sim/profile.ts';
import { validateField } from '../src/sim/field.ts';
import { OdomFrame, World } from '../src/sim/world.ts';
import { field, robot } from './helpers.ts';

async function world(id = 'tank-6m-450', start = { x: 0, y: 0, theta: 0 }) {
  return new World(await robot(id), await field(), start);
}

const presets = readdirSync(path.join(repoRoot, 'data/robots')).map((f) => f.replace(/.json$/, ''));
const full = { maxSpeed: 127, minSpeed: 0, earlyExitRange: 0 };

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
    const ids = readdirSync(path.join(repoRoot, 'data/robots')).map((f) => f.replace(/\.json$/, ''));
    expect(ids.length).toBeGreaterThanOrEqual(11);
    for (const id of ids) expect(validateProfile(await robot(id)), id).toEqual([]);
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
    // 450 rpm * 3.25" * pi / 60 = 76.6 in/s; the motors' torque fades near free speed
    expect(w.speed / maxSpeed(w.profile)).toBeGreaterThan(0.99);
    expect(w.speed).toBeLessThanOrEqual(maxSpeed(w.profile));
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

describe('no swing: motions stop on target instead of going past and coming back', () => {
  it('in-place turns of 90 and 180 degrees overshoot less than 1 degree on every preset', async () => {
    for (const id of presets) {
      for (const target of [90, 180]) {
        const w = await world(id);
        const m = new Turn('turnToHeading', () => target, 3000, { direction: 0, ...full });
        w.controller = m;
        let peak = 0;
        for (let t = 0; t < 2500; t++) {
          w.step(1);
          peak = Math.max(peak, w.pose.theta);
          if (m.done) w.controller = null;
        }
        expect(m.done, id).toBe(true);
        expect(peak - target, `${id} ${target}`).toBeLessThan(1);
        expect(Math.abs(w.pose.theta - target), `${id} ${target}`).toBeLessThan(1);
      }
    }
  });

  it('moveToPose curves in without reversing and ends on the pose, on every preset', async () => {
    for (const id of presets) {
      const w = await world(id);
      const m = new MoveToPose(20, 15, 90, 4000, { forwards: true, ...full, lead: 0.6 });
      w.controller = m;
      let slowest = 0;
      while (!m.done) {
        w.step(1);
        slowest = Math.min(slowest, w.speed);
      }
      expect(slowest, id).toBeGreaterThan(-0.5); // never backs up
      expect(m.elapsed, id).toBeLessThan(4000);
      expect(Math.hypot(w.pose.x - 20, w.pose.y - 15), id).toBeLessThan(1);
      expect(Math.abs(w.pose.theta - 90), id).toBeLessThan(1);
    }
  });

  it('a backwards moveToPose aims its carrot behind the robot and arrives facing the pose', async () => {
    const w = await world('lemlib-template');
    const m = new MoveToPose(-20, -15, 90, 4000, { forwards: false, ...full, lead: 0.6 });
    w.controller = m;
    let fastest = 0;
    while (!m.done) {
      w.step(1);
      fastest = Math.max(fastest, w.speed);
    }
    expect(fastest).toBeLessThan(0.5); // reverses the whole way
    expect(m.elapsed).toBeLessThan(4000);
    expect(Math.hypot(w.pose.x + 20, w.pose.y + 15)).toBeLessThan(1);
    expect(Math.abs(w.pose.theta - 90)).toBeLessThan(1);
  });

  it('a leftover spin from the last turn dies out instead of bending the next drive', async () => {
    const w = await world('lemlib-template');
    // what a turn leaves when it hands over (it settles below 2 in/s per side)
    w.vL = -2;
    w.vR = 2;
    const m = new MoveToPoint(0, 48, 3000, { forwards: true, ...full });
    w.controller = m;
    let wide = 0;
    while (!m.done) {
      w.step(1);
      wide = Math.max(wide, Math.abs(w.pose.x));
    }
    // both sides are grip-limited while speeding up, so a little sideways drift is real
    expect(wide).toBeLessThan(1);
    expect(Math.abs(w.pose.y - 48)).toBeLessThan(0.5);
    expect(Math.abs(w.pose.theta)).toBeLessThan(2); // LemLib stops steering in the last 7.5 in
  });

  it('a chained moveToPoint (minSpeed) ends at speed once it crosses the target line', async () => {
    const w = await world();
    const m = new MoveToPoint(0, 24, 3000, { forwards: true, maxSpeed: 127, minSpeed: 60, earlyExitRange: 0 });
    w.controller = m;
    runUntil(w, () => m.done);
    expect(w.pose.y).toBeGreaterThanOrEqual(24);
    expect(w.pose.y).toBeLessThan(25);
    expect(w.speed).toBeGreaterThan((maxSpeed(w.profile) * 60) / 127 - 1);
  });
});

describe('drivetrain hardware', () => {
  const coastFrom = async (brakeMode: number) => {
    const w = await world();
    const ports = [...w.profile.drivetrain.left, ...w.profile.drivetrain.right];
    for (const p of ports) {
      w.motor(p).cmd = 127 * Math.sign(p);
      w.motor(p).brakeMode = brakeMode;
    }
    runUntil(w, () => false, 700);
    const y = w.pose.y;
    for (const p of ports) w.motor(p).cmd = 0;
    runUntil(w, () => Math.abs(w.speed) < 1e-9, 3000);
    return w.pose.y - y;
  };

  it('brake modes: coast rolls on about a foot, brake stops sooner, hold soonest', async () => {
    const coast = await coastFrom(0);
    const brake = await coastFrom(1);
    const hold = await coastFrom(2);
    expect(coast).toBeGreaterThan(brake);
    expect(brake).toBeGreaterThan(hold);
    expect(coast).toBeGreaterThan(10);
    expect(coast).toBeLessThan(30);
    expect(hold).toBeGreaterThan(5); // even hold can't stop faster than the wheels' grip allows
  });

  it('driving into a wall at an angle squares the robot against it', async () => {
    const w = await world('tank-6m-450', { x: 0, y: 40, theta: 8 });
    for (const p of [...w.profile.drivetrain.left, ...w.profile.drivetrain.right]) w.motor(p).cmd = 60 * Math.sign(p);
    runUntil(w, () => false, 2000);
    expect(Math.abs(w.pose.theta)).toBeLessThan(0.5);
    const half = w.field.perimeter.inside / 2;
    expect(w.pose.y + w.profile.size.length / 2).toBeCloseTo(half, 3);
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
