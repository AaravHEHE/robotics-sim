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

/** A sensor's position on the robot (robot frame, inches) and the direction it faces. */
export interface SensorMount {
  x: number;
  y: number;
  /** Height above the tiles (default 3 for distance, 2 for optical). */
  z?: number;
  /** Degrees clockwise from the robot's forward direction. */
  heading: number;
}

export type DeviceSpec =
  | { type: 'motor'; port: number; cartridge: Cartridge; name?: string }
  | { type: 'imu'; port: number; name?: string }
  | { type: 'rotation'; port: number; name?: string; trackingWheel?: TrackingWheelSpec; mechanism?: string }
  | { type: 'distance'; port: number; name?: string; mount: SensorMount }
  | {
      type: 'optical';
      port: number;
      name?: string;
      /** Where it looks from (default: front center, 2" up, facing forward). */
      mount?: SensorMount;
      /** A claw, intake or staging area it looks into: it then reads what that holds. */
      watches?: string;
    }
  | {
      type: 'gps';
      port: number;
      name?: string;
      /** Where the sensor physically sits (heading: which way it faces; default forward). */
      mount?: { x: number; y: number; heading?: number };
    }
  | { type: 'vision' | 'ai_vision'; port: number; name?: string }
  | { type: 'adi_digital_out' | 'adi_digital_in'; port: string; name?: string };

/**
 * How a mechanism is driven: by motors (output angle = motor angle × ratio, optional
 * hard stops) or by a solenoid on an ADI port (0 = retracted, 1 = extended).
 */
export interface MechanismDrive {
  /** Motor ports driving it (unsigned). */
  motors?: number[];
  /** Output revolutions per motor revolution. */
  ratio?: number;
  /** Travel limits (hard stops), degrees of output rotation. */
  range?: [number, number];
  /** Solenoid port letter. */
  adi?: string;
  /** Named node in the GLB model that this mechanism animates. */
  node?: string;
}

/** A robot-frame point: +x right, +y forward, z up from the tiles (inches). */
export interface RobotPoint {
  x?: number;
  y: number;
  z: number;
}

/** A robot-frame rectangle on the floor plan: center (x right, y forward) and size. */
export interface RobotRect {
  x: number;
  y: number;
  width: number;
  length: number;
}

export type LiftType = 'arm' | 'fourbar' | 'sixbar' | 'dr4b' | 'cascade' | 'piston';

/** A lift. Its end effector sits at `home` when the lift's output is 0. */
export interface LiftSpec extends MechanismDrive {
  kind: 'lift';
  name: string;
  lift: LiftType;
  home: RobotPoint;
  /** Bar length (arm, fourbar, sixbar, dr4b), inches. */
  length?: number;
  /** Bar angle above horizontal at output 0 (arm, fourbar, sixbar, dr4b), degrees. */
  startAngle?: number;
  /** Spool diameter (cascade), inches. */
  spoolDiameter?: number;
  /** Stages moving with the carriage (cascade; default 1). */
  stages?: number;
  /** Rise when extended (piston), inches. */
  travel?: number;
  /**
   * Which way a bar lift (arm, fourbar, sixbar) reaches as it rises: 'front' (default) or
   * 'rear' for a lift that scores out of the back of the robot (its home y is then behind
   * the turning center).
   */
  facing?: 'front' | 'rear';
}

/** What a claw / intake / staging area can hold at once. */
export interface Capacity {
  pins: number;
  cups: number;
}

export type PreloadOrientation = 'alliance-down' | 'yellow-down';

export interface ClawSpec extends MechanismDrive {
  kind: 'claw';
  name: string;
  /** The lift it rides on; without one it sits fixed at `at`. */
  lift?: string;
  at?: RobotPoint;
  /**
   * piston: closed while the solenoid is extended (or retracted, see closedWhen);
   * motor: closed at or past `closedAt` degrees; roller: grabs while spinning inward.
   */
  grip: 'piston' | 'motor' | 'roller';
  closedWhen?: 'extended' | 'retracted';
  closedAt?: number;
  /** Sign of the output speed that pulls objects in (roller grip, default 1). */
  inward?: 1 | -1;
  /** Horizontal capture radius around the effector (default 2 in). */
  reach?: number;
  capacity?: Capacity;
  /** Start the Match holding the Preload Pin. */
  preload?: PreloadOrientation;
}

export interface IntakeSpec extends MechanismDrive {
  kind: 'intake';
  name: string;
  /** Capture area on the floor, robot frame. */
  zone: RobotRect;
  /** Where acquired pieces go (a claw or staging area); omitted = they stay in the intake. */
  into?: string;
  accepts?: { pins?: boolean; cups?: boolean; lying?: boolean };
  inward?: 1 | -1;
  /** Time from pickup to arrival at `into` (default 300 ms). */
  transferMs?: number;
  /** Diameter of the rollers that pull pieces in (default 2.75 in): sets how fast pieces pass. */
  rollerDiameter?: number;
  capacity?: Capacity;
  preload?: PreloadOrientation;
}

/** A passive holder where an intake assembles a Pin + Cup combo for a claw to grab. */
export interface StagingSpec extends MechanismDrive {
  kind: 'staging';
  name: string;
  at: RobotPoint;
  capacity?: Capacity;
  preload?: PreloadOrientation;
}

/** Flips what a claw holds end over end (motor output past 90°, or solenoid extended). */
export interface WristSpec extends MechanismDrive {
  kind: 'wrist';
  name: string;
  claw: string;
}

/**
 * Something that reaches a perimeter Toggle: a fixed bumper, a solenoid plate (active
 * while extended) or a spinning roller.
 */
export interface ToggleToolSpec extends MechanismDrive {
  kind: 'toggleTool';
  name: string;
  tool: 'bumper' | 'plate' | 'roller';
  /** Footprint, robot frame (the plate's extended position). */
  box: RobotRect;
  /** Height range it covers above the tiles. */
  bottom: number;
  top: number;
  /** Sign of the roller's output speed that rolls the Toggle's top into the field (default 1). */
  inward?: 1 | -1;
}

export type MechanismSpec =
  | (MechanismDrive & { kind: 'roller' | 'arm' | 'flywheel'; name: string; motors: number[]; ratio: number })
  | (MechanismDrive & { kind: 'piston'; name: string; adi: string; travel?: number })
  | LiftSpec
  | ClawSpec
  | IntakeSpec
  | StagingSpec
  | WristSpec
  | ToggleToolSpec;

/** Is the mechanism driven by a solenoid (state 0/1) rather than motors (angle)? */
export const isPneumatic = (m: MechanismSpec): boolean => typeof m.adi === 'string' && m.adi.length > 0;
/** Is it driven by motors? */
export const isMotorized = (m: MechanismSpec): boolean => Array.isArray(m.motors) && m.motors.length > 0;

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
  e.push(...validateMechanisms(r.mechanisms));
  for (const dev of r.devices) {
    if (dev.type !== 'optical' || dev.watches === undefined) continue;
    if (!r.mechanisms.some((m) => m.name === dev.watches && ['claw', 'intake', 'staging'].includes(m.kind))) {
      e.push(`Optical sensor on port ${dev.port}: watches "${dev.watches}" must name a claw, intake or staging mechanism.`);
    }
  }
  return e;
}

const KINDS = ['roller', 'arm', 'flywheel', 'piston', 'lift', 'claw', 'intake', 'staging', 'wrist', 'toggleTool'];
const LIFTS: LiftType[] = ['arm', 'fourbar', 'sixbar', 'dr4b', 'cascade', 'piston'];
const isPoint = (p: RobotPoint | undefined) => !!p && isNum(p.y, -40, 40) && isNum(p.z, -5, 80) && (p.x === undefined || isNum(p.x, -40, 40));
const isRect = (r: RobotRect | undefined) => !!r && isNum(r.x, -40, 40) && isNum(r.y, -40, 40) && isNum(r.width, 0.1, 40) && isNum(r.length, 0.1, 40);

function validateMechanisms(mechs: MechanismSpec[]): string[] {
  const e: string[] = [];
  const names = new Map(mechs.map((m) => [m.name, m]));
  if (names.size !== mechs.length) e.push('Mechanism names must be unique.');
  const drive = (m: MechanismSpec, need: 'motors' | 'adi' | 'either' | 'none') => {
    const hasM = isMotorized(m);
    const hasA = m.adi !== undefined;
    if (hasA && !/^[A-Ha-h]$/.test(String(m.adi))) e.push(`Mechanism ${m.name}: adi must be a letter A-H.`);
    if (hasM && !isNum(m.ratio, 1e-4, 1e4)) e.push(`Mechanism ${m.name}: needs motors and a positive ratio.`);
    if (hasM && hasA) e.push(`Mechanism ${m.name}: use either motors or adi, not both.`);
    if (need === 'motors' && !(hasM && isNum(m.ratio, 1e-4, 1e4))) e.push(`Mechanism ${m.name}: needs motors and a positive ratio.`);
    if (need === 'adi' && !hasA) e.push(`Mechanism ${m.name}: needs an adi port.`);
    if (need === 'either' && !hasM && !hasA) e.push(`Mechanism ${m.name}: needs motors (with a ratio) or an adi port.`);
  };
  const ref = (m: MechanismSpec, target: string | undefined, kinds: string[], what: string) => {
    if (target === undefined) return;
    const t = names.get(target);
    if (!t || !kinds.includes(t.kind)) e.push(`Mechanism ${m.name}: ${what} "${target}" must name a ${kinds.join(' or ')} mechanism.`);
  };
  const cap = (m: { name: string; capacity?: Capacity }) => {
    if (m.capacity && !(isNum(m.capacity.pins, 0, 10) && isNum(m.capacity.cups, 0, 10))) e.push(`Mechanism ${m.name}: capacity needs pins and cups counts.`);
  };
  let preloads = 0;
  for (const m of mechs) {
    if (!m.name) e.push('Every mechanism needs a name.');
    if (!KINDS.includes(m.kind)) {
      e.push(`Mechanism ${m.name}: unknown kind "${m.kind as string}".`);
      continue;
    }
    switch (m.kind) {
      case 'piston':
        drive(m, 'adi');
        break;
      case 'roller':
      case 'arm':
      case 'flywheel':
        drive(m, 'motors');
        break;
      case 'lift':
        if (!LIFTS.includes(m.lift)) e.push(`Lift ${m.name}: lift must be one of ${LIFTS.join(', ')}.`);
        drive(m, m.lift === 'piston' ? 'adi' : 'motors');
        if (!isPoint(m.home)) e.push(`Lift ${m.name}: home {y, z} is required (inches).`);
        if (['arm', 'fourbar', 'sixbar', 'dr4b'].includes(m.lift) && !isNum(m.length, 0.5, 60)) e.push(`Lift ${m.name}: length (bar length, in) is required.`);
        if (m.lift === 'cascade' && !isNum(m.spoolDiameter, 0.1, 10)) e.push(`Lift ${m.name}: spoolDiameter is required.`);
        if (m.lift === 'piston' && !isNum(m.travel, 0.1, 60)) e.push(`Lift ${m.name}: travel is required.`);
        if (m.facing !== undefined && m.facing !== 'front' && m.facing !== 'rear') e.push(`Lift ${m.name}: facing must be front or rear.`);
        break;
      case 'claw':
        if (!['piston', 'motor', 'roller'].includes(m.grip)) e.push(`Claw ${m.name}: grip must be piston, motor or roller.`);
        drive(m, m.grip === 'piston' ? 'adi' : 'motors');
        if (m.grip === 'motor' && !isNum(m.closedAt)) e.push(`Claw ${m.name}: closedAt (degrees) is required for a motor claw.`);
        ref(m, m.lift, ['lift'], 'lift');
        if (!m.lift && !isPoint(m.at)) e.push(`Claw ${m.name}: needs a lift or a fixed position at {y, z}.`);
        cap(m);
        break;
      case 'intake':
        drive(m, 'motors');
        if (!isRect(m.zone)) e.push(`Intake ${m.name}: zone {x, y, width, length} is required.`);
        ref(m, m.into, ['claw', 'staging'], 'into');
        if (m.rollerDiameter !== undefined && !(m.rollerDiameter > 0)) e.push(`Intake ${m.name}: rollerDiameter must be a positive number of inches.`);
        cap(m);
        break;
      case 'staging':
        drive(m, 'none');
        if (!isPoint(m.at)) e.push(`Staging ${m.name}: at {y, z} is required.`);
        cap(m);
        break;
      case 'wrist':
        drive(m, 'either');
        ref(m, m.claw, ['claw'], 'claw');
        break;
      case 'toggleTool':
        if (!['bumper', 'plate', 'roller'].includes(m.tool)) e.push(`Toggle tool ${m.name}: tool must be bumper, plate or roller.`);
        drive(m, m.tool === 'plate' ? 'adi' : m.tool === 'roller' ? 'motors' : 'none');
        if (!isRect(m.box)) e.push(`Toggle tool ${m.name}: box {x, y, width, length} is required.`);
        if (!isNum(m.bottom, 0, 80) || !isNum(m.top, 0, 80) || m.top <= m.bottom) e.push(`Toggle tool ${m.name}: needs bottom < top heights.`);
        break;
    }
    if ('preload' in m && m.preload) preloads++;
  }
  if (preloads > 1) e.push('Only one mechanism can hold the Preload.');
  return e;
}
