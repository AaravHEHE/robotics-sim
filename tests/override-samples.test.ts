// Golden scores of the Override sample autons: each runs exactly as the app opens it.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readProjectDir } from '../scripts/node-bundle.ts';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { runSample } from '../scripts/sample-run.ts';
import { SAMPLES } from '../src/app/samples-meta.ts';
import { build } from './helpers.ts';

const GOLDEN: Record<string, { red: number; blue: number; toggles?: Record<string, string> }> = {
  'override-flex': { red: 35, blue: 0, toggles: { red1: 'red' } },
  'override-toggle-bot': { red: 40, blue: 0, toggles: { red1: 'red', red2: 'red' } },
  'override-workhorse-toggle': { red: 45, blue: 0, toggles: { red1: 'red' } },
  'override-midfield-pusher': { red: 8, blue: 0 },
  'override-dr4b': { red: 5, blue: 0 },
};

describe('Override sample autons', () => {
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
