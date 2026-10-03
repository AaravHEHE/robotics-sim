// The simulated robot on the field: motors, idealized tank drivetrain, sensors and
// wall collisions. Stepped at a fixed 1 ms by the runtime. All math is deterministic
// (dmath.ts) so a given program produces bit-identical results on every machine.

import { dcos, dcosDeg, dhypot, dsin, dsinDeg, RAD, wrap180 } from './dmath.ts';
import type { FieldDef, Vec2 } from './field.ts';
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
  readonly adiConfig = new Map<string, number>();
  /** Drive controller of the active idealized motion, if any. */
  controller: DriveController | null = null;
  readonly collisions: Collision[] = [];
  private lastCollisionWall = '';
  private lastObstacle = '';
  /** What a game adds to the robot's sensors (game objects, colors). */
  sensors: SensorHooks = {};
  /** Static convex obstacles (goals, loaders, field objects) in the field frame. */
  readonly obstacles: Obstacle[];
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
    const bx = this.pose.x;
    const by = this.pose.y;
    this.resolveObstacles();
    this.resolveWalls();
    // Blocked by a wall or field element: the wheels stall instead of spinning on at the
    // commanded speed, so the forward speed drops to what the robot actually achieved.
    const pushed = (this.pose.x - bx) * dsinDeg(this.pose.theta) + (this.pose.y - by) * dcosDeg(this.pose.theta);
    if (pushed * v < 0) {
      const achieved = Math.sign(v) * Math.max(0, Math.abs(v) - Math.abs(pushed) / dt);
      this.vL += achieved - v;
      this.vR += achieved - v;
    }

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

  /** Push the robot out of static field elements (goals, loaders, field objects). */
  private resolveObstacles(): void {
    let hit = '';
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const ob of this.obstacles) {
        const mtv = satMtv(this.footprint(), ob.poly);
        if (!mtv) continue;
        this.pose.x += mtv[0];
        this.pose.y += mtv[1];
        hit = ob.id;
        moved = true;
      }
      if (!moved) break;
    }
    if (hit && hit !== this.lastObstacle) this.collisions.push({ t: this.time, wall: hit });
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
    for (const ob of this.obstacles) best = Math.min(best, rayPolygon(ox, oy, dx, dy, ob.poly));
    if (this.sensors.objectRay) best = Math.min(best, this.sensors.objectRay({ ox, oy, dx, dy, z }));
    return best;
  }

  /** Output angle (deg) of a mechanism, or extension 0..1 for pistons. */
  mechanismState(mech: MechanismSpec): number {
    if (isPneumatic(mech)) return this.adiOut.get(mech.adi!.toUpperCase()) ? 1 : 0;
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
}

const COS_22_5 = dcosDeg(22.5);

/** Octagon with flats facing the axes (Override goals), given the width across flats. */
export function octagon(cx: number, cy: number, acrossFlats: number): Vec2[] {
  const r = acrossFlats / 2 / COS_22_5;
  const pts: Vec2[] = [];
  for (let k = 0; k < 8; k++) pts.push([cx + r * dcosDeg(22.5 + 45 * k), cy + r * dsinDeg(22.5 + 45 * k)]);
  return pts;
}

function box(cx: number, cy: number, w: number, l: number, heading = 0): Vec2[] {
  const s = dsinDeg(heading);
  const c = dcosDeg(heading);
  return ([[-w / 2, -l / 2], [w / 2, -l / 2], [w / 2, l / 2], [-w / 2, l / 2]] as Vec2[]).map(([lx, ly]): Vec2 => [cx + lx * c + ly * s, cy - lx * s + ly * c]);
}

/** Collision shapes of everything fixed on the field. */
export function fieldObstacles(field: FieldDef): Obstacle[] {
  const out: Obstacle[] = [];
  for (const g of field.goals ?? []) out.push({ id: `goal ${g.id}`, poly: octagon(g.x, g.y, g.baseWidth) });
  const half = field.perimeter.inside / 2;
  for (const l of field.loaders ?? []) {
    const inward = l.wall === 'left' ? 1 : -1;
    out.push({ id: `loader ${l.id}`, poly: box(-inward * half + (inward * l.depth) / 2, l.y, l.depth, l.width) });
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
      const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
      if (overlap <= 0) return null;
      if (overlap < best) {
        best = overlap;
        // push a away from b
        const sign = (aMin + aMax) / 2 < (bMin + bMax) / 2 ? -1 : 1;
        axis = [nx * sign, ny * sign];
      }
    }
  }
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
