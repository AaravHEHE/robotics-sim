// Fixes from the Milestone 4 audit of the simulator core.
import { describe, expect, it } from 'vitest';
import { validateProfile, type RobotProfile } from '../src/sim/profile.ts';
import { World } from '../src/sim/world.ts';
import { field, prosProject, robot, simulate } from './helpers.ts';

describe('profile validation catches what would freeze or crash a run', () => {
  const withLift = async (patch: (p: RobotProfile) => void) => {
    const p = structuredClone(await robot('override-claw-gate'));
    patch(p);
    return validateProfile(p);
  };

  it('mechanism ports: unsigned, a motor device, not the drivetrain', async () => {
    expect((await withLift((p) => (p.mechanisms[0].motors = [-7, 8]))).join()).toMatch(/port -7 must be 1-21/);
    expect((await withLift((p) => (p.mechanisms[0].motors = [7, 2]))).join()).toMatch(/port 2 is a drivetrain motor/);
    expect((await withLift((p) => (p.mechanisms[0].motors = [7, 15]))).join()).toMatch(/port 15 needs a motor device/);
  });

  it('cartridges, ranges, stages and sensor mounts', async () => {
    expect((await withLift((p) => ((p.devices.find((d) => d.type === 'motor') as { cartridge: string }).cartridge = 'yellow'))).join()).toMatch(/cartridge must be red, green or blue/);
    expect((await withLift((p) => ((p.mechanisms[1] as { range: number[] }).range = [190, -25]))).join()).toMatch(/range must be \[low, high\]/);
    expect((await withLift((p) => ((p.mechanisms[0] as { stages: number }).stages = 0))).join()).toMatch(/stages must be a whole number/);
    expect((await withLift((p) => p.devices.push({ type: 'distance', port: 19 } as never))).join()).toMatch(/distance sensor on port 19: mount needs/);
  });
});

describe('lifts', () => {
  it('an unpowered chain bar past vertical falls onto its far stop, not back over the top', async () => {
    const p = await robot('override-ace');
    const w = new World(p, await field(), { x: 0, y: 0, theta: 0 });
    const bar = p.mechanisms.find((m) => m.name === 'Chain bar')!;
    const m = w.motor(9);
    m.angle = 170 / bar.ratio!; // swung over the top, then left in coast
    for (let t = 0; t < 3000; t++) w.step(1);
    expect(w.mechanismState(bar)).toBeCloseTo(190, 3);
    m.angle = 60 / bar.ratio!; // in front: it sags down to the floor stop
    for (let t = 0; t < 3000; t++) w.step(1);
    expect(w.mechanismState(bar)).toBeCloseTo(-25, 3);
  });
});

describe('PROS API', () => {
  it('a loop waiting with delay(0) still lets time pass', async () => {
    const rec = await simulate(
      prosProject(`#include "main.h"
pros::Motor m(7, pros::MotorGears::green, pros::MotorUnits::degrees);
void initialize() {}
void autonomous() {
  m.move(127);
  while (m.get_position() < 500) pros::delay(0);
  m.brake();
  printf("spun at %u\\n", (unsigned)pros::millis());
}
`),
      'tank-6m-450',
      { profile: { ...(await robot('tank-6m-450')), devices: [...(await robot('tank-6m-450')).devices, { type: 'motor', port: 7, cartridge: 'green' }] } },
    );
    expect(rec.error).toBeNull();
    expect(rec.console.some((c) => c.text.startsWith('spun at'))).toBe(true);
  });

  it('the IMU reads 0 where it powered on; reset zeroes heading, rotation and yaw', async () => {
    const rec = await simulate(
      prosProject(`#include "main.h"
pros::Imu imu(11);
void initialize() {
  printf("boot %.1f %.1f\\n", imu.get_heading(), imu.get_yaw());
  imu.reset(true);
  printf("reset %.1f %.1f %.1f\\n", imu.get_heading(), imu.get_rotation(), imu.get_yaw());
}
void autonomous() {}
`),
      'tank-6m-450',
      { start: { x: 0, y: 0, theta: 90 } },
    );
    const lines = rec.console.map((c) => c.text.trim());
    expect(lines).toContain('boot 0.0 0.0');
    expect(lines).toContain('reset 0.0 0.0 0.0');
  });
});

describe('Override: setPose() onto the other side', () => {
  it('a robot placed on the blue side before it moves plays for blue, with the blue Preload', async () => {
    const { OverrideGame } = await import('../src/games/override/game.ts');
    const f = JSON.parse(await (await import('node:fs/promises')).readFile('data/fields/override.json', 'utf8'));
    const p = await robot('override-banshee');
    const w = new World(p, f, { x: -60.705, y: -37, theta: 90 });
    const game = await OverrideGame.create(f, 'h2h', w);
    expect(game.alliance).toBe('red');
    w.pose = { x: 60.705, y: -37, theta: 270 }; // chassis.setPose() places it on Blue 1
    game.robotTeleported();
    for (let t = 0; t < 200; t++) {
      w.step(1);
      game.step(1);
    }
    expect(game.alliance).toBe('blue');
    expect((game.state.held['Roller claw'][0] as { colors: string[] }).colors[0]).toBe('blue');
    expect(game.rules.violations).toEqual([]);
  });
});
