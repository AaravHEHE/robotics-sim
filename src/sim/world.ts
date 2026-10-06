// The simulated robot on the field: motors, idealized tank drivetrain, sensors and
// wall collisions. Stepped at a fixed 1 ms by the runtime. All math is deterministic
// (dmath.ts) so a given program produces bit-identical results on every machine.

import { dcos, dcosDeg, dhypot, dsin, dsinDeg, RAD, wrap180 } from './dmath.ts';
import type { FieldDef, GoalDef, Vec2 } from './field.ts';
import { CARTRIDGE_RPM, CARTRIDGE_TICKS, isMotorized, isPneumatic, maxSpeed, type Cartridge, type DeviceSpec, type MechanismSpec, type RobotProfile, type SensorMount } from './profile.ts';

export interface Pose {
  x: number;
  y: number;
  /** degrees, 0 = +y, clockwise positive (continuous, not wrapped) */
  theta: number;
}

const CARTRIDGE_BY_GEARSET: Cartridge[] = ['red', 'green', 'blue'];
/** Seconds for a free-spinning mechanism motor to reach full speed. */
const MOTOR_SPINUP_S = 0.15;
/**
 * Drivetrain motor torque at stall, as a multiple of the traction limit (maxAccel): torque
 * falls linearly to zero at free speed, so a robot speeds up at the traction limit until
 * about 2/3 of top speed, then more and more slowly; braking from speed stays strong.
 */
const STALL_ACCEL_FACTOR = 3;
/** Seconds for a pneumatic cylinder to stroke fully. */
const PISTON_STROKE_S = 0.15;
/** Share of a lift motor's speed lost to the lift's weight going up. */
const LIFT_LOAD = 0.2;
/** An unpowered lift falls at this share of free speed (coast), or creeps down (brake). */
const LIFT_SAG = 0.25;
const LIFT_CREEP = 0.02;
/** Unpowered, coasting: rolling friction plus back-driving the gearboxes (in/s^2); a robot
 * coasting from full speed rolls on for about a foot. */
const COAST_DECEL = 150;
/** Friction that brings a braking robot to a final stop (in/s^2). */
const FRICTION_DECEL = 40;

export type MotorMode = 'voltage' | 'velocity' | 'position';

export class MotorState {
  readonly port: number;
  /** Physical cartridge from the profile (null = no motor on this port). */
  readonly cartridge: Cartridge | null;
  /**
   * Gearset the code configured. Like a real V5 motor, encoder degrees/rotations and
   * velocities are scaled by this setting, while raw counts are physical ticks.
   * PROS leaves the motor's default (18:1, green) unless code sets it.
   */
  codeGearset = 1;
  gearsetSetByCode = false;
  /** 0 degrees, 1 rotations, 2 counts. The motor firmware default is raw counts (EZ-Template relies on it). */
  encoderUnits = 2;
  brakeMode = 0; // 0 coast, 1 brake, 2 hold
  mode: MotorMode = 'voltage';
  /** voltage: -127..127 (physical direction) · velocity: rpm in configured-gearset units · position: target physical angle (deg) */
  cmd = 0;
  /** Profiled-move speed, configured-gearset rpm. */
  profileRpm = 0;
  /** Physical output-shaft speed (rpm) and cumulative angle (deg), unsigned frame. */
  rpm = 0;
  angle = 0;
  /** Physical angle at which the reported position is zero. */
  zero = 0;
  /** Drivetrain motors are driven by the drivetrain model, not their own ramp. */
  driveSide: 'left' | 'right' | null = null;
  driveMount = 1;
  voltageLimit = 0;
  currentLimit = 2500;
  /**
   * Acceleration of position moves (move_absolute/relative), deg/s^2 of the output shaft.
   * Free-spinning motors: full speed in MOTOR_SPINUP_S; drive motors: the drivetrain's.
   */
  positionAccel: number | null = null;
  /** Lift motors: sign of the motor direction that raises the lift (0 = not a lift). */
  liftUp = 0;
  /**
   * A bar lift (arm, 4-bar, 6-bar, DR4B, chain bar) this motor drives: past vertical its
   * weight pulls the other way. Its bar angle is startAngle + motor angle × ratio.
   */
  barLift: { startAngle: number; ratio: number } | null = null;

  constructor(port: number, cartridge: Cartridge | null) {
    this.port = port;
    this.cartridge = cartridge;
  }

  get freeRpm(): number {
    return this.cartridge ? CARTRIDGE_RPM[this.cartridge] : 0;
  }

  private get physTicks(): number {
    return CARTRIDGE_TICKS[this.cartridge ?? 'green'];
  }

  private get codeTicks(): number {
    return CARTRIDGE_TICKS[CARTRIDGE_BY_GEARSET[this.codeGearset] ?? 'green'];
  }

  /** Physical rpm -> rpm as reported/commanded in configured-gearset units. */
  get codeRpmPerPhysRpm(): number {
    return this.physTicks / this.codeTicks;
  }

  /**
   * Share of its torque the motor may use under its current limit (2500 mA = all of it).
   * The limit caps current, so torque: how hard the motor accelerates, not its top speed.
   */
  get torqueShare(): number {
    return Math.max(0, Math.min(1, this.currentLimit / 2500));
  }

  /** A current limit of 0 lets no current through: the motor is unpowered whatever it is told. */
  get noPower(): boolean {
    return this.currentLimit <= 0;
  }

  /** Target physical rpm from the current command. */
  targetRpm(): number {
    if (this.noPower) return 0;
    const free = this.freeRpm;
    switch (this.mode) {
      case 'voltage': {
        let v = Math.max(-127, Math.min(127, this.cmd));
        if (this.voltageLimit > 0) v = Math.max((-this.voltageLimit / 12000) * 127, Math.min((this.voltageLimit / 12000) * 127, v));
        return (v / 127) * free;
      }
      case 'velocity':
        return Math.max(-free, Math.min(free, this.cmd / this.codeRpmPerPhysRpm));
      case 'position': {
        const err = this.cmd - this.angle;
        const accel = this.positionAccel ?? (free / MOTOR_SPINUP_S) * 6; // deg/s^2 (rpm/s * 6)
        const vmax = Math.min(Math.abs(this.profileRpm / this.codeRpmPerPhysRpm), free) * 6; // deg/s
        const v = Math.min(vmax, Math.sqrt(2 * accel * Math.abs(err)));
        return (Math.sign(err) * v) / 6;
      }
    }
  }

  /** Raw encoder count (ticks of the physical cartridge) for a signed port. */
  rawTicks(sign: number): number {
    return ((sign * (this.angle - this.zero)) / 360) * this.physTicks;
  }

  /** Reported encoder position in the code's units for a signed port. */
  reported(sign: number): number {
    return this.reportedAt(this.angle, sign);
  }

  /** What the encoder would report at physical angle `angle` (deg). */
  reportedAt(angle: number, sign: number): number {
    const ticks = ((sign * (angle - this.zero)) / 360) * this.physTicks;
    if (this.encoderUnits === 2) return ticks;
    const rotations = ticks / this.codeTicks;
    return this.encoderUnits === 1 ? rotations : rotations * 360;
  }

  /** Convert a position in the code's units to a physical angle offset (deg). */
  fromUnits(value: number): number {
    const ticks = this.encoderUnits === 2 ? value : (this.encoderUnits === 1 ? value : value / 360) * this.codeTicks;
    return (ticks / this.physTicks) * 360;
  }
}
export interface ImuState {
  port: number;
  calibratingUntil: number;
  rotationOffset: number;
  headingOffset: number;
  pitchOffset: number;
  rollOffset: number;
  yawOffset: number;
}

export interface RotationState {
  port: number;
  spec: Extract<DeviceSpec, { type: 'rotation' }>;
  /** centidegrees accumulated by the physical sensor */
  raw: number;
  velocity: number;
  zero: number;
  reversed: boolean;
}

export interface Collision {
  t: number;
  wall: string;
}

/** Idealized motion controller: returns desired side wheel velocities (in/s). */
export interface DriveController {
  update(world: World, dt: number): [number, number];
}

/** A sensor beam in the field frame: origin, unit direction and height above the tiles. */
export interface SensorBeam {
  ox: number;
  oy: number;
  dx: number;
  dy: number;
  z: number;
}

/** Color and closeness of whatever an optical sensor sees (PROS units). */
export interface OpticalReading {
  /** 0-360 degrees */
  hue: number;
  /** 0-1 */
  saturation: number;
  /** 0-1 */
  brightness: number;
  /** 0 (nothing) - 255 (touching) */
  proximity: number;
}

/** Game-specific sensing, installed by the game running on the field. */
export interface SensorHooks {
  /** Distance along a beam to the nearest game object (Infinity if none). */
  objectRay?: (beam: SensorBeam) => number;
  /** What an optical sensor sees. */
  optical?: (device: Extract<DeviceSpec, { type: 'optical' }>) => OpticalReading;
}

export class World {
  readonly profile: RobotProfile;
  readonly field: FieldDef;
  pose: Pose;
  /** Side wheel surface speeds, in/s (forward positive). */
  vL = 0;
  vR = 0;
  /** Forward acceleration of the robot center, in/s^2 (for the IMU accelerometer). */
  accelForward = 0;
  readonly motors = new Map<number, MotorState>();
  readonly imus = new Map<number, ImuState>();
  readonly rotations = new Map<number, RotationState>();
  readonly adiOut = new Map<string, boolean>();
  /** Stroke position (0 retracted .. 1 extended) of each solenoid that drives a mechanism. */
  readonly pistons = new Map<string, number>();
  readonly adiConfig = new Map<string, number>();
  /** Drive controller of the active idealized motion, if any. */
  controller: DriveController | null = null;
  readonly collisions: Collision[] = [];
  private lastCollisionWall = '';
  private lastObstacle = '';
  private readonly lastContact = new Map<string, number>();
  /** What a game adds to the robot's sensors (game objects, colors). */
  sensors: SensorHooks = {};
  /** Static convex obstacles (goals, loaders, field objects) in the field frame. */
  readonly obstacles: Obstacle[];
  /** Movable objects that currently can't move out of the robot's way (set by a game). */
  pinnedObstacles: Obstacle[] = [];
  /** Claws and what they hold, outside the robot's frame (set by a game): they can't pass through things either. */
  attachments: Attachment[] = [];
  /**
   * Attachment / obstacle pairs that overlap without blocking: the carried object came down
   * onto its top from above (being set on a Goal or stack) or was picked up already touching it.
   * Each pair blocks again once the two are apart.
   */
  private readonly overlapping = new Set<string>();
  /** The pairs in `overlapping` that met from above: lowering further would sink into it. */
  private readonly resting = new Set<string>();
  private readonly knownAttachments = new Set<string>();
  /**
   * What the robot carries for the mechanisms' current positions (set by a game): a lift that
   * would lower something into what it rests on stalls there, as a real lift stops on a Goal.
   */
  attachmentsAt: (() => Attachment[]) | null = null;
  time = 0;
  /** Total distance driven by each side, in (for tracking/drive encoders). */
  private readonly maxV: number;

  constructor(profile: RobotProfile, field: FieldDef, start: Pose) {
    this.profile = profile;
    this.field = field;
    this.pose = { ...start };
    this.maxV = maxSpeed(profile);
    this.obstacles = fieldObstacles(field);
    const dt = profile.drivetrain;
    for (const [side, ports] of [['left', dt.left], ['right', dt.right]] as const) {
      for (const p of ports) {
        const m = new MotorState(Math.abs(p), dt.cartridge);
        m.driveSide = side;
        m.driveMount = Math.sign(p) || 1;
        // in/s^2 at the wheel -> deg/s^2 at the motor
        m.positionAccel = (dt.maxAccel / (Math.PI * dt.wheelDiameter)) * 360 * (CARTRIDGE_RPM[dt.cartridge] / dt.wheelRpm);
        this.motors.set(m.port, m);
      }
    }
    for (const mech of profile.mechanisms) {
      if (isPneumatic(mech)) this.pistons.set(mech.adi!.toUpperCase(), 0);
    }
    for (const d of profile.devices) {
      if (d.type === 'motor') this.motors.set(d.port, new MotorState(d.port, d.cartridge));
      // an IMU reads 0 where it powered on (the start), not the field heading
      const t0 = start.theta;
      if (d.type === 'imu') this.imus.set(d.port, { port: d.port, calibratingUntil: 0, rotationOffset: t0, headingOffset: t0, pitchOffset: 0, rollOffset: 0, yawOffset: t0 });
      if (d.type === 'rotation') this.rotations.set(d.port, { port: d.port, spec: d, raw: 0, velocity: 0, zero: 0, reversed: false });
    }
    // lift motors carry the lift's weight (a positive output raises a lift)
    for (const mech of profile.mechanisms) {
      if (mech.kind !== 'lift' || !isMotorized(mech)) continue;
      for (const port of mech.motors!) {
        const m = this.motors.get(port);
        if (!m) continue;
        m.liftUp = Math.sign(mech.ratio ?? 1) || 1;
        if (['arm', 'fourbar', 'sixbar', 'dr4b', 'chainbar'].includes(mech.lift)) m.barLift = { startAngle: mech.startAngle ?? 0, ratio: mech.ratio ?? 1 };
      }
    }
  }

  get maxSpeed(): number {
    return this.maxV;
  }

  get accel(): number {
    return this.profile.drivetrain.maxAccel;
  }

  get trackWidth(): number {
    return this.profile.drivetrain.trackWidth;
  }

  deviceAt(port: number): DeviceSpec | 'drive-motor' | null {
    const dt = this.profile.drivetrain;
    if ([...dt.left, ...dt.right].some((p) => Math.abs(p) === port)) return 'drive-motor';
    return this.profile.devices.find((d) => d.port === port) ?? null;
  }

  /** Motor on a port; creates an "empty port" placeholder so code can still run. */
  motor(port: number): MotorState {
    const p = Math.abs(port);
    let m = this.motors.get(p);
    if (!m) {
      m = new MotorState(p, null);
      this.motors.set(p, m);
    }
    return m;
  }

  /** Desired side velocities from raw motor commands (no active motion controller). */
  private sideTargetsFromMotors(): [number, number] {
    const dt = this.profile.drivetrain;
    const ratio = dt.wheelRpm / CARTRIDGE_RPM[dt.cartridge];
    const side = (ports: number[]) => {
      let sum = 0;
      for (const sp of ports) {
        const m = this.motors.get(Math.abs(sp))!;
        sum += m.targetRpm() * m.driveMount * ratio; // wheel rpm, forward positive
      }
      return ((sum / ports.length) * Math.PI * dt.wheelDiameter) / 60 * (dt.speedScale ?? 1);
    };
    return [side(dt.left), side(dt.right)];
  }

  /**
   * A side whose motors are told to stop (move(0), brake(), velocity 0) isn't driven: it
   * slows by the motors' brake mode (all of a side's motors are set alike in practice).
   */
  private sideUnpowered(ports: number[]): boolean {
    return ports.every((p) => {
      const m = this.motors.get(Math.abs(p))!;
      return m.noPower || (m.mode !== 'position' && m.targetRpm() === 0);
    });
  }

  /**
   * Change of one side's surface speed over dt toward `target`.
   * - Powered: the motors' velocity loop pushes toward the target with the torque the DC
   *   motor has left at this speed (stall torque falling linearly to zero at free speed),
   *   limited by wheel traction (the profile's maxAccel).
   * - Unpowered, by brake mode: coast rolls on against friction; brake shorts the windings
   *   (back-EMF braking, strong at speed, weak when slow); hold stops at full strength.
   */
  private sideAccel(v: number, target: number, ports: number[], dt: number): number {
    const traction = this.accel;
    const vmax = this.maxV;
    if (!this.controller && this.sideUnpowered(ports)) {
      if (v === 0) return 0;
      // with no current at all, nothing brakes or holds either: it coasts
      const brake = Math.min(...ports.map((p) => (this.motors.get(Math.abs(p))!.noPower ? 0 : this.motors.get(Math.abs(p))!.brakeMode)));
      const decel = brake === 2 ? traction : brake === 1 ? Math.min(traction, STALL_ACCEL_FACTOR * traction * (Math.abs(v) / vmax) + FRICTION_DECEL) : COAST_DECEL;
      return -Math.sign(v) * Math.min(Math.abs(v), decel * dt);
    }
    const err = target - v;
    // torque available in the direction of the error: + toward free speed, back-EMF helps braking
    const dir = Math.sign(err);
    const share = ports.reduce((n, p) => n + this.motors.get(Math.abs(p))!.torqueShare, 0) / ports.length;
    const motorMax = STALL_ACCEL_FACTOR * traction * share * Math.max(0, 1 - (dir * v) / vmax);
    // the motor's velocity loop reaches the target as fast as torque and traction allow
    return dir * Math.min(Math.abs(err), Math.min(traction, motorMax) * dt);
  }

  step(dtMs: number): void {
    const dt = dtMs / 1000;
    const d = this.profile.drivetrain;
    let [tL, tR] = this.controller ? this.controller.update(this, dt) : this.sideTargetsFromMotors();
    const vmax = this.maxV;
    tL = Math.max(-vmax, Math.min(vmax, tL));
    tR = Math.max(-vmax, Math.min(vmax, tR));
    const vPrev = (this.vL + this.vR) / 2;
    let dL = this.sideAccel(this.vL, tL, d.left, dt);
    let dR = this.sideAccel(this.vR, tR, d.right, dt);
    const eL = tL - this.vL;
    const eR = tR - this.vR;
    // Each side's motors follow their own command. A side that can reach its target this step
    // does; when both sides are flat out, their torques follow their voltages, so each speeds
    // up in proportion to how far it has to go. A difference between the sides' commands then
    // always turns the robot (a leftover spin dies out instead of persisting while both sides
    // accelerate), and a swing's locked side stays locked.
    if ((this.controller || (!this.sideUnpowered(d.left) && !this.sideUnpowered(d.right))) && Math.abs(dL) < Math.abs(eL) && Math.abs(dR) < Math.abs(eR)) {
      const f = Math.min(dL / eL, dR / eR);
      dL = f * eL;
      dR = f * eR;
    }
    this.vL += dL;
    this.vR += dR;

    // kinematics (midpoint integration)
    const v = (this.vL + this.vR) / 2;
    const w = (this.vL - this.vR) / this.trackWidth; // rad/s, clockwise positive
    const x0 = this.pose.x;
    const y0 = this.pose.y;
    const th0 = this.pose.theta;
    const thMid = (this.pose.theta + (w * dt * 0.5) / RAD) * RAD;
    this.pose.x += v * dsin(thMid) * dt;
    this.pose.y += v * dcos(thMid) * dt;
    this.pose.theta += (w * dt) / RAD;
    const bx = this.pose.x;
    const by = this.pose.y;
    this.resolveObstacles();
    this.resolveWalls();
    this.squareToWalls(v, dt);
    // Blocked by a wall or field element: the wheels stall instead of spinning on at the
    // commanded speed, so the forward speed drops to what the robot actually achieved.
    const pushed = (this.pose.x - bx) * dsinDeg(this.pose.theta) + (this.pose.y - by) * dcosDeg(this.pose.theta);
    if (pushed * v < 0) {
      const achieved = Math.sign(v) * Math.max(0, Math.abs(v) - Math.abs(pushed) / dt);
      this.vL += achieved - v;
      this.vR += achieved - v;
    }
    // after the stall: hitting something shows up on the IMU's accelerometer
    this.accelForward = ((this.vL + this.vR) / 2 - vPrev) / dt;
    // what the robot really did this step (after collisions), robot frame
    const dTurn = (this.pose.theta - th0) * RAD;
    const thStep = th0 * RAD + dTurn / 2;
    const dx = this.pose.x - x0;
    const dy = this.pose.y - y0;
    const stepForward = dx * dsin(thStep) + dy * dcos(thStep);
    const stepRight = dx * dcos(thStep) - dy * dsin(thStep);

    // motors: drive motors follow their side; others ramp toward their target
    const anglesBefore = new Map([...this.motors].map(([port, m]) => [port, m.angle]));
    const wheelToMotor = CARTRIDGE_RPM[d.cartridge] / d.wheelRpm;
    const inPerSecToWheelRpm = 60 / (Math.PI * d.wheelDiameter);
    for (const m of this.motors.values()) {
      if (m.driveSide) {
        const sideV = m.driveSide === 'left' ? this.vL : this.vR;
        m.rpm = sideV * inPerSecToWheelRpm * wheelToMotor * m.driveMount;
      } else if (m.cartridge) {
        let target = m.targetRpm();
        // a lift motor works against the lift's weight: slower going up, and with no power it
        // sags (coast) or creeps down (brake); hold keeps it where it is. A bar swung past
        // vertical falls the other way (onto its far stop).
        const up = m.barLift ? m.liftUp * Math.sign(Math.round(dcosDeg(m.barLift.startAngle + m.angle * m.barLift.ratio) * 1e9)) : m.liftUp;
        const unpowered = m.noPower || (m.mode !== 'position' && target === 0);
        if (up) {
          const brake = m.noPower ? 0 : m.brakeMode;
          if (unpowered) target = brake === 0 ? -up * LIFT_SAG * m.freeRpm : brake === 1 ? -up * LIFT_CREEP * m.freeRpm : 0;
          else if (target * up > 0) target *= 1 - LIFT_LOAD;
        }
        // powered, it spins up as fast as its current limit allows; sagging needs no current
        const a = (m.freeRpm / MOTOR_SPINUP_S) * dt * (unpowered ? 1 : m.torqueShare);
        m.rpm += Math.max(-a, Math.min(a, target - m.rpm));
      } else {
        m.rpm = 0;
      }
      m.angle += m.rpm * 6 * dt;
    }
    this.applyMechanismLimits();
    // pistons take a moment to stroke
    const pistonsBefore = new Map(this.pistons);
    for (const [port, pos] of this.pistons) {
      const goal = this.adiOut.get(port) ? 1 : 0;
      this.pistons.set(port, pos + Math.max(-dt / PISTON_STROKE_S, Math.min(dt / PISTON_STROKE_S, goal - pos)));
    }
    this.stallLifts(anglesBefore, pistonsBefore);

    // tracking wheels
    for (const r of this.rotations.values()) {
      const tw = r.spec.trackingWheel;
      let rate = 0; // deg/s of the sensor
      if (tw) {
        // the wheel rolls with the robot's real motion, including being pushed sideways
        const travel = tw.axis === 'vertical' ? stepForward - dTurn * tw.offset : stepRight + dTurn * tw.offset;
        rate = (travel / dt / (Math.PI * tw.wheelDiameter)) * 360;
      } else if (r.spec.mechanism) {
        const mech = this.profile.mechanisms.find((m) => m.name === r.spec.mechanism);
        if (mech && isMotorized(mech)) rate = this.mechanismRpm(mech) * 6;
      }
      r.velocity = rate * 100;
      r.raw += rate * 100 * dt;
    }
    this.time += dtMs;
  }

  private applyMechanismLimits(): void {
    for (const mech of this.profile.mechanisms) {
      if (!isMotorized(mech) || !mech.range) continue;
      const ratio = mech.ratio ?? 1;
      for (const port of mech.motors!) {
        const m = this.motors.get(port);
        if (!m) continue;
        const out = m.angle * ratio;
        if (out < mech.range[0]) {
          m.angle = mech.range[0] / ratio;
          m.rpm = Math.max(0, m.rpm);
        } else if (out > mech.range[1]) {
          m.angle = mech.range[1] / ratio;
          m.rpm = Math.min(0, m.rpm);
        }
      }
    }
  }

  /** Robot footprint corners in the field frame (robot frame: +x right, +y forward). */
  footprint(): Vec2[] {
    const { width, length } = this.profile.size;
    const s = dsinDeg(this.pose.theta);
    const c = dcosDeg(this.pose.theta);
    return ([[-width / 2, -length / 2], [width / 2, -length / 2], [width / 2, length / 2], [-width / 2, length / 2]] as Vec2[]).map(
      ([lx, ly]): Vec2 => [this.pose.x + lx * c + ly * s, this.pose.y - lx * s + ly * c],
    );
  }

  /** The robot was placed somewhere instantly: what it carries starts out where it is, like a pickup. */
  placed(): void {
    this.knownAttachments.clear();
  }

  /**
   * A lift that has lowered a claw, or what it holds, onto a Goal (or Loader, or stuck piece)
   * from above can't push it down into it: the lift stops where it was.
   */
  private stallLifts(anglesBefore: Map<number, number>, pistonsBefore: Map<string, number>): void {
    if (!this.attachmentsAt || !this.resting.size) return;
    const before = new Map(this.attachments.map((a) => [a.id, a.bottom]));
    const obstacles = this.pinnedObstacles.length ? [...this.obstacles, ...this.pinnedObstacles] : this.obstacles;
    for (const a of this.attachmentsAt()) {
      if (!a.drivenBy || !(a.bottom < (before.get(a.id) ?? -Infinity))) continue;
      const poly = this.attachmentPoly(a);
      const sinks = obstacles.some((ob) => {
        if (!this.resting.has(a.id + '\n' + ob.id)) return false;
        const cross = crossSection(ob, a.bottom, a.fixedOnly);
        return !!cross && !!satMtv(poly, cross);
      });
      if (!sinks) continue;
      for (const port of a.drivenBy.motors) {
        const m = this.motors.get(port);
        if (!m) continue;
        m.angle = anglesBefore.get(port) ?? m.angle;
        m.rpm = 0;
      }
      for (const port of a.drivenBy.pistons) this.pistons.set(port, pistonsBefore.get(port) ?? this.pistons.get(port)!);
    }
  }

  /** Field-frame outline of an attachment at the current pose. */
  attachmentPoly(a: Attachment): Vec2[] {
    const s = dsinDeg(this.pose.theta);
    const c = dcosDeg(this.pose.theta);
    return octagon(this.pose.x + a.x * c + a.y * s, this.pose.y - a.x * s + a.y * c, 2 * a.r);
  }

  /** Track which attachment / obstacle pairs may overlap (see `overlapping`). */
  private updateOverlapping(obstacles: Obstacle[]): void {
    const now = new Set(this.attachments.map((a) => a.id));
    for (const key of [...this.overlapping]) {
      if (now.has(key.slice(0, key.indexOf('\n')))) continue;
      this.overlapping.delete(key);
      this.resting.delete(key);
    }
    for (const a of this.attachments) {
      const fresh = !this.knownAttachments.has(a.id);
      const poly = this.attachmentPoly(a);
      for (const ob of obstacles) {
        const key = a.id + '\n' + ob.id;
        if (!satMtv(poly, ob.poly)) {
          this.overlapping.delete(key);
          this.resting.delete(key);
        } else if (!crossSection(ob, a.bottom, a.fixedOnly) && satMtv(poly, topOutline(ob, a.fixedOnly))) {
          this.overlapping.add(key);
          this.resting.add(key);
        } else if (fresh) this.overlapping.add(key);
      }
    }
    this.knownAttachments.clear();
    for (const id of now) this.knownAttachments.add(id);
  }

  /** Push the robot out of static field elements (goals, loaders, field objects). */
  private resolveObstacles(): void {
    let hit = '';
    const obstacles = this.pinnedObstacles.length ? [...this.obstacles, ...this.pinnedObstacles] : this.obstacles;
    if (this.attachments.length || this.overlapping.size) this.updateOverlapping(obstacles);
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const ob of obstacles) {
        const mtv = satMtv(this.footprint(), ob.poly);
        if (!mtv) continue;
        this.pose.x += mtv[0];
        this.pose.y += mtv[1];
        hit = ob.id;
        moved = true;
      }
      // what the robot carries outside its frame runs into anything it is not above
      for (const a of this.attachments) {
        for (const ob of obstacles) {
          if (this.overlapping.has(a.id + '\n' + ob.id) || (a.fixedOnly && this.pinnedObstacles.includes(ob))) continue;
          const cross = crossSection(ob, a.bottom, a.fixedOnly);
          const mtv = cross && satMtv(this.attachmentPoly(a), cross);
          if (!mtv) continue;
          this.pose.x += mtv[0];
          this.pose.y += mtv[1];
          hit = ob.id;
          moved = true;
        }
      }
      if (!moved) break;
    }
    // pressing on something reports it once, not on every step the contact flickers
    if (hit && hit !== this.lastObstacle && !(this.time - (this.lastContact.get(hit) ?? -Infinity) < 500)) this.collisions.push({ t: this.time, wall: hit });
    if (hit) this.lastContact.set(hit, this.time);
    this.lastObstacle = hit;
  }

  /** Keep the robot footprint inside the perimeter (position correction only). */
  private resolveWalls(): void {
    const half = this.field.perimeter.inside / 2;
    const { width, length } = this.profile.size;
    const s = dsinDeg(this.pose.theta);
    const c = dcosDeg(this.pose.theta);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [lx, ly] of [[-width / 2, -length / 2], [width / 2, -length / 2], [width / 2, length / 2], [-width / 2, length / 2]]) {
      // robot frame: +x right, +y forward
      const fx = this.pose.x + lx * c + ly * s;
      const fy = this.pose.y - lx * s + ly * c;
      minX = Math.min(minX, fx);
      maxX = Math.max(maxX, fx);
      minY = Math.min(minY, fy);
      maxY = Math.max(maxY, fy);
    }
    // a carried object below the top of the perimeter can't go through it either
    for (const a of this.attachments) {
      if (a.bottom >= this.field.perimeter.wallHeight) continue;
      const cx = this.pose.x + a.x * c + a.y * s;
      const cy = this.pose.y - a.x * s + a.y * c;
      minX = Math.min(minX, cx - a.r);
      maxX = Math.max(maxX, cx + a.r);
      minY = Math.min(minY, cy - a.r);
      maxY = Math.max(maxY, cy + a.r);
    }
    let wall = '';
    if (minX < -half) { this.pose.x += -half - minX; wall = 'left'; }
    if (maxX > half) { this.pose.x -= maxX - half; wall = 'right'; }
    if (minY < -half) { this.pose.y += -half - minY; wall = 'near'; }
    if (maxY > half) { this.pose.y -= maxY - half; wall = 'far'; }
    // pressing on a wall reports it once, not on every step the contact flickers
    if (wall && wall !== this.lastCollisionWall && !(this.time - (this.lastContact.get(wall) ?? -Infinity) < 500)) this.collisions.push({ t: this.time, wall });
    if (wall) this.lastContact.set(wall, this.time);
    this.lastCollisionWall = wall;
  }

  /**
   * Driving into a wall at a small angle: the leading corner touches first and the robot
   * pivots about it until its face sits flush, which is how teams square against walls.
   * The rate follows the drive speed over half the robot's width (the wheels slip sideways).
   */
  private squareToWalls(v: number, dt: number): void {
    if (Math.abs(v) < 1e-6) return;
    const half = this.field.perimeter.inside / 2;
    const fp = this.footprint();
    const xs = fp.map((p) => p[0]);
    const ys = fp.map((p) => p[1]);
    const touching: number[] = []; // outward normal headings of the walls touched
    if (Math.max(...xs) >= half - 1e-6) touching.push(90);
    if (Math.min(...xs) <= -half + 1e-6) touching.push(-90);
    if (Math.max(...ys) >= half - 1e-6) touching.push(0);
    if (Math.min(...ys) <= -half + 1e-6) touching.push(180);
    if (!touching.length) return;
    const drive = v > 0 ? this.pose.theta : this.pose.theta + 180;
    const rate = Math.abs(v) / (this.profile.size.width / 2) / RAD; // deg/s
    for (const n of touching) {
      const d = wrap180(drive - n);
      if (Math.abs(d) >= 45 || Math.abs(d) < 1e-9) continue;
      this.pose.theta -= Math.sign(d) * Math.min(Math.abs(d), rate * dt);
      this.resolveWalls();
      return;
    }
  }

  // ---------------- sensors ----------------

  imuRotation(imu: ImuState): number {
    return this.pose.theta - imu.rotationOffset;
  }

  imuHeading(imu: ImuState): number {
    // twice: a tiny negative h + 360 rounds to exactly 360, outside [0, 360)
    return (((this.pose.theta - imu.headingOffset) % 360) + 360) % 360;
  }

  /** Angular velocity, deg/s, clockwise positive. */
  get omega(): number {
    return ((this.vL - this.vR) / this.trackWidth) / RAD;
  }

  get speed(): number {
    return (this.vL + this.vR) / 2;
  }

  /**
   * IMU accelerometer reading in g: x forward, y lateral (centripetal), z up. A moving
   * robot's IMU always sees vibration, which libraries such as EZ-Template rely on to
   * tell 'moving' from 'stopped'; it is modelled as deterministic noise while moving.
   */
  imuAccel(): [number, number, number] {
    const G = 386.09; // in/s^2
    const moving = Math.abs(this.speed) > 0.5 || Math.abs(this.omega) > 2;
    const n = (k: number) => {
      // deterministic hash of (time, axis) -> [-1, 1]
      let h = Math.imul((this.time | 0) ^ (k * 0x9e3779b1), 0x85ebca6b);
      h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
      h ^= h >>> 16;
      return ((h >>> 0) / 0xffffffff) * 2 - 1;
    };
    const vib = moving ? 0.2 : 0;
    const lateral = (this.speed * this.omega * RAD) / G;
    return [this.accelForward / G + vib * n(1), lateral + vib * n(2), 1 + vib * 0.5 * n(3)];
  }

  /** Field-frame origin and direction of a robot-mounted sensor's beam. */
  beam(mount: SensorMount): SensorBeam {
    const s = dsinDeg(this.pose.theta);
    const c = dcosDeg(this.pose.theta);
    const h = (this.pose.theta + mount.heading) * RAD;
    return {
      ox: this.pose.x + mount.x * c + mount.y * s,
      oy: this.pose.y - mount.x * s + mount.y * c,
      dx: dsin(h),
      dy: dcos(h),
      z: mount.z ?? 3,
    };
  }

  /**
   * Distance from a robot-mounted sensor to the nearest wall, field element or (through
   * the game's sensor hook) game object along its beam, inches.
   */
  raycast(mount: SensorMount): number {
    const { ox, oy, dx, dy, z } = this.beam(mount);
    const half = this.field.perimeter.inside / 2;
    let best = Infinity;
    if (dx > 1e-9) best = Math.min(best, (half - ox) / dx);
    if (dx < -1e-9) best = Math.min(best, (-half - ox) / dx);
    if (dy > 1e-9) best = Math.min(best, (half - oy) / dy);
    if (dy < -1e-9) best = Math.min(best, (-half - oy) / dy);
    // what is at the beam's height: a beam over a Goal's top misses it; one at a Goal's stack
    // meets the stack (a game keeps its Goals' shapes up to date)
    for (const ob of this.obstacles) {
      const cross = crossSection(ob, z, false, 0); // a beam has no chamfer to ride over
      if (cross) best = Math.min(best, rayPolygon(ox, oy, dx, dy, cross));
    }
    if (this.sensors.objectRay) best = Math.min(best, this.sensors.objectRay({ ox, oy, dx, dy, z }));
    return best;
  }

  /** Output angle (deg) of a mechanism, or extension 0..1 for pistons. */
  mechanismState(mech: MechanismSpec): number {
    if (isPneumatic(mech)) {
      const port = mech.adi!.toUpperCase();
      return this.pistons.get(port) ?? (this.adiOut.get(port) ? 1 : 0);
    }
    if (!isMotorized(mech)) return 0;
    const m = this.motors.get(mech.motors![0]);
    return m ? m.angle * (mech.ratio ?? 1) : 0;
  }

  /** Output speed (rpm) of a motor-driven mechanism (0 otherwise). */
  mechanismRpm(mech: MechanismSpec): number {
    if (!isMotorized(mech)) return 0;
    return (this.motors.get(mech.motors![0])?.rpm ?? 0) * (mech.ratio ?? 1);
  }
}

// ---------------- static obstacles and geometry ----------------

export interface Obstacle {
  id: string;
  /** Convex polygon, field frame, inches. */
  poly: Vec2[];
  /** Height of its top (in); omitted: taller than anything a robot carries. */
  top?: number;
  /** Its cross-section at a height, where narrower than `poly` (a tapered Goal). */
  at?: (z: number) => Vec2[];
  /** The fixed part alone, when `top` / `at` also cover movable things on it (a Goal's pieces). */
  body?: { top?: number; at?: (z: number) => Vec2[] };
}

/** A part of the robot outside its frame that runs into things: a claw, or the stack it holds. */
export interface Attachment {
  /** Changes whenever what is carried changes (a new pickup counts as appearing). */
  id: string;
  /** Centre in the robot frame (+x right, +y forward), inches. */
  x: number;
  y: number;
  /** Footprint radius (in). */
  r: number;
  /** Height of its lowest point above the tiles (in). */
  bottom: number;
  /**
   * Runs into fixed things only (Goal bodies, Loaders, walls): an open claw's jaws, which go
   * around pieces to grab them.
   */
  fixedOnly?: boolean;
  /** The motors (ports) and solenoids (ADI ports) that raise and lower it. */
  drivenBy?: { motors: number[]; pistons: string[] };
}

/** A carried piece whose bottom is this close to an obstacle's top rides over it (chamfers, in). */
export const CARRY_CLEARANCE = 0.25;

/**
 * The part of an obstacle a carried object at height `bottom` runs into, or null when it
 * passes over the top.
 */
export function crossSection(ob: Obstacle, bottom: number, fixedOnly = false, clearance = CARRY_CLEARANCE): Vec2[] | null {
  if (bottom <= 0) return ob.poly;
  const { top, at } = fixedOnly && ob.body ? ob.body : ob;
  if (top !== undefined && bottom >= top - clearance) return null;
  return at ? at(bottom) : ob.poly;
}

/** The outline of an obstacle's top surface (a tapered Goal is narrower there than at its base). */
export function topOutline(ob: Obstacle, fixedOnly = false): Vec2[] {
  const { top } = fixedOnly && ob.body ? ob.body : ob;
  return (top !== undefined && crossSection(ob, top - CARRY_CLEARANCE - 0.01, fixedOnly)) || ob.poly;
}

/** Width across flats of a Goal at height z: the box-shaped body, then the taper to the top. */
export function goalWidthAt(g: GoalDef, z: number): number {
  if (z <= g.bodyHeight || g.height <= g.bodyHeight) return g.baseWidth;
  // drawn as a frustum from 0.9 × the base width at the body's top to the top width
  const k = Math.min(1, (z - g.bodyHeight) / (g.height - g.bodyHeight));
  return g.baseWidth * 0.9 + (g.topWidth - g.baseWidth * 0.9) * k;
}

const COS_22_5 = dcosDeg(22.5);

/** Octagon with flats facing the axes (Override goals), given the width across flats. */
export function octagon(cx: number, cy: number, acrossFlats: number): Vec2[] {
  const r = acrossFlats / 2 / COS_22_5;
  const pts: Vec2[] = [];
  for (let k = 0; k < 8; k++) pts.push([cx + r * dcosDeg(22.5 + 45 * k), cy + r * dsinDeg(22.5 + 45 * k)]);
  return pts;
}

export function box(cx: number, cy: number, w: number, l: number, heading = 0): Vec2[] {
  const s = dsinDeg(heading);
  const c = dcosDeg(heading);
  return ([[-w / 2, -l / 2], [w / 2, -l / 2], [w / 2, l / 2], [-w / 2, l / 2]] as Vec2[]).map(([lx, ly]): Vec2 => [cx + lx * c + ly * s, cy - lx * s + ly * c]);
}

/** Collision shapes of everything fixed on the field. */
export function fieldObstacles(field: FieldDef): Obstacle[] {
  const out: Obstacle[] = [];
  for (const g of field.goals ?? []) {
    const at = (z: number) => octagon(g.x, g.y, goalWidthAt(g, z));
    out.push({ id: `goal ${g.id}`, poly: octagon(g.x, g.y, g.baseWidth), top: g.height, at, body: { top: g.height, at } });
  }
  const half = field.perimeter.inside / 2;
  for (const l of field.loaders ?? []) {
    const inward = l.wall === 'left' ? 1 : -1;
    out.push({ id: `loader ${l.id}`, poly: box(-inward * half + (inward * l.depth) / 2, l.y, l.depth, l.width), top: l.height });
  }
  for (const o of field.objects) {
    if (o.movable) continue;
    if (o.shape.type === 'box') out.push({ id: o.id, poly: box(o.shape.x, o.shape.y, o.shape.width, o.shape.length, o.shape.heading) });
    else out.push({ id: o.id, poly: octagon(o.shape.x, o.shape.y, o.shape.radius * 2 * COS_22_5) });
  }
  return out;
}

/**
 * Separating-axis test for two convex polygons. Returns the minimum translation that
 * moves `a` out of `b`, or null if they do not overlap.
 */
export function satMtv(a: Vec2[], b: Vec2[]): Vec2 | null {
  let best = Infinity;
  let axis: Vec2 = [0, 0];
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      let nx = q[1] - p[1];
      let ny = p[0] - q[0];
      const len = Math.sqrt(nx * nx + ny * ny);
      if (len < 1e-12) continue;
      nx /= len;
      ny /= len;
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const v of a) {
        const d = v[0] * nx + v[1] * ny;
        aMin = Math.min(aMin, d);
        aMax = Math.max(aMax, d);
      }
      for (const v of b) {
        const d = v[0] * nx + v[1] * ny;
        bMin = Math.min(bMin, d);
        bMax = Math.max(bMax, d);
      }
      if (Math.min(aMax, bMax) - Math.max(aMin, bMin) <= 0) return null;
      // how far a has to move along this axis to get clear of b, each way: when one contains
      // the other this is more than the overlap of the two intervals
      const back = aMax - bMin; // moving a toward -axis
      const fwd = bMax - aMin; // moving a toward +axis
      const depth = Math.min(back, fwd);
      if (depth < best) {
        best = depth;
        const sign = back < fwd ? -1 : 1;
        axis = [nx * sign, ny * sign];
      }
    }
  }
  // NaN coordinates (bad field or robot data) make every comparison false: no overlap rather
  // than a NaN push that would poison the robot's pose
  if (!Number.isFinite(best)) return null;
  return [axis[0] * best, axis[1] * best];
}

/** Distance along a ray (unit direction) to a convex polygon's edges, or Infinity. */
export function rayPolygon(ox: number, oy: number, dx: number, dy: number, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [px, py] = poly[i];
    const [qx, qy] = poly[(i + 1) % poly.length];
    const ex = qx - px;
    const ey = qy - py;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((px - ox) * ey - (py - oy) * ex) / den;
    const u = ((px - ox) * dy - (py - oy) * dx) / den;
    if (t >= 0 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return best;
}

// ---------------- frame transforms ----------------

/** Rotate a field-frame vector by a heading change d (degrees, clockwise). */
export function rotateCW(x: number, y: number, d: number): [number, number] {
  const s = dsinDeg(d);
  const c = dcosDeg(d);
  return [x * c + y * s, -x * s + y * c];
}

/**
 * Maps between the field frame and a library's odometry frame. LemLib's setPose(o)
 * while the robot is truly at field pose f defines map(f) = o.
 */
export class OdomFrame {
  private f0: Pose = { x: 0, y: 0, theta: 0 };
  private o0: Pose = { x: 0, y: 0, theta: 0 };

  /** Make the robot's current field pose correspond to odometry pose o. */
  anchor(field: Pose, odom: Pose): void {
    this.f0 = { ...field };
    this.o0 = { ...odom };
  }

  get delta(): number {
    return this.o0.theta - this.f0.theta;
  }

  toOdom(p: Pose): Pose {
    const [x, y] = rotateCW(p.x - this.f0.x, p.y - this.f0.y, this.delta);
    return { x: x + this.o0.x, y: y + this.o0.y, theta: p.theta + this.delta };
  }

  toField(p: Pose): Pose {
    const [x, y] = rotateCW(p.x - this.o0.x, p.y - this.o0.y, -this.delta);
    return { x: x + this.f0.x, y: y + this.f0.y, theta: p.theta - this.delta };
  }
}

export { dhypot, wrap180 };
