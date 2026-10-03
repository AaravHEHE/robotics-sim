// V5RC Override scoring (manual v2.0 SC1–SC8, RSC3). Pure functions of the game state.

import type { FieldDef, GoalDef } from '../../sim/field.ts';
import type { Piece, PinColor } from './elements.ts';
import type { OverrideState } from './state.ts';
import { setColor, type ToggleColor } from './toggle.ts';

export type Mode = 'h2h' | 'skills';
export type Owner = 'red' | 'blue' | null;

export interface HalfScore {
  pin: string;
  color: PinColor;
  visible: boolean;
  /** Who earns points for this half (null = nobody). */
  owner: Owner;
  points: number;
}

export interface GoalScore {
  goal: string;
  zone: string;
  /** Pins that are Placed (SC2). */
  placedPins: number;
  halves: HalfScore[];
  red: number;
  blue: number;
}

export interface ScoreBreakdown {
  mode: Mode;
  red: number;
  blue: number;
  goals: GoalScore[];
  toggles: Array<{ id: string; zone: string; color: ToggleColor }>;
  midfield: { red: number; blue: number; points: { red: number; blue: number } };
}

export interface ScoreContext {
  field: FieldDef;
  state: OverrideState;
  mode: Mode;
  /** Robots of each alliance in the Midfield (SC6). */
  robotsInMidfield: { red: number; blue: number };
  /**
   * Autonomous-period scoring (SC7a): excludes Robots in the Midfield and Midfield
   * yellow-Pin ownership.
   */
  autonomous: boolean;
}

/**
 * Placed Pins in a goal stack (SC2): the first piece must be a Pin nested in the Goal,
 * then each Cup must sit on a Placed Pin and each Pin in a Cup above it. The stack
 * model allows one Pin half per Cup half, so (ii) always holds; anything above a break
 * is not Placed.
 */
export function placedPrefix(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const p of pieces) {
    const prev = out[out.length - 1];
    if (prev ? p.kind === prev.kind : p.kind !== 'pin') break;
    out.push(p);
  }
  return out;
}

/** Visible halves of each Placed Pin (SC3): a half inside an opaque Cup half is hidden. */
function pinHalves(stack: Piece[]): Array<{ pin: string; color: PinColor; visible: boolean }> {
  const out: Array<{ pin: string; color: PinColor; visible: boolean }> = [];
  for (let i = 0; i < stack.length; i++) {
    const p = stack[i];
    if (p.kind !== 'pin') continue;
    const below = stack[i - 1];
    const above = stack[i + 1];
    // lower half sits in the upper half of the Cup below (or in the Goal)
    const lowerHidden = below?.kind === 'cup' && below.up === 'gray';
    // upper half is covered by the lower half of the Cup above, which is the opposite of its 'up' half
    const upperHidden = above?.kind === 'cup' && above.up === 'clear';
    out.push({ pin: p.id, color: p.colors[0], visible: !lowerHidden });
    out.push({ pin: p.id, color: p.colors[1], visible: !upperHidden });
  }
  return out;
}

const toggleFor = (field: FieldDef, zone: string) => field.toggles?.find((t) => t.zone === zone);
const zoneColor = (field: FieldDef, zone: string) => field.zones?.find((z) => z.id === zone)?.color ?? 'neutral';

export function score(ctx: ScoreContext): ScoreBreakdown {
  const { field, state, mode } = ctx;
  const toggles = (field.toggles ?? []).map((t) => {
    const s = state.toggles.find((x) => x.id === t.id);
    return { id: t.id, zone: t.zone, color: setColor(t, s?.angle ?? 0, s?.touched ?? false) };
  });
  const toggleColor = (zone: string): ToggleColor => toggles.find((t) => t.zone === zone)?.color ?? 'yellow';
  const mid = ctx.robotsInMidfield;
  const midOwner: Owner = ctx.autonomous ? null : mid.red > mid.blue ? 'red' : mid.blue > mid.red ? 'blue' : null;

  const goals: GoalScore[] = [];
  let red = 0;
  let blue = 0;
  for (const g of field.goals ?? []) {
    const placed = placedPrefix(state.goals[g.id] ?? []);
    const gs: GoalScore = { goal: g.id, zone: g.zone, placedPins: placed.filter((p) => p.kind === 'pin').length, halves: [], red: 0, blue: 0 };
    for (const h of pinHalves(placed)) {
      const owner = h.visible ? halfOwner(field, g, h.color, mode, toggleColor, midOwner, ctx) : null;
      const points = owner ? (h.color === 'yellow' ? 10 : 5) : 0;
      gs.halves.push({ ...h, owner, points });
      if (owner === 'red') gs.red += points;
      if (owner === 'blue') gs.blue += points;
    }
    red += gs.red;
    blue += gs.blue;
    goals.push(gs);
  }
  const midPoints = ctx.autonomous ? { red: 0, blue: 0 } : { red: 8 * mid.red, blue: 8 * mid.blue };
  red += midPoints.red;
  blue += midPoints.blue;
  return { mode, red, blue, goals, toggles, midfield: { ...mid, points: midPoints } };
}

function halfOwner(
  field: FieldDef,
  g: GoalDef,
  color: PinColor,
  mode: Mode,
  toggleColor: (zone: string) => ToggleColor,
  midOwner: Owner,
  ctx: ScoreContext,
): Owner {
  const inMidfield = g.zone === 'midfield';
  if (mode === 'h2h') {
    if (color === 'red' || color === 'blue') return color;
    if (inMidfield) return midOwner;
    const t = toggleColor(g.zone);
    return t === 'yellow' ? null : t;
  }
  // Robot Skills (RSC3): one team; points are reported as "red" (the skills alliance)
  const zc = zoneColor(field, g.zone);
  if (color === 'red' || color === 'blue') return inMidfield || zc === color ? 'red' : null;
  if (inMidfield) return ctx.robotsInMidfield.red + ctx.robotsInMidfield.blue > 0 ? 'red' : null;
  const t = toggleFor(field, g.zone) ? toggleColor(g.zone) : 'yellow';
  return t !== 'yellow' && t === zc ? 'red' : null;
}

// ---------------- Autonomous Bonus and Autonomous Win Point ----------------

export interface AwpCheck {
  alliance: 'red' | 'blue';
  /** Standard events (6 Pins / 2 Goals) and World-qualifying events (7 / 3). */
  standard: boolean;
  worlds: boolean;
  scoredPins: number;
  goalsWithTwo: number;
  touchingPerimeter: boolean;
  violation: boolean;
}

/**
 * SC8. Scored Pins count per visible half Scored for the alliance (SC3: each visible half
 * "counts as a Scored Pin"), excluding Goals in Quadrants on the opposing side.
 */
export function awp(field: FieldDef, s: ScoreBreakdown, alliance: 'red' | 'blue', touchingPerimeter: boolean, violation: boolean): AwpCheck {
  let scoredPins = 0;
  let goalsWithTwo = 0;
  for (const g of s.goals) {
    const zc = zoneColor(field, g.zone);
    if (zc !== 'neutral' && zc !== alliance) continue; // opposing side of the Autonomous Line
    const n = g.halves.filter((h) => h.owner === alliance).length;
    scoredPins += n;
    if (n >= 2) goalsWithTwo++;
  }
  const ok = !touchingPerimeter && !violation;
  return {
    alliance,
    standard: ok && scoredPins >= 6 && goalsWithTwo >= 2,
    worlds: ok && scoredPins >= 7 && goalsWithTwo >= 3,
    scoredPins,
    goalsWithTwo,
    touchingPerimeter,
    violation,
  };
}

/** SC7: 12 points to the higher autonomous score, 6 each on a tie; a violation hands it to the opponent. */
export function autonomousBonus(s: ScoreBreakdown, violations: { red: boolean; blue: boolean }): { red: number; blue: number } {
  if (violations.red && violations.blue) return { red: 0, blue: 0 };
  if (violations.red) return { red: 0, blue: 12 };
  if (violations.blue) return { red: 12, blue: 0 };
  if (s.red === s.blue) return { red: 6, blue: 6 };
  return s.red > s.blue ? { red: 12, blue: 0 } : { red: 0, blue: 12 };
}
