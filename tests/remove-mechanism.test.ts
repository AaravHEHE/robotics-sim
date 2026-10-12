// Removing a mechanism leaves a profile that still validates: the sensors and wrists that used it are cleaned up.
import { describe, expect, it } from 'vitest';
import { removeMechanism, renameReferences } from '../src/app/robot-editor/templates.ts';
import { validateProfile, type RobotProfile } from '../src/sim/profile.ts';
import { robot } from './helpers.ts';

describe('removeMechanism', () => {
  it('a rotation sensor that read the removed lift no longer points at it', async () => {
    const p = structuredClone(await robot('override-ace')) as RobotProfile;
    const lift = p.mechanisms.find((m) => m.kind === 'lift')!;
    p.devices.push({ type: 'rotation', port: 19, name: 'Arm angle', mechanism: lift.name } as RobotProfile['devices'][number]);
    removeMechanism(p, lift.name);
    const rot = p.devices.find((d) => d.type === 'rotation' && d.name === 'Arm angle') as { mechanism?: string } | undefined;
    expect(rot?.mechanism).toBeUndefined();
    expect(validateProfile(p).filter((e) => e.includes('Arm angle'))).toEqual([]);
  });
});

describe('renameReferences', () => {
  it('renaming the lift a chain bar rides keeps the profile valid', async () => {
    const p = structuredClone(await robot('override-ace')) as RobotProfile;
    const bar = p.mechanisms.find((m) => m.kind === 'lift' && m.base !== undefined) as { base: string };
    const base = p.mechanisms.find((m) => m.name === bar.base)!;
    renameReferences(p, base.name, 'Renamed');
    base.name = 'Renamed';
    expect(validateProfile(p)).toEqual([]);
  });
});
