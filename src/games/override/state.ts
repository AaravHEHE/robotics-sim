// Override game state: where every Pin and Cup is, what each Goal holds, and each
// Toggle's angle. Built from a field layout; evolved by the simulator; recorded for
// replay; scored by scoring.ts.

import type { FieldDef, LayoutPiece } from '../../sim/field.ts';
import type { CupPiece, Piece, PinColor, PinPiece } from './elements.ts';

/** Pieces standing on the floor at (x, y), bottom first (e.g. a cup holding a pin). */
export interface FloorStack {
  id: string;
  x: number;
  y: number;
  pieces: Piece[];
}

/** A pin lying on its side; heading points from colors[0]'s end to colors[1]'s end. */
export interface LyingPin {
  id: string;
  x: number;
  y: number;
  heading: number;
  colors: [PinColor, PinColor];
}

export interface ToggleState {
  id: string;
  /** Roll angle in degrees: 0 = starting orientation; +120 = one roll with the top moving outward. */
  angle: number;
  /** Angular velocity, deg/s (absent in older recordings: at rest). */
  omega?: number;
  /** A robot is touching the toggle right now. */
  touched: boolean;
}

/**
 * A piece on its way somewhere, for the viewer to animate: it left `from` at t0 and gets
 * where the state says it is at t1 (ms). Keyed by piece id (riding through an intake),
 * `claw:<name>` (what a claw just picked up) or a floor stack / lying Pin id (falling).
 */
export interface Transit {
  /** Field position it started from, and the height of its bottom (in). */
  from: { x: number; y: number; z: number };
  /** Where it ends up, when that is on a Goal or stack (its bottom there): it falls onto it. */
  to?: { x: number; y: number; z: number };
  /** It started out lying, pointing this way (degrees): it is turned upright on the way. */
  lying?: number;
  t0: number;
  t1: number;
}

export interface OverrideState {
  floor: FloorStack[];
  lying: LyingPin[];
  /** Goal id -> pieces placed on it, bottom first. */
  goals: Record<string, Piece[]>;
  toggles: ToggleState[];
  /** Match loads still off the field, per alliance. */
  matchLoads: Partial<Record<'red' | 'blue', Piece[]>>;
  /** Loader id -> pieces in its chute, bottom first (the bottom one can be taken). */
  loaders: Record<string, Piece[]>;
  /** Robot mechanism name (claw, staging, intake) -> pieces it holds, bottom first. */
  held: Record<string, Piece[]>;
  /** Claw name -> height of its grip point above the bottom of what it holds. */
  grip: Record<string, number>;
  /** Pieces in motion (see Transit). */
  transit: Record<string, Transit>;
  /** Claw name -> its wrist has turned what it holds upside down. */
  flipped: Record<string, boolean>;
}

/** Initial state for a layout ("h2h" or "skills"). Ids are deterministic per call, and each call has its own. */
export function initialState(field: FieldDef, layoutId: string): OverrideState {
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}${++counter}`;
  const pieceFrom = (p: LayoutPiece): Piece =>
    p.kind === 'pin'
      ? ({ kind: 'pin', id: nextId('pin'), colors: p.colors as [PinColor, PinColor] } satisfies PinPiece)
      : ({ kind: 'cup', id: nextId('cup'), up: p.up } satisfies CupPiece);
  const layout = field.layouts?.[layoutId];
  const state: OverrideState = {
    floor: [],
    lying: [],
    goals: Object.fromEntries((field.goals ?? []).map((g) => [g.id, [] as Piece[]])),
    toggles: (field.toggles ?? []).map((t) => ({ id: t.id, angle: 0, touched: false })),
    matchLoads: {},
    loaders: Object.fromEntries((field.loaders ?? []).map((l) => [l.id, [] as Piece[]])),
    held: {},
    grip: {},
    transit: {},
    flipped: {},
  };
  if (!layout) return state;
  for (const it of layout.items) {
    if (it.type === 'stack') state.floor.push({ id: nextId('s'), x: it.x, y: it.y, pieces: it.pieces.map(pieceFrom) });
    else if (it.type === 'lying') state.lying.push({ id: nextId('pin'), x: it.x, y: it.y, heading: it.heading, colors: it.colors as [PinColor, PinColor] });
    else state.goals[it.goal].push(...it.pieces.map(pieceFrom));
  }
  for (const [alliance, loads] of Object.entries(layout.matchLoads ?? {})) {
    state.matchLoads[alliance as 'red' | 'blue'] = (loads ?? []).map(pieceFrom);
  }
  return state;
}

/** Count objects in a state (for checks against the manual's inventory). */
export function inventory(state: OverrideState): { cups: number; pins: Record<string, number> } {
  const pins: Record<string, number> = {};
  let cups = 0;
  const addPin = (c: [string, string]) => {
    const key = [...c].sort().join('/');
    pins[key] = (pins[key] ?? 0) + 1;
  };
  const visit = (p: Piece) => (p.kind === 'cup' ? cups++ : addPin(p.colors));
  for (const s of state.floor) s.pieces.forEach(visit);
  for (const l of state.lying) addPin(l.colors);
  for (const ps of Object.values(state.goals)) ps.forEach(visit);
  for (const ps of Object.values(state.matchLoads)) ps?.forEach(visit);
  for (const ps of Object.values(state.loaders)) ps.forEach(visit);
  for (const ps of Object.values(state.held)) ps.forEach(visit);
  return { cups, pins };
}
