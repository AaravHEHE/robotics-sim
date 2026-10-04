import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CUP } from '../src/games/override/elements.ts';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { OverrideGame } from '../src/games/override/game.ts';
import type { FieldDef } from '../src/sim/field.ts';
import { World } from '../src/sim/world.ts';
import { prosProject, robot, simulate } from './helpers.ts';

const field = async () => JSON.parse(await readFile(path.join(repoRoot, 'data/fields/override.json'), 'utf8')) as FieldDef;

/** Drive straight at full power for `ms`, stepping world + game like the runtime. */
async function plow(ms: number, start = { x: 0, y: -33, theta: 0 }) {
  const f = await field();
  const r = await robot('tank-6m-450');
  const world = new World(r, f, start);
  const game = await OverrideGame.create(f, 'h2h', world);
  for (const p of [...r.drivetrain.left, ...r.drivetrain.right]) world.motor(p).cmd = 127 * Math.sign(p);
  for (let t = 1; t <= ms; t++) {
    world.step(1);
    game.step(1);
    if (t % 10 === 0) game.recordFrame(t);
  }
  return { world, game, rec: game.finish(), f };
}

describe('Override floor physics', () => {
  it('the robot plows the Midfield-corner stack toward the center goal', async () => {
    const { game } = await plow(1500);
    const corner = game.state.floor.find((s) => Math.abs(s.x) < 6 && s.y > -30 && s.y < 0 && s.pieces.length === 2)!;
    expect(corner).toBeDefined();
    // it started at y = -23.55; the robot pushed it north
    expect(corner.y).toBeGreaterThan(-20);
  });

  it('a stack jammed against the center Goal stops the robot instead of being driven through', async () => {
    const { world, game } = await plow(1500);
    const stack = game.state.floor.find((s) => Math.abs(s.x) < 6 && s.y > -30 && s.y < 0 && s.pieces.length === 2)!;
    const front = world.pose.y + world.profile.size.length / 2;
    expect(world.speed).toBeCloseTo(0, 3);
    // the stack (radius = the Cup's rim) is still in front of the robot, not inside it
    expect(stack.y - front).toBeGreaterThan(CUP.rimDiameter / 2 - 0.5);
  });

  it('objects never leave the field', async () => {
    const { game, f } = await plow(3000, { x: -40, y: -40, theta: 45 });
    const half = f.perimeter.inside / 2;
    for (const s of game.state.floor) expect(Math.max(Math.abs(s.x), Math.abs(s.y))).toBeLessThan(half);
    for (const l of game.state.lying) expect(Math.max(Math.abs(l.x), Math.abs(l.y))).toBeLessThan(half);
  });

  it('untouched objects stay exactly where the manual puts them', async () => {
    const { game, rec } = await plow(1500);
    const far = game.state.floor.filter((s) => s.y > 30); // the robot never got there
    const start = rec.snapshots[0].state.floor;
    for (const s of far) {
      const s0 = start.find((x) => x.id === s.id)!;
      expect(s.x).toBeCloseTo(s0.x, 3);
      expect(s.y).toBeCloseTo(s0.y, 3);
    }
  });

  it('is deterministic: identical tracks on repeated runs', async () => {
    const a = await plow(2000, { x: -40, y: -40, theta: 45 });
    const b = await plow(2000, { x: -40, y: -40, theta: 45 });
    expect(JSON.stringify(a.rec.tracks)).toBe(JSON.stringify(b.rec.tracks));
    expect(Object.keys(a.rec.tracks).length).toBe(36 + 16 + 4); // every floor stack, lying pin and toggle
  });

  it('a compiled program on the Override field records game replay data', async () => {
    const rec = await simulate(
      prosProject(`#include "main.h"
pros::MotorGroup left({-1, -2, -3}, pros::MotorGears::blue);
pros::MotorGroup right({4, 5, 6}, pros::MotorGears::blue);
void autonomous() { left.move(127); right.move(127); pros::delay(800); left.brake(); right.brake(); }
`),
      'tank-6m-450',
      { field: await field(), start: { x: 12, y: -33, theta: 0 } },
    );
    expect(rec.error).toBeNull();
    expect(rec.game?.id).toBe('override');
    expect(rec.game?.layout).toBe('h2h');
    expect(rec.game?.snapshots[0].state.floor.length).toBe(36); // 24 wall-group cups + 4 cross + 4 corner + 4 diagonal
    // nothing scored, but driving north from (12, -33) crosses the Autonomous Line (SG7)
    expect(rec.game?.alliance).toBe('red');
    expect(rec.game?.result?.score).toMatchObject({ red: 0, blue: 0 });
    expect(rec.game?.violations.map((v) => v.rule)).toContain('SG7');
    expect(rec.game?.result?.autonomousBonus).toEqual({ red: 0, blue: 12 });
    expect(rec.events.some((e) => e.message.startsWith('<SG7>'))).toBe(true);
  });
});
