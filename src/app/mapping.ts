// Auton mapping: the field as a 12 × 12 ft coordinate plane (inches, origin at the field
// center, +y toward the far wall, headings clockwise from +y, as in the simulator, LemLib
// and the GPS). Plotted points, measurements between them and to field elements, and plans
// that can be saved and shared. Pure functions: no three.js, no DOM.

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { FieldDef, LayoutPiece } from '../sim/field.ts';

export interface MapPoint {
  id: string;
  x: number;
  y: number;
  label?: string;
  /** Heading the robot should face here (degrees clockwise from +y), if it matters. */
  heading?: number;
}

/** A field element to measure to. */
export interface Poi {
  id: string;
  label: string;
  kind: 'goal' | 'toggle' | 'loader' | 'stack' | 'pin' | 'start';
  x: number;
  y: number;
}

export interface Measure {
  dx: number;
  dy: number;
  dist: number;
  /** Heading to face b from a: degrees clockwise from +y, in [0, 360). */
  heading: number;
}

const DEG = 180 / Math.PI;

/** Distance and heading from a to b. */
export function measure(a: { x: number; y: number }, b: { x: number; y: number }): Measure {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { dx, dy, dist: Math.hypot(dx, dy), heading: normHeading(Math.atan2(dx, dy) * DEG) };
}

/** A heading in [0, 360). */
export function normHeading(h: number): number {
  const r = ((h % 360) + 360) % 360;
  return r >= 360 - 1e-9 ? 0 : r;
}

/** The shortest turn from heading h1 to h2: positive = clockwise (right), in (-180, 180]. */
export function turnBetween(h1: number, h2: number): number {
  const t = normHeading(h2 - h1);
  return t > 180 ? t - 360 : t;
}

/** Snap a coordinate to a grid step (in); a step of 0 leaves it. */
export function snap(v: number, step: number): number {
  return step > 0 ? Math.round(v / step) * step : v;
}

/** Keep a point inside the field's walls. */
export function clampToField(p: { x: number; y: number }, field: FieldDef): { x: number; y: number } {
  const half = field.perimeter.inside / 2;
  return { x: Math.max(-half, Math.min(half, p.x)), y: Math.max(-half, Math.min(half, p.y)) };
}

const pieceName = (p: LayoutPiece) => (p.kind === 'pin' ? `${p.colors.join('/')} Pin` : `${p.up === 'gray' ? 'gray-up' : 'clear-up'} Cup`);

/**
 * Field elements to measure to: Goals, Toggles (center and both ends), Loaders (where a
 * robot takes from them), the layout's floor stacks and lying Pins, and start positions.
 */
export function pointsOfInterest(field: FieldDef, layoutId: string): Poi[] {
  const out: Poi[] = [];
  for (const g of field.goals ?? []) out.push({ id: `goal:${g.id}`, label: `Goal ${g.id}`, kind: 'goal', x: g.x, y: g.y });
  for (const t of field.toggles ?? []) {
    const along: [number, number] = t.wall === 'left' || t.wall === 'right' ? [0, 1] : [1, 0];
    const h = t.length / 2;
    const name = t.id.replace(/^T_/, '');
    out.push({ id: `toggle:${t.id}`, label: `Toggle ${name}`, kind: 'toggle', x: t.x, y: t.y });
    out.push({ id: `toggle:${t.id}:a`, label: `Toggle ${name} (end)`, kind: 'toggle', x: t.x - along[0] * h, y: t.y - along[1] * h });
    out.push({ id: `toggle:${t.id}:b`, label: `Toggle ${name} (other end)`, kind: 'toggle', x: t.x + along[0] * h, y: t.y + along[1] * h });
  }
  const half = field.perimeter.inside / 2;
  for (const l of field.loaders ?? []) {
    const inward = l.wall === 'left' ? 1 : -1;
    // the bottom opening, just inside the field (where a robot takes its pieces)
    out.push({ id: `loader:${l.id}`, label: `Loader ${l.id.replace(/^L_/, '')} opening`, kind: 'loader', x: -inward * half + inward * (l.depth + 1.5), y: l.y });
  }
  const layout = field.layouts?.[layoutId];
  let n = 0;
  for (const item of layout?.items ?? []) {
    if (item.type === 'stack') out.push({ id: `stack:${n++}`, label: `Stack: ${item.pieces.map(pieceName).join(' + ')}`, kind: 'stack', x: item.x, y: item.y });
    else if (item.type === 'lying') out.push({ id: `pin:${n++}`, label: `Lying ${item.colors.join('/')} Pin`, kind: 'pin', x: item.x, y: item.y });
  }
  for (const s of field.startPositions ?? []) {
    if (!s.layouts.includes(layoutId)) continue;
    out.push({ id: `start:${s.id}`, label: `Start ${s.name}`, kind: 'start', x: s.x, y: s.y });
  }
  return out;
}

/** The nearest element within `maxDist` inches of p, or null. */
export function nearestPoi(p: { x: number; y: number }, pois: Poi[], maxDist: number): Poi | null {
  let best: Poi | null = null;
  let bestD = maxDist;
  for (const q of pois) {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= bestD) {
      best = q;
      bestD = d;
    }
  }
  return best;
}

/** Per segment of a route: distance, heading to drive, and the turn from the previous one. */
export function segments(points: MapPoint[]): Array<Measure & { turn: number | null }> {
  const out: Array<Measure & { turn: number | null }> = [];
  for (let i = 1; i < points.length; i++) {
    const m = measure(points[i - 1], points[i]);
    const prev = out[out.length - 1];
    // turning at the previous point: from the way the robot arrived (or the heading set there)
    const facing = points[i - 1].heading ?? prev?.heading;
    out.push({ ...m, turn: facing === undefined ? null : turnBetween(facing, m.heading) });
  }
  return out;
}

// ---------------- plans: save and share ----------------

export interface MapPlan {
  v: 1;
  name: string;
  /** The field and layout it was made on. */
  field: string;
  layout: string;
  points: MapPoint[];
  /** When it was made (ms since 1970). */
  created: number;
}

export const MAX_PLAN_POINTS = 200;

/** Problems with a plan read from a file or a link (empty = fine). */
export function validatePlan(p: unknown): string[] {
  const e: string[] = [];
  const plan = p as Partial<MapPlan>;
  if (!plan || typeof plan !== 'object') return ['Not a plan.'];
  if (plan.v !== 1) e.push(`Unknown plan version ${String(plan.v)}.`);
  if (typeof plan.name !== 'string') e.push('The plan has no name.');
  if (typeof plan.field !== 'string' || typeof plan.layout !== 'string') e.push('The plan does not say which field it is for.');
  if (!Array.isArray(plan.points)) return [...e, 'The plan has no points.'];
  if (plan.points.length > MAX_PLAN_POINTS) e.push(`Too many points (${plan.points.length}; at most ${MAX_PLAN_POINTS}).`);
  plan.points.forEach((q, i) => {
    if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.y) || Math.abs(q.x) > 200 || Math.abs(q.y) > 200) e.push(`Point ${i + 1} has no valid x and y.`);
    else if (q.heading !== undefined && !Number.isFinite(q.heading)) e.push(`Point ${i + 1} has an invalid heading.`);
  });
  return e;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** A plan as compact text for a link: rounded to 0.1 in, deflated, base64url. */
export function encodePlan(plan: MapPlan): string {
  const compact = {
    v: 1,
    n: plan.name,
    f: plan.field,
    l: plan.layout,
    c: plan.created,
    p: plan.points.map((q) => {
      const row: Array<number | string | null> = [round1(q.x), round1(q.y)];
      if (q.heading !== undefined || q.label) row.push(q.heading === undefined ? null : round1(q.heading));
      if (q.label) row.push(q.label);
      return row;
    }),
  };
  const bytes = deflateSync(strToU8(JSON.stringify(compact)), { level: 9 });
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The plan in a link's text (throws a readable error when it isn't one). */
export function decodePlan(text: string): MapPlan {
  let compact: { v: number; n: string; f: string; l: string; c: number; p: Array<[number, number, (number | null)?, string?]> };
  try {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    compact = JSON.parse(strFromU8(inflateSync(Uint8Array.from(bin, (c) => c.charCodeAt(0)))));
  } catch {
    throw new Error('This link does not contain a readable plan (it may be cut short).');
  }
  const plan: MapPlan = {
    v: compact.v as 1,
    name: compact.n,
    field: compact.f,
    layout: compact.l,
    created: compact.c,
    points: (compact.p ?? []).map((row, i) => {
      const q: MapPoint = { id: `p${i + 1}`, x: row[0], y: row[1] };
      if (typeof row[2] === 'number') q.heading = row[2];
      if (typeof row[3] === 'string') q.label = row[3];
      return q;
    }),
  };
  const errs = validatePlan(plan);
  if (errs.length) throw new Error(errs.join(' '));
  return plan;
}
