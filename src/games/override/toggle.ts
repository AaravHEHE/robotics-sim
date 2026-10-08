// Toggle model (SC4). A Toggle is a triangular prism that rolls about its long axis in
// 120° steps between three faces. Its color is the face seen from inside the field.
// Angle convention: 0 = starting orientation; +120 = one roll with the top moving
// outward (away from the field), which brings the face that was down on the mounts to
// the inside; -120 = one roll with the top moving inward, which brings the outward face in.
//
// Contact model (idealized, no rigid-body simulation): the part of the Toggle that hangs
// over the field is a thin strip along the wall. A robot part (the chassis box, a bumper,
// a plate or a roller) whose height range overlaps the Toggle touches it when its
// footprint enters the strip. Pressing into it (against the wall) rolls the Toggle
// outward one face, after which the part must back off before the next press ("each
// square press advances one face"). A spinning roller rolls it either way at the
// roller's speed. Released between faces, the Toggle falls back to the nearest face.

import type { FieldDef, ToggleDef, Vec2 } from '../../sim/field.ts';
import { dsinDeg } from '../../sim/dmath.ts';
import type { ToggleState } from './state.ts';

/** How far from a detent a Toggle may rest and still count as fully seated. */
export const SEAT_TOLERANCE_DEG = 4;
/** The fastest a press rolls it (deg/s). */
const PRESS_RATE = 600;
/** A press never drives slower than this (deg/s) until it is on the face, or it would creep. */
const PRESS_FLOOR = 200;
/** Rolling at no more than this many deg/s and within this many degrees of a face, it clicks into the detent. */
const SEAT_RATE = 40;
const SEAT_SNAP_DEG = 2.5;
/** Fraction of the overhang a robot must press into to roll the Toggle. */
const PRESS_DEPTH = 0.6;

export type ToggleColor = 'red' | 'blue' | 'yellow';

/** The face seen from inside the field at a given roll angle (nearest detent). */
export function faceInside(def: ToggleDef, angle: number): ToggleColor {
  const k = ((Math.round(angle / 120) % 3) + 3) % 3;
  return (k === 0 ? def.start.in : k === 1 ? def.start.down : def.start.out) as ToggleColor;
}

/** Set color per SC4: seated on a face and not touched by a robot; otherwise neutral (yellow). */
export function setColor(def: ToggleDef, angle: number, touched: boolean): ToggleColor {
  if (touched) return 'yellow';
  const off = Math.abs(angle - 120 * Math.round(angle / 120));
  if (off > SEAT_TOLERANCE_DEG) return 'yellow';
  return faceInside(def, angle);
}

/** Inward unit normal of the Toggle's wall and its along-wall direction. */
export function wallFrame(def: ToggleDef): { n: Vec2; u: Vec2 } {
  switch (def.wall) {
    case 'left': return { n: [1, 0], u: [0, 1] };
    case 'right': return { n: [-1, 0], u: [0, 1] };
    case 'bottom': return { n: [0, 1], u: [1, 0] };
    default: return { n: [0, -1], u: [1, 0] };
  }
}

/** How far the Toggle hangs over the field: half its cross-section width. */
export function overhang(def: ToggleDef): number {
  return def.sectionHeight / Math.sqrt(3); // half the side of an equilateral triangle
}

/** A robot part that can touch a Toggle. */
export interface ContactShape {
  /** Floor-plan outline, field frame. */
  poly: Vec2[];
  bottom: number;
  top: number;
  /** A roller (set even when stopped): the Toggle roll rate it imposes (deg/s, + = top outward). */
  spin?: number;
  /** A jammer: wedged against a Toggle, it stops it turning either way. */
  lock?: boolean;
  /** How fast the robot is moving (in/s, field frame): a press at speed carries a Toggle two faces. */
  velocity?: Vec2;
}

/**
 * Depth (in) a robot part reaches into the Toggle's overhang strip, or 0 if it does not
 * touch it. Only the part of the outline within the Toggle's length counts.
 */
export function contactDepth(def: ToggleDef, shape: ContactShape): number {
  if (shape.top < def.topHeight - def.sectionHeight || shape.bottom > def.topHeight) return 0; // misses it vertically
  const { n, u } = wallFrame(def);
  // local coords: s along the wall from the Toggle center, d = distance into the field from the wall line
  let poly = shape.poly.map(([x, y]): Vec2 => [(x - def.x) * u[0] + (y - def.y) * u[1], (x - def.x) * n[0] + (y - def.y) * n[1]]);
  poly = clip(poly, (p) => p[0] + def.length / 2); // s >= -L/2
  poly = clip(poly, (p) => def.length / 2 - p[0]); // s <= +L/2
  if (poly.length === 0) return 0;
  const minD = Math.min(...poly.map((p) => p[1]));
  return Math.max(0, overhang(def) - minD);
}

/** Sutherland–Hodgman clip of a convex polygon to the half-plane f(p) >= 0. */
function clip(poly: Vec2[], f: (p: Vec2) => number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa >= 0) out.push(a);
    if (fa >= 0 !== fb >= 0) {
      const k = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
    }
  }
  return out;
}

/**
 * Rotational dynamics of a Toggle (angle and angular velocity, degrees).
 *   - Three detents: a restoring torque -DETENT sin(3 angle) pulls it to the nearest face.
 *   - Friction: viscous (DAMPING) and dry (FRICTION).
 *   - A press: a robot part pushing into the overhang drives it toward the next face at up to
 *     PRESS_RATE; the hit itself (its speed into the wall) also gives it an angular velocity
 *     (HIT_GAIN deg/s per in/s). Fast enough, that carries it over the next detent's barrier: two
 *     faces (about 40 in/s with these numbers, like 8059's toggler).
 *   - A roller drags it toward the roller's surface speed.
 * Constants are estimates fitted to the behaviour the game describes (one face per square press,
 * two for a hard hit); they are not measurements of a real Toggle.
 */
const DETENT = 5000; // deg/s^2
/** Viscous damping (1/s): strong at low speed (it settles on a face quickly), weak when spinning fast (a hard hit carries on). */
const DAMPING_SLOW = 30;
const DAMPING_FAST = 1;
const DAMPING_KNEE = 300; // deg/s
const FRICTION = 20; // deg/s^2
const PRESS_GAIN = 60; // 1/s: how stiffly a press drives it to its rate
const ROLLER_GAIN = 60; // 1/s
const HIT_GAIN = 32; // deg/s per in/s of speed into the wall
const MAX_RATE = 1400; // deg/s

/** Steps every Toggle on the field from robot contact. */
export class ToggleSim {
  private readonly defs: ToggleDef[];
  /** Per toggle: a part was pressing it last step, the face it is being pressed toward, and whether it got there. */
  private readonly pressed = new Set<string>();
  private readonly goal = new Map<string, number>();
  private readonly latched = new Set<string>();

  constructor(field: FieldDef) {
    this.defs = field.toggles ?? [];
  }

  step(dtMs: number, states: ToggleState[], shapes: ContactShape[]): void {
    const dt = dtMs / 1000;
    for (const def of this.defs) {
      const s = states.find((x) => x.id === def.id);
      if (!s) continue;
      let pressing = false;
      let spin = 0;
      let rolled = false;
      let locked = false;
      let into = 0;
      s.touched = false;
      for (const shape of shapes) {
        const depth = contactDepth(def, shape);
        if (depth <= 0) continue;
        s.touched = true;
        if (shape.lock) locked = true;
        if (shape.spin !== undefined) {
          spin += shape.spin; // rollers roll it, never shove it
          rolled = true;
        } else if (depth >= PRESS_DEPTH * overhang(def)) {
          pressing = true;
          // only the speed into the wall counts: sliding along it at speed is no hard hit
          const [vx, vy] = shape.velocity ?? [0, 0];
          const { n } = wallFrame(def);
          into = Math.max(into, -(vx * n[0] + vy * n[1]));
        }
      }
      let w = s.omega ?? 0;
      if (locked) {
        // jammed: nothing turns it (not even our own presses) until the jammer lets go
        s.omega = 0;
        this.pressed.delete(def.id);
        this.goal.delete(def.id);
        continue;
      }
      if (rolled) pressing = false; // a roller has it: no press on top of it
      if (pressing && !this.pressed.has(def.id)) {
        // the hit: a new press starts toward the next face, with the speed it came in at
        this.goal.set(def.id, 120 * Math.floor(s.angle / 120 + 1e-6) + 120);
        this.latched.delete(def.id);
        if (into > 0) w = Math.min(MAX_RATE, w + HIT_GAIN * into);
      }
      if (pressing) this.pressed.add(def.id);
      else {
        this.pressed.delete(def.id);
        this.goal.delete(def.id);
        this.latched.delete(def.id);
      }
      let a = -DETENT * dsinDeg(3 * s.angle) - (DAMPING_FAST + (DAMPING_SLOW - DAMPING_FAST) / (1 + (w / DAMPING_KNEE) ** 2)) * w - (Math.abs(w) > 1 ? Math.sign(w) * FRICTION : 0);
      if (pressing && !this.latched.has(def.id)) {
        const goal = this.goal.get(def.id)!;
        if (s.angle >= goal) this.latched.add(def.id); // it stops on the face; the press must let go before it turns it again
        else a += PRESS_GAIN * Math.max(0, Math.min(PRESS_RATE, Math.max(PRESS_FLOOR, 8 * (goal - s.angle))) - w);
      }
      if (rolled) a += ROLLER_GAIN * (Math.max(-PRESS_RATE, Math.min(PRESS_RATE, spin)) - w);
      w = Math.max(-MAX_RATE, Math.min(MAX_RATE, w + a * dt));
      s.angle += w * dt;
      // at rest on a face (and nothing driving it): it sits exactly on it
      const face = 120 * Math.round(s.angle / 120);
      const driven = rolled || (pressing && !this.latched.has(def.id));
      if (!driven && Math.abs(w) < SEAT_RATE && Math.abs(s.angle - face) < SEAT_SNAP_DEG) {
        s.angle = face;
        w = 0;
      }
      s.omega = w;
    }
  }
}
