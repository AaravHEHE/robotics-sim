// Idealized motions for LemLib / EZ-Template re-implementations.
//
// No PID is simulated: each motion is a kinematic controller that drives the
// robot along the geometrically intended path as fast as the profile allows,
// using trapezoidal (accelerate / cruise / decelerate) speed limits derived from
// the drivetrain's real top speed and acceleration. Library tuning constants are
// accepted by the C++ shim and ignored.
//
// All targets are in the field frame (the runtime converts from odometry frames).

import { datan2, dcos, dhypot, dsin, RAD, wrap180 } from './dmath.ts';
import type { DriveController, Pose, World } from './world.ts';

/** Heading-tracking gain (1/s): how quickly the idealized robot points at its target. */
const HEADING_GAIN = 8;
/** Distance at which point/pose motions stop steering and settle (LemLib uses 7.5 in). */
const CLOSE_DIST = 7.5;
/** Share of the braking budget kept while steering: heading corrections use the rest. */
const STEER_RESERVE = 0.8;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const headingTo = (from: Pose, x: number, y: number) => datan2(x - from.x, y - from.y) / RAD;

export abstract class Motion implements DriveController {
  readonly timeout: number;
  elapsed = 0;
  /** Progress for waitUntil(): inches for drives, degrees for turns. */
  traveled = 0;
  done = false;
  readonly label: string;
  protected last: Pose | null = null;

  constructor(label: string, timeout: number) {
    this.label = label;
    this.timeout = timeout > 0 ? timeout : Infinity;
  }

  update(w: World, dt: number): [number, number] {
    if (this.done) return [0, 0];
    this.track(w);
    this.elapsed += dt * 1000;
    this.dt = dt;
    if (this.elapsed >= this.timeout) {
      this.done = true;
      return [0, 0];
    }
    const out = this.control(w, dt);
    if (this.done) return [0, 0];
    return out;
  }

  /** Default progress: path length. */
  protected track(w: World): void {
    if (this.last) this.traveled += dhypot(w.pose.x - this.last.x, w.pose.y - this.last.y);
    this.last = { ...w.pose };
  }

  protected abstract control(w: World, dt: number): [number, number];

  /** Length of the current control step (s). */
  protected dt = 0.001;

  /**
   * Speed limit to stop exactly after `dist` inches braking at `share` of the drivetrain's
   * deceleration, never below `floor`. Discrete: the world applies a command one step
   * later, so the continuous sqrt(2ad) would always overshoot a little.
   */
  protected stopLimit(w: World, dist: number, floor = 0, share = 1): number {
    const a = w.accel * share;
    const adt = a * this.dt;
    const v = adt * (Math.sqrt((2 * Math.max(0, dist)) / (a * this.dt * this.dt) + 0.25) - 0.5);
    return Math.max(floor, v);
  }

  /**
   * Turn rate (rad/s) toward a heading error (deg), never faster than the robot can stop
   * from in the remaining angle using `share` of each wheel's acceleration, so heading
   * corrections don't swing past and come back.
   */
  protected steer(w: World, errDeg: number, vmax: number, share = 0.5): number {
    const omegaMax = (2 * vmax) / w.trackWidth;
    const alpha = (2 * w.accel * share) / w.trackWidth;
    const e = Math.abs(errDeg) * RAD;
    return Math.sign(errDeg) * Math.min(omegaMax, Math.sqrt(2 * alpha * e), HEADING_GAIN * e);
  }

  /**
   * Fastest speed for following an arc toward a point `dist` inches away at heading error
   * `errDeg`: the sideways (centripetal) acceleration v^2/r can't exceed what the wheels'
   * traction gives, like LemLib's horizontal-drift slip limit.
   */
  protected cornerLimit(w: World, errDeg: number, dist: number): number {
    const curvature = (2 * Math.abs(dsin(errDeg * RAD))) / Math.max(dist, 1e-6);
    return curvature < 1e-9 ? Infinity : Math.sqrt(w.accel / curvature);
  }

  /** Scale (v, omega) to wheel speeds within vmax. omega is rad/s, clockwise positive. */
  protected wheels(w: World, v: number, omega: number, vmax: number): [number, number] {
    const half = (omega * w.trackWidth) / 2;
    let l = v + half;
    let r = v - half;
    const ratio = Math.max(Math.abs(l), Math.abs(r)) / vmax;
    if (ratio > 1) {
      l /= ratio;
      r /= ratio;
    }
    return [l, r];
  }
}

export interface PointParams {
  forwards: boolean;
  maxSpeed: number; // 0-127
  minSpeed: number; // 0-127
  earlyExitRange: number;
}

export class MoveToPoint extends Motion {
  private close = false;
  private prevSide: boolean | null = null;
  /** Direction from the start toward the target (LemLib fixes it when the motion starts). */
  private approach: number | null = null;
  readonly x: number;
  readonly y: number;
  readonly p: PointParams;
  constructor(x: number, y: number, timeout: number, p: PointParams) {
    super('moveToPoint', timeout);
    this.x = x;
    this.y = y;
    this.p = p;
  }

  protected control(w: World): [number, number] {
    const pose = w.pose;
    const vmax = (w.maxSpeed * clamp(this.p.maxSpeed, 0, 127)) / 127;
    const vmin = (w.maxSpeed * clamp(Math.abs(this.p.minSpeed), 0, 127)) / 127;
    const dist = dhypot(this.x - pose.x, this.y - pose.y);
    if (dist < CLOSE_DIST) this.close = true;

    // motion chaining: with minSpeed, exit once the robot crosses the line through the
    // target perpendicular to the approach (LemLib's "side" test), offset by earlyExitRange
    this.approach ??= headingTo(pose, this.x, this.y) * RAD;
    if (vmin > 0) {
      const s = this.sideOf(pose, this.approach);
      if (this.prevSide === null) this.prevSide = s;
      if (s !== this.prevSide) {
        this.done = true;
        return [0, 0];
      }
    }

    let desired = headingTo(pose, this.x, this.y);
    if (!this.p.forwards) desired += 180;
    const err = wrap180(desired - pose.theta);
    const dir = this.p.forwards ? 1 : -1;
    // signed along-heading distance to the target (what LemLib calls lateral error)
    const along = dist * dcos(wrap180(headingTo(pose, this.x, this.y) - pose.theta) * RAD);

    if (this.close) {
      // settled: on target and (nearly) stopped, like LemLib's small-error exit condition
      if (Math.abs(along) < 0.25 && Math.abs(w.speed) < 3 && vmin === 0) {
        this.done = true;
        return [0, 0];
      }
      // chaining (minSpeed) keeps going the way it was until it crosses the line
      const sign = vmin > 0 ? dir : Math.sign(along);
      const v = sign * Math.min(vmax, this.stopLimit(w, Math.abs(along), vmin));
      return this.wheels(w, v, 0, vmax);
    }
    const limit = Math.min(vmax, this.stopLimit(w, dist, vmin, STEER_RESERVE), Math.max(vmin, this.cornerLimit(w, err, dist)));
    const v = dir * limit * Math.max(0, dcos(err * RAD));
    return this.wheels(w, v, this.steer(w, err, vmax), vmax);
  }

  private sideOf(pose: Pose, approachRad: number): boolean {
    // project robot position onto the approach direction, relative to target
    const ux = dsin(approachRad);
    const uy = dcos(approachRad);
    const proj = (pose.x - this.x) * ux + (pose.y - this.y) * uy;
    return proj <= -this.p.earlyExitRange;
  }
}

export class MoveToPose extends Motion {
  private close = false;
  readonly x: number;
  readonly y: number;
  readonly theta: number;
  readonly p: PointParams & { lead: number };
  constructor(x: number, y: number, theta: number, timeout: number, p: PointParams & { lead: number }) {
    super('moveToPose', timeout);
    this.x = x;
    this.y = y;
    this.theta = theta;
    this.p = p;
  }

  protected control(w: World): [number, number] {
    const pose = w.pose;
    const vmax = (w.maxSpeed * clamp(this.p.maxSpeed, 0, 127)) / 127;
    const vmin = (w.maxSpeed * clamp(Math.abs(this.p.minSpeed), 0, 127)) / 127;
    const dir = this.p.forwards ? 1 : -1;
    const targetHeading = this.p.forwards ? this.theta : this.theta + 180;
    const dist = dhypot(this.x - pose.x, this.y - pose.y);
    if (dist < CLOSE_DIST) this.close = true;

    if (this.close) {
      // settle: drive the remaining along-track distance while turning to the final heading
      const along = dist * dcos(wrap180(headingTo(pose, this.x, this.y) - pose.theta) * RAD);
      // still aim at the target point while it is ahead, so a sideways offset left by the
      // boomerang closes up instead of staying; fades to the final heading at the end
      const ex = this.x - pose.x;
      const ey = this.y - pose.y;
      const alongT = ex * dsin(targetHeading * RAD) + ey * dcos(targetHeading * RAD);
      const latT = ex * dcos(targetHeading * RAD) - ey * dsin(targetHeading * RAD);
      const aim = alongT > 1 ? datan2(latT, Math.max(alongT, 3)) / RAD : 0;
      const herr = wrap180(this.theta + aim - pose.theta);
      if (Math.abs(along) < 0.25 && Math.abs(herr) < 0.5 && Math.abs(w.vL) < 3 && Math.abs(w.vR) < 3 && vmin === 0) {
        this.done = true;
        return [0, 0];
      }
      if (vmin > 0 && dist < Math.max(1, this.p.earlyExitRange)) {
        this.done = true;
        return [0, 0];
      }
      // braking and turning share each wheel's acceleration, half each
      const v = Math.sign(along) * Math.min(vmax, this.stopLimit(w, Math.abs(along), vmin, 0.5));
      return this.wheels(w, v, this.steer(w, herr, vmax, 0.5), vmax);
    }

    // boomerang carrot point behind the target along the direction of travel at the end
    // (targetHeading is already reversed for backwards moves)
    const carrotX = this.x - dist * this.p.lead * dsin(targetHeading * RAD);
    const carrotY = this.y - dist * this.p.lead * dcos(targetHeading * RAD);
    let desired = headingTo(pose, carrotX, carrotY);
    if (!this.p.forwards) desired += 180;
    const err = wrap180(desired - pose.theta);
    const carrotDist = dhypot(carrotX - pose.x, carrotY - pose.y);
    // same braking budget as the settle phase, so entering it doesn't overshoot
    const limit = Math.min(vmax, this.stopLimit(w, dist, vmin, 0.5), Math.max(vmin, this.cornerLimit(w, err, carrotDist)));
    const v = dir * limit * Math.max(0, dcos(err * RAD));
    return this.wheels(w, v, this.steer(w, err, vmax), vmax);
  }
}

export interface TurnParams {
  /** 1 clockwise, -1 counter-clockwise, 0 shortest */
  direction: number;
  maxSpeed: number;
  minSpeed: number;
  earlyExitRange: number;
}

/** In-place turn (or swing, with one side locked) to a heading or toward a point. */
export class Turn extends Motion {
  private startTheta = 0;
  private toGo: number | null = null;
  private readonly target: (pose: Pose) => number;
  readonly p: TurnParams;
  /** null: turn in place · 'left' / 'right': that side is locked (swing) */
  readonly locked: 'left' | 'right' | null;
  /** For swings: the locked side moves at this fraction of the moving side's speed (EZ opposite speed). */
  readonly lockedRatio: number;
  constructor(label: string, target: (pose: Pose) => number, timeout: number, p: TurnParams, locked: 'left' | 'right' | null = null, lockedRatio = 0) {
    super(label, timeout);
    this.target = target;
    this.p = p;
    this.locked = locked;
    this.lockedRatio = clamp(lockedRatio, -0.95, 0.95);
  }

  protected track(w: World): void {
    if (this.toGo === null) {
      this.startTheta = w.pose.theta;
      let err = wrap180(this.target(w.pose) - w.pose.theta);
      if (this.p.direction > 0 && err < -0.5) err += 360;
      if (this.p.direction < 0 && err > 0.5) err -= 360;
      this.toGo = err;
    }
    this.traveled = Math.abs(w.pose.theta - this.startTheta);
  }

  protected control(w: World): [number, number] {
    const pose = w.pose;
    // remaining signed angle: follow the (possibly moving) target, keeping the forced direction
    const turned = pose.theta - this.startTheta;
    let remaining = this.toGo! - turned;
    const fresh = wrap180(this.target(pose) - pose.theta);
    if (Math.abs(remaining) < 180) remaining = fresh;
    const vmax = (w.maxSpeed * clamp(this.p.maxSpeed, 0, 127)) / 127;
    const vmin = (w.maxSpeed * clamp(Math.abs(this.p.minSpeed), 0, 127)) / 127;
    const exitRange = vmin > 0 ? Math.max(this.p.earlyExitRange, 0.5) : 0.5;
    // turns and swings (unless chaining) settle: on target with both sides (nearly) stopped, so the
    // robot doesn't coast on and the next motion doesn't inherit leftover wheel speed, like
    // LemLib's / EZ-Template's small-error exit conditions
    if (Math.abs(remaining) < exitRange && (vmin > 0 || (Math.abs(w.vL) < 2 && Math.abs(w.vR) < 2))) {
      this.done = true;
      return [0, 0];
    }
    // the moving wheel(s) cover an arc of radius track/2 (in place) or track (swing)
    const radius = this.locked ? w.trackWidth / (1 - this.lockedRatio) : w.trackWidth / 2;
    const arc = Math.abs(remaining) * RAD * radius;
    const speed = Math.min(vmax, this.stopLimit(w, arc, vmin)) * Math.sign(remaining);
    if (this.locked === 'left') return [-speed * this.lockedRatio, -speed];
    if (this.locked === 'right') return [speed, speed * this.lockedRatio];
    return [speed, -speed];
  }
}

export interface PathPoint {
  x: number;
  y: number;
  speed: number; // 0-127
}

/** Parse a LemLib / path.jerryio path file: "x, y, speed" lines until "endData". */
export function parsePath(text: string): PathPoint[] {
  const pts: PathPoint[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === 'endData') break;
    const parts = line.split(',').map((s) => Number(s.trim()));
    if (parts.length >= 3 && parts.every(Number.isFinite)) pts.push({ x: parts[0], y: parts[1], speed: parts[2] });
  }
  return pts;
}

/** Idealized pure pursuit along a path (field frame). */
export class FollowPath extends Motion {
  private closest = 0;
  private readonly path: PathPoint[];
  readonly lookahead: number;
  readonly forwards: boolean;
  /** Index of the real end of the path (path.jerryio appends zero-speed extension points). */
  private readonly endIdx: number;
  constructor(path: PathPoint[], lookahead: number, timeout: number, forwards: boolean) {
    super('follow', timeout);
    this.path = path;
    this.lookahead = lookahead;
    this.forwards = forwards;
    let last = path.length - 1;
    while (last > 0 && path[last - 1].speed <= 0) last--;
    this.endIdx = Math.max(1, last);
    if (path.length < 2) this.done = true;
  }

  protected control(w: World): [number, number] {
    const pose = w.pose;
    const pts = this.path;
    // advance the closest index monotonically
    let best = dhypot(pts[this.closest].x - pose.x, pts[this.closest].y - pose.y);
    for (let i = this.closest + 1; i < Math.min(pts.length, this.closest + 50); i++) {
      const d = dhypot(pts[i].x - pose.x, pts[i].y - pose.y);
      if (d < best) {
        best = d;
        this.closest = i;
      }
    }
    const end = pts[this.endIdx];
    const toEnd = dhypot(end.x - pose.x, end.y - pose.y);
    const stalled = pts[this.closest].speed <= 0 && Math.abs(w.speed) < 0.5;
    if ((this.closest >= this.endIdx - 1 && toEnd < 1.5) || (this.closest >= this.endIdx - 1 && stalled)) {
      this.done = true;
      return [0, 0];
    }
    // lookahead point: first path point at least `lookahead` away beyond the closest
    let look = end;
    for (let i = this.closest; i < pts.length; i++) {
      if (dhypot(pts[i].x - pose.x, pts[i].y - pose.y) >= this.lookahead) {
        look = pts[i];
        break;
      }
    }
    // remaining path length for the final deceleration
    let remaining = dhypot(pts[this.closest].x - pose.x, pts[this.closest].y - pose.y);
    for (let i = this.closest; i < this.endIdx; i++) remaining += dhypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);

    const vmax = (w.maxSpeed * clamp(pts[this.closest].speed, 0, 127)) / 127;
    let desired = headingTo(pose, look.x, look.y);
    if (!this.forwards) desired += 180;
    const err = wrap180(desired - pose.theta);
    // pure-pursuit curvature to the lookahead point: k = 2 sin(err) / L
    const L = Math.max(1e-3, dhypot(look.x - pose.x, look.y - pose.y));
    const v = Math.min(vmax, this.stopLimit(w, remaining)) * (this.forwards ? 1 : -1);
    const curvature = (2 * dsin(err * RAD)) / L;
    const omega = Math.abs(v) * curvature;
    return this.wheels(w, v, omega, w.maxSpeed);
  }
}

/** EZ-Template style straight drive by a relative distance, holding a heading. */
export class DriveDistance extends Motion {
  private startX = 0;
  private startY = 0;
  private started = false;
  readonly distance: number;
  readonly heading: number;
  readonly maxSpeed127: number;
  constructor(distance: number, heading: number, maxSpeed127: number, timeout: number) {
    super('drive', timeout);
    this.distance = distance;
    this.heading = heading;
    this.maxSpeed127 = maxSpeed127;
  }

  protected track(w: World): void {
    if (!this.started) {
      this.started = true;
      this.startX = w.pose.x;
      this.startY = w.pose.y;
    }
    // signed distance along the held heading
    const h = this.heading * RAD;
    this.traveled = Math.abs((w.pose.x - this.startX) * dsin(h) + (w.pose.y - this.startY) * dcos(h));
  }

  protected control(w: World): [number, number] {
    const h = this.heading * RAD;
    const progressed = (w.pose.x - this.startX) * dsin(h) + (w.pose.y - this.startY) * dcos(h);
    const remaining = this.distance - progressed;
    if (Math.abs(remaining) < 0.25 && Math.abs(w.speed) < 3) {
      this.done = true;
      return [0, 0];
    }
    const vmax = (w.maxSpeed * clamp(Math.abs(this.maxSpeed127), 0, 127)) / 127;
    const v = Math.sign(remaining) * Math.min(vmax, this.stopLimit(w, Math.abs(remaining)));
    const err = wrap180(this.heading - w.pose.theta);
    return this.wheels(w, v, this.steer(w, err, vmax), vmax);
  }
}
