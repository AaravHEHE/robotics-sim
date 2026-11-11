// A robot drawn from a CAD build (RobotProfile.cad): the presets that name one are valid, the build
// loads, and a build with a motion spec moves with its lift.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CadBody, CAD_BUILD_NAMES, loadCadBody } from '../src/app/parts/cad-body.ts';
import { validateProfile, type RobotProfile } from '../src/sim/profile.ts';

const presets = readdirSync('data/robots')
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(`data/robots/${f}`, 'utf8')) as RobotProfile);

describe('profiles with a CAD build', () => {
  const withCad = presets.filter((p) => p.cad);

  it('some presets draw from a CAD, and every one is a valid profile naming a build the app has', () => {
    expect(withCad.map((p) => p.id).sort()).toEqual(['override-ace', 'override-claw-gate', 'override-dr4b-intake']);
    for (const p of withCad) {
      expect(validateProfile(p)).toEqual([]);
      expect(CAD_BUILD_NAMES).toContain(p.cad!.build);
    }
  });

  it('rejects a CAD naming a lift the robot does not have, or no build', () => {
    const p = withCad[0];
    expect(validateProfile({ ...p, cad: { build: 'cascade', lift: 'Nope' } }).join(' ')).toMatch(/cad\.lift/);
    expect(validateProfile({ ...p, cad: { build: '' } }).join(' ')).toMatch(/cad\.build/);
  });
});

describe('CadBody', () => {
  it('an unknown build is null (the viewer then draws the box robot)', async () => {
    expect(await loadCadBody('no-such-build')).toBeNull();
  });

  it('every build the app knows loads with one object per part', async () => {
    for (const name of CAD_BUILD_NAMES) {
      const body = await loadCadBody(name);
      expect(body).toBeInstanceOf(CadBody);
      expect(body!.group.children[0].children.length).toBeGreaterThan(10);
    }
  });

  it('a cascade body rises with its carriage; a build without a motion spec stays still', async () => {
    const cascade = (await loadCadBody('cascade'))!;
    expect(cascade.animated).toBe(true);
    const parts = cascade.group.children[0].children;
    const before = parts.map((o) => o.matrix.elements.slice());
    cascade.setOut(6);
    const moved = parts.filter((o, i) => o.matrix.elements.some((v, k) => Math.abs(v - before[i][k]) > 1e-6));
    expect(moved.length).toBeGreaterThan(5);
    cascade.setOut(0);
    parts.forEach((o, i) => o.matrix.elements.forEach((v, k) => expect(v).toBeCloseTo(before[i][k], 6)));

    const dr4b = (await loadCadBody('dr4b'))!;
    expect(dr4b.animated).toBe(false);
    dr4b.setOut(30); // nothing to move: no error
  });
});
