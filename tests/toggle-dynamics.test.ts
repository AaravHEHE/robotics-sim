import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { ToggleSim, wallFrame, type ContactShape } from '../src/games/override/toggle.ts';
import { initialState } from '../src/games/override/state.ts';
import type { FieldDef } from '../src/sim/field.ts';

const field = async () => JSON.parse(await readFile(path.join(repoRoot, 'data/fields/override.json'), 'utf8')) as FieldDef;

/** A 14 in tall box pressed into the Toggle's strip, moving into the wall at `speed` in/s. */
async function press(speed: number, holdMs: number, releaseMs = 1500) {
  const f = await field();
  const sim = new ToggleSim(f);
  const s = initialState(f, 'h2h').toggles;
  const tg = s.find((x) => x.id === 'T_red1')!;
  const def = f.toggles!.find((x) => x.id === 'T_red1')!;
  const { n } = wallFrame(def);
  const half = f.perimeter.inside / 2;
  const box = (cx: number): ContactShape => ({ poly: [[cx - 7.5, -7], [cx + 7.5, -7], [cx + 7.5, 7], [cx - 7.5, 7]], bottom: 0, top: 14, velocity: [-n[0] * speed, 0] });
  const angles: number[] = [];
  const omegas: number[] = [];
  for (let i = 0; i < holdMs; i++) {
    sim.step(1, s, [box(-half + 7.5)]);
    angles.push(tg.angle);
    omegas.push(tg.omega ?? 0);
  }
  for (let i = 0; i < releaseMs; i++) {
    sim.step(1, s, [box(0)]);
    angles.push(tg.angle);
    omegas.push(tg.omega ?? 0);
  }
  return { tg, angles, omegas };
}

describe('Toggle rotational dynamics', () => {
  it('a gentle press turns one face and a press over 40 in/s turns two, whatever the speed beyond that', async () => {
    for (const v of [5, 20, 36, 39]) expect((await press(v, 1500)).tg.angle, `${v} in/s`).toBe(120);
    for (const v of [42, 50, 70, 100, 200]) expect((await press(v, 1500)).tg.angle, `${v} in/s`).toBe(240);
  });

  it('a hard hit carries on to the second face even when the part lets go at once', async () => {
    expect((await press(80, 5)).tg.angle).toBe(240);
    expect((await press(10, 5)).tg.angle).toBe(0); // a tap too gentle to turn it falls back
  });

  it('it rests only on a face, never between', async () => {
    for (const v of [0, 5, 20, 60]) {
      for (const hold of [20, 60, 100, 160, 220]) {
        const { tg } = await press(v, hold, 2500);
        expect(tg.angle % 120, `${v} in/s held ${hold} ms`).toBe(0);
        expect(tg.omega ?? 0).toBe(0);
      }
    }
  });

  it('never gains energy on its own: from rest on a face with nothing touching it, it stays put', async () => {
    const f = await field();
    const sim = new ToggleSim(f);
    const s = initialState(f, 'h2h').toggles;
    for (let i = 0; i < 5000; i++) sim.step(1, s, []);
    expect(s.every((t) => t.angle === 0 && (t.omega ?? 0) === 0)).toBe(true);
  });

  it('a toggle is slowed by the detents: from a hit it never spins faster than it was hit', async () => {
    const { omegas } = await press(80, 5, 600);
    expect(Math.max(...omegas.map(Math.abs))).toBeLessThanOrEqual(1400 + 1);
  });
});
