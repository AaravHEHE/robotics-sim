// Override game fixes from the deep search: claw orientation, stacking in a claw, taking a
// Pin out of a Cup, the Autonomous Line in the Midfield, which violations count, SG10, sensors.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { OverrideGame } from '../src/games/override/game.ts';
import { stackOnto } from '../src/games/override/manipulators.ts';
import { RuleMonitor } from '../src/games/override/rules.ts';
import type { Piece } from '../src/games/override/elements.ts';
import type { FieldDef, Vec2 } from '../src/sim/field.ts';
import type { RobotProfile } from '../src/sim/profile.ts';
import { box, World } from '../src/sim/world.ts';
import { robot } from './helpers.ts';

const field = async () => JSON.parse(await readFile(path.join(repoRoot, 'data/fields/override.json'), 'utf8')) as FieldDef;

async function game(r: RobotProfile, start: { x: number; y: number; theta: number }) {
  const f = await field();
  const world = new World(r, f, start);
  const g = await OverrideGame.create(f, 'h2h', world);
  const run = (ms: number) => {
    for (let t = 0; t < ms; t++) {
      world.step(1);
      g.step(1);
    }
  };
  return { f, world, game: g, run };
}

const pin = (id: string): Piece => ({ kind: 'pin', id, colors: ['red', 'yellow'] });
const cup = (id: string): Piece => ({ kind: 'cup', id, up: 'gray' });

describe('Override game fixes', () => {
  it('a claw stacks only what can really stack, Pin under Cup', () => {
    expect(stackOnto([cup('c')], [pin('p')])?.map((p) => p.id)).toEqual(['p', 'c']);
    expect(stackOnto([pin('p')], [cup('c')])?.map((p) => p.id)).toEqual(['p', 'c']);
    expect(stackOnto([pin('a'), cup('b')], [pin('c')])?.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(stackOnto([pin('a')], [pin('b')])).toBeNull();
    expect(stackOnto([cup('a'), pin('b')], [pin('c'), cup('d')])).toBeNull();
  });

  it('a wrist set to minus the arm angle keeps the stack upright (Banshee at arm 100°)', async () => {
    const r = await robot('override-banshee');
    const { world, game: g, run } = await game(r, { x: -40, y: -40, theta: 0 });
    const before = g.state.held['Roller claw'].map((p) => (p.kind === 'pin' ? p.colors.join() : p.up));
    world.motor(7).angle = 100 / 0.2; // arm 100°
    world.motor(7).brakeMode = 2;
    world.motor(8).angle = -100 / 0.25; // wrist -100°
    world.motor(8).brakeMode = 2;
    run(50);
    expect(g.state.held['Roller claw'].map((p) => (p.kind === 'pin' ? p.colors.join() : p.up))).toEqual(before);
    expect(g.state.flipped['Roller claw'] ?? false).toBe(false);
  });

  it('taking the Pin out of a Cup against the wall leaves the Cup where it is', async () => {
    const r = await robot('override-ace');
    for (const m of r.mechanisms) if (m.kind === 'claw') delete m.preload;
    // facing the south wall-group Cup + Pin at (-23.55, -68.63), the claw 11" ahead over it
    const { world, game: g, run } = await game(r, { x: -23.548, y: -68.626 + 11, theta: 180 });
    const stack = g.state.floor.find((s) => Math.hypot(s.x + 23.548, s.y + 68.626) < 0.1)!;
    expect(stack.pieces.map((p) => p.kind)).toEqual(['cup', 'pin']);
    for (const p of [7, 8]) {
      world.motor(p).angle = 56 / 0.3333; // cascade up 2" (grip point ~8" up: on the Pin)
      world.motor(p).brakeMode = 2;
    }
    world.motor(9).brakeMode = 2; // the chain bar held straight out
    run(50);
    const pose = { ...world.pose };
    world.adiOut.set('A', true); // close
    run(400);
    expect(g.state.held['Lobster claw'].map((p) => p.kind)).toEqual(['pin']);
    expect(stack.pieces.map((p) => p.kind)).toEqual(['cup']);
    expect(Math.hypot(stack.x + 23.548, stack.y + 68.626)).toBeLessThan(0.05);
    expect(Math.hypot(world.pose.x - pose.x, world.pose.y - pose.y)).toBeLessThan(0.05);
  });

  it('the Autonomous Line is interrupted by the Midfield', async () => {
    const f = await field();
    const m = new RuleMonitor(f, { alliance: 'red', mode: 'h2h', size: { width: 15, length: 15, height: 15 } });
    m.check(0, box(2, 2, 6, 6) as Vec2[]); // past y = -x, but inside the Midfield
    expect(m.violations).toEqual([]);
    m.check(1, box(30, 30, 6, 6) as Vec2[]); // past it outside the Midfield
    expect(m.violations.map((v) => v.rule)).toEqual(['SG7']);
  });

  it('an oversized profile is noted (SG1) but does not cost the Autonomous Bonus or the AWP', async () => {
    const big = await robot('tank-6m-450');
    big.size = { ...big.size, width: 20 };
    const small = await robot('tank-6m-450');
    const a = await game(big, { x: -40, y: -40, theta: 0 });
    const b = await game(small, { x: -40, y: -40, theta: 0 });
    expect(a.game.rules.violations.map((v) => v.rule)).toEqual(['SG1']);
    expect(a.game.score().autonomousBonus).toEqual(b.game.score().autonomousBonus);
    expect(a.game.score().awp).toEqual(b.game.score().awp);
  });

  it('SG10 is only for Placed pieces taken off a neutral Goal', async () => {
    const { game: g } = await game(await robot('override-ace'), { x: -40, y: -40, theta: 0 });
    const N = g.field.goals!.find((x) => x.id === 'N_R1')!;
    // its yellow Pin is Placed; a Cup on a Cup above it is past a break (not Placed)
    g.state.goals.N_R1.push(cup('c1'), cup('c2'));
    const take = (i: number) => (g.manipulators as unknown as { takeFromGoal: (goal: typeof N, i: number, into: () => void) => void }).takeFromGoal(N, i, () => {});
    take(2);
    expect(g.rules.violations.map((v) => v.rule)).not.toContain('SG10');
    take(0);
    expect(g.rules.violations.map((v) => v.rule)).toContain('SG10');
  });

  it('a distance sensor sees a lying Pin across its collar (no blind band in the middle)', async () => {
    const r = await robot('tank-6m-450');
    r.devices.push({ type: 'distance', port: 12, mount: { x: 0, y: 7.5, heading: 0, z: 1 } });
    const { world, game: g } = await game(r, { x: -10, y: -40, theta: 0 });
    // a lying Pin across the beam, its collar straight ahead
    g.state.lying.push({ id: 'L', x: -10, y: -30, heading: 90, colors: ['red', 'yellow'] });
    const d = world.raycast({ x: 0, y: 7.5, heading: 0, z: 1 });
    expect(d).toBeCloseTo(-30 - 1.58 - (-40 + 7.5), 1);
  });
});
