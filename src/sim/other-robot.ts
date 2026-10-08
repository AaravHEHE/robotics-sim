// A second robot on the field that no program drives: it can sit still, be pushed around by
// the robot you are simulating (it has mass and moment of inertia, slides against the tiles and
// spins when hit off-center), or follow a scripted path at a set speed (and be slowed or
// shoved off it by a hard enough push). Defined in a field's `objects` list with a `robot`
// entry. It does not touch scoring objects: pieces pass under it.

import { dcosDeg, dhypot, dsinDeg, datan2, RAD, wrap180 } from './dmath.ts';
import type { FieldObject, Vec2 } from './field.ts';

const LB = 0.45359237;
const IN = 0.0254;
const G_IN = 386.0886; // in/s^2
/** Sliding friction of its tires on the tiles (it is unpowered when pushed). */
const SLIDE_FRICTION = 0.6;
/** The most it can speed up when it follows a path (a fraction of what its grip allows). */
const PATH_ACCEL = 0.4 * SLIDE_FRICTION * G_IN;
const DEFAULT_TURN_RATE = 120; // deg/s


export class OtherRobot {
  readonly id: string;
  readonly width: number;
  readonly length: number;
  readonly height: number;
  readonly color: string;
  /** Pose: field frame inches, heading degrees clockwise from +y. */
  x: number;
  y: number;
  theta: number;
  /** Velocity, in/s (field frame), and spin, deg/s (clockwise positive). */
  vx = 0;
  vy = 0;
  omega = 0;
  /** kg and kg·m². */
  readonly mass: number;
  readonly inertia: number;
  private readonly path: Vec2[];
  private readonly speed: number;
  private readonly delay: number;
  private next = 0;
  private time = 0;

  constructor(o: FieldObject) {
    const sh = o.shape;
    if (sh.type !== 'box') throw new Error(`robot object ${o.id} needs a box shape.`);
    const r = o.robot ?? {};
    this.id = o.id;
    this.width = sh.width;
    this.length = sh.length;
    this.height = o.height;
    this.color = o.color ?? '#8b949e';
    this.x = sh.x;
    this.y = sh.y;
    this.theta = sh.heading ?? 0;
    this.mass = (r.mass ?? 12) * LB;
    this.inertia = (this.mass * ((sh.width * IN) ** 2 + (sh.length * IN) ** 2)) / 12;
    this.path = r.path ?? [];
    this.speed = r.speed ?? 30;
    this.delay = r.delay ?? 0;
  }

  /** Its footprint, field frame. */
  footprint(): Vec2[] {
    const s = dsinDeg(this.theta);
    const c = dcosDeg(this.theta);
    return ([[-this.width / 2, -this.length / 2], [this.width / 2, -this.length / 2], [this.width / 2, this.length / 2], [-this.width / 2, this.length / 2]] as Vec2[]).map(([lx, ly]): Vec2 => [this.x + lx * c + ly * s, this.y - lx * s + ly * c]);
  }

  /** Velocity of the point (px, py) on it, in/s. */
  velocityAt(px: number, py: number): Vec2 {
    const w = -this.omega * RAD; // rad/s counterclockwise
    return [this.vx - w * (py - this.y), this.vy + w * (px - this.x)];
  }

  /** Advance `dt` seconds: follow the path (if any), slide to a stop, and keep inside the walls (`half`: inside half-width). */
  step(dt: number, half: number): void {
    this.time += dt;
    const driving = this.path.length > 0 && this.next < this.path.length && this.time >= this.delay;
    if (driving) {
      const [tx, ty] = this.path[this.next];
      const dx = tx - this.x;
      const dy = ty - this.y;
      const d = dhypot(dx, dy);
      if (d < 1) this.next++;
      else {
        // face it, then drive at it
        const want = datan2(dx, dy) / RAD;
        const err = wrap180(want - this.theta);
        this.omega = Math.max(-DEFAULT_TURN_RATE, Math.min(DEFAULT_TURN_RATE, err * 6));
        const facing = Math.abs(err) < 25 ? 1 : 0;
        const sp = Math.min(this.speed, Math.sqrt(2 * PATH_ACCEL * d)) * facing;
        const tvx = sp * dsinDeg(this.theta);
        const tvy = sp * dcosDeg(this.theta);
        const ax = tvx - this.vx;
        const ay = tvy - this.vy;
        const am = dhypot(ax, ay);
        const lim = PATH_ACCEL * dt;
        const k = am > lim ? lim / am : 1;
        this.vx += ax * k;
        this.vy += ay * k;
      }
    } else {
      // unpowered: tires slide against the tiles
      const sp = dhypot(this.vx, this.vy);
      if (sp > 0) {
        const k = Math.max(0, sp - SLIDE_FRICTION * G_IN * dt) / sp;
        this.vx *= k;
        this.vy *= k;
      }
      if (this.omega !== 0) {
        // the wheels' sideways grip resists spinning: about a quarter of the footprint's size from the center
        const arm = Math.min(this.width, this.length) / 4;
        const alpha = ((SLIDE_FRICTION * this.mass * 9.80665 * arm * IN) / this.inertia) / RAD;
        this.omega = Math.sign(this.omega) * Math.max(0, Math.abs(this.omega) - alpha * dt);
      }
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.theta += this.omega * dt;
    // the walls
    const fp = this.footprint();
    const xs = fp.map((p) => p[0]);
    const ys = fp.map((p) => p[1]);
    const push = (axis: 'x' | 'y', by: number) => {
      this[axis] += by;
      const v = axis === 'x' ? 'vx' : 'vy';
      if (Math.sign(this[v]) === -Math.sign(by)) this[v] = 0;
    };
    if (Math.min(...xs) < -half) push('x', -half - Math.min(...xs));
    if (Math.max(...xs) > half) push('x', half - Math.max(...xs));
    if (Math.min(...ys) < -half) push('y', -half - Math.min(...ys));
    if (Math.max(...ys) > half) push('y', half - Math.max(...ys));
  }
}
