// A side with no current can't push, even while a motion controller is driving the robot.
import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world.ts';
import { field, robot } from './helpers.ts';

describe('a side with no current under a motion controller', () => {
  it('stops pushing, so the robot turns instead of carrying its speed on forever', async () => {
    const w = new World(await robot('tank-6m-450'), await field(), { x: 0, y: -60, theta: 0 });
    w.controller = { update: () => [40, 40] };
    for (let i = 0; i < 800; i++) w.step(1);
    expect(Math.abs(w.vL - 40)).toBeLessThan(10);
    for (const p of w.profile.drivetrain.left) w.motor(p).currentLimit = 0;
    for (let i = 0; i < 500; i++) w.step(1);
    expect(w.vL).toBeLessThan(w.vR - 5);
  });
});
