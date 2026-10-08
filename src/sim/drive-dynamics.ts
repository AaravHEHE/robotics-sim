// The drivetrain as a physical machine: V5 motors on a battery turning geared wheels that
// push a body of some mass and inertia against the tiles. Deterministic (only + - * / and
// sqrt, with dmath for anything else), SI inside, inches at the edges.
//
// What it models
// - Each drive motor: torque from the current its winding gets from the supply minus its own
//   back-EMF, capped by the V5's current limit (so torque falls linearly with speed).
// - The battery: its terminal voltage sags with the current all motors draw.
// - Heat: I^2 R in each motor, cooling to the room, and the V5 cutting back its current above
//   55 C (to half at 65 C).
// - The wheels: grip limits the force each side can push with (friction x its share of the
//   weight); beyond it the wheels slip and push with the friction they have.
// - The body: both sides push on one mass, so the sum of the two sides' force speeds it up and
//   their difference turns it against its moment of inertia.
// - Turning scrub: a skid-steer robot's wheels drag sideways as it turns.
// What it does not model: the motors' own velocity loop (a stiff loop is assumed: a side
// reaches its target speed as fast as its torque and grip allow, then holds it), rolling
// resistance while powered (negligible), tire squish, wheel flex, gearbox backlash.

import { BATTERY_OPEN_CIRCUIT, DEFAULT_LATERAL_FRICTION, DRIVE_EFFICIENCY, G_SI, INCH, motorConstants, resolveDynamics, type Dynamics } from './dynamics-spec.ts';
import { CARTRIDGE_RPM, type RobotProfile } from './profile.ts';

/** Friction that stops an unpowered, coasting robot (in/s^2, the same figure as the idealized model's). */
const COAST_DECEL = 150 * INCH;
/** What brings a braking robot to a final stop (m/s^2). */
const FRICTION_DECEL = 40 * INCH;
const AMBIENT_C = 25;
/** Heat capacity of a motor (J/K) and its thermal resistance to the air (K/W): estimates. */
const MOTOR_HEAT_CAPACITY = 60;
const MOTOR_THERMAL_RESISTANCE = 1.2;
const DERATE_START_C = 55;
const DERATE_SPAN_C = 20;

/** One side of the drive at one step. */
export interface SideState {
  /** Ground speed of the side, in/s, forward positive. */
  v: number;
  /** Where the motors are asked to take it, in/s. */
  target: number;
  /** False when the motors are told to stop: brake mode then decides what slows it. */
  powered: boolean;
  /** 0 coast, 1 brake, 2 hold (only when unpowered). */
  brake: number;
  /** How many motors drive this side, and their current limit (A each). */
  motors: number;
  currentLimit: number;
}

export interface DriveStep {
  /** Accelerations of the two sides, in/s^2. */
  aL: number;
  aR: number;
}

export class DriveDynamics {
  readonly dyn: Dynamics;
  /** Per-side motor temperature (C), current per motor (A), and the battery's terminal voltage (V). */
  temp: [number, number] = [AMBIENT_C, AMBIENT_C];
  current: [number, number] = [0, 0];
  battery = BATTERY_OPEN_CIRCUIT;
  /** Torque each motor puts on the wheel's shaft last step (N·m), for the PROS API. */
  torque: [number, number] = [0, 0];
  private readonly kt: number;
  private readonly ke: number;
  private readonly res: number;
  private readonly gear: number;
  private readonly r: number;
  private readonly track: number;
  private readonly k: number;
  private readonly scrub: number;

  readonly profile: RobotProfile;

  constructor(profile: RobotProfile) {
    this.profile = profile;
    this.dyn = resolveDynamics(profile);
    const d = profile.drivetrain;
    const { kt, ke, spec } = motorConstants(d.cartridge);
    this.kt = kt;
    this.ke = ke;
    this.res = spec.resistance;
    // motor turns per wheel turn
    this.gear = CARTRIDGE_RPM[d.cartridge] / d.wheelRpm;
    this.r = (d.wheelDiameter / 2) * INCH;
    this.track = d.trackWidth * INCH;
    // 1/kg: how much a force difference between the sides turns the robot, per unit of
    // (track/2)^2 / inertia (aL - aR = 2 k (FL - FR))
    this.k = (this.track * this.track) / (4 * this.dyn.inertia);
    // mean distance of the wheels from the robot's center along its length
    const span = Math.max(0, (profile.size.length - d.wheelDiameter - 1) * INCH);
    const n = this.dyn.wheelsPerSide;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.abs(n === 1 ? 0 : -span / 2 + (i * span) / (n - 1));
    this.scrub = (DEFAULT_LATERAL_FRICTION * this.dyn.wheelFriction * this.dyn.mass * G_SI * sum) / n;
  }

  /** The most a side can push with, N: what the motors give in direction `u` at this speed, or the grip. */
  private forceLimit(s: SideState, u: number, vms: number, vApp: number, temp: number): number {
    const omega = (this.gear * vms) / this.r;
    const derate = Math.max(0.5, Math.min(1, 1 - Math.max(0, temp - DERATE_START_C) / (2 * DERATE_SPAN_C)));
    const i = Math.max(0, Math.min(s.currentLimit * derate, (vApp - u * this.ke * omega) / this.res));
    const motor = (s.motors * this.kt * i * this.gear * DRIVE_EFFICIENCY) / this.r;
    return Math.min(motor, this.grip());
  }

  /** Friction one side can push with, N. */
  private grip(): number {
    return (this.dyn.wheelFriction * this.dyn.mass * G_SI) / 2;
  }

  /** What an unpowered side does to itself, N (opposing its motion). */
  private unpoweredForce(s: SideState, vms: number, vApp: number, dt: number): number {
    if (vms === 0) return 0;
    const sign = vms > 0 ? 1 : -1;
    const half = this.dyn.mass / 2;
    const stop = (half * Math.abs(vms)) / dt; // exactly what would stop it this step
    let f: number;
    if (s.brake === 2) f = this.grip();
    else if (s.brake === 1) {
      // windings shorted: back-EMF drives a current that brakes
      const omega = (this.gear * Math.abs(vms)) / this.r;
      const i = Math.min(s.currentLimit, (this.ke * omega) / this.res);
      f = (s.motors * this.kt * i * this.gear * DRIVE_EFFICIENCY) / this.r + half * FRICTION_DECEL;
    } else f = half * COAST_DECEL;
    void vApp;
    return -sign * Math.min(f, stop);
  }

  /**
   * Advance the machine one step of `dt` seconds: how each side accelerates (in/s^2). Updates
   * the battery, motor current and temperature as a side effect.
   */
  step(L: SideState, R: SideState, dt: number, load = 0): DriveStep {
    const m = this.dyn.mass;
    const k = this.k;
    const vL = L.v * INCH;
    const vR = R.v * INCH;
    const vApp = Math.min(12, this.battery);
    // scrub: the turn is dragged against by the wheels' sideways friction (never reversing the turn in one step)
    const w = (vL - vR) / this.track;
    const wdotExt = w === 0 ? 0 : -(w > 0 ? 1 : -1) * Math.min(this.scrub / this.dyn.inertia, Math.abs(w) / dt);
    const extL = (wdotExt * this.track) / 2;
    const extR = -extL;
    // pieces being pushed resist the way the robot is going (or trying to go, from rest)
    const heading = Math.abs(L.v + R.v) > 0.2 ? Math.sign(L.v + R.v) : Math.sign(L.target + R.target);
    const drag = (heading * load) / m;
    const reqL = L.powered ? ((L.target - L.v) * INCH) / dt - extL + drag : 0;
    const reqR = R.powered ? ((R.target - R.v) * INCH) / dt - extR + drag : 0;
    const limit = (s: SideState, i: 0 | 1, u: number, v: number) => this.forceLimit(s, u, v, vApp, this.temp[i]);
    let FL = 0;
    let FR = 0;
    if (L.powered && R.powered) {
      const S = (m * (reqL + reqR)) / 2;
      const D = (reqL - reqR) / (2 * k);
      FL = (S + D) / 2;
      FR = (S - D) / 2;
      // out of force on a side: both ease off together so the robot still turns the way it was told
      let f = 1;
      if (FL !== 0) f = Math.min(f, limit(L, 0, FL > 0 ? 1 : -1, vL) / Math.abs(FL));
      if (FR !== 0) f = Math.min(f, limit(R, 1, FR > 0 ? 1 : -1, vR) / Math.abs(FR));
      FL *= f;
      FR *= f;
    } else if (L.powered) {
      FR = this.unpoweredForce(R, vR, vApp, dt);
      FL = (reqL - FR * (1 / m - k)) / (1 / m + k);
      const cap = limit(L, 0, FL > 0 ? 1 : -1, vL);
      if (Math.abs(FL) > cap) FL = Math.sign(FL) * cap;
    } else if (R.powered) {
      FL = this.unpoweredForce(L, vL, vApp, dt);
      FR = (reqR - FL * (1 / m - k)) / (1 / m + k);
      const cap = limit(R, 1, FR > 0 ? 1 : -1, vR);
      if (Math.abs(FR) > cap) FR = Math.sign(FR) * cap;
    } else {
      FL = this.unpoweredForce(L, vL, vApp, dt);
      FR = this.unpoweredForce(R, vR, vApp, dt);
    }
    const sum = (FL + FR) / m;
    const dif = (FL - FR) * k;
    this.account([L, R], [FL, FR], [vL, vR], dt);
    let net = load === 0 ? 0 : -drag;
    // static friction: a robot at rest that can't push the load stays put instead of rolling back
    if (load > 0 && Math.abs(L.v + R.v) <= 0.2 && heading !== 0 && (sum + net) * heading < 0) net = -sum;
    return { aL: (sum + dif + extL + net) / INCH, aR: (sum - dif + extR + net) / INCH };
  }

  /** Current, battery and heat from the forces the sides pushed with. */
  private account(sides: [SideState, SideState], F: [number, number], v: [number, number], dt: number): void {
    let total = 0;
    for (const i of [0, 1] as const) {
      const s = sides[i];
      const motorForce = Math.abs(F[i]);
      // N at the ground -> A in each winding
      const i0 = s.motors > 0 ? (motorForce * this.r) / (s.motors * this.kt * this.gear * DRIVE_EFFICIENCY) : 0;
      // an unpowered side that is not braking draws nothing
      const draws = s.powered || s.brake > 0;
      const amps = draws ? i0 : 0;
      this.current[i] = amps;
      this.torque[i] = this.kt * amps;
      total += s.motors * amps;
      // heat: I^2 R in, conduction out
      const watts = amps * amps * this.res;
      this.temp[i] += ((watts - (this.temp[i] - AMBIENT_C) / MOTOR_THERMAL_RESISTANCE) / MOTOR_HEAT_CAPACITY) * dt;
      void v;
    }
    this.battery = BATTERY_OPEN_CIRCUIT - this.dyn.batteryResistance * total;
  }

  /** The force one side can push with from rest, N. */
  private stallForce(atSpeed = 0): number {
    const d = this.profile.drivetrain;
    const side: SideState = { v: 0, target: 1, powered: true, brake: 0, motors: d.left.length, currentLimit: motorConstants(d.cartridge).spec.currentLimit };
    return this.forceLimit(side, 1, atSpeed, 12, AMBIENT_C);
  }

  /** How fast the robot can speed up from rest in a straight line, in/s^2: the lesser of what the motors and the grip allow. */
  nominalAccel(): number {
    return (2 * this.stallForce()) / this.dyn.mass / INCH;
  }

  /**
   * The acceleration (per side, in/s^2) the motion planners can count on in both directions, for
   * driving straight and for turning in place (the weaker of the two: a turn's force difference
   * works against the robot's inertia, which is less than its mass would give).
   */
  planAccel(): number {
    // what the drive can count on across a move: its force at about half of top speed, not at stall
    const d = this.profile.drivetrain;
    const f = this.stallForce(0.5 * ((d.wheelRpm * Math.PI * d.wheelDiameter) / 60) * INCH);
    return Math.min((2 * f) / this.dyn.mass, 2 * f * this.k) / INCH;
  }
}
