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
import type { ToggleState } from './state.ts';

/** How far from a detent a Toggle may rest and still count as fully seated. */
export const SEAT_TOLERANCE_DEG = 4;
/** Roll speed while a robot presses it, and settle speed when released (deg/s). */
const PRESS_RATE = 480;
const SETTLE_RATE = 360;
/** Fraction of the overhang a robot must press into to roll the Toggle. */
const PRESS_DEPTH = 0.6;
/** A press faster than this (in/s) turns a Toggle two faces, not one (8059's toggler, used in autonomous). */
const FAST_PRESS = 40;

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

/** Steps every Toggle on the field from robot contact. */
export class ToggleSim {
  private readonly defs: ToggleDef[];
  /** Per toggle: the press already rolled it one face; wait for release. */
  private readonly latched = new Map<string, boolean>();
  /** Detent each Toggle is rolling toward while pressed. */
  private readonly target = new Map<string, number>();
  /** Toggles flung by a fast press: momentum carries them on to the second face. */
  private readonly flung = new Set<string>();

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
      let locked = false;
      let fast = false;
      s.touched = false;
      for (const shape of shapes) {
        const depth = contactDepth(def, shape);
        if (depth <= 0) continue;
        s.touched = true;
        if (shape.lock) locked = true;
        if (shape.spin !== undefined) spin += shape.spin; // rollers roll it, never shove it
        else if (depth >= PRESS_DEPTH * overhang(def)) {
          pressing = true;
          // only the speed into the wall counts: sliding along it at speed is no hard hit
          const [vx, vy] = shape.velocity ?? [0, 0];
          const { n } = wallFrame(def);
          if (-(vx * n[0] + vy * n[1]) > FAST_PRESS) fast = true;
        }
      }
      if (locked) {
        // jammed: nothing turns it (not even our own presses) until the jammer lets go
        this.target.delete(def.id);
        this.flung.delete(def.id);
        continue;
      }
      if (spin) {
        // a roller drives it continuously, either way; no detent latching
        s.angle += Math.max(-PRESS_RATE, Math.min(PRESS_RATE, spin)) * dt;
        this.latched.set(def.id, false);
        this.target.delete(def.id);
        this.flung.delete(def.id); // the roller has it now: no fast press carries on afterwards
        continue;
      }
      if ((pressing && !this.latched.get(def.id)) || this.flung.has(def.id)) {
        if (fast && !this.target.has(def.id)) this.flung.add(def.id);
        const goal = this.target.get(def.id) ?? 120 * Math.floor(s.angle / 120 + 1e-6) + (fast ? 240 : 120);
        this.target.set(def.id, goal);
        s.angle = Math.min(goal, s.angle + PRESS_RATE * dt);
        if (s.angle >= goal) {
          // it stops on the face; a press still on it has to let go before it turns it again
          this.latched.set(def.id, pressing);
          this.target.delete(def.id);
          this.flung.delete(def.id);
        }
        continue;
      }
      if (!pressing) {
        this.latched.set(def.id, false);
        this.target.delete(def.id);
      }
      // settle onto the nearest face
      const rest = 120 * Math.round(s.angle / 120);
      const delta = rest - s.angle;
      s.angle = Math.abs(delta) <= SETTLE_RATE * dt ? rest : s.angle + Math.sign(delta) * SETTLE_RATE * dt;
    }
  }
}
