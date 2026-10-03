// The Override game running inside a simulation: owns the game state and the floor
// physics, steps them with the simulator, and records what the replay viewer needs.

import type { Alliance, FieldDef, Vec2 } from '../../sim/field.ts';
import type { World } from '../../sim/world.ts';
import { FloorPhysics, initPhysics, PHYSICS_DT_MS } from './physics.ts';
import { inMidfield, RuleMonitor, sideOf, startsOnAutonLine, touchingPerimeter, type Violation } from './rules.ts';
import { autonomousBonus, awp, score, type AwpCheck, type Mode, type ScoreBreakdown } from './scoring.ts';
import { initialState, type OverrideState } from './state.ts';
import { ToggleSim } from './toggle.ts';

/** End-of-run scoring: what the referee would record when the run stops. */
export interface OverrideResult {
  t: number;
  score: ScoreBreakdown;
  /** Head-to-head only (SC7). */
  autonomousBonus: { red: number; blue: number } | null;
  /** Head-to-head only (SC8), for the robot's alliance. */
  awp: AwpCheck | null;
  touchingPerimeter: boolean;
  inMidfield: boolean;
}

/** Replay data: full-state snapshots when the structure changes, plus motion tracks. */
export interface OverrideRecording {
  id: 'override';
  layout: string;
  mode: Mode;
  /** The robot's alliance (from its starting side; always red in Skills). */
  alliance: Alliance;
  /** Snapshots in time order; the first is at t = 0. */
  snapshots: Array<{ t: number; state: OverrideState }>;
  /** Object or toggle id -> flat [t, x, y, heading, ...] samples (toggles: [t, angle, touched, 0]). */
  tracks: Record<string, number[]>;
  violations: Violation[];
  result: OverrideResult | null;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class OverrideGame {
  readonly field: FieldDef;
  readonly layout: string;
  readonly mode: Mode;
  readonly alliance: Alliance;
  readonly state: OverrideState;
  readonly rules: RuleMonitor;
  private readonly world: World;
  private readonly physics: FloorPhysics;
  private readonly toggles: ToggleSim;
  /** Objects on the opponent's side of the Autonomous Line at the start (SG7e). */
  private readonly opponentSide = new Set<string>();
  private clock = 0;
  private physicsClock = 0;
  private readonly rec: OverrideRecording;
  private readonly lastTrack = new Map<string, [number, number, number]>();

  private constructor(field: FieldDef, layout: string, world: World) {
    this.field = field;
    this.layout = layout;
    this.world = world;
    this.state = initialState(field, layout);
    this.mode = layout === 'skills' ? 'skills' : 'h2h';
    this.alliance = this.mode === 'skills' || sideOf([world.pose.x, world.pose.y]) !== 'blue' ? 'red' : 'blue';
    this.toggles = new ToggleSim(field);
    this.rules = new RuleMonitor(field, { alliance: this.alliance, mode: this.mode, size: world.profile.size });
    if (this.mode === 'h2h') {
      for (const o of [...this.state.floor, ...this.state.lying]) {
        const side = sideOf([o.x, o.y]);
        if (side !== 'line' && side !== this.alliance && !startsOnAutonLine([o.x, o.y])) this.opponentSide.add(o.id);
      }
    }
    this.physics = new FloorPhysics(field, world.profile.size, { x: world.pose.x, y: world.pose.y, heading: world.pose.theta });
    for (const s of this.state.floor) this.physics.addStack(s);
    for (const p of this.state.lying) this.physics.addLying(p);
    this.rec = {
      id: 'override',
      layout,
      mode: this.mode,
      alliance: this.alliance,
      snapshots: [{ t: 0, state: clone(this.state) }],
      tracks: {},
      violations: this.rules.violations,
      result: null,
    };
  }

  static async create(field: FieldDef, layout: string, world: World): Promise<OverrideGame> {
    await initPhysics();
    return new OverrideGame(field, layout, world);
  }

  /** The robot was placed somewhere else instantly (setPose placement). */
  robotTeleported(): void {
    this.physics.teleportRobot({ x: this.world.pose.x, y: this.world.pose.y, heading: this.world.pose.theta });
  }

  /** Advance by one simulator step (1 ms); physics runs every PHYSICS_DT_MS. */
  step(dtMs: number): void {
    this.clock += dtMs;
    const fp = this.world.footprint();
    this.toggles.step(dtMs, this.state.toggles, fp, this.world.profile.size.height);
    this.rules.check(this.clock, fp);
    this.physicsClock += dtMs;
    while (this.physicsClock >= PHYSICS_DT_MS) {
      this.physicsClock -= PHYSICS_DT_MS;
      this.physics.setRobot({ x: this.world.pose.x, y: this.world.pose.y, heading: this.world.pose.theta });
      this.physics.step();
      this.syncFromPhysics();
      for (const id of this.opponentSide) {
        if (!this.physics.touchingRobot(id)) continue;
        this.rules.add(this.clock, 'SG7', 'The robot touched a Scoring Object on the opposing side of the Autonomous Line.');
        this.opponentSide.clear(); // reported once
        break;
      }
    }
  }

  private syncFromPhysics(): void {
    for (const s of this.state.floor) {
      const p = this.physics.pose(s.id);
      if (p) {
        s.x = p.x;
        s.y = p.y;
      }
    }
    for (const l of this.state.lying) {
      const p = this.physics.pose(l.id);
      if (p) {
        l.x = p.x;
        l.y = p.y;
        l.heading = p.heading;
      }
    }
  }

  /** Score the current state as if the run ended now. */
  score(): OverrideResult {
    return scoreState(this.field, this.mode, this.alliance, this.state, this.world.footprint(), this.rules.violations.length > 0, this.clock);
  }

  /** Record motion samples for objects that moved since their last sample. */
  recordFrame(t: number): void {
    const sample = (id: string, a: number, b: number, c: number) => {
      const last = this.lastTrack.get(id);
      if (last && Math.abs(last[0] - a) < 1e-3 && Math.abs(last[1] - b) < 1e-3 && Math.abs(last[2] - c) < 1e-2) return;
      (this.rec.tracks[id] ??= []).push(t, a, b, c);
      this.lastTrack.set(id, [a, b, c]);
    };
    for (const s of this.state.floor) sample(s.id, s.x, s.y, 0);
    for (const l of this.state.lying) sample(l.id, l.x, l.y, l.heading);
    for (const tg of this.state.toggles) sample(tg.id, tg.angle, tg.touched ? 1 : 0, 0);
  }

  /** Record a structural change (pickup, placement, drop) at time t. */
  snapshot(t: number): void {
    this.rec.snapshots.push({ t, state: clone(this.state) });
  }

  finish(): OverrideRecording {
    this.rec.result = this.score();
    this.physics.free();
    return this.rec;
  }
}

/**
 * Score a state at the end of a run. Head-to-head runs are the Autonomous Period: the
 * Autonomous Bonus and AWP are judged and Midfield-dependent scoring is excluded (SC7a).
 * Skills runs are scored as a whole Match, including the Midfield (RSC3).
 */
export function scoreState(
  field: FieldDef,
  mode: Mode,
  alliance: Alliance,
  state: OverrideState,
  footprint: Vec2[],
  violation: boolean,
  t: number,
): OverrideResult {
  const mid = inMidfield(field, footprint);
  const s = score({
    field,
    state,
    mode,
    autonomous: mode === 'h2h',
    robotsInMidfield: { red: mid && alliance === 'red' ? 1 : 0, blue: mid && alliance === 'blue' ? 1 : 0 },
  });
  const perimeter = touchingPerimeter(field, footprint);
  return {
    t,
    score: s,
    autonomousBonus: mode === 'h2h' ? autonomousBonus(s, { red: alliance === 'red' && violation, blue: alliance === 'blue' && violation }) : null,
    awp: mode === 'h2h' ? awp(field, s, alliance, perimeter, violation) : null,
    touchingPerimeter: perimeter,
    inMidfield: mid,
  };
}
