// Phasing checks for the Override field: is any floor piece inside another piece, the
// robot, a Goal, a Loader or a wall, and does every stack nest the way real pieces can?
// Used by the tests and scripts/check-phasing.ts; goalShape is also the simulator's Goal collision shape.

import { dcos, dhypot, dsin } from '../../sim/dmath.ts';
import type { FieldDef, GoalDef, Vec2 } from '../../sim/field.ts';
import { crossSection, fieldObstacles, goalWidthAt, octagon, satMtv, type Obstacle } from '../../sim/world.ts';
import { CUP, layoutStack, PIN, stackTop, type Piece } from './elements.ts';
import type { OverrideState } from './state.ts';

/** Overlap (in) the soft contacts of the floor physics may show for a moment. */
export const PIECE_SLOP = 0.25;
/** The robot is moved every 1 ms but pieces are pushed every 5 ms: a little more slack. */
export const ROBOT_SLOP = 0.5;

const RAD = Math.PI / 180;

export function footprintRadius(pieces: Piece[]): number {
  return Math.max(...pieces.map((p) => (p.kind === 'cup' ? CUP.rimDiameter : PIN.collarDiameter) / 2));
}

/** A floor piece as the physics sees it: a disc (standing stack) or a capsule (lying Pin). */
interface Body {
  id: string;
  a: Vec2;
  b: Vec2;
  r: number;
}

function arc(c: Vec2, r: number, from: number, n: number, out: Vec2[]): void {
  for (let k = 0; k <= n; k++) {
    const t = (from + (180 * k) / n) * RAD;
    out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
}

/** Convex outline of a body (16 points per full circle). */
function outline(b: Body): Vec2[] {
  const dx = b.b[0] - b.a[0];
  const dy = b.b[1] - b.a[1];
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const pts: Vec2[] = [];
  arc(b.b, b.r, ang - 90, 8, pts);
  arc(b.a, b.r, ang + 90, 8, pts);
  return pts;
}

const segLen = (b: Body) => dhypot(b.b[0] - b.a[0], b.b[1] - b.a[1]);

/** The floor pieces of a state as bodies. */
export function floorBodies(state: OverrideState): Body[] {
  const out: Body[] = [];
  for (const s of state.floor) out.push({ id: s.id, a: [s.x, s.y], b: [s.x, s.y], r: footprintRadius(s.pieces) });
  const r = PIN.coneDiameter / 2;
  const h = PIN.length / 2 - r;
  for (const l of state.lying) {
    const ux = dsin(l.heading * RAD) * h;
    const uy = dcos(l.heading * RAD) * h;
    out.push({ id: l.id, a: [l.x - ux, l.y - uy], b: [l.x + ux, l.y + uy], r });
  }
  return out;
}

function depth(a: Body, b: Body): number {
  const reach = segLen(a) / 2 + a.r + segLen(b) / 2 + b.r;
  const ca: Vec2 = [(a.a[0] + a.b[0]) / 2, (a.a[1] + a.b[1]) / 2];
  const cb: Vec2 = [(b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2];
  const d = dhypot(ca[0] - cb[0], ca[1] - cb[1]);
  if (d >= reach) return 0;
  if (segLen(a) === 0 && segLen(b) === 0) return a.r + b.r - d;
  const m = satMtv(outline(a), outline(b));
  return m ? dhypot(m[0], m[1]) : 0;
}

function polyDepth(b: Body, poly: Vec2[]): number {
  const m = satMtv(outline(b), poly);
  return m ? dhypot(m[0], m[1]) : 0;
}

/**
 * A Goal's collision shape with the pieces on it, for something carried into it from the
 * side: as tall as its stack, and above the Goal top as wide as the pieces above that height.
 */
export function goalShape(g: GoalDef, pieces: Piece[]): Required<Pick<Obstacle, 'top' | 'at'>> {
  const slots = layoutStack(pieces, g.height, true);
  return {
    top: Math.max(g.height, ...slots.map((s) => s.top)),
    at: (z) => {
      if (z < g.height) return octagon(g.x, g.y, goalWidthAt(g, z));
      const above = slots.filter((s) => s.top > z).map((s) => s.piece);
      return octagon(g.x, g.y, above.length ? 2 * footprintRadius(above) : g.topWidth);
    },
  };
}

/** Why a stack (bottom first) can't stand the way it is, or null. */
export function badNesting(pieces: Piece[]): string | null {
  for (let i = 1; i < pieces.length; i++) {
    if (pieces[i].kind === pieces[i - 1].kind) return `a ${pieces[i].kind === 'pin' ? 'Pin' : 'Cup'} sits directly on a ${pieces[i].kind === 'pin' ? 'Pin' : 'Cup'}`;
  }
  return null;
}

export interface Phasing {
  what: string;
  /** How far into each other (in). */
  depth: number;
}

/** A stack a claw holds (field frame): it may only overlap what it is above or being set onto. */
export interface HeldStack {
  name: string;
  x: number;
  y: number;
  r: number;
  bottom: number;
  /** An open claw's jaws: only Goal bodies, Loaders and walls count (they close around pieces). */
  fixedOnly?: boolean;
}

/** Held this close to the centre of a Goal or stack, a held stack is going onto it (in). */
const ONTO = 1.5;

/** Everything phasing through something else right now. */
export function phasing(field: FieldDef, state: OverrideState, robot: Vec2[] | null, held: HeldStack[] = []): Phasing[] {
  const out: Phasing[] = [];
  const bodies = floorBodies(state);
  const half = field.perimeter.inside / 2;
  const statics = fieldObstacles(field);
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const d = depth(a, bodies[j]);
      if (d > PIECE_SLOP) out.push({ what: `${a.id} inside ${bodies[j].id}`, depth: d });
    }
    for (const ob of statics) {
      const d = polyDepth(a, ob.poly);
      if (d > PIECE_SLOP) out.push({ what: `${a.id} inside ${ob.id}`, depth: d });
    }
    const out_ = Math.max(...[a.a, a.b].flatMap(([x, y]) => [Math.abs(x), Math.abs(y)])) + a.r - half;
    if (out_ > PIECE_SLOP) out.push({ what: `${a.id} through the perimeter`, depth: out_ });
    if (robot) {
      const d = polyDepth(a, robot);
      if (d > ROBOT_SLOP) out.push({ what: `${a.id} inside the robot`, depth: d });
    }
  }
  for (const h of held) {
    const disc: Body = { id: `held by ${h.name}`, a: [h.x, h.y], b: [h.x, h.y], r: h.r };
    for (const b of h.fixedOnly ? [] : bodies) {
      const s = state.floor.find((x) => x.id === b.id);
      const top = s ? stackTop(s.pieces, 0, false) : PIN.collarDiameter;
      if (h.bottom >= top || (s && dhypot(s.x - h.x, s.y - h.y) <= ONTO)) continue;
      const d = depth(disc, b);
      if (d > ROBOT_SLOP) out.push({ what: `${disc.id} inside ${b.id}`, depth: d });
    }
    for (const ob0 of statics) {
      const g = field.goals?.find((x) => `goal ${x.id}` === ob0.id);
      const ob = g && !h.fixedOnly ? { ...ob0, ...goalShape(g, state.goals[g.id] ?? []) } : ob0;
      const cross = crossSection(ob, h.bottom, h.fixedOnly);
      if (!cross) continue;
      if (g && dhypot(g.x - h.x, g.y - h.y) <= ONTO) continue;
      const m = satMtv(octagon(h.x, h.y, 2 * h.r), cross);
      const d = m ? dhypot(m[0], m[1]) : 0;
      if (d > ROBOT_SLOP) out.push({ what: `${disc.id} inside ${ob.id}`, depth: d });
    }
    const past = Math.max(Math.abs(h.x), Math.abs(h.y)) + h.r - half;
    if (h.bottom < field.perimeter.wallHeight && past > ROBOT_SLOP) out.push({ what: `${disc.id} through the perimeter`, depth: past });
  }
  for (const [id, pieces] of Object.entries(state.goals)) {
    const bad = badNesting(pieces);
    if (bad) out.push({ what: `Goal ${id}: ${bad}`, depth: 0 });
  }
  for (const s of state.floor) {
    const bad = badNesting(s.pieces);
    if (bad) out.push({ what: `floor stack ${s.id}: ${bad}`, depth: 0 });
  }
  for (const [name, pieces] of Object.entries(state.held)) {
    const bad = badNesting(pieces);
    if (bad) out.push({ what: `held by ${name}: ${bad}`, depth: 0 });
  }
  return out;
}
