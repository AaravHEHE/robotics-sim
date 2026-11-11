// Moving a parts build as its lift moves (the build is cosmetic; the robot profile decides what
// the lift does). A motion spec lists groups of parts and how each group moves for a lift
// output, in the robot frame (x right, y forward, z up, inches). Pure: no three.js, no DOM.
//
//   revolute  turns about the line through (y, z) parallel to the robot's x axis, by ratio × out degrees;
//   yaw       turns about the vertical axis through (x, y), by ratio × out degrees (a claw's finger on its hinge post);
//   slide     moves along a direction by ratio × out inches, or by a piecewise-linear profile of
//             [out, travel] points when stages move in turn (cascade and continuous stages);
//   track     follows solved poses: [out, turn (deg), shift y, shift z] keys, turning about `about` first (a
//             linkage solved from the CAD's mates by scripts/onshape/mates-to-motion.py);
//   couple    translates, without turning, as the point `track` on an arm that turns about `pivot`
//             does (the coupler of a four-bar, the carriage of a DR4B): ratio × out degrees.
//
// `out` is the lift's output: degrees for arms and bars, inches for slides.
import type { Assembly, Placed, Rot3 } from './assembly.ts';

export type Joint =
  | { type: 'revolute'; pivot: [number, number]; ratio: number }
  | { type: 'yaw'; pivot: [number, number]; ratio: number }
  | { type: 'slide'; dir: [number, number, number]; ratio: number; profile?: [number, number][] }
  | { type: 'couple'; pivot: [number, number]; track: [number, number]; ratio: number }
  | { type: 'track'; about: [number, number]; keys: [number, number, number, number][] };

export interface MotionGroup {
  name: string;
  /** Indices into the build's parts. */
  parts: number[];
  joint: Joint;
}

export interface MotionSpec {
  v: 1;
  /** The lift kind this models: arm, fourbar, sixbar, dr4b, dr6b, cascade, continuous. */
  lift: string;
  /** What `out` means and how far it goes. */
  out: { unit: 'deg' | 'in'; min: number; max: number };
  groups: MotionGroup[];
  /** Notes on how the groups were chosen. */
  notes?: string;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** A point (a, b) in a plane turned about (pa, pb) by `deg` degrees, counterclockwise (y-z seen from +x, x-y seen from above). */
export function turnYZ(y: number, z: number, py: number, pz: number, deg: number): [number, number] {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  const dy = y - py;
  const dz = z - pz;
  return [py + dy * c - dz * s, pz + dy * s + dz * c];
}

/** Rotation of `deg` about the robot x axis, as a row-major 3×3. */
function rotX(deg: number): Rot3 {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

/** Rotation of `deg` about the robot z axis (counterclockwise from above), as a row-major 3×3. */
function rotZ(deg: number): Rot3 {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

function mul(a: Rot3, b: Rot3): Rot3 {
  const r = new Array(9).fill(0) as Rot3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

/** The travel for `out` from [out, travel] points (clamped at the ends). */
export function profileAt(pts: [number, number][], out: number): number {
  if (out <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (out <= pts[i][0]) {
      const [a, b] = [pts[i - 1], pts[i]];
      return a[1] + ((out - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
    }
  }
  return pts[pts.length - 1][1];
}

/** The pose [turn, shift y, shift z] a track gives at `out` (linear between keys, clamped at the ends). */
export function trackAt(keys: [number, number, number, number][], out: number): [number, number, number] {
  if (out <= keys[0][0]) return [keys[0][1], keys[0][2], keys[0][3]];
  for (let i = 1; i < keys.length; i++) {
    if (out <= keys[i][0]) {
      const [a, b] = [keys[i - 1], keys[i]];
      const t = (out - a[0]) / (b[0] - a[0]);
      return [a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2]), a[3] + t * (b[3] - a[3])];
    }
  }
  const k = keys[keys.length - 1];
  return [k[1], k[2], k[3]];
}

/** Where a group's parts move for a lift output: a turn about x (maybe) and a shift of the center. */
function groupMove(g: MotionGroup, out: number): { turn: number; about: [number, number]; shift: [number, number, number]; axis?: 'z' } {
  const j = g.joint;
  switch (j.type) {
    case 'yaw':
      return { turn: j.ratio * out, about: j.pivot, shift: [0, 0, 0], axis: 'z' };
    case 'revolute':
      return { turn: j.ratio * out, about: j.pivot, shift: [0, 0, 0] };
    case 'slide': {
      const d = j.profile ? profileAt(j.profile, out) : j.ratio * out;
      return { turn: 0, about: [0, 0], shift: [j.dir[0] * d, j.dir[1] * d, j.dir[2] * d] };
    }
    case 'track': {
      const [turn, dy, dz] = trackAt(j.keys, out);
      return { turn, about: j.about, shift: [0, dy, dz] };
    }
    case 'couple': {
      const [ty, tz] = turnYZ(j.track[0], j.track[1], j.pivot[0], j.pivot[1], j.ratio * out);
      return { turn: 0, about: [0, 0], shift: [0, ty - j.track[0], tz - j.track[1]] };
    }
  }
}

/**
 * The build with every group moved for lift output `out`. The input is not changed; parts
 * not in any group stay where they are. Parts without free placement are left alone (a
 * build that moves has to be a CAD import).
 */
export function poseBuild(asm: Assembly, spec: MotionSpec, out: number): Assembly {
  const parts: Placed[] = asm.parts.map((p) => structuredClone(p));
  for (const g of spec.groups) {
    const m = groupMove(g, out);
    for (const i of g.parts) {
      const p = parts[i];
      if (!p?.xf) continue;
      if (m.axis === 'z') {
        // about the vertical axis through (x, y): the center turns in the x-y plane and the part turns with it
        const [x, y] = turnYZ(p.xf.c[0], p.xf.c[1], m.about[0], m.about[1], m.turn);
        p.xf.c = [x, y, p.xf.c[2]];
        if (m.turn !== 0) p.xf.r = mul(rotZ(m.turn), p.xf.r as Rot3).map((v) => Math.round(v * 1e9) / 1e9) as Rot3;
        continue;
      }
      const [y, z] = turnYZ(p.xf.c[1], p.xf.c[2], m.about[0], m.about[1], m.turn);
      p.xf.c = [p.xf.c[0] + m.shift[0], y + m.shift[1], z + m.shift[2]];
      if (m.turn !== 0) p.xf.r = mul(rotX(m.turn), p.xf.r as Rot3).map((v) => Math.round(v * 1e9) / 1e9) as Rot3;
    }
  }
  return { ...asm, parts };
}

/** Problems with a motion spec for a build (empty = fine). */
export function validateMotion(spec: MotionSpec, asm: Assembly): string[] {
  const e: string[] = [];
  const seen = new Set<number>();
  if (spec.v !== 1) e.push('Unknown motion version.');
  if (!(spec.out.max >= spec.out.min)) e.push('Output range is backwards.');
  for (const g of spec.groups) {
    if (!g.parts.length) e.push(`Group "${g.name}" has no parts.`);
    for (const i of g.parts) {
      if (!Number.isInteger(i) || i < 0 || i >= asm.parts.length) e.push(`Group "${g.name}": part ${i} is not in the build.`);
      else if (seen.has(i)) e.push(`Part ${i} is in more than one group.`);
      seen.add(i);
    }
  }
  return e;
}
