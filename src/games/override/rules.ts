// Rule monitors for the simulated robot (SG1–SG3, SG7, SG9). They report violations as
// notes and feed the Autonomous Bonus / AWP; nothing is enforced on the robot.

import { inPolygon, type Alliance, type FieldDef, type Vec2 } from '../../sim/field.ts';
import { octagon, satMtv } from '../../sim/world.ts';

export interface Violation {
  t: number;
  rule: string;
  message: string;
}

/** A part of the robot outside its frame (a claw, a held stack): its outline and its lowest point. */
export interface RobotPart {
  poly: Vec2[];
  bottom: number;
}

/**
 * Violations that cost the Autonomous Bonus and the AWP: those of the autonomous period.
 * SG1 / SG2 come from the profile's size (an inspection matter) and stay notes.
 */
export const autonomousViolation = (v: Violation): boolean => v.rule !== 'SG1' && v.rule !== 'SG2';

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

/** The robot (its frame, or what it carries below the top of the wall) touches the perimeter. */
export function touchingPerimeter(field: FieldDef, footprint: Vec2[], parts: RobotPart[] = []): boolean {
  const half = field.perimeter.inside / 2 - TOUCH;
  const low = parts.filter((p) => p.bottom < field.perimeter.wallHeight).flatMap((p) => p.poly);
  return [...footprint, ...low].some(([x, y]) => Math.abs(x) >= half || Math.abs(y) >= half);
}

/** Any part of the robot inside the Midfield volume (SC6), what it carries included. */
export function inMidfield(field: FieldDef, footprint: Vec2[], parts: RobotPart[] = []): boolean {
  const mid = field.zones?.find((z) => z.kind === 'midfield');
  return !!mid && [footprint, ...parts.map((p) => p.poly)].some((poly) => satMtv(poly, mid.polygon) !== null);
}

export interface MonitorOptions {
  alliance: Alliance;
  mode: 'h2h' | 'skills';
  size: { width: number; length: number; height: number };
}

export class RuleMonitor {
  readonly violations: Violation[] = [];
  private readonly seen = new Set<string>();
  private readonly opponentGoals: Array<{ id: string; poly: Vec2[]; height: number }>;
  /** The Autonomous Line is interrupted by the Midfield: crossing it there is no violation. */
  private readonly midfield: Vec2[] | null;

  private readonly opts: MonitorOptions;

  constructor(field: FieldDef, opts: MonitorOptions) {
    this.opts = opts;
    const opp = opts.alliance === 'red' ? 'blue' : 'red';
    this.opponentGoals = (field.goals ?? [])
      .filter((g) => g.color === opp)
      .map((g) => ({ id: g.id, poly: octagon(g.x, g.y, g.baseWidth + 2 * TOUCH), height: g.height }));
    this.midfield = field.zones?.find((z) => z.kind === 'midfield')?.polygon ?? null;
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

  /** Check the robot at time t (ms of autonomous): its frame and what it carries outside it. */
  check(t: number, footprint: Vec2[], parts: RobotPart[] = []): void {
    if (this.opts.mode !== 'h2h') return; // Skills has no opponent
    const points = [...footprint, ...parts.flatMap((p) => p.poly)];
    const across = (p: Vec2) => pastAutonLine(this.opts.alliance, p) > 0 && !(this.midfield && inPolygon(p, this.midfield));
    if (points.some(across)) {
      this.add(t, 'SG7', 'The robot crossed the Autonomous Line onto the opposing side.');
    }
    for (const g of this.opponentGoals) {
      const touches = satMtv(footprint, g.poly) || parts.some((p) => p.bottom < g.height && satMtv(p.poly, g.poly));
      if (touches) this.add(t, 'SG9', `The robot touched opponent Goal ${g.id}.`);
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
