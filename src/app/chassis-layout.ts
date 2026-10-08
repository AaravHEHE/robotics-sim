// Where a robot's drive base structure is, for everything drawn on it: the chassis itself
// (robot-meshes.ts) and the game manipulators mounted on it (manipulator-meshes.ts). Robot
// frame: x right, y forward, z up; inches.

import { partSize, type PartDef } from './parts/assembly.ts';
import { CATALOG, partDef } from './parts/catalog.ts';
import { WALL } from './parts/fasteners.ts';
import { clawEffector, clawPitch, type Point3 } from '../sim/lift.ts';
import type { ClawSpec, IntakeSpec, LiftSpec, MechanismSpec, RobotProfile, StagingSpec } from '../sim/profile.ts';

/** Holes (0.5 in) for a length in inches, at least `min`. */
export const holes = (inches: number, min = 2) => Math.max(min, Math.round(inches / 0.5));

/** The wheel part closest to the profile's wheels. */
export function wheelPart(diameter: number, style: 'omni' | 'traction'): PartDef {
  const wheels = CATALOG.parts.filter((d) => d.kind === 'wheel' && d.style === style);
  return wheels.reduce((a, b) => (Math.abs((b.diameter ?? 0) - diameter) < Math.abs((a.diameter ?? 0) - diameter) ? b : a));
}

/**
 * Where the drive base's structure is (robot frame: x right, y forward, z up; inches), for
 * whatever mounts on it: the rails either side of the wheels, and the crossbars across them.
 */
export interface ChassisLayout {
  /** Wheel radius, and the wheels' centres along the robot. */
  r: number;
  wheelY: number[];
  /** Centre of the inner rails (|x|): their web is on the inside, at |x| = inner - 0.25. */
  inner: number;
  /** Centre of the outer rails (|x|), if there is room for them. */
  outer: number | null;
  /** Height of the top of the rails (their top flange). */
  railTop: number;
  /** The rails run from -railHalf to railHalf (y). */
  railHalf: number;
  /** Crossbars across the inner rails, web down on the rails, flanges up: their centres (y). */
  /** (`tank`: under the air tank, or a cascade lift's fixed stages; null when there is neither.) */
  crossbars: { rear: number; mid: number; tank: number | null; front2: number; front: number };
  /** Top of a crossbar's web (what sits in its trough sits here), and of its flanges. */
  deck: number;
  deckTop: number;
  /** Half the length of a crossbar (x). */
  crossHalf: number;
  /** The brain's centre and size, if it is drawn. */
  brain: { x: number; y: number; z: number; size: [number, number, number] } | null;
  /**
   * Drive motors that cannot sit at their wheels (a claw takes up the room beside it): each is on the
   * rail at `y` instead, and turns its wheel by chain.
   */
  moved: Array<{ wheel: number; y: number }>;
  /** The battery's centre, whether it lies along the robot, the crossbars it is strapped to, and its size. */
  battery: { x: number; y: number; turned: boolean; bars: [number, number]; size: [number, number, number] };
}

export function chassisLayout(p: RobotProfile): ChassisLayout {
  const { length: L } = p.size;
  const d = p.drivetrain;
  const r = d.wheelDiameter / 2;
  const half = d.trackWidth / 2;
  const n = Math.max(2, Math.min(4, d.left.length));
  const ww = wheelPart(d.wheelDiameter, 'omni').width ?? 1;
  const inner = half - ww / 2 - 0.4;
  const outer = half + ww / 2 + 0.4;
  const hasOuter = outer + 0.25 <= p.size.width / 2 + 0.05;
  // the axle runs through the rails' lower hole: the rails' centre 0.25 above it
  const railTop = r + 0.25 + 0.5;
  // (a claw at the back reaches into the drive base: the rear crossbar, and the brain on it, stand in front of it)
  let rear = -L / 2 + 0.75;
  for (const z of clawZones(p)) if (z.y1 < 0 && z.z1 > railTop - 0.1 && z.z0 < railTop + 0.6 && z.y1 > rear - 1.05) rear = z.y1 + 1.05;
  const front = L / 2 - 0.75;
  // (the brain's mounting holes, 3.75 in apart, are over these two)
  const mid = rear + 3.75;
  const front2 = front - 2.5;
  const deck = railTop + WALL;
  const deckTop = railTop + 0.5;
  const brainSize = partSize(partDef('v5-brain'), {});
  const batSize = partSize(partDef('v5-battery'), {});
  const crossHalf = (holes(2 * inner + 0.5) * 0.5) / 2;
  const crossbars = { rear, mid, tank: tankCrossbar(p, mid, front2), front2, front };
  const hasBrain = p.size.width >= 8 && L >= 10;
  const brain = hasBrain ? { x: 0, y: (rear + mid) / 2, z: deck + 0.5 + brainSize[2] / 2, size: brainSize } : null;
  // the battery: across the front crossbars; lying along the robot beside the route a stack takes; or
  // (where a claw takes up the front) beside the brain at the back
  const relief = chassisRelief(p);
  const [bw, bd, bh] = batSize;
  const free = (x: number, hx: number, y: number, hy: number) => {
    const rel = relief(y - hy, y + hy, deckTop, deckTop + bh);
    return Math.abs(x) + hx <= crossHalf + 0.01 && !(rel && x + hx > rel.lo && x - hx < rel.hi);
  };
  const frontY = (front2 + front) / 2;
  let battery: ChassisLayout['battery'] = { x: 0, y: frontY, turned: false, bars: [front2, front], size: batSize };
  if (!free(0, bw / 2, frontY, bd / 2)) {
    const rel = relief(frontY - bw / 2, frontY + bw / 2, deckTop, deckTop + bh);
    const beside = rel ? [rel.hi + 0.05 + bd / 2, rel.lo - 0.05 - bd / 2].find((x) => free(x, bd / 2, frontY, bw / 2)) : undefined;
    if (beside !== undefined) battery = { x: beside, y: frontY, turned: true, bars: [front2, front], size: batSize };
    else if (brain) {
      const total = brainSize[0] + 0.15 + bd;
      brain.x = -total / 2 + brainSize[0] / 2;
      battery = { x: total / 2 - bd / 2, y: brain.y, turned: true, bars: [rear, mid], size: batSize };
    }
  }
  const wheelY = Array.from({ length: n }, (_, i) => -L / 2 + r + 0.5 + (i * (L - 2 * r - 1)) / (n - 1));
  // drive motors (inside the rail, at the wheel's height) that a claw's room would cut through
  const [ml, mw, mh] = partSize(partDef('v5-motor'), {});
  const motorsPerSide = Math.max(1, d.left.length);
  const hits = (y: number) => relief(y - mw / 2, y + mw / 2, r - mh / 2, r + mh / 2);
  const inTheWay = (y: number) => {
    const rel = hits(y);
    return !!rel && rel.hi > inner - 0.25 - ml;
  };
  const moved: ChassisLayout['moved'] = [];
  const taken = wheelY.filter((_, i) => motorsPerSide >= n || i === 0);
  for (const [i, wy] of wheelY.entries()) {
    if (!(motorsPerSide >= n || i === 0) || !inTheWay(wy)) continue;
    // the nearest stretch of rail clear of the room and of the other motors
    const others = () => [...taken.filter((y) => y !== wy), ...moved.map((m) => m.y)];
    const lo = -L / 2 + 1.6;
    const hi = L / 2 - 1.6;
    let best: number | null = null;
    for (let y = lo; y <= hi; y += 0.25) {
      if (inTheWay(y) || others().some((o) => Math.abs(o - y) < mw + 0.1)) continue;
      if (best === null || Math.abs(y - wy) < Math.abs(best - wy)) best = y;
    }
    if (best !== null) moved.push({ wheel: i, y: best });
  }
  return {
    r,
    wheelY,
    moved,
    inner,
    outer: hasOuter ? outer : null,
    railTop,
    railHalf: (holes(L - 0.5) * 0.5) / 2,
    crossbars,
    deck,
    deckTop,
    crossHalf,
    brain,
    battery,
  };
}

/**
 * Where a lift's pivot is (robot frame y, z) when it pivots on towers on the drive rails
 * (arms, 4-bars, 6-bars, chain bars, double reverse 4-bars), or null.
 */
export function liftPivot(p: RobotProfile, m: LiftSpec): { y: number; z: number } | null {
  if (m.base) return null;
  const L = m.length ?? 0;
  const a0 = ((m.startAngle ?? 0) * Math.PI) / 180;
  const out = m.facing === 'rear' ? -1 : 1;
  if (m.lift === 'arm' || m.lift === 'fourbar' || m.lift === 'chainbar') return { y: m.home.y - out * L * Math.cos(a0), z: m.home.z - L * Math.sin(a0) };
  if (m.lift === 'sixbar') return { y: m.home.y - out * L * Math.cos(a0), z: m.home.z - 2 * L * Math.sin(a0) };
  if (m.lift === 'dr4b') {
    // its fixed stage hangs from the top of towers at the end of the drive base nearer its
    // carriage (just inside the end crossbar); the carriage comes up below it
    const y = m.home.y < 0 ? -p.size.length / 2 + 1.75 : p.size.length / 2 - 1.75;
    return { y, z: m.home.z - 2 * L * Math.sin(a0) };
  }
  return null;
}

/** The air tank's crossbar: under a cascade's fixed stages, or clear of the lift towers. */
function tankCrossbar(p: RobotProfile, mid: number, front2: number): number | null {
  const lifts = p.mechanisms.filter((m): m is LiftSpec => m.kind === 'lift');
  const cascade = lifts.find((m) => m.lift === 'cascade' && !m.base);
  if (cascade) return cascade.home.y;
  if (!p.devices.some((x) => x.type === 'adi_digital_out')) return null;
  const towers = lifts.map((m) => liftPivot(p, m)?.y).filter((y): y is number => y !== undefined);
  return [mid + 2.5, mid + 1.5, mid + 3.5, front2 - 1.5].find((y) => y > mid + 1 && y < front2 - 1 && towers.every((t) => Math.abs(t - y) >= 1.1)) ?? null;
}


// ---- the route an intake carries a stack along, and what it needs cleared ----

/** The widest a carried piece is (a Pin's collar), and a margin, and the tallest stack (a Cup over a Pin). */
export const STACK_RADIUS = 1.75;
export const STACK_HEIGHT = 10.1;

/** Where an intake's route ends: the bottom of the stack once its destination holds it (robot frame). */
export function intakeEnd(p: RobotProfile, spec: IntakeSpec, dest: ClawSpec | StagingSpec | null, valueOf: Parameters<typeof clawEffector>[2]): Point3 {
  // a claw holds a piece `grip` in above its bottom (at least 1, never in the last inch of it): so the
  // stack's bottom is at the floor unless the claw receives it very high
  const claw = (e: Point3): Point3 => ({ x: e.x, y: e.y, z: Math.max(0, e.z - Math.min(Math.max(1, e.z), 5.5)) });
  if (spec.handoff) return claw({ x: spec.handoff.x ?? 0, y: spec.handoff.y, z: spec.handoff.z });
  if (dest?.kind === 'staging') return { x: dest.at.x ?? 0, y: dest.at.y, z: dest.at.z };
  if (dest?.kind === 'claw') return claw(clawEffector(p, dest, valueOf));
  return { x: spec.zone.x, y: spec.zone.y - spec.zone.length / 2 - 2, z: 0.5 };
}

/** Top of the highest thing standing on the drive base (the electronics), where the route crosses over it. */
export function chassisTop(p: RobotProfile): number {
  const railTop = p.drivetrain.wheelDiameter / 2 + 0.75;
  const deck = railTop + WALL;
  let top = railTop + 0.5 + partSize(partDef('v5-battery'), {})[2];
  if (p.size.width >= 8 && p.size.length >= 10) top = Math.max(top, deck + 0.5 + partSize(partDef('v5-brain'), {})[2]);
  if (p.devices.some((x) => x.type === 'adi_digital_out')) top = Math.max(top, railTop + 0.5 + partSize(partDef('air-tank'), {})[1]);
  return top;
}

/**
 * Where an intake carries a stack (the stack's bottom, robot frame): from the floor at its mouth to
 * where its destination takes it. A short hop goes straight; a long one rises at the mouth, crosses
 * over the electronics and comes down at the end.
 */
export function intakeRoute(p: RobotProfile, spec: IntakeSpec, dest: ClawSpec | StagingSpec | null, valueOf: Parameters<typeof clawEffector>[2] = () => 0): Point3[] {
  const mouth = { x: spec.zone.x, y: spec.zone.y, z: 0 };
  const end = intakeEnd(p, spec, dest, valueOf);
  if (Math.hypot(end.x - mouth.x, end.y - mouth.y) < 4) return [mouth, end];
  const lane = Math.max(end.z, chassisTop(p) + 0.05);
  return [mouth, { x: mouth.x, y: mouth.y, z: lane }, { x: end.x, y: end.y, z: lane }, end];
}

/**
 * The x span a stack riding `route` needs clear at a thing occupying y in [y0, y1] and z in
 * [z0, z1] (the stack is `STACK_RADIUS` wide, `STACK_HEIGHT` tall), or null when it never comes near.
 */
export function routeRelief(route: Point3[], y0: number, y1: number, z0: number, z1: number): { lo: number; hi: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i];
    const b = route[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.25));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const z = a.z + (b.z - a.z) * t;
      if (z + STACK_HEIGHT <= z0 || z >= z1) continue;
      const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
      if (dy >= STACK_RADIUS) continue;
      const c = Math.sqrt(STACK_RADIUS * STACK_RADIUS - dy * dy);
      lo = Math.min(lo, x - c);
      hi = Math.max(hi, x + c);
    }
  }
  return lo === Infinity ? null : { lo, hi };
}

/** An intake's destination mechanism, by name. */
export function intakeDest(p: RobotProfile, spec: IntakeSpec): ClawSpec | StagingSpec | null {
  return (p.mechanisms.find((m) => m.name === spec.into && (m.kind === 'claw' || m.kind === 'staging')) as ClawSpec | StagingSpec | undefined) ?? null;
}


// ---- claws: the room one takes up at rest ----

/** A box in the robot frame (inches). */
export interface Zone {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/**
 * The room each claw takes up when its lifts are at rest: its side plates and back wall behind the
 * grip point, its jaws or rollers (and their motors) about it. Nothing of the drive base may stand
 * in it.
 */
export function clawZones(p: RobotProfile): Zone[] {
  const claws = p.mechanisms.filter((m): m is ClawSpec => m.kind === 'claw');
  return claws.flatMap((c) => [clawZone(p, c, () => 0), clawZone(p, c, (m) => (m.kind === 'lift' && m.range ? Math.min(0, m.range[0]) : 0))]);
}

/** The room a claw takes up with its lifts at the values `v` give them. */
export function clawZone(p: RobotProfile, c: ClawSpec, v: (m: MechanismSpec) => number = () => 0): Zone {
  const e = clawEffector(p, c, v);
  const lift = c.lift ? p.mechanisms.find((m): m is LiftSpec => m.kind === 'lift' && m.name === c.lift) : undefined;
  const front = (lift ? lift.home.y : (c.at?.y ?? 1)) >= 0;
  const roller = c.grip === 'roller';
  const hx = roller ? 4.0 : 3.5;
  const [behind, ahead] = [4.6, 2.3];
  return {
    x0: -hx,
    x1: hx,
    y0: front ? e.y - behind : e.y - ahead,
    y1: front ? e.y + ahead : e.y + behind,
    z0: e.z - (roller ? 1.6 : 1.4),
    z1: e.z + (roller ? 4.2 : 1.4),
  };
}

/**
 * Where the stack a claw holds goes as its lifts move through their ranges (points down its axis,
 * robot frame): the stack hangs along the claw's pitch below the grip point.
 */
export function heldSweep(p: RobotProfile): Point3[] {
  const out: Point3[] = [];
  const lifts = p.mechanisms.filter((m): m is LiftSpec => m.kind === 'lift' && !!m.range);
  const at = (f: number[]) => (m: MechanismSpec) => {
    const i = lifts.indexOf(m as LiftSpec);
    return i < 0 ? 0 : lifts[i].range![0] + (lifts[i].range![1] - lifts[i].range![0]) * f[i];
  };
  const steps = lifts.length > 1 ? 5 : 11;
  const combos: number[][] = [[]];
  for (let i = 0; i < lifts.length; i++) {
    const next: number[][] = [];
    for (const c of combos) for (let k = 0; k < steps; k++) next.push([...c, k / (steps - 1)]);
    combos.splice(0, combos.length, ...next);
  }
  for (const c of p.mechanisms.filter((m): m is ClawSpec => m.kind === 'claw')) {
    for (const f of combos) {
      const v = at(f);
      const e = clawEffector(p, c, v);
      const a = (clawPitch(p, c, v, false) * Math.PI) / 180;
      for (const grip of [1, 5.5]) {
        for (let h = 0; h <= 10.1; h += 0.5) {
          const along = h - grip; // up the axis from the grip point
          out.push({ x: e.x, y: e.y - along * Math.sin(a), z: e.z + along * Math.cos(a) });
        }
      }
    }
  }
  return out;
}

export function chassisRelief(p: RobotProfile): (y0: number, y1: number, z0: number, z1: number) => { lo: number; hi: number } | null {
  const intake = p.mechanisms.find((m): m is IntakeSpec => m.kind === 'intake');
  const route = intake ? intakeRoute(p, intake, intakeDest(p, intake)) : [];
  const zones = clawZones(p);
  const sweep = heldSweep(p);
  return (y0, y1, z0, z1) => {
    let { lo, hi } = routeRelief(route, y0, y1, z0, z1) ?? { lo: Infinity, hi: -Infinity };
    // what a held stack swings through (a stack is a column of radius STACK_RADIUS around its axis)
    if (sweep.some((q) => q.y > y0 - STACK_RADIUS && q.y < y1 + STACK_RADIUS && q.z > z0 - STACK_RADIUS && q.z < z1 + STACK_RADIUS)) {
      lo = Math.min(lo, -STACK_RADIUS);
      hi = Math.max(hi, STACK_RADIUS);
    }
    for (const z of zones) {
      if (z.y1 <= y0 || z.y0 >= y1 || z.z1 <= z0 || z.z0 >= z1) continue;
      lo = Math.min(lo, z.x0);
      hi = Math.max(hi, z.x1);
    }
    return lo === Infinity ? null : { lo, hi };
  };
}
