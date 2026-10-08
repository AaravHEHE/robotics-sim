import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { OverrideGame } from '../src/games/override/game.ts';
import { stateAt } from '../src/games/override/replay.ts';
import type { FieldDef } from '../src/sim/field.ts';
import { World } from '../src/sim/world.ts';
import { robot } from './helpers.ts';

const field = async () => JSON.parse(await readFile(path.join(repoRoot, 'data/fields/override.json'), 'utf8')) as FieldDef;

async function setup() {
  const f = await field();
  const world = new World(await robot('tank-6m-450'), f, { x: 50, y: 50, theta: 0 });
  const game = await OverrideGame.create(f, 'h2h', world);
  const stack = game.state.floor.find((s) => s.pieces.length === 2)!;
  return { game, stack };
}

/** Something carried hits `stack` from the -x side at `speed` in/s, its bottom `bottom` in up. */
function hit(game: OverrideGame, bottom: number, speed: number, only?: string) {
  const physics = (game as unknown as { physics: { hitByCarried: (id: string) => unknown } }).physics;
  vi.spyOn(physics, 'hitByCarried').mockImplementation((id: string) => {
    const s = game.state.floor.find((x) => x.id === id && (!only || id === only));
    return s ? { carried: { id: 'claw', x: s.x - 2, y: s.y, r: 1.6, bottom }, speed } : null;
  });
  (game as unknown as { checkToppling: () => void }).checkToppling();
}

describe('stack toppling', () => {
  it('a stack pushed low slides, and one hit slowly stays up', async () => {
    const a = await setup();
    const n = a.game.state.floor.length;
    hit(a.game, 0, 30, a.stack.id);
    expect(a.game.state.floor.length).toBe(n);
    const b = await setup();
    hit(b.game, 8, 2, b.stack.id);
    expect(b.game.state.floor.length).toBe(b.game.state.floor.length);
    expect(b.game.state.floor.includes(b.stack)).toBe(true);
  });

  it('a stack hit high up while moving tips: its Pin lies along the push and its Cup stands beside it', async () => {
    const { game, stack } = await setup();
    const { x, y } = stack;
    const lying = game.state.lying.length;
    hit(game, 6, 30, stack.id);
    expect(game.state.floor.includes(stack)).toBe(false);
    expect(game.state.lying.length).toBe(lying + 1);
    const pin = game.state.lying.at(-1)!;
    // pushed from the -x side, so it lies along +x (heading 90°) and beyond where it stood
    expect(pin.x).toBeGreaterThan(x);
    expect(Math.abs(pin.y - y)).toBeLessThan(1e-6);
    expect(Math.abs(pin.heading - 90)).toBeLessThan(1e-6);
    const cup = game.state.floor.find((s) => s.pieces.length === 1 && s.pieces[0].kind === 'cup' && Math.hypot(s.x - x, s.y - y) < 10);
    expect(cup).toBeTruthy();
    expect(game.notes.some((m) => /tipped over/.test(m))).toBe(true);
  });

  it('the replay shows the tipped state', async () => {
    const { game } = await setup();
    game.recordFrame(0);
    const target = game.state.floor.find((s) => s.pieces.length === 2)!;
    hit(game, 6, 30, target.id);
    game.step(5);
    const rec = game.finish();
    const last = rec.snapshots.at(-1)!;
    expect(last.state.lying.length).toBeGreaterThan(rec.snapshots[0].state.lying.length);
    const shown = stateAt(rec, last.t);
    expect(shown.lying.length).toBe(last.state.lying.length);
  });
});
