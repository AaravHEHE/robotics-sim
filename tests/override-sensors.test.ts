import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { OverrideGame } from '../src/games/override/game.ts';
import { colorAt } from '../src/games/override/sensors.ts';
import type { FieldDef } from '../src/sim/field.ts';
import type { DeviceSpec, RobotProfile } from '../src/sim/profile.ts';
import { World } from '../src/sim/world.ts';
import { prosProject, robot, simulate } from './helpers.ts';

const field = async () => JSON.parse(await readFile(path.join(repoRoot, 'data/fields/override.json'), 'utf8')) as FieldDef;
type Optical = Extract<DeviceSpec, { type: 'optical' }>;

async function withDevices(id: string, devices: DeviceSpec[]): Promise<RobotProfile> {
  const r = await robot(id);
  r.devices.push(...devices);
  return r;
}

async function look(r: RobotProfile, pose: { x: number; y: number; theta: number }, dev: Optical, setup?: (g: OverrideGame) => void) {
  const f = await field();
  const world = new World(r, f, pose);
  const game = await OverrideGame.create(f, 'h2h', world);
  setup?.(game);
  return { reading: world.sensors.optical!(dev), world, game };
}

const isHue = (hue: number, want: 'red' | 'blue' | 'yellow') => (want === 'red' ? hue < 15 || hue > 345 : want === 'blue' ? hue > 190 && hue < 240 : hue > 40 && hue < 70);

describe('Override optical sensor', () => {
  it('sees a Cup over a Pin: gray where opaque, the yellow Pin through the clear half', async () => {
    // the diagonal stack at (-23.5, -23.5): a clear-up Cup holding a yellow Pin, 3" ahead
    const r = await robot('tank-6m-450');
    const low: Optical = { type: 'optical', port: 12, mount: { x: 0, y: 7.5, z: 2, heading: 0 } };
    const high: Optical = { ...low, mount: { ...low.mount!, z: 5 } };
    const pose = { x: -23.548, y: -23.548 - 7.5 - 1.6 - 2, theta: 0 };
    const a = await look(r, pose, low);
    expect(a.reading.saturation).toBeLessThan(0.2); // the gray lower half
    expect(a.reading.proximity).toBeGreaterThan(150);
    const b = await look(r, pose, high);
    expect(isHue(b.reading.hue, 'yellow')).toBe(true);
    expect(b.reading.saturation).toBeGreaterThan(0.5);
  });

  it('reads a Toggle face as it rolls', async () => {
    const r = await robot('tank-6m-450');
    const dev: Optical = { type: 'optical', port: 12, mount: { x: 0, y: 7.5, z: 12.5, heading: 0 } };
    const pose = { x: -70.205 + 7.5 + 1.5, y: 0, theta: 270 }; // facing the left wall's Toggle
    const before = await look(r, pose, dev);
    expect(isHue(before.reading.hue, 'yellow')).toBe(true);
    const after = await look(r, pose, dev, (g) => (g.state.toggles.find((t) => t.id === 'T_red1')!.angle = -120));
    expect(isHue(after.reading.hue, 'red')).toBe(true);
  });

  it('sees a Goal body, and nothing when out of range', async () => {
    const r = await robot('tank-6m-450');
    const dev: Optical = { type: 'optical', port: 12, mount: { x: 0, y: 7.5, z: 2, heading: 0 } };
    const near = await look(r, { x: -47.091 - 7.5 - 2.8 - 1, y: -23.547, theta: 90 }, dev);
    expect(isHue(near.reading.hue, 'red')).toBe(true);
    const far = await look(r, { x: -47.091 - 7.5 - 2.8 - 9, y: -23.547, theta: 90 }, dev);
    expect(far.reading.proximity).toBe(0);
  });

  it('a sensor watching the DR4B chamber reads the Preload', async () => {
    const r = await withDevices('override-dr4b-intake', [{ type: 'optical', port: 13, watches: 'Chamber' }]);
    const { reading } = await look(r, { x: 0, y: -40, theta: 0 }, r.devices.at(-1) as Optical);
    expect(isHue(reading.hue, 'red')).toBe(true); // red half down, the sensor sits low
    expect(reading.proximity).toBeGreaterThan(200);
  });

  it('colorAt: a nested Pin shows through a clear Cup half only', () => {
    const pin = { kind: 'pin' as const, id: 'p', colors: ['red', 'yellow'] as ['red', 'yellow'] };
    expect(colorAt([{ kind: 'cup', id: 'c', up: 'clear' }, pin], 0, false, 5)).toBe('red');
    expect(colorAt([{ kind: 'cup', id: 'c', up: 'gray' }, pin], 0, false, 5)).toBe('gray');
    expect(colorAt([pin], 0, false, 1)).toBe('red');
    expect(colorAt([pin], 0, false, 6)).toBe('yellow');
    expect(colorAt([pin], 0, false, 9)).toBeNull();
  });
});

describe('Override distance sensor sees game objects', () => {
  it('measures to a Cup in front of it', async () => {
    const r = await robot('tank-6m-450');
    const f = await field();
    // 4" from the bumper to the diagonal stack's rim
    const w = new World(r, f, { x: -23.548, y: -23.548 - 7.5 - 1.58 - 4, theta: 0 });
    await OverrideGame.create(f, 'h2h', w);
    expect(w.raycast({ x: 0, y: 7.5, heading: 0 })).toBeCloseTo(4, 1);
  });
});

describe('GPS', () => {
  it('reports the field position in meters, using the offset the code declares', async () => {
    const r = await withDevices('tank-6m-450', [{ type: 'gps', port: 12, mount: { x: 0, y: -5, heading: 180 } }]);
    const rec = await simulate(
      prosProject(`#include "main.h"
pros::MotorGroup left({-1, -2, -3}, pros::MotorGears::blue);
pros::MotorGroup right({4, 5, 6}, pros::MotorGears::blue);
pros::Gps right_offset(12, 0, -0.127);  // the sensor is 5" behind the turning center
void initialize() {}
void autonomous() {
  pros::Gps no_offset(12);
  no_offset.set_offset(0, 0);
  auto a = no_offset.get_position();
  printf("raw %.3f %.3f\\n", a.x, a.y);
  right_offset.set_offset(0, -0.127);
  auto b = right_offset.get_position();
  printf("center %.3f %.3f heading %.1f\\n", b.x, b.y, right_offset.get_heading());
  left.move(60); right.move(60); pros::delay(500); left.brake(); right.brake(); pros::delay(300);
  printf("moved %.3f\\n", right_offset.get_position_x());
}
`),
      'tank-6m-450',
      { field: await field(), profile: r, start: { x: -60.705, y: -37, theta: 90 } },
    );
    expect(rec.error).toBeNull();
    const line = (p: string) => rec.console.find((c) => c.text.startsWith(p))!.text.split(' ').slice(1).map(Number);
    // the sensor itself: 5" behind a robot facing +x
    expect(line('raw')).toEqual([Number(((-60.705 - 5) * 0.0254).toFixed(3)), Number((-37 * 0.0254).toFixed(3))]);
    const [x, y, , heading] = line('center');
    expect([x, y]).toEqual([Number((-60.705 * 0.0254).toFixed(3)), Number((-37 * 0.0254).toFixed(3))]);
    expect(heading).toBe(270); // mounted facing backward on a robot facing 90°
    expect(line('moved')[0]).toBeGreaterThan(x + 0.1);
  });
});
