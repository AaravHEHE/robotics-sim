// Golden scores of the Override sample autons: each runs exactly as the app opens it.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readProjectDir } from '../scripts/node-bundle.ts';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { runSample } from '../scripts/sample-run.ts';
import { SAMPLES } from '../src/app/samples-meta.ts';
import type { FieldDef } from '../src/sim/field.ts';
import { build } from './helpers.ts';

const GOLDEN: Record<string, { red: number; blue: number; toggles?: Record<string, string> }> = {
  'override-flex': { red: 35, blue: 0, toggles: { red1: 'red' } },
  'override-toggle-bot': { red: 40, blue: 0, toggles: { red1: 'red', red2: 'red' } },
  'override-workhorse-toggle': { red: 45, blue: 0, toggles: { red1: 'red' } },
  'override-midfield-pusher': { red: 8, blue: 0 },
  'override-dr4b': { red: 45, blue: 0, toggles: { red1: 'red' } },
  'override-cascade': { red: 45, blue: 0, toggles: { red1: 'red' } },
  'override-sixbar-wrist': { red: 35, blue: 0, toggles: { red1: 'red' } },
  'override-skills': { red: 23, blue: 0 },
};

describe('Override sample autons', () => {
  it('every Override sample has a golden score', () => {
    expect(SAMPLES.filter((s) => s.field === 'override' && s.kind !== 'test').map((s) => s.id).sort()).toEqual(Object.keys(GOLDEN).sort());
  });

  for (const [id, want] of Object.entries(GOLDEN)) {
    it(`${id} scores red ${want.red} / blue ${want.blue}`, async () => {
      const meta = SAMPLES.find((s) => s.id === id)!;
      const b = await build(await readProjectDir(path.join(repoRoot, 'samples', id)));
      expect(b.ok).toBe(true);
      const rec = await runSample(meta, await WebAssembly.compile(b.wasm!));
      expect(rec.error).toBeNull();
      const r = rec.game!.result!;
      expect({ red: r.score.red, blue: r.score.blue }).toEqual({ red: want.red, blue: want.blue });
      for (const [zone, color] of Object.entries(want.toggles ?? {})) expect(r.score.toggles.find((t) => t.zone === zone)?.color).toBe(color);
      expect(rec.game!.violations).toEqual([]);
    });
  }
});

/**
 * Mechanism tests: every check the program makes prints PASS (and how many), and the
 * pieces really moved the way the program says (its checks can't see them).
 */
const TESTS: Record<string, { checks: number; holder?: string; regrab?: boolean; flips?: boolean; fromTray?: boolean }> = {
  'test-flex': { checks: 13, holder: 'Claw', regrab: true },
  'test-dr4b-roller': { checks: 13, holder: 'Roller claw', regrab: true },
  'test-cascade': { checks: 15, holder: 'Claw', regrab: true },
  'test-intake-staging': { checks: 17, holder: 'Claw', fromTray: true },
  'test-sixbar-wrist': { checks: 15, holder: 'Claw', regrab: true, flips: true },
  'test-workhorse': { checks: 13, holder: 'Claw', regrab: true },
  'test-toggle-bot': { checks: 12 },
  'test-midfield-pusher': { checks: 10 },
};

describe('Override sample settings', () => {
  it("each sample starts where its mode allows (the app would move it on reload otherwise)", async () => {
    const field = JSON.parse(await readFile(path.join(repoRoot, 'data/fields/override.json'), 'utf8')) as FieldDef;
    for (const s of SAMPLES.filter((x) => x.field === 'override')) {
      const layout = (s.autonMs ?? 15000) >= 60000 ? 'skills' : 'h2h';
      const sp = field.startPositions!.find((p) => p.id === s.start)!;
      expect(sp.layouts, `${s.id}: ${s.start}`).toContain(layout);
    }
  });
});

describe('Override mechanism tests', () => {
  it('every robot preset for Override has a mechanism test', () => {
    const tests = SAMPLES.filter((s) => s.kind === 'test');
    expect(tests.map((s) => s.id).sort()).toEqual(Object.keys(TESTS).sort());
    expect(new Set(tests.map((s) => s.robot)).size).toBe(tests.length);
  });

  for (const [id, want] of Object.entries(TESTS)) {
    it(`${id}: all ${want.checks} checks pass`, async () => {
      const meta = SAMPLES.find((s) => s.id === id)!;
      const b = await build(await readProjectDir(path.join(repoRoot, 'samples', id)));
      expect(b.ok).toBe(true);
      const rec = await runSample(meta, await WebAssembly.compile(b.wasm!));
      expect(rec.error).toBeNull();
      const out = rec.console.map((c) => c.text).join('\n');
      expect(out.match(/^FAIL.*$/gm) ?? []).toEqual([]);
      expect(out).toContain(`RESULT ${want.checks} passed, 0 failed`);
      expect(rec.game!.violations).toEqual([]);
      const snaps = rec.game!.snapshots.map((x) => x.state);
      const end = snaps.at(-1)!;
      if (want.regrab) {
        // the Preload was let go of, lay on the floor, and was picked up again
        const dropped = snaps.flatMap((st) => st.lying).find((l) => l.id.startsWith('d'));
        expect(dropped).toBeDefined();
        expect(end.held[want.holder!].map((p) => p.id)).toEqual([dropped!.id]);
      }
      if (want.fromTray) {
        expect(snaps[0].held.Stage.map((p) => p.id)).toEqual(['preload']);
        expect(end.held.Stage).toEqual([]);
        expect(end.held[want.holder!].map((p) => p.id)).toEqual(['preload']);
      }
      if (want.flips) expect(snaps.some((st) => st.flipped?.[want.holder!])).toBe(true);
    });
  }
});
