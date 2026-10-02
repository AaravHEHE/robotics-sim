// The simulated robot on the field: motors, idealized tank drivetrain, sensors and
// wall collisions. Stepped at a fixed 1 ms by the runtime. All math is deterministic
// (dmath.ts) so a given program produces bit-identical results on every machine.

import { dcos, dcosDeg, dhypot, dsin, dsinDeg, RAD, wrap180 } from './dmath.ts';
import type { FieldDef } from './field.ts';
import { CARTRIDGE_RPM, CARTRIDGE_TICKS, maxSpeed, type Cartridge, type DeviceSpec, type MechanismSpec, type RobotProfile } from './profile.ts';

export interface Pose {
  x: number;
  y: number;
  /** degrees, 0 = +y, clockwise positive (continuous, not wrapped) */
  theta: number;
}

const CARTRIDGE_BY_GEARSET: Cartridge[] = ['red', 'green', 'blue'];
/** Seconds for a free-spinning mechanism motor to reach full speed. */
const MOTOR_SPINUP_S = 0.15;

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

  /** Target physical rpm from the current command. */
  targetRpm(): number {
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
        const accel = (free / MOTOR_SPINUP_S) * 6; // deg/s^2 (rpm/s * 6)
        const vmax = Math.min(Math.abs(this.profileRpm / this.codeRpmPerPhysRpm), free) * 6; // deg/s
        const v = Math.min(vmax, Math.sqrt(2 * accel * Math.abs(err)));
        return (Math.sign(err) * v) / 6;
      }
    }
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
  readonly adiConfig = new Map<string, number>();
  /** Drive controller of the active idealized motion, if any. */
  controller: DriveController | null = null;
  readonly collisions: Collision[] = [];
  private lastCollisionWall = '';
  time = 0;
  /** Total distance driven by each side, in (for tracking/drive encoders). */
  private readonly maxV: number;

  constructor(profile: RobotProfile, field: FieldDef, start: Pose) {
    this.profile = profile;
    this.field = field;
    this.pose = { ...start };
    this.maxV = maxSpeed(profile);
    const dt = profile.drivetrain;
    for (const [side, ports] of [['left', dt.left], ['right', dt.right]] as const) {
      for (const p of ports) {
        const m = new MotorState(Math.abs(p), dt.cartridge);
        m.driveSide = side;
        m.driveMount = Math.sign(p) || 1;
        this.motors.set(m.port, m);
      }
    }
    for (const d of profile.devices) {
      if (d.type === 'motor') this.motors.set(d.port, new MotorState(d.port, d.cartridge));
      if (d.type === 'imu') this.imus.set(d.port, { port: d.port, calibratingUntil: 0, rotationOffset: 0, headingOffset: 0, pitchOffset: 0, rollOffset: 0, yawOffset: 0 });
      if (d.type === 'rotation') this.rotations.set(d.port, { port: d.port, spec: d, raw: 0, velocity: 0, zero: 0, reversed: false });
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

  private sideBrakeFactor(ports: number[]): number {
    // coast brakes at half the drivetrain deceleration; brake/hold at full
    const coast = ports.every((p) => this.motors.get(Math.abs(p))!.brakeMode === 0);
    return coast ? 0.5 : 1;
  }

  step(dtMs: number): void {
    const dt = dtMs / 1000;
    const d = this.profile.drivetrain;
    let [tL, tR] = this.controller ? this.controller.update(this, dt) : this.sideTargetsFromMotors();
    const vmax = this.maxV;
    tL = Math.max(-vmax, Math.min(vmax, tL));
    tR = Math.max(-vmax, Math.min(vmax, tR));
    const ramp = (v: number, target: number, ports: number[]) => {
      const braking = Math.abs(target) < Math.abs(v) || Math.sign(target) !== Math.sign(v);
      const a = this.accel * dt * (braking && target === 0 ? this.sideBrakeFactor(ports) : 1);
      return v + Math.max(-a, Math.min(a, target - v));
    };
    const vPrev = (this.vL + this.vR) / 2;
    this.vL = ramp(this.vL, tL, d.left);
    this.vR = ramp(this.vR, tR, d.right);
    this.accelForward = ((this.vL + this.vR) / 2 - vPrev) / dt;

    // kinematics (midpoint integration)
    const v = (this.vL + this.vR) / 2;
    const w = (this.vL - this.vR) / this.trackWidth; // rad/s, clockwise positive
    const thMid = (this.pose.theta + (w * dt * 0.5) / RAD) * RAD;
    this.pose.x += v * dsin(thMid) * dt;
    this.pose.y += v * dcos(thMid) * dt;
    this.pose.theta += (w * dt) / RAD;
    this.resolveWalls();

    // motors: drive motors follow their side; others ramp toward their target
    const wheelToMotor = CARTRIDGE_RPM[d.cartridge] / d.wheelRpm;
    const inPerSecToWheelRpm = 60 / (Math.PI * d.wheelDiameter);
    for (const m of this.motors.values()) {
      if (m.driveSide) {
        const sideV = m.driveSide === 'left' ? this.vL : this.vR;
        m.rpm = sideV * inPerSecToWheelRpm * wheelToMotor * m.driveMount;
      } else if (m.cartridge) {
        const target = m.targetRpm();
        const a = (m.freeRpm / MOTOR_SPINUP_S) * dt;
        m.rpm += Math.max(-a, Math.min(a, target - m.rpm));
      } else {
        m.rpm = 0;
      }
      m.angle += m.rpm * 6 * dt;
    }
    this.applyMechanismLimits();

    // tracking wheels
    for (const r of this.rotations.values()) {
      const tw = r.spec.trackingWheel;
      let rate = 0; // deg/s of the sensor
      if (tw) {
        const surface = tw.axis === 'vertical' ? v - w * tw.offset : w * tw.offset;
        rate = (surface / (Math.PI * tw.wheelDiameter)) * 360;
      } else if (r.spec.mechanism) {
        const mech = this.profile.mechanisms.find((m) => m.name === r.spec.mechanism);
        if (mech && mech.kind !== 'piston') rate = (this.motors.get(mech.motors[0])?.rpm ?? 0) * 6 * mech.ratio;
      }
      r.velocity = rate * 100;
      r.raw += rate * 100 * dt;
    }
    this.time += dtMs;
  }

  private applyMechanismLimits(): void {
    for (const mech of this.profile.mechanisms) {
      if (mech.kind === 'piston' || !mech.range) continue;
      for (const port of mech.motors) {
        const m = this.motors.get(port);
        if (!m) continue;
        const out = m.angle * mech.ratio;
        if (out < mech.range[0]) {
          m.angle = mech.range[0] / mech.ratio;
          m.rpm = Math.max(0, m.rpm);
        } else if (out > mech.range[1]) {
          m.angle = mech.range[1] / mech.ratio;
          m.rpm = Math.min(0, m.rpm);
        }
      }
    }
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
    let wall = '';
    if (minX < -half) { this.pose.x += -half - minX; wall = 'left'; }
    if (maxX > half) { this.pose.x -= maxX - half; wall = 'right'; }
    if (minY < -half) { this.pose.y += -half - minY; wall = 'near'; }
    if (maxY > half) { this.pose.y -= maxY - half; wall = 'far'; }
    if (wall && wall !== this.lastCollisionWall) this.collisions.push({ t: this.time, wall });
    this.lastCollisionWall = wall;
  }

  // ---------------- sensors ----------------

  imuRotation(imu: ImuState): number {
    return this.pose.theta - imu.rotationOffset;
  }

  imuHeading(imu: ImuState): number {
    const h = (this.pose.theta - imu.headingOffset) % 360;
    return h < 0 ? h + 360 : h;
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

  /** Distance from a robot-mounted sensor to the nearest wall along its beam, inches. */
  raycast(mount: { x: number; y: number; heading: number }): number {
    const s = dsinDeg(this.pose.theta);
    const c = dcosDeg(this.pose.theta);
    const ox = this.pose.x + mount.x * c + mount.y * s;
    const oy = this.pose.y - mount.x * s + mount.y * c;
    const h = (this.pose.theta + mount.heading) * RAD;
    const dx = dsin(h);
    const dy = dcos(h);
    const half = this.field.perimeter.inside / 2;
    let best = Infinity;
    if (dx > 1e-9) best = Math.min(best, (half - ox) / dx);
    if (dx < -1e-9) best = Math.min(best, (-half - ox) / dx);
    if (dy > 1e-9) best = Math.min(best, (half - oy) / dy);
    if (dy < -1e-9) best = Math.min(best, (-half - oy) / dy);
    return best;
  }

  /** Output angle (deg) of a mechanism, or extension 0..1 for pistons. */
  mechanismState(mech: MechanismSpec): number {
    if (mech.kind === 'piston') return this.adiOut.get(mech.adi.toUpperCase()) ? 1 : 0;
    const m = this.motors.get(mech.motors[0]);
    return m ? m.angle * mech.ratio : 0;
  }
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
