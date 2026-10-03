// What the robot's sensors see on the Override field: game objects for distance sensors,
// and colors for optical sensors (Pins, Cups, Goals, Toggle faces, held pieces).
// Installed into the World's sensor hooks by the game. Idealized: exact colors, no
// ambient light, no noise.

import type { FieldDef } from '../../sim/field.ts';
import { clawEffector } from '../../sim/lift.ts';
import type { ClawSpec, DeviceSpec, IntakeSpec, StagingSpec } from '../../sim/profile.ts';
import type { OpticalReading, SensorBeam, World } from '../../sim/world.ts';
import { octagon, rayPolygon } from '../../sim/world.ts';
import { CUP, layoutStack, PIN, type Piece } from './elements.ts';
import type { OverrideState } from './state.ts';
import { faceInside, overhang, wallFrame } from './toggle.ts';

/** How far an optical sensor sees, inches (proximity falls to 0 at this distance). */
export const OPTICAL_RANGE = 6;

type Hsv = Omit<OpticalReading, 'proximity'>;
const COLORS: Record<string, Hsv> = {
  red: { hue: 4, saturation: 0.85, brightness: 0.45 },
  blue: { hue: 215, saturation: 0.85, brightness: 0.4 },
  yellow: { hue: 52, saturation: 0.85, brightness: 0.7 },
  // a Cup's opaque gray half, and its clear half (mostly the dark inside / what's behind)
  gray: { hue: 210, saturation: 0.1, brightness: 0.3 },
  clear: { hue: 200, saturation: 0.06, brightness: 0.12 },
  // neutral Goals are black; the perimeter is aluminum and clear polycarbonate
  black: { hue: 0, saturation: 0, brightness: 0.06 },
  wall: { hue: 210, saturation: 0.05, brightness: 0.25 },
};
const NOTHING: OpticalReading = { hue: 0, saturation: 0, brightness: 0.02, proximity: 0 };

/**
 * Color of a stack at height z (pieces laid out from `base`), or null if nothing is
 * there. A Cup's opaque half hides a Pin inside it; through its clear half the Pin shows.
 */
export function colorAt(pieces: Piece[], base: number, onGoal: boolean, z: number): string | null {
  let pin: string | null = null;
  let cup: string | null = null;
  for (const s of layoutStack(pieces, base, onGoal)) {
    if (z < s.bottom || z > s.top) continue;
    const p = s.piece;
    if (p.kind === 'pin') pin = z < s.bottom + PIN.half + PIN.collar / 2 ? p.colors[0] : p.colors[1];
    else {
      const upper = z >= s.bottom + CUP.height / 2;
      cup = upper === (p.up === 'gray') ? 'gray' : 'clear';
    }
  }
  if (cup === 'gray') return 'gray';
  return pin ?? cup;
}

/** Distance along a ray to a circle (Infinity if missed or behind). */
function rayCircle(b: SensorBeam, cx: number, cy: number, r: number): number {
  const fx = b.ox - cx;
  const fy = b.oy - cy;
  const bq = fx * b.dx + fy * b.dy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0; // starts inside it
  const disc = bq * bq - c;
  if (disc < 0) return Infinity;
  const t = -bq - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

interface Hit {
  t: number;
  color: string;
}

export function installSensors(world: World, field: FieldDef, state: OverrideState): void {
  const half = field.perimeter.inside / 2;
  const toward = (b: SensorBeam): Hit[] => {
    const hits: Hit[] = [];
    // standing stacks: a disc as wide as the widest piece, as tall as the stack
    for (const s of state.floor) {
      const color = colorAt(s.pieces, 0, false, b.z);
      if (!color) continue;
      const r = Math.max(...s.pieces.map((p) => (p.kind === 'cup' ? CUP.rimDiameter : PIN.collarDiameter) / 2));
      hits.push({ t: rayCircle(b, s.x, s.y, r), color });
    }
    // lying Pins: a row of discs along the axis, each half its own color
    for (const l of state.lying) {
      if (b.z > PIN.collarDiameter) continue;
      const ux = Math.sin((l.heading * Math.PI) / 180);
      const uy = Math.cos((l.heading * Math.PI) / 180);
      for (const k of [-2, -1, 1, 2]) {
        const d = (k / 2.5) * (PIN.length / 2);
        hits.push({ t: rayCircle(b, l.x + ux * d, l.y + uy * d, PIN.coneDiameter / 2), color: l.colors[k < 0 ? 0 : 1] });
      }
    }
    return hits;
  };

  world.sensors.objectRay = (b) => Math.min(Infinity, ...toward(b).map((h) => h.t));

  world.sensors.optical = (dev) => {
    if (dev.watches) return watched(dev);
    const m = dev.mount ?? { x: 0, y: world.profile.size.length / 2, z: 2, heading: 0 };
    const b = world.beam({ ...m, z: m.z ?? 2 });
    const hits = toward(b);
    // Goals: the body below its top, the stack above it
    for (const g of field.goals ?? []) {
      const color = b.z <= g.height ? (g.color === 'neutral' ? 'black' : g.color) : colorAt(state.goals[g.id] ?? [], g.height, true, b.z);
      if (color) hits.push({ t: rayPolygon(b.ox, b.oy, b.dx, b.dy, octagon(g.x, g.y, g.baseWidth)), color });
    }
    // Toggles: the face toward the field, where the prism hangs over it
    for (const t of field.toggles ?? []) {
      if (b.z < t.topHeight - t.sectionHeight || b.z > t.topHeight) continue;
      const { n, u } = wallFrame(t);
      const along = b.dx * n[0] + b.dy * n[1];
      if (along >= -1e-9) continue; // pointing away from this wall
      const dist = (b.ox - t.x) * n[0] + (b.oy - t.y) * n[1] - overhang(t);
      const tt = dist / -along;
      const s = (b.ox + b.dx * tt - t.x) * u[0] + (b.oy + b.dy * tt - t.y) * u[1];
      if (tt >= 0 && Math.abs(s) <= t.length / 2) {
        const st = state.toggles.find((x) => x.id === t.id);
        hits.push({ t: tt, color: faceInside(t, st?.angle ?? 0) });
      }
    }
    // the perimeter
    let wall = Infinity;
    if (b.dx > 1e-9) wall = Math.min(wall, (half - b.ox) / b.dx);
    if (b.dx < -1e-9) wall = Math.min(wall, (-half - b.ox) / b.dx);
    if (b.dy > 1e-9) wall = Math.min(wall, (half - b.oy) / b.dy);
    if (b.dy < -1e-9) wall = Math.min(wall, (-half - b.oy) / b.dy);
    hits.push({ t: wall, color: 'wall' });
    const best = hits.reduce<Hit | null>((a, h) => (h.t < (a?.t ?? Infinity) ? h : a), null);
    if (!best || best.t > OPTICAL_RANGE) return NOTHING;
    return { ...COLORS[best.color], proximity: Math.round(255 * (1 - best.t / OPTICAL_RANGE)) };
  };

  /** A sensor looking into a claw, intake or staging area: the held piece at its height. */
  const watched = (dev: Extract<DeviceSpec, { type: 'optical' }>): OpticalReading => {
    const name = dev.watches!;
    const pieces = state.held[name] ?? [];
    if (!pieces.length) return NOTHING;
    const mech = world.profile.mechanisms.find((x) => x.name === name) as ClawSpec | IntakeSpec | StagingSpec;
    let base = 0.5; // an intake carries pieces just off the floor
    if (mech.kind === 'staging') base = mech.at.z;
    if (mech.kind === 'claw') base = clawEffector(world.profile, mech, (x) => world.mechanismState(x)).z - (state.grip[name] ?? 0);
    const z = dev.mount?.z ?? base + 1;
    // at the sensor's height, or else the nearest piece's color
    const slots = layoutStack(pieces, base, false);
    const color = colorAt(pieces, base, false, z) ?? colorAt(pieces, base, false, z < slots[0].bottom ? slots[0].bottom : slots[slots.length - 1].top);
    return { ...COLORS[color ?? 'gray'], proximity: 230 };
  };
}

