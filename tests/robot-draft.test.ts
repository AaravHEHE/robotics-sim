// The robot layout editor's model: each draggable shape reads and writes the right profile fields.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { barPivot, handlesFor, setBarTip, snapIn } from '../src/app/robot-editor/draft.ts';
import { liftEffector } from '../src/sim/lift.ts';
import { validateProfile, type LiftSpec, type RobotProfile } from '../src/sim/profile.ts';
import { robot } from './helpers.ts';

const presets = readdirSync(path.join(repoRoot, 'data/robots')).map((f) => f.replace(/\.json$/, ''));

describe('robot layout editor', () => {
  it('putting every shape back where it is changes nothing, for every preset', async () => {
    for (const id of presets) {
      const p = await robot(id);
      const before = JSON.stringify(p);
      const draft = structuredClone(p) as RobotProfile;
      for (const h of handlesFor(draft)) h.set(draft, h.get(draft));
      expect(validateProfile(draft), id).toEqual([]);
      // (values are kept to 0.01 in: presets are already that precise or the rounding is invisible)
      const a = JSON.parse(before) as RobotProfile;
      expect(draft.size, id).toEqual(a.size);
      expect(draft.drivetrain.trackWidth, id).toBeCloseTo(a.drivetrain.trackWidth, 2);
    }
  });

  it('each preset gets shapes for its chassis, track and placed mechanisms', async () => {
    const p = await robot('override-banshee');
    const ids = handlesFor(p).map((h) => h.id);
    expect(ids).toEqual(expect.arrayContaining(['chassis-top', 'chassis-side', 'track', 'mech:Arm:home', 'mech:Arm:pivot', 'mech:Intake:rect', 'mech:Intake:handoff']));
    expect(ids.some((i) => i.startsWith('mech:Toggle bumper'))).toBe(true);
    const dr4b = handlesFor(await robot('override-dr4b-intake')).map((h) => h.id);
    expect(dr4b).toContain('mech:DR4B:home');
    expect(dr4b).not.toContain('mech:DR4B:pivot'); // a DR4B rises straight up: no pivot to drag
    expect(dr4b.filter((i) => i.startsWith('dev:'))).toHaveLength(2); // GPS and the chamber eye
  });

  it('resizing the chassis edits size; the track edits trackWidth', async () => {
    const p = await robot('override-flex');
    const hs = handlesFor(p);
    hs.find((h) => h.id === 'chassis-top')!.set(p, { u: 0, v: 0, w: 15, h: 16.5 });
    hs.find((h) => h.id === 'chassis-side')!.set(p, { u: 0, v: 7, w: 16.5, h: 14 });
    hs.find((h) => h.id === 'track')!.set(p, { u: -6.25, v: 3 });
    expect(p.size).toEqual({ width: 15, length: 16.5, height: 14 });
    expect(p.drivetrain.trackWidth).toBe(12.5);
  });

  it('dragging a bar lift tip keeps its pivot: the length and start angle follow', async () => {
    for (const id of ['override-banshee', 'override-flex', 'override-sixbar-wrist', 'override-fourbar-claw', 'override-ace']) {
      const p = await robot(id);
      const lift = p.mechanisms.find((m) => m.kind === 'lift' && ['arm', 'fourbar', 'sixbar', 'chainbar'].includes(m.lift)) as LiftSpec;
      const pivot = barPivot(lift);
      setBarTip(lift, { y: lift.home.y + 2, z: lift.home.z + 3 });
      const after = barPivot(lift);
      expect(after.y, id).toBeCloseTo(pivot.y, 1);
      expect(after.z, id).toBeCloseTo(pivot.z, 1);
      // the simulator's own kinematics put the tip at home at output 0
      const e = liftEffector(lift, 0);
      expect(e.y).toBeCloseTo(lift.home.y, 6);
      expect(e.z).toBeCloseTo(lift.home.z, 6);
      expect(validateProfile(p), id).toEqual([]);
    }
  });

  it('moving a pivot carries the lift; toggle tool height edits bottom and top', async () => {
    const p = await robot('override-banshee');
    const hs = handlesFor(p);
    const piv = hs.find((h) => h.id === 'mech:Arm:pivot')!;
    const home = hs.find((h) => h.id === 'mech:Arm:home')!;
    const t0 = home.get(p);
    const p0 = piv.get(p);
    piv.set(p, { u: p0.u - 1, v: p0.v + 2 });
    expect(home.get(p).u).toBeCloseTo(t0.u - 1, 6);
    expect(home.get(p).v).toBeCloseTo(t0.v + 2, 6);
    const tool = hs.find((h) => h.id === 'mech:Toggle bumper:height')!;
    tool.set(p, { u: 7.75, v: 12.5, w: 0.5, h: 3 });
    const bumper = p.mechanisms.find((m) => m.name === 'Toggle bumper') as { bottom: number; top: number };
    expect([bumper.bottom, bumper.top]).toEqual([11, 14]);
  });

  it('snapping', () => {
    expect(snapIn(1.13, false)).toBe(1.25);
    expect(snapIn(1.13, true)).toBe(1);
  });
});

describe('adding and removing parts in the layout editor', async () => {
  const { addMechanism, addSensor, removeMechanism, MECHANISM_TEMPLATES, SENSOR_TEMPLATES } = await import('../src/app/robot-editor/templates.ts');

  it('every mechanism and sensor can be added to every preset and the robot stays valid', async () => {
    for (const id of presets) {
      for (const t of Object.keys(MECHANISM_TEMPLATES) as Array<keyof typeof MECHANISM_TEMPLATES>) {
        const p = structuredClone(await robot(id));
        let ok = true;
        try {
          addMechanism(p, t);
        } catch (e) {
          ok = /ports are in use/.test((e as Error).message); // a full robot says so instead
        }
        expect(ok, `${id} + ${t}`).toBe(true);
        expect(validateProfile(p), `${id} + ${t}`).toEqual([]);
        expect(handlesFor(p).length).toBeGreaterThan(2);
      }
      for (const t of Object.keys(SENSOR_TEMPLATES) as Array<keyof typeof SENSOR_TEMPLATES>) {
        const p = structuredClone(await robot(id));
        try {
          addSensor(p, t);
        } catch {
          /* no free port */
        }
        expect(validateProfile(p), `${id} + ${t}`).toEqual([]);
      }
    }
  });

  it('removing mechanisms frees their ports and keeps the robot valid', async () => {
    for (const id of presets) {
      const p = structuredClone(await robot(id));
      const motors = p.devices.filter((d) => d.type === 'motor').length;
      for (const m of [...p.mechanisms]) {
        removeMechanism(p, m.name);
        expect(validateProfile(p), `${id} - ${m.name}`).toEqual([]);
      }
      expect(p.mechanisms).toEqual([]);
      expect(p.devices.filter((d) => d.type === 'motor').length).toBeLessThanOrEqual(motors);
      expect(p.devices.some((d) => d.type === 'adi_digital_out')).toBe(false);
    }
  });
});
