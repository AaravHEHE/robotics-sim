// Rule monitors for the simulated robot (SG1–SG3, SG7, SG9). They report violations as
// notes and feed the Autonomous Bonus / AWP; nothing is enforced on the robot.

import type { Alliance, FieldDef, Vec2 } from '../../sim/field.ts';
import { octagon, satMtv } from '../../sim/world.ts';

export interface Violation {
  t: number;
  rule: string;
  message: string;
}

/** Autonomous Line: double tape 2.5″ wide on y = −x; red's side is x + y < 0. */
const LINE_HALF_WIDTH = 1.25;
/** Contact tolerance (in) for "touching" the perimeter or a Goal. */
const TOUCH = 0.02;

/** Signed distance (in) of a point past the Autonomous Line's far edge, for an alliance. */
export function pastAutonLine(alliance: Alliance, [x, y]: Vec2): number {
  const d = (x + y) / Math.SQRT2; // > 0 on blue's side
  return (alliance === 'red' ? d : -d) - LINE_HALF_WIDTH;
}

/** Which side of the Autonomous Line a point is on ('line' if on the tape). */
export function sideOf([x, y]: Vec2): Alliance | 'line' {
  const d = (x + y) / Math.SQRT2;
  return d < -LINE_HALF_WIDTH ? 'red' : d > LINE_HALF_WIDTH ? 'blue' : 'line';
}

export function touchingPerimeter(field: FieldDef, footprint: Vec2[]): boolean {
  const half = field.perimeter.inside / 2 - TOUCH;
  return footprint.some(([x, y]) => Math.abs(x) >= half || Math.abs(y) >= half);
}

/** Any part of the robot inside the Midfield volume (SC6). */
export function inMidfield(field: FieldDef, footprint: Vec2[]): boolean {
  const mid = field.zones?.find((z) => z.kind === 'midfield');
  return !!mid && satMtv(footprint, mid.polygon) !== null;
}

export interface MonitorOptions {
  alliance: Alliance;
  mode: 'h2h' | 'skills';
  size: { width: number; length: number; height: number };
}

export class RuleMonitor {
  readonly violations: Violation[] = [];
  private readonly seen = new Set<string>();
  private readonly opponentGoals: Array<{ id: string; poly: Vec2[] }>;

  private readonly opts: MonitorOptions;

  constructor(field: FieldDef, opts: MonitorOptions) {
    this.opts = opts;
    const opp = opts.alliance === 'red' ? 'blue' : 'red';
    this.opponentGoals = (field.goals ?? [])
      .filter((g) => g.color === opp)
      .map((g) => ({ id: g.id, poly: octagon(g.x, g.y, g.baseWidth + 2 * TOUCH) }));
    const { width, length, height } = opts.size;
    if (Math.max(width, length, height) > 18) {
      this.add(0, 'SG1', `The robot profile is ${width}×${length}×${height}″; robots must start within 18×18×18″.`);
    }
    if (Math.max(width, length) > 24 || height > 50) {
      this.add(0, 'SG2', `The robot profile exceeds the 24×24″ footprint / 50″ height limits.`);
    }
  }

  /** Report a rule once (the first time it happens). */
  add(t: number, rule: string, message: string): void {
    if (this.seen.has(rule + message)) return;
    this.seen.add(rule + message);
    this.violations.push({ t, rule, message });
  }

  /** Check the robot at time t (ms of autonomous). */
  check(t: number, footprint: Vec2[]): void {
    if (this.opts.mode !== 'h2h') return; // Skills has no opponent
    if (footprint.some((p) => pastAutonLine(this.opts.alliance, p) > 0)) {
      this.add(t, 'SG7', 'The robot crossed the Autonomous Line onto the opposing side.');
    }
    for (const g of this.opponentGoals) {
      if (satMtv(footprint, g.poly)) this.add(t, 'SG9', `The robot touched opponent Goal ${g.id}.`);
    }
  }
}

/**
 * Objects that begin the Match on (above or touching) the Autonomous Line are shared
 * (SG7b): the crosses on y = −x and the stacks at the Midfield corners — 28 objects.
 */
export function startsOnAutonLine([x, y]: Vec2): boolean {
  const onDiagonal = Math.abs(x + y) < 8;
  const onMidfieldCorner = Math.abs(Math.abs(x) + Math.abs(y) - 23.548) < 1;
  return onDiagonal || onMidfieldCorner;
}
