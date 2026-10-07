// Where a robot's drive base structure is, for everything drawn on it: the chassis itself
// (robot-meshes.ts) and the game manipulators mounted on it (manipulator-meshes.ts). Robot
// frame: x right, y forward, z up; inches.

import { partSize, type PartDef } from './parts/assembly.ts';
import { CATALOG, partDef } from './parts/catalog.ts';
import { WALL } from './parts/fasteners.ts';
import type { LiftSpec, RobotProfile } from '../sim/profile.ts';

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
  brain: { y: number; z: number; size: [number, number, number] } | null;
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
  const rear = -L / 2 + 0.75;
  const front = L / 2 - 0.75;
  // (the brain's mounting holes, 3.75 in apart, are over these two)
  const mid = rear + 3.75;
  const front2 = front - 2.5;
  const deck = railTop + WALL;
  const brainSize = partSize(partDef('v5-brain'), {});
  return {
    r,
    wheelY: Array.from({ length: n }, (_, i) => -L / 2 + r + 0.5 + (i * (L - 2 * r - 1)) / (n - 1)),
    inner,
    outer: hasOuter ? outer : null,
    railTop,
    railHalf: (holes(L - 0.5) * 0.5) / 2,
    crossbars: { rear, mid, tank: tankCrossbar(p, mid, front2), front2, front },
    deck,
    deckTop: railTop + 0.5,
    crossHalf: (holes(2 * inner + 0.5) * 0.5) / 2,
    brain: p.size.width >= 8 && L >= 10 ? { y: (rear + mid) / 2, z: deck + 0.5 + brainSize[2] / 2, size: brainSize } : null,
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
