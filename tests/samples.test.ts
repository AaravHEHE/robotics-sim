// The sample projects shipped in the app must build and run cleanly on their robots.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readProjectDir } from '../scripts/node-bundle.ts';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { SAMPLES } from '../src/app/samples-meta.ts';
import { finalPose, simulate } from './helpers.ts';

describe('sample projects', () => {
  // game-field samples are checked (with their scores) in override-samples.test.ts
  for (const s of SAMPLES.filter((x) => !x.field)) {
    it(`${s.id} builds and runs on ${s.robot}`, async () => {
      const files = await readProjectDir(path.join(repoRoot, 'samples', s.id));
      const rec = await simulate(files, s.robot);
      expect(rec.error).toBeNull();
      expect(rec.events.filter((e) => e.level === 'error')).toEqual([]);
      let furthest = 0;
      for (let i = 0; i < rec.frames.length; i += rec.stride) furthest = Math.max(furthest, Math.hypot(rec.frames[i + 1], rec.frames[i + 2]));
      expect(furthest).toBeGreaterThan(12); // the robot actually drove somewhere
      expect(Number.isFinite(finalPose(rec).theta)).toBe(true);
    });
  }

  it('pros-basic uses its mechanisms', async () => {
    const files = await readProjectDir(path.join(repoRoot, 'samples/pros-basic'));
    const rec = await simulate(files, 'tank-6m-450');
    const intake = rec.mechanisms.indexOf('Intake');
    const clamp = rec.mechanisms.indexOf('Clamp');
    const col = (i: number) => Array.from({ length: rec.frames.length / rec.stride }, (_, k) => rec.frames[k * rec.stride + 6 + i]);
    expect(Math.max(...col(intake).map(Math.abs))).toBeGreaterThan(360); // spun at least a turn
    expect(Math.max(...col(clamp))).toBe(1); // extended at some point
    expect(rec.console.some((c) => c.text.startsWith('Autonomous finished'))).toBe(true);
  });
});
