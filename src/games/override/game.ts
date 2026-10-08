// The Override game running inside a simulation: owns the game state and the floor
// physics, steps them with the simulator, and records what the replay viewer needs.

import type { Alliance, FieldDef, Vec2 } from '../../sim/field.ts';
import { octagon, type Obstacle, type World } from '../../sim/world.ts';
import { datan2, dhypot } from '../../sim/dmath.ts';
import { CUP, nestRest, PIN, stackTop, type Piece, type PinColor } from './elements.ts';
import { footprintRadius, goalShape, phasing } from './overlaps.ts';
import { Manipulators, type GameOps } from './manipulators.ts';
import { FloorPhysics, initPhysics, PHYSICS_DT_MS, type Carried } from './physics.ts';
import { toField } from '../../sim/lift.ts';
import { installSensors } from './sensors.ts';
import { autonomousViolation, inMidfield, RuleMonitor, sideOf, startsOnAutonLine, touchingPerimeter, type RobotPart, type Violation } from './rules.ts';
import { autonomousBonus, awp, score, type AwpCheck, type Mode, type ScoreBreakdown } from './scoring.ts';
import { initialState, type FloorStack, type OverrideState } from './state.ts';
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
  /** Setup notes (e.g. where the Preload went). */
  notes: string[];
  result: OverrideResult | null;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Slowest hit (in/s) that tips a stack over. */
const TIP_SPEED = 6;

export class OverrideGame implements GameOps {
  readonly field: FieldDef;
  readonly layout: string;
  readonly mode: Mode;
  alliance: Alliance;
  readonly state: OverrideState;
  rules: RuleMonitor;
  private readonly world: World;
  private readonly physics: FloorPhysics;
  private readonly toggles: ToggleSim;
  readonly manipulators: Manipulators;
  private dirty = false;
  private dropCount = 0;
  /** Objects on the opponent's side of the Autonomous Line at the start (SG7e). */
  private readonly opponentSide = new Set<string>();
  private clock = 0;
  private physicsClock = 0;
  private readonly rec: OverrideRecording;
  private readonly lastTrack = new Map<string, [number, number, number]>();
  /** The robot's collision shape of each Goal (see updateGoalObstacles). */
  private readonly goalObstacles = new Map<string, Obstacle>();

  private constructor(field: FieldDef, layout: string, world: World) {
    this.field = field;
    this.layout = layout;
    this.world = world;
    this.state = initialState(field, layout);
    this.mode = layout === 'skills' ? 'skills' : 'h2h';
    this.alliance = this.mode === 'skills' || sideOf([world.pose.x, world.pose.y]) !== 'blue' ? 'red' : 'blue';
    this.toggles = new ToggleSim(field);
    this.rules = new RuleMonitor(field, { alliance: this.alliance, mode: this.mode, size: world.profile.size });
    this.findOpponentSide();
    this.physics = new FloorPhysics(field, world.profile.size, { x: world.pose.x, y: world.pose.y, heading: world.pose.theta });
    for (const s of this.state.floor) this.physics.addStack(s);
    for (const p of this.state.lying) this.physics.addLying(p);
    // the drive team loads Pins and Cups alternately, so the robot can assemble combos
    const loads = this.state.matchLoads.red;
    if (loads) {
      const pins = loads.filter((x) => x.kind === 'pin');
      const cups = loads.filter((x) => x.kind === 'cup');
      this.state.matchLoads.red = Array.from({ length: Math.max(pins.length, cups.length) }, (_, i) => [pins[i], cups[i]]).flat().filter((x): x is Piece => !!x);
    }
    this.notes = [];
    this.manipulators = new Manipulators(this, world);
    for (const g of field.goals ?? []) {
      const ob = world.obstacles.find((o) => o.id === `goal ${g.id}`);
      if (ob) this.goalObstacles.set(g.id, ob);
    }
    this.updateGoalObstacles();
    this.updateStackObstacles();
    world.attachments = this.manipulators.attachments();
    world.attachmentsAt = () => this.manipulators.attachments();
    this.keepInside();
    this.noteStartingOnPieces();
    installSensors(world, field, this.state);
    this.rec = {
      id: 'override',
      layout,
      mode: this.mode,
      alliance: this.alliance,
      snapshots: [{ t: 0, state: clone(this.state) }],
      tracks: {},
      violations: this.rules.violations,
      notes: this.notes,
      result: null,
    };
  }

  /**
   * A robot set against the perimeter with its claw out behind it would have its Preload
   * through the wall: it is placed that much further in instead (the Preload stands on the tiles).
   */
  private keepInside(): void {
    const half = this.field.perimeter.inside / 2;
    const { pose } = this.world;
    let dx = 0;
    let dy = 0;
    for (const a of this.world.attachments) {
      if (a.bottom >= this.field.perimeter.wallHeight) continue;
      const [x, y] = toField(pose, a);
      if (x - a.r < -half) dx = Math.max(dx, -half - (x - a.r));
      if (x + a.r > half) dx = Math.min(dx, half - (x + a.r));
      if (y - a.r < -half) dy = Math.max(dy, -half - (y - a.r));
      if (y + a.r > half) dy = Math.min(dy, half - (y + a.r));
    }
    if (!dx && !dy) return;
    pose.x += dx;
    pose.y += dy;
    this.physics.teleportRobot({ x: pose.x, y: pose.y, heading: pose.theta });
    this.notes.push(`What the robot holds would start through the perimeter wall, so the robot is placed ${dhypot(dx, dy).toFixed(2)}″ further into the field.`);
  }

  /**
   * A robot placed on top of floor pieces can't be there: they get shoved out from under it
   * at once, possibly into the wall. Say so, so the start position can be fixed.
   */
  private noteStartingOnPieces(): void {
    const fp = this.world.footprint();
    const under = phasing(this.field, { ...this.state, goals: {}, held: {} }, fp).filter((p) => p.what.endsWith('inside the robot'));
    if (under.length) {
      this.notes.push(`The robot is placed on top of ${under.length} Scoring Object${under.length > 1 ? 's' : ''}: they are pushed out from under it. Move the start position so it is clear of them.`);
    }
  }

  static async create(field: FieldDef, layout: string, world: World): Promise<OverrideGame> {
    await initPhysics();
    return new OverrideGame(field, layout, world);
  }

  /** Objects that start on the opponent's side of the Autonomous Line (SG7e), head-to-head. */
  private findOpponentSide(): void {
    this.opponentSide.clear();
    if (this.mode !== 'h2h') return;
    for (const o of [...this.state.floor, ...this.state.lying]) {
      const side = sideOf([o.x, o.y]);
      if (side !== 'line' && side !== this.alliance && !startsOnAutonLine([o.x, o.y])) this.opponentSide.add(o.id);
    }
  }

  /**
   * The robot was placed somewhere else instantly (setPose placement). If that puts it on
   * the other alliance's side before it has done anything, it is that alliance's robot:
   * its Preload, its side of the Autonomous Line and its Goals.
   */
  robotTeleported(): void {
    this.physics.teleportRobot({ x: this.world.pose.x, y: this.world.pose.y, heading: this.world.pose.theta });
    this.world.placed();
    this.keepInside();
    this.noteStartingOnPieces();
    const side = sideOf([this.world.pose.x, this.world.pose.y]);
    if (this.mode !== 'h2h' || side === 'line' || side === this.alliance) return;
    if (!this.manipulators.untouched()) return;
    this.alliance = side;
    this.rules = new RuleMonitor(this.field, { alliance: this.alliance, mode: this.mode, size: this.world.profile.size });
    this.rec.alliance = this.alliance;
    this.rec.violations = this.rules.violations;
    this.findOpponentSide();
    this.manipulators.reloadPreload();
    this.notes.push(`setPose() placed the robot on the ${side} side: it plays for ${side}.`);
    this.dirty = true;
  }

  /** Advance by one simulator step (1 ms); physics runs every PHYSICS_DT_MS. */
  step(dtMs: number): void {
    this.clock += dtMs;
    // where the claws are now (the lifts move every step): what the robot carries collides there
    this.world.attachments = this.manipulators.attachments();
    this.toggles.step(dtMs, this.state.toggles, this.manipulators.contactShapes());
    this.rules.check(this.clock, this.world.footprint(), this.robotParts());
    this.physicsClock += dtMs;
    while (this.physicsClock >= PHYSICS_DT_MS) {
      this.physicsClock -= PHYSICS_DT_MS;
      this.physics.setRobot({ x: this.world.pose.x, y: this.world.pose.y, heading: this.world.pose.theta });
      this.physics.setCarried(this.carried());
      this.physics.step();
      this.syncFromPhysics();
      this.checkToppling();
      // pushing pieces along the floor is work for the drive
      this.world.pushLoad = this.physics.pushedMass() * FloorPhysics.FLOOR_FRICTION * 9.80665;
      this.world.pinnedObstacles = this.physics.pinnedObstacles([
        { poly: this.world.footprint(), bottom: 0 },
        ...this.world.attachments.filter((a) => !a.fixedOnly).map((a) => ({ poly: this.world.attachmentPoly(a), bottom: a.bottom, passes: (id: string) => this.physics.passes(a.slot ?? a.id, id) })),
      ]);
      this.manipulators.step(this.clock);
      this.world.attachments = this.manipulators.attachments();
      this.updateGoalObstacles();
      this.updateStackObstacles();
      for (const id of this.opponentSide) {
        if (!this.physics.touchingRobot(id)) continue;
        this.rules.add(this.clock, 'SG7', 'The robot touched a Scoring Object on the opposing side of the Autonomous Line.');
        this.opponentSide.clear(); // reported once
        break;
      }
    }
    if (this.dirty) {
      this.dirty = false;
      this.snapshot(this.clock);
    }
  }

  /**
   * Pieces on a Goal are part of it for anything carried into it from the side: the Goal is
   * as tall as its stack, and above the Goal top as wide as the pieces still above that height.
   */
  private updateGoalObstacles(): void {
    for (const g of this.field.goals ?? []) {
      const ob = this.goalObstacles.get(g.id);
      if (ob) Object.assign(ob, goalShape(g, this.state.goals[g.id] ?? []));
    }
  }

  /**
   * The stacks standing on the floor, for lifts lowering things onto them: a held piece stops
   * on top of one, or slides down onto it if it fits and is centred (see Obstacle.nest).
   */
  private updateStackObstacles(): void {
    this.world.stackObstacles = this.state.floor.map((s) => ({
      id: `stack ${s.id}`,
      poly: octagon(s.x, s.y, 2 * footprintRadius(s.pieces)),
      top: stackTop(s.pieces, 0, false),
      nest: { x: s.x, y: s.y, rest: (kind: string) => nestRest(s.pieces, 0, false, kind) },
    }));
  }

  /** What the robot carries, in the field frame, for the floor physics. */
  private carried(): Carried[] {
    return this.world.attachments.filter((a) => !a.fixedOnly).map((a) => {
      const [x, y] = toField(this.world.pose, a);
      // the same body whatever the claw holds: what it was passing through carries over
      return { id: a.slot ?? a.id, x, y, r: a.r, bottom: a.bottom };
    });
  }

  // ---------------- GameOps (used by the manipulators) ----------------

  readonly notes: string[];

  removeFloor(id: string): void {
    this.physics.remove(id);
    // a claw or intake taking it touches it as much as the chassis would (SG7e)
    if (this.opponentSide.has(id)) {
      this.rules.add(this.clock, 'SG7', 'The robot took a Scoring Object from the opposing side of the Autonomous Line.');
      this.opponentSide.clear(); // reported once
    }
    this.opponentSide.delete(id);
  }

  addFloor(pieces: Piece[], x: number, y: number): string {
    const s: FloorStack = { id: `d${++this.dropCount}`, x, y, pieces };
    this.state.floor.push(s);
    this.physics.addStack(s, false);
    return s.id;
  }

  addLying(colors: [PinColor, PinColor], x: number, y: number, heading: number): string {
    const l = { id: `d${++this.dropCount}`, x, y, heading, colors };
    this.state.lying.push(l);
    this.physics.addLying(l, false);
    return l.id;
  }

  rebuildFloor(stack: FloorStack): void {
    this.physics.restack(stack);
    // taking part of a stack, or setting pieces on one, touches it (SG7e)
    if (this.opponentSide.has(stack.id)) {
      this.rules.add(this.clock, 'SG7', 'The robot took from or added to a Scoring Object on the opposing side of the Autonomous Line.');
      this.opponentSide.clear(); // reported once
    }
  }

  changed(): void {
    this.dirty = true;
  }

  liftedOutOf(clawName: string, stackId: string): void {
    this.physics.expectOverlap(`claw:${clawName}`, stackId);
  }

  violation(rule: string, message: string): void {
    this.rules.add(this.clock, rule, message);
  }

  note(message: string): void {
    this.notes.push(message);
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

  /**
   * A standing stack hit by something carried tips over when it is pushed high enough that its
   * base would tip before it slides: above the height where the stack's radius equals the floor
   * friction times that height (about 4 in for these pieces), and hard enough to matter. Pins
   * end up lying along the push, each beyond the last; Cups stand where they land.
   */
  private checkToppling(): void {
    for (const s of [...this.state.floor]) {
      const hit = this.physics.hitByCarried(s.id);
      if (!hit || hit.speed < TIP_SPEED) continue;
      const push = Math.max(hit.carried.bottom, 0) + 1; // about where the lower part of what is carried meets it
      const top = stackTop(s.pieces, 0, false);
      const r = Math.max(...s.pieces.map((p) => (p.kind === 'cup' ? CUP.rimDiameter : PIN.collarDiameter) / 2));
      if (push >= top || push * FloorPhysics.FLOOR_FRICTION <= r) continue; // pushed low: it slides
      this.topple(s, hit.carried);
    }
  }

  private topple(s: FloorStack, from: { x: number; y: number }): void {
    const dx = s.x - from.x;
    const dy = s.y - from.y;
    const d = dhypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const heading = (datan2(ux, uy) * 180) / Math.PI;
    const old = this.opponentSide.has(s.id);
    this.state.floor.splice(this.state.floor.indexOf(s), 1);
    this.physics.remove(s.id);
    this.opponentSide.delete(s.id);
    s.pieces.forEach((p, i) => {
      const x = s.x + ux * (1.5 + 3 * i);
      const y = s.y + uy * (1.5 + 3 * i);
      const id = p.kind === 'pin' ? this.addLying(p.colors, x, y, heading) : this.addFloor([p], x, y);
      if (old) this.opponentSide.add(id);
    });
    this.notes.push(`At ${(this.clock / 1000).toFixed(2)} s, a stack was hit high up while moving and tipped over.`);
    this.dirty = true;
  }

  /** Score the current state as if the run ended now. */
  score(): OverrideResult {
    return scoreState(this.field, this.mode, this.alliance, this.state, this.world.footprint(), this.rules.violations.some(autonomousViolation), this.clock, this.robotParts());
  }

  /** The claws and what they hold, as outlines for the rules (field frame). */
  private robotParts(): RobotPart[] {
    return this.world.attachments.map((a) => ({ poly: this.world.attachmentPoly(a), bottom: a.bottom }));
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
  parts: RobotPart[] = [],
): OverrideResult {
  const mid = inMidfield(field, footprint, parts);
  const s = score({
    field,
    state,
    mode,
    autonomous: mode === 'h2h',
    robotsInMidfield: { red: mid && alliance === 'red' ? 1 : 0, blue: mid && alliance === 'blue' ? 1 : 0 },
  });
  const perimeter = touchingPerimeter(field, footprint, parts);
  return {
    t,
    score: s,
    autonomousBonus: mode === 'h2h' ? autonomousBonus(s, { red: alliance === 'red' && violation, blue: alliance === 'blue' && violation }) : null,
    awp: mode === 'h2h' ? awp(field, s, alliance, perimeter, violation) : null,
    touchingPerimeter: perimeter,
    inMidfield: mid,
  };
}
