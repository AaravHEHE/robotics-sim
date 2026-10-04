// Lift kinematics: where a lift's end effector is, in the robot frame, for a given
// mechanism output (degrees for motor lifts, 0..1 for pneumatic ones). Idealized: the
// end effector of each lift type moves along its textbook path; no deflection, no load.
// Shared by the simulator (pickup / placement) and the viewer (drawing).

import { dcosDeg, dsinDeg } from './dmath.ts';
import type { ClawSpec, LiftSpec, MechanismSpec, RobotPoint, RobotProfile } from './profile.ts';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/**
 * - arm / fourbar: the tip swings on a bar of `length` (a fourbar keeps the claw level;
 *   for position both are the same).
 * - sixbar: two linked bars; twice the rise of a fourbar for the same angle, with the
 *   reach of one bar.
 * - dr4b: two stacked fourbars, cross-linked: twice the rise, the reach stays put.
 * - cascade: string-driven slides; rise = spool travel × stages.
 * - piston: rises `travel` when extended.
 */
export function liftOffset(spec: LiftSpec, out: number): { dy: number; dz: number } {
  const L = spec.length ?? 0;
  const a0 = spec.startAngle ?? 0;
  const a = a0 + out;
  switch (spec.lift) {
    case 'arm':
    case 'fourbar':
    case 'chainbar': // a 2-bar whose claw is chained level: it can swing over the top to the back
      return { dy: L * (dcosDeg(a) - dcosDeg(a0)), dz: L * (dsinDeg(a) - dsinDeg(a0)) };
    case 'sixbar':
      return { dy: L * (dcosDeg(a) - dcosDeg(a0)), dz: 2 * L * (dsinDeg(a) - dsinDeg(a0)) };
    case 'dr4b':
      return { dy: 0, dz: 2 * L * (dsinDeg(a) - dsinDeg(a0)) };
    case 'cascade':
      return { dy: 0, dz: (out / 360) * Math.PI * (spec.spoolDiameter ?? 0) * (spec.stages ?? 1) };
    case 'piston':
      return { dy: 0, dz: (spec.travel ?? 0) * out };
  }
}

export function liftEffector(spec: LiftSpec, out: number): Point3 {
  const { dy, dz } = liftOffset(spec, out);
  const reach = spec.facing === 'rear' ? -dy : dy; // a rear lift's bars swing out behind
  return { x: spec.home.x ?? 0, y: spec.home.y + reach, z: spec.home.z + dz };
}

/**
 * How far a claw is tilted from upright (degrees, 0..90). A claw on a single-pivot arm
 * turns with the arm (fourbars, sixbars, DR4Bs and cascades keep it level); a motor wrist
 * turns it too (0° and 180° are both upright: the stack is just upside down).
 */
export function clawTilt(profile: RobotProfile, claw: ClawSpec, valueOf: (m: MechanismSpec) => number): number {
  let tilt = 0;
  const lift = claw.lift ? profile.mechanisms.find((m): m is LiftSpec => m.kind === 'lift' && m.name === claw.lift) : undefined;
  if (lift?.lift === 'arm') tilt += valueOf(lift);
  const wrist = profile.mechanisms.find((m) => m.kind === 'wrist' && m.claw === claw.name);
  if (wrist && !wrist.adi) tilt += valueOf(wrist);
  const a = ((tilt % 180) + 180) % 180;
  return Math.min(a, 180 - a);
}

const pt = (p: RobotPoint): Point3 => ({ x: p.x ?? 0, y: p.y, z: p.z });

const liftNamed = (profile: RobotProfile, name: string | undefined) =>
  name ? profile.mechanisms.find((m): m is LiftSpec => m.kind === 'lift' && m.name === name) : undefined;

/** How far a lift's base has carried it from its home (a chain bar riding a cascade's carriage). */
export function baseOffset(profile: RobotProfile, spec: LiftSpec, valueOf: (m: MechanismSpec) => number): Point3 {
  const base = liftNamed(profile, spec.base);
  if (!base) return { x: 0, y: 0, z: 0 };
  const e = liftEffector(base, valueOf(base));
  return { x: e.x - (base.home.x ?? 0), y: e.y - base.home.y, z: e.z - base.home.z };
}

/** Robot-frame end effector of a lift, including what its base lift carries it by. */
export function liftPosition(profile: RobotProfile, spec: LiftSpec, valueOf: (m: MechanismSpec) => number): Point3 {
  const e = liftEffector(spec, valueOf(spec));
  const o = baseOffset(profile, spec, valueOf);
  return { x: e.x + o.x, y: e.y + o.y, z: e.z + o.z };
}

/** Robot-frame grip point of a claw, given each mechanism's current output. */
export function clawEffector(profile: RobotProfile, claw: ClawSpec, valueOf: (m: MechanismSpec) => number): Point3 {
  const lift = liftNamed(profile, claw.lift);
  if (lift) return liftPosition(profile, lift, valueOf);
  return pt(claw.at ?? { y: profile.size.length / 2, z: 2 });
}

/** Robot frame -> field frame (heading clockwise from +y, degrees). */
export function toField(pose: { x: number; y: number; theta: number }, p: { x: number; y: number }): [number, number] {
  const s = dsinDeg(pose.theta);
  const c = dcosDeg(pose.theta);
  return [pose.x + p.x * c + p.y * s, pose.y - p.x * s + p.y * c];
}

/** Field frame -> robot frame. */
export function toRobot(pose: { x: number; y: number; theta: number }, fx: number, fy: number): [number, number] {
  const s = dsinDeg(pose.theta);
  const c = dcosDeg(pose.theta);
  const dx = fx - pose.x;
  const dy = fy - pose.y;
  return [dx * c - dy * s, dx * s + dy * c];
}
