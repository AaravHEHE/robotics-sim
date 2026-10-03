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
  return { x: spec.home.x ?? 0, y: spec.home.y + dy, z: spec.home.z + dz };
}

const pt = (p: RobotPoint): Point3 => ({ x: p.x ?? 0, y: p.y, z: p.z });

/** Robot-frame grip point of a claw, given each mechanism's current output. */
export function clawEffector(profile: RobotProfile, claw: ClawSpec, valueOf: (m: MechanismSpec) => number): Point3 {
  const lift = claw.lift ? profile.mechanisms.find((m): m is LiftSpec => m.kind === 'lift' && m.name === claw.lift) : undefined;
  if (lift) return liftEffector(lift, valueOf(lift));
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
