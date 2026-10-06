// New mechanisms and sensors for the robot layout editor: each one valid as added (free
// ports picked, a motor device added for each motor), placed sensibly for the robot's size.

import type { DeviceSpec, MechanismSpec, RobotProfile } from '../../sim/profile.ts';

export const MECHANISM_TEMPLATES = {
  arm: 'Arm lift + claw',
  fourbar: '4-bar lift + claw',
  dr4b: 'DR4B lift + claw',
  cascade: 'Cascade lift + claw',
  intake: 'Intake',
  roller: 'Roller (spins)',
  piston: 'Piston',
  bumper: 'Toggle bumper',
  staging: 'Staging tray',
} as const;
export const SENSOR_TEMPLATES = { distance: 'Distance sensor', optical: 'Optical sensor', gps: 'GPS', rotation: 'Rotation sensor', imu: 'IMU' } as const;

export type MechanismTemplate = keyof typeof MECHANISM_TEMPLATES;
export type SensorTemplate = keyof typeof SENSOR_TEMPLATES;

/** The lowest smart port no device or drive motor uses. */
export function freePort(p: RobotProfile): number {
  const used = new Set([...p.drivetrain.left, ...p.drivetrain.right].map((x) => Math.abs(x)));
  for (const d of p.devices) if (typeof d.port === 'number') used.add(d.port);
  for (let i = 1; i <= 21; i++) if (!used.has(i)) return i;
  throw new Error('All 21 smart ports are in use.');
}

/** The first three-wire port (A-H) no device uses. */
export function freeAdi(p: RobotProfile): string {
  const used = new Set(p.devices.filter((d) => typeof d.port === 'string').map((d) => String(d.port).toUpperCase()));
  for (const c of 'ABCDEFGH') if (!used.has(c)) return c;
  throw new Error('All 8 three-wire ports are in use.');
}

/** A name not yet taken ("Claw", "Claw 2", ...). */
export function freeName(p: RobotProfile, base: string): string {
  const names = new Set(p.mechanisms.map((m) => m.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

const motor = (p: RobotProfile, name: string, cartridge: 'red' | 'green' | 'blue' = 'green'): number => {
  const port = freePort(p);
  p.devices.push({ type: 'motor', port, cartridge, name });
  return port;
};
const adi = (p: RobotProfile, name: string): string => {
  const port = freeAdi(p);
  p.devices.push({ type: 'adi_digital_out', port, name });
  return port;
};

/** Add a mechanism (and its motors or piston port) to the profile; returns its name. */
export function addMechanism(p: RobotProfile, t: MechanismTemplate): string {
  const front = p.size.length / 2;
  const add = (m: MechanismSpec) => {
    p.mechanisms.push(m);
    return m.name;
  };
  if (t === 'arm' || t === 'fourbar' || t === 'dr4b' || t === 'cascade') {
    const name = freeName(p, t === 'arm' ? 'Arm' : t === 'fourbar' ? '4-bar' : t === 'dr4b' ? 'DR4B' : 'Cascade');
    const ports = t === 'arm' ? [motor(p, `${name}`)] : [motor(p, `${name} L`), motor(p, `${name} R`)];
    const lift: MechanismSpec =
      t === 'cascade'
        ? { kind: 'lift', name, lift: 'cascade', motors: ports, ratio: 1 / 3, range: [0, 1000], home: { y: front - 1, z: 4 }, spoolDiameter: 1.375, stages: 2 }
        : t === 'dr4b'
          ? { kind: 'lift', name, lift: 'dr4b', motors: ports, ratio: 1 / 5, range: [0, 100], home: { y: front + 1, z: 3 }, length: 10, startAngle: -40 }
          : { kind: 'lift', name, lift: t, motors: ports, ratio: 1 / 5, range: [0, 100], home: { y: front + 2.5, z: 3 }, length: 10, startAngle: -25 };
    add(lift);
    add({ kind: 'claw', name: freeName(p, 'Claw'), lift: name, grip: 'piston', adi: adi(p, 'Claw') });
    return name;
  }
  if (t === 'intake') return add({ kind: 'intake', name: freeName(p, 'Intake'), motors: [motor(p, 'Intake', 'blue')], ratio: 1, zone: { x: 0, y: front + 0.75, width: 8, length: 1.5 } });
  if (t === 'roller') return add({ kind: 'roller', name: freeName(p, 'Roller'), motors: [motor(p, 'Roller')], ratio: 1 });
  if (t === 'piston') return add({ kind: 'piston', name: freeName(p, 'Piston'), adi: adi(p, 'Piston') });
  if (t === 'bumper') return add({ kind: 'toggleTool', name: freeName(p, 'Toggle bumper'), tool: 'bumper', box: { x: 0, y: front + 0.25, width: Math.min(12, p.size.width), length: 0.5 }, bottom: 11, top: 13.5 });
  return add({ kind: 'staging', name: freeName(p, 'Tray'), at: { y: 0, z: 6 } });
}

/** Add a sensor; returns its index in devices. */
export function addSensor(p: RobotProfile, t: SensorTemplate): number {
  const port = freePort(p);
  const front = p.size.length / 2;
  const d: DeviceSpec =
    t === 'distance'
      ? { type: 'distance', port, name: 'Distance', mount: { x: 0, y: front, heading: 0 } }
      : t === 'optical'
        ? { type: 'optical', port, name: 'Optical', mount: { x: 0, y: front, heading: 0 } }
        : t === 'gps'
          ? { type: 'gps', port, name: 'GPS', mount: { x: 0, y: 0, heading: 0 } }
          : t === 'rotation'
            ? { type: 'rotation', port, name: 'Rotation' }
            : { type: 'imu', port, name: 'IMU' };
  p.devices.push(d);
  return p.devices.length - 1;
}

/**
 * Remove a mechanism, the mechanisms that only make sense with it (a claw on a removed lift
 * loses its lift: it gets a fixed position instead), and the motor and piston ports no
 * other mechanism uses.
 */
export function removeMechanism(p: RobotProfile, name: string): void {
  const m = p.mechanisms.find((x) => x.name === name);
  if (!m) return;
  p.mechanisms = p.mechanisms.filter((x) => x !== m);
  for (const x of p.mechanisms) {
    const r = x as unknown as Record<string, unknown>;
    if (x.kind === 'claw' && x.lift === name) {
      delete r.lift;
      x.at = { y: p.size.length / 2 + 1, z: 3 };
    }
    if (x.kind === 'lift' && x.base === name) delete r.base;
    if (x.kind === 'intake' && x.into === name) delete r.into;
    if (x.kind === 'wrist' && x.claw === name) p.mechanisms = p.mechanisms.filter((y) => y !== x);
  }
  const stillUsed = (port: number | string) => p.mechanisms.some((x) => x.motors?.includes(port as number) || (x.adi !== undefined && String(x.adi).toUpperCase() === String(port).toUpperCase()));
  p.devices = p.devices.filter((d) => {
    const own = (d.type === 'motor' && m.motors?.includes(d.port as number)) || (d.type === 'adi_digital_out' && m.adi !== undefined && String(m.adi).toUpperCase() === String(d.port).toUpperCase());
    return !own || stillUsed(d.port);
  });
  // optical sensors that watched it
  for (const d of p.devices) if (d.type === 'optical' && d.watches === name) delete (d as { watches?: string }).watches;
}
