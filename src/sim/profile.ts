// Robot profiles: the robot's hardware, in real units (inches, rpm). The profile —
// never the cosmetic 3D model — determines size, collisions and speed.
// JSON schema: schemas/robot.schema.json. Documentation: docs/robot-profile.md.

export type Cartridge = 'red' | 'green' | 'blue';
export const CARTRIDGE_RPM: Record<Cartridge, number> = { red: 100, green: 200, blue: 600 };
/** PROS encoder ticks per motor output revolution, by cartridge. */
export const CARTRIDGE_TICKS: Record<Cartridge, number> = { red: 1800, green: 900, blue: 300 };

export interface TrackingWheelSpec {
  /** Which way the wheel rolls: 'vertical' = forward/back, 'horizontal' = sideways. */
  axis: 'vertical' | 'horizontal';
  wheelDiameter: number;
  /** Offset from the robot's center of rotation, inches (vertical: + right, horizontal: + forward). */
  offset: number;
}

export type DeviceSpec =
  | { type: 'motor'; port: number; cartridge: Cartridge; name?: string }
  | { type: 'imu'; port: number; name?: string }
  | { type: 'rotation'; port: number; name?: string; trackingWheel?: TrackingWheelSpec; mechanism?: string }
  | { type: 'distance'; port: number; name?: string; mount: { x: number; y: number; heading: number } }
  | { type: 'optical' | 'gps' | 'vision' | 'ai_vision'; port: number; name?: string }
  | { type: 'adi_digital_out' | 'adi_digital_in'; port: string; name?: string };

export type MechanismSpec =
  | {
      kind: 'roller' | 'arm' | 'flywheel';
      name: string;
      /** Motor ports driving it (unsigned). */
      motors: number[];
      /** Output revolutions per motor revolution. */
      ratio: number;
      /** Optional travel limits for arms, degrees of output rotation. */
      range?: [number, number];
      /** Named node in the GLB model that this mechanism animates. */
      node?: string;
    }
  | { kind: 'piston'; name: string; adi: string; node?: string; travel?: number };

export interface RobotProfile {
  schema: 1;
  id: string;
  name: string;
  description?: string;
  /** Overall footprint used for collisions and the default box model. */
  size: { width: number; length: number; height: number };
  mass?: number;
  drivetrain: {
    type: 'tank';
    /** Signed ports, written the way code must declare them for "forward" to drive forward. */
    left: number[];
    right: number[];
    cartridge: Cartridge;
    wheelDiameter: number;
    /** Wheel rpm at full motor speed, after gearing. */
    wheelRpm: number;
    /** Distance between left and right wheel centers. */
    trackWidth: number;
    /** Maximum linear acceleration, in/s^2 (idealized; limits both speeding up and braking). */
    maxAccel: number;
    /** Fraction of free speed actually reached under load (0..1, default 1). */
    speedScale?: number;
  };
  devices: DeviceSpec[];
  mechanisms: MechanismSpec[];
  model?: {
    /** IndexedDB key of a user-imported GLB. Cosmetic only. */
    assetId: string;
    scale?: number;
    offset?: [number, number, number];
    rotationDeg?: number;
  };
}

/** Theoretical top speed in in/s. */
export function maxSpeed(p: RobotProfile): number {
  const d = p.drivetrain;
  return ((d.wheelRpm * Math.PI * d.wheelDiameter) / 60) * (d.speedScale ?? 1);
}

const isNum = (v: unknown, min = -Infinity, max = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** Validate a profile; returns human-readable problems (empty = valid). */
export function validateProfile(p: unknown): string[] {
  const e: string[] = [];
  const r = p as RobotProfile;
  if (!r || typeof r !== 'object') return ['Profile must be a JSON object.'];
  if (r.schema !== 1) e.push('schema must be 1.');
  if (!r.id || typeof r.id !== 'string') e.push('id is required.');
  if (!r.name || typeof r.name !== 'string') e.push('name is required.');
  if (!r.size || !isNum(r.size.width, 1, 36) || !isNum(r.size.length, 1, 36) || !isNum(r.size.height, 1, 36)) {
    e.push('size.width / length / height must be numbers in inches (1-36).');
  }
  const d = r.drivetrain;
  if (!d) e.push('drivetrain is required.');
  else {
    if (d.type !== 'tank') e.push('drivetrain.type must be "tank" (other drivetrains are not supported yet).');
    for (const side of ['left', 'right'] as const) {
      if (!Array.isArray(d[side]) || !d[side].length || !d[side].every((x) => Number.isInteger(x) && Math.abs(x) >= 1 && Math.abs(x) <= 21)) {
        e.push(`drivetrain.${side} must be a non-empty list of ports 1-21 (negative = reversed).`);
      }
    }
    if (!(d.cartridge in CARTRIDGE_RPM)) e.push('drivetrain.cartridge must be red, green or blue.');
    if (!isNum(d.wheelDiameter, 1, 10)) e.push('drivetrain.wheelDiameter must be 1-10 inches.');
    if (!isNum(d.wheelRpm, 1, 1200)) e.push('drivetrain.wheelRpm must be 1-1200.');
    if (!isNum(d.trackWidth, 2, 30)) e.push('drivetrain.trackWidth must be 2-30 inches.');
    if (!isNum(d.maxAccel, 1, 1000)) e.push('drivetrain.maxAccel must be 1-1000 in/s^2.');
    if (d.speedScale !== undefined && !isNum(d.speedScale, 0.1, 1)) e.push('drivetrain.speedScale must be 0.1-1.');
  }
  if (!Array.isArray(r.devices)) e.push('devices must be a list.');
  if (!Array.isArray(r.mechanisms)) e.push('mechanisms must be a list.');
  if (e.length) return e;

  const used = new Map<string, string>();
  const claim = (port: string, what: string) => {
    if (used.has(port)) e.push(`Port ${port} is used by both ${used.get(port)} and ${what}.`);
    used.set(port, what);
  };
  for (const p of [...d.left, ...d.right]) claim(String(Math.abs(p)), 'the drivetrain');
  for (const dev of r.devices) {
    if (dev.type === 'adi_digital_out' || dev.type === 'adi_digital_in') {
      if (!/^[A-Ha-h]$/.test(String(dev.port))) e.push(`ADI port ${dev.port} must be a letter A-H.`);
      claim(String(dev.port).toUpperCase(), dev.name ?? dev.type);
    } else {
      const port = dev.port as number;
      if (!Number.isInteger(port) || port < 1 || port > 21) e.push(`${dev.type} port ${dev.port} must be 1-21.`);
      claim(String(dev.port), dev.name ?? dev.type);
    }
  }
  for (const m of r.mechanisms) {
    if (!m.name) e.push('Every mechanism needs a name.');
    if (m.kind === 'piston') {
      if (!/^[A-Ha-h]$/.test(m.adi)) e.push(`Mechanism ${m.name}: adi must be a letter A-H.`);
    } else if (!Array.isArray(m.motors) || !m.motors.length || !isNum(m.ratio, 1e-4, 1e4)) {
      e.push(`Mechanism ${m.name}: needs motors and a positive ratio.`);
    }
  }
  return e;
}
