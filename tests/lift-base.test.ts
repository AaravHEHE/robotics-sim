// A lift may ride another lift only as a chain bar; the 3D robot can't draw any other mounting.
import { describe, expect, it } from 'vitest';
import { validateProfile, type LiftSpec, type RobotProfile } from '../src/sim/profile.ts';
import { robot } from './helpers.ts';

describe('lift base', () => {
  it('a chain bar may ride a cascade, but another lift type may not', async () => {
    const good = structuredClone(await robot('override-ace')) as RobotProfile;
    const bar = good.mechanisms.find((m) => m.kind === 'lift' && (m as LiftSpec).base) as LiftSpec;
    expect(bar.lift).toBe('chainbar');
    expect(validateProfile(good)).toEqual([]);
    const bad = structuredClone(good) as RobotProfile;
    (bad.mechanisms.find((m) => m.name === bar.name) as LiftSpec).lift = 'arm';
    expect(validateProfile(bad).some((e) => e.includes('only a chain bar can ride another lift'))).toBe(true);
  });
});
