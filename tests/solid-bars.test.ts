// Lift bars and links are solid: lowered beside a Goal, a 6-bar's bars come down onto it and the
// lift stops there (clear of it, it goes on down to the floor).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { OverrideGame } from '../src/games/override/game.ts';
import type { FieldDef, GoalDef } from '../src/sim/field.ts';
import type { LiftSpec } from '../src/sim/profile.ts';
import { World } from '../src/sim/world.ts';
import { robot } from './helpers.ts';

const field = async () => JSON.parse(await readFile(path.join(repoRoot, 'data/fields/override.json'), 'utf8')) as FieldDef;

/** Lower the 6-bar from 80° for 1.5 s with the robot beside (dx) and short of (dy) Goal N_R1; its bar angle after. */
async function lower(dx: number): Promise<number> {
  const f = await field();
  const r = await robot('override-sixbar');
  for (const m of r.mechanisms) if (m.kind === 'claw') delete m.preload;
  const g = f.goals!.find((x: GoalDef) => x.id === 'N_R1')!;
  // facing +y, the Goal 10.5" ahead and `dx` to the right: the chassis and the claw clear it
  const w = new World(r, f, { x: g.x - dx, y: g.y - 10.5, theta: 0 });
  const game = await OverrideGame.create(f, 'h2h', w);
  const lift = r.mechanisms.find((m): m is LiftSpec => m.kind === 'lift')!;
  w.motor(7).angle = 80 / lift.ratio!;
  w.motor(7).cmd = -80;
  for (let t = 1; t <= 1500; t++) {
    w.step(1);
    game.step(1);
  }
  return w.mechanismState(lift);
}

describe('solid lift bars', () => {
  it('a 6-bar lowered with its bars over a Goal stops on it; one clear of it goes all the way down', async () => {
    const onGoal = await lower(4.6); // the right bar comes down onto N_R1 (5.77" tall)
    const between = await lower(12); // well to the side: nothing in the way
    // its bar 0.8 of the way out is 5.77" up (less 0.6 for the bar) at about 8.8° of lift
    expect(onGoal).toBeGreaterThan(6);
    expect(onGoal).toBeLessThan(11);
    expect(between).toBeLessThan(1);
  });
});
