// Robot manipulators on the Override field: claws, intakes, staging, wrists and Toggle
// tools from the robot profile, driven by the user's code through the motors and
// solenoids they are mapped to. Pickup, placement and dropping are rule-exact "snap"
// operations (hybrid model): a claw that closes on an object takes it; one that opens
// over a Goal or stack, at the right height, nests what it holds; anywhere else it drops
// to the floor.

import type { Alliance, FieldDef, GoalDef, LoaderDef, Vec2 } from '../../sim/field.ts';
import { clawEffector, toField, toRobot, type Point3 } from '../../sim/lift.ts';
import type { Capacity, ClawSpec, IntakeSpec, MechanismSpec, PreloadOrientation, RobotProfile, StagingSpec, ToggleToolSpec, WristSpec } from '../../sim/profile.ts';
import type { World } from '../../sim/world.ts';
import { CUP, layoutStack, PIN, type Piece, type PinColor } from './elements.ts';
import type { FloorStack, LyingPin, OverrideState } from './state.ts';
import type { ContactShape } from './toggle.ts';

/** Horizontal tolerance for releasing onto a Goal or stack (in). */
export const PLACE_TOLERANCE = 1.5;
/** How far below / above the resting height a released stack may be and still nest (in). */
export const PLACE_BELOW = 2;
export const PLACE_ABOVE = 4;
/** Height a claw must be at or below to take from a Loader's bottom opening, or a lying Pin. */
const LOW_REACH = PIN.collarDiameter + 1.5;
/** Output speed (rpm) above which rollers and intakes count as spinning. */
const SPIN_RPM = 10;
/** Minimum time between two intake pickups or ejections (ms). */
const INTAKE_COOLDOWN = 350;
/** Pieces a Loader chute holds, and how often the drive team adds one (Skills). */
const LOADER_CAPACITY = 2;
const LOADER_REFILL_MS = 1000;
const DEFAULT_CAPACITY: Capacity = { pins: 1, cups: 1 };

/** What the manipulators need from the game. */
export interface GameOps {
  readonly field: FieldDef;
  readonly state: OverrideState;
  readonly mode: 'h2h' | 'skills';
  readonly alliance: Alliance;
  removeFloor(id: string): void;
  addFloor(pieces: Piece[], x: number, y: number): void;
  addLying(colors: [PinColor, PinColor], x: number, y: number, heading: number): void;
  /** A floor stack's pieces changed. */
  rebuildFloor(stack: FloorStack): void;
  /** Something changed structurally (record a snapshot). */
  changed(): void;
  violation(rule: string, message: string): void;
  note(message: string): void;
}

/** Is a claw closed at a given mechanism output? (Roller claws have no open/closed state.) */
export function clawClosed(s: ClawSpec, v: number): boolean {
  if (s.grip === 'piston') return (s.closedWhen ?? 'extended') === 'extended' ? v >= 0.5 : v < 0.5;
  if (s.grip === 'motor') return (s.closedAt ?? 0) >= 0 ? v >= (s.closedAt ?? 0) : v <= (s.closedAt ?? 0);
  return false;
}

export const flipPiece = (p: Piece): Piece =>
  p.kind === 'pin' ? { ...p, colors: [p.colors[1], p.colors[0]] } : { ...p, up: p.up === 'gray' ? 'clear' : 'gray' };
/** Turn a stack end over end. */
export const flipStack = (pieces: Piece[]): Piece[] => pieces.map(flipPiece).reverse();

export function countPieces(pieces: Piece[]): Capacity {
  let pins = 0;
  let cups = 0;
  for (const p of pieces) p.kind === 'pin' ? pins++ : cups++;
  return { pins, cups };
}

const fits = (cap: Capacity | undefined, have: Piece[], add: Piece[]) => {
  const c = cap ?? DEFAULT_CAPACITY;
  const n = countPieces([...have, ...add]);
  return n.pins <= c.pins && n.cups <= c.cups;
};

/**
 * Add pieces to what a holder has. A stack taken whole keeps its order; pieces collected
 * separately are assembled Pin first with the Cup over it, ready to nest onto a Goal or
 * onto the Cup on top of a stack.
 */
const merge = (have: Piece[], add: Piece[]): Piece[] =>
  have.length ? [...have, ...add].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'pin' ? -1 : 1)) : [...add];

/**
 * Where the bottom of `next` comes to rest when nested onto `existing` (on a Goal of
 * height `base`, or on the floor).
 */
export function restingBottom(existing: Piece[], base: number, onGoal: boolean, next: Piece): number {
  const slots = layoutStack([...existing, next], base, onGoal);
  return slots[slots.length - 1].bottom;
}

/** Lowest piece of a stack whose height range contains z (with a small margin), or -1. */
function slotAt(pieces: Piece[], base: number, onGoal: boolean, z: number): { index: number; bottom: number } | null {
  const slots = layoutStack(pieces, base, onGoal);
  for (let i = 0; i < slots.length; i++) {
    if (z >= slots[i].bottom - 0.5 && z <= slots[i].top + 0.5) return { index: i, bottom: slots[i].bottom };
  }
  return null;
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dy);
}

const RAD = Math.PI / 180;
/** End points of a lying pin: [colors[0] end, colors[1] end]. */
function pinEnds(l: LyingPin): [Vec2, Vec2] {
  const h = PIN.length / 2;
  const ux = Math.sin(l.heading * RAD);
  const uy = Math.cos(l.heading * RAD);
  return [
    [l.x - ux * h, l.y - uy * h],
    [l.x + ux * h, l.y + uy * h],
  ];
}

/** Where a robot takes the bottom piece of a Loader: just inside the field at its opening. */
export function loaderMouth(field: FieldDef, l: LoaderDef): Vec2 {
  const half = field.perimeter.inside / 2;
  const inward = l.wall === 'left' ? 1 : -1;
  return [-inward * half + inward * (l.depth + 1.5), l.y];
}

interface ClawRuntime {
  spec: ClawSpec;
  closed: boolean;
  /** Height of the held stack's bottom below the grip point. */
  grip: number;
  flipped: boolean;
}

export class Manipulators {
  private readonly ops: GameOps;
  private readonly world: World;
  private readonly profile: RobotProfile;
  private readonly claws: ClawRuntime[];
  private readonly intakes: IntakeSpec[];
  private readonly stagings: StagingSpec[];
  private readonly wrists: WristSpec[];
  private readonly tools: ToggleToolSpec[];
  /** Piece id -> time it reaches its intake's destination. */
  private readonly arrival = new Map<string, number>();
  private readonly lastIntake = new Map<string, number>();
  private nextRefill = 0;
  /** Kind of the piece last put in each Loader. */
  private readonly lastLoaded = new Map<string, Piece['kind']>();

  constructor(ops: GameOps, world: World) {
    this.ops = ops;
    this.world = world;
    this.profile = world.profile;
    const of = <K extends MechanismSpec['kind']>(k: K) => this.profile.mechanisms.filter((m): m is Extract<MechanismSpec, { kind: K }> => m.kind === k);
    this.claws = of('claw').map((spec) => ({ spec, closed: false, grip: 0, flipped: false }));
    this.intakes = of('intake');
    this.stagings = of('staging');
    this.wrists = of('wrist');
    this.tools = of('toggleTool');
    for (const m of [...of('claw'), ...this.intakes, ...this.stagings]) ops.state.held[m.name] = [];
    for (const c of this.claws) c.closed = this.isClosed(c);
    this.loadPreload();
  }

  private loadPreload(): void {
    const holder = this.profile.mechanisms.find((m): m is ClawSpec | IntakeSpec | StagingSpec => 'preload' in m && !!m.preload);
    const piece = this.ops.field.layouts?.[this.ops.mode === 'skills' ? 'skills' : 'h2h']?.preload?.[this.ops.alliance];
    if (!piece || piece.kind !== 'pin') return;
    if (!holder) {
      this.ops.note('No mechanism holds the Preload (set "preload" on a claw, intake or staging area), so it is not on the field.');
      return;
    }
    const alliance = piece.colors.find((c) => c !== 'yellow') ?? 'yellow';
    const order: PreloadOrientation = holder.preload!;
    const colors: [PinColor, PinColor] = order === 'alliance-down' ? [alliance as PinColor, 'yellow'] : ['yellow', alliance as PinColor];
    this.ops.state.held[holder.name] = [{ kind: 'pin', id: 'preload', colors }];
  }

  // ---------------- per-step ----------------

  step(t: number): void {
    this.refillLoaders(t);
    for (const c of this.claws) this.stepClaw(c);
    for (const w of this.wrists) this.stepWrist(w);
    for (const i of this.intakes) this.stepIntake(i, t);
    for (const c of this.claws) this.ops.state.grip[c.spec.name] = c.grip;
  }

  /** Robot parts that can touch a Toggle: the chassis box plus Toggle tools. */
  contactShapes(): ContactShape[] {
    const shapes: ContactShape[] = [{ poly: this.world.footprint(), bottom: 0, top: this.profile.size.height }];
    for (const tool of this.tools) {
      if (tool.tool === 'plate' && this.world.mechanismState(tool) < 0.5) continue;
      const { x, y, width, length } = tool.box;
      const poly = ([[x - width / 2, y - length / 2], [x + width / 2, y - length / 2], [x + width / 2, y + length / 2], [x - width / 2, y + length / 2]] as Vec2[]).map(
        ([px, py]) => toField(this.world.pose, { x: px, y: py }),
      );
      // roller: + output with inward = 1 rolls the Toggle's top into the field (negative angle)
      const spin = tool.tool === 'roller' ? -(tool.inward ?? 1) * this.world.mechanismRpm(tool) * 4.4 : undefined;
      shapes.push({ poly, bottom: tool.bottom, top: tool.top, spin });
    }
    return shapes;
  }

  /** Pieces the robot possesses right now (for SG6 and the viewer). */
  possessed(): Piece[] {
    return Object.values(this.ops.state.held).flat();
  }

  // ---------------- claws ----------------

  private isClosed(c: ClawRuntime): boolean {
    return clawClosed(c.spec, this.world.mechanismState(c.spec));
  }

  /** Field position (x, y) and height of a claw's grip point. */
  effector(spec: ClawSpec): { x: number; y: number; z: number; robot: Point3 } {
    const p = clawEffector(this.profile, spec, (m) => this.world.mechanismState(m));
    const [x, y] = toField(this.world.pose, p);
    return { x, y, z: p.z, robot: p };
  }

  private stepClaw(c: ClawRuntime): void {
    const held = this.ops.state.held[c.spec.name];
    if (c.spec.grip === 'roller') {
      const spin = this.world.mechanismRpm(c.spec) * (c.spec.inward ?? 1);
      if (spin > SPIN_RPM) this.grab(c);
      else if (spin < -SPIN_RPM && held.length) this.release(c);
      return;
    }
    const closed = this.isClosed(c);
    if (closed && !c.closed) this.grab(c);
    if (!closed && c.closed && held.length) this.release(c);
    c.closed = closed;
  }

  private grab(c: ClawRuntime): void {
    const { state, field } = this.ops;
    const held = state.held[c.spec.name];
    // a claw closing on what it already holds just secures it (rollers keep pulling in)
    if (held.length && c.spec.grip !== 'roller') return;
    const e = this.effector(c.spec);
    const reach = c.spec.reach ?? 2;
    type Cand = { d: number; take: () => void; pieces: Piece[] };
    const cands: Cand[] = [];
    const ok = (pieces: Piece[]) => pieces.length > 0 && fits(c.spec.capacity, held, pieces);

    for (const s of this.stagings) {
      const items = state.held[s.name];
      const d = Math.hypot(e.robot.x - (s.at.x ?? 0), e.robot.y - s.at.y);
      if (d <= reach && Math.abs(e.robot.z - s.at.z) <= 1.5 && ok(items)) {
        cands.push({ d, pieces: items, take: () => this.receive(c, state.held[s.name].splice(0), 0) });
      }
    }
    if (e.z <= LOW_REACH) {
      for (const l of field.loaders ?? []) {
        const items = state.loaders[l.id];
        const [mx, my] = loaderMouth(field, l);
        const d = Math.hypot(e.x - mx, e.y - my);
        if (items.length && d <= reach + 1 && ok(items.slice(0, 1))) cands.push({ d, pieces: items.slice(0, 1), take: () => this.receive(c, items.splice(0, 1), e.z) });
      }
      for (const l of state.lying) {
        const [a, b] = pinEnds(l);
        const d = distToSegment([e.x, e.y], a, b);
        const pin: Piece = { kind: 'pin', id: l.id, colors: this.uprightColors(l) };
        if (d <= reach && ok([pin])) cands.push({ d, pieces: [pin], take: () => this.takeLying(l, (p) => this.receive(c, [p], e.z)) });
      }
    }
    for (const g of field.goals ?? []) {
      const pieces = state.goals[g.id];
      const d = Math.hypot(e.x - g.x, e.y - g.y);
      if (!pieces.length || d > reach) continue;
      const slot = slotAt(pieces, g.height, true, e.z);
      if (slot && ok(pieces.slice(slot.index))) {
        cands.push({ d, pieces: pieces.slice(slot.index), take: () => this.takeFromGoal(g, slot.index, (ps) => this.receive(c, ps, e.z - slot.bottom)) });
      }
    }
    for (const s of state.floor) {
      const d = Math.hypot(e.x - s.x, e.y - s.y);
      if (d > reach) continue;
      const slot = slotAt(s.pieces, 0, false, e.z);
      if (slot && ok(s.pieces.slice(slot.index))) {
        cands.push({ d, pieces: s.pieces.slice(slot.index), take: () => this.takeFromFloor(s, slot.index, (ps) => this.receive(c, ps, e.z - slot.bottom)) });
      }
    }
    if (!cands.length) return;
    cands.sort((a, b) => a.d - b.d);
    cands[0].take();
    this.checkPossession();
    this.ops.changed();
  }

  /** Put pieces into a claw; `grip` = how far above the stack bottom it holds them. */
  private receive(c: ClawRuntime, pieces: Piece[], grip: number): void {
    const held = this.ops.state.held[c.spec.name];
    if (!held.length) c.grip = Math.max(0, grip);
    this.ops.state.held[c.spec.name] = merge(held, pieces);
  }

  private release(c: ClawRuntime): void {
    const { state, field } = this.ops;
    const held = state.held[c.spec.name];
    const e = this.effector(c.spec);
    const bottom = e.z - c.grip;
    const first = held[0];
    const nests = (existing: Piece[], base: number, onGoal: boolean) => {
      const rest = restingBottom(existing, base, onGoal, first);
      return bottom >= rest - PLACE_BELOW && bottom <= rest + PLACE_ABOVE;
    };
    const pieces = held.splice(0);
    c.grip = 0;
    for (const g of field.goals ?? []) {
      if (Math.hypot(e.x - g.x, e.y - g.y) > PLACE_TOLERANCE || !nests(state.goals[g.id], g.height, true)) continue;
      if (this.ops.mode === 'h2h' && g.color !== 'neutral' && g.color !== this.ops.alliance) {
        this.ops.violation('SG9', `The robot added Scoring Objects to opponent Goal ${g.id}.`);
      }
      state.goals[g.id].push(...pieces);
      this.ops.changed();
      return;
    }
    for (const s of state.floor) {
      if (Math.hypot(e.x - s.x, e.y - s.y) > PLACE_TOLERANCE || !nests(s.pieces, 0, false)) continue;
      s.pieces.push(...pieces);
      this.ops.rebuildFloor(s);
      this.ops.changed();
      return;
    }
    this.dropAt(pieces, e.x, e.y);
    this.ops.changed();
  }

  private stepWrist(w: WristSpec): void {
    const c = this.claws.find((x) => x.spec.name === w.claw);
    if (!c) return;
    const v = this.world.mechanismState(w);
    const a = ((v % 360) + 360) % 360;
    const flipped = w.adi ? v >= 0.5 : a > 90 && a < 270;
    if (flipped === c.flipped) return;
    c.flipped = flipped;
    const held = this.ops.state.held[c.spec.name];
    if (!held.length) return;
    const height = layoutStack(held, 0, false).reduce((m, s) => Math.max(m, s.top), 0);
    this.ops.state.held[c.spec.name] = flipStack(held);
    c.grip = Math.max(0, height - c.grip);
    this.ops.changed();
  }

  // ---------------- intakes ----------------

  private stepIntake(spec: IntakeSpec, t: number): void {
    const { state } = this.ops;
    const mine = state.held[spec.name];
    // deliver pieces that have travelled through
    const destSpec = spec.into ? (this.profile.mechanisms.find((m) => m.name === spec.into) as ClawSpec | StagingSpec) : null;
    if (spec.into && destSpec && mine.length && this.canReceive(destSpec)) {
      const ready = mine.filter((p) => (this.arrival.get(p.id) ?? 0) <= t);
      // pieces that came in together (a stack) move on together, keeping their order;
      // otherwise one at a time, as far as there is room
      const batches = fits(destSpec.capacity, state.held[spec.into], ready) ? [ready] : ready.map((p) => [p]);
      for (const batch of batches) {
        if (!batch.length || !fits(destSpec.capacity, state.held[spec.into], batch)) continue;
        const claw = this.claws.find((c) => c.spec.name === spec.into);
        if (claw && !state.held[spec.into].length) claw.grip = 0;
        for (const p of batch) {
          mine.splice(mine.indexOf(p), 1);
          this.arrival.delete(p.id);
        }
        state.held[spec.into] = merge(state.held[spec.into], batch);
        this.ops.changed();
      }
    }
    const spin = this.world.mechanismRpm(spec) * (spec.inward ?? 1);
    if (Math.abs(spin) <= SPIN_RPM || t - (this.lastIntake.get(spec.name) ?? -1e9) < INTAKE_COOLDOWN) return;
    if (spin < 0) {
      // reversing spits out what is still in the intake
      const p = mine.pop();
      if (!p) return;
      this.arrival.delete(p.id);
      const [x, y] = toField(this.world.pose, { x: spec.zone.x, y: spec.zone.y + spec.zone.length / 2 + 3 });
      this.dropAt([p], x, y);
      this.lastIntake.set(spec.name, t);
      this.ops.changed();
      return;
    }
    const acquired = this.intakeOne(spec);
    if (!acquired.length) return;
    for (const p of acquired) this.arrival.set(p.id, t + (spec.transferMs ?? 300));
    state.held[spec.name] = merge(state.held[spec.name], acquired);
    this.lastIntake.set(spec.name, t);
    this.checkPossession();
    this.ops.changed();
  }

  /** A claw fed by an intake takes pieces only while lowered; staging always can. */
  private canReceive(dest: ClawSpec | StagingSpec): boolean {
    if (dest.kind !== 'claw' || !dest.lift) return true;
    const lift = this.profile.mechanisms.find((m) => m.name === dest.lift);
    return !lift || clawEffector(this.profile, dest, (m) => this.world.mechanismState(m)).z <= ((lift as { home: Point3 }).home.z + 2);
  }

  private inZone(spec: IntakeSpec, fx: number, fy: number, margin: number): boolean {
    const [lx, ly] = toRobot(this.world.pose, fx, fy);
    const z = spec.zone;
    return Math.abs(lx - z.x) <= z.width / 2 + margin && Math.abs(ly - z.y) <= z.length / 2 + margin;
  }

  private intakeOne(spec: IntakeSpec): Piece[] {
    const { state, field } = this.ops;
    const acc = { pins: true, cups: true, lying: true, ...spec.accepts };
    const mine = state.held[spec.name];
    const accepted = (ps: Piece[]) => ps.every((p) => (p.kind === 'pin' ? acc.pins : acc.cups)) && fits(spec.capacity, mine, ps);
    for (const l of field.loaders ?? []) {
      const items = state.loaders[l.id];
      const [mx, my] = loaderMouth(field, l);
      if (items.length && this.inZone(spec, mx, my, 0.5) && accepted(items.slice(0, 1))) return items.splice(0, 1);
    }
    for (const s of state.floor) {
      if (!this.inZone(spec, s.x, s.y, 0.5) || !accepted(s.pieces)) continue;
      this.ops.removeFloor(s.id);
      state.floor.splice(state.floor.indexOf(s), 1);
      return s.pieces;
    }
    if (acc.lying && acc.pins) {
      for (const l of state.lying) {
        if (!this.inZone(spec, l.x, l.y, 0.5)) continue;
        const pin: Piece = { kind: 'pin', id: l.id, colors: this.uprightColors(l) };
        if (!accepted([pin])) continue;
        let got: Piece[] = [];
        this.takeLying(l, (p) => (got = [p]));
        return got;
      }
    }
    return [];
  }

  // ---------------- taking and dropping ----------------

  /** A lying pin picked up stands with the end nearer the robot at the bottom. */
  private uprightColors(l: LyingPin): [PinColor, PinColor] {
    const [a, b] = pinEnds(l);
    const { x, y } = this.world.pose;
    return Math.hypot(a[0] - x, a[1] - y) <= Math.hypot(b[0] - x, b[1] - y) ? [l.colors[0], l.colors[1]] : [l.colors[1], l.colors[0]];
  }

  private takeLying(l: LyingPin, into: (p: Piece) => void): void {
    const { state } = this.ops;
    this.ops.removeFloor(l.id);
    state.lying.splice(state.lying.indexOf(l), 1);
    into({ kind: 'pin', id: l.id, colors: this.uprightColors(l) });
  }

  private takeFromFloor(s: FloorStack, index: number, into: (ps: Piece[]) => void): void {
    const { state } = this.ops;
    const taken = s.pieces.splice(index);
    if (s.pieces.length) this.ops.rebuildFloor(s);
    else {
      this.ops.removeFloor(s.id);
      state.floor.splice(state.floor.indexOf(s), 1);
    }
    into(taken);
  }

  private takeFromGoal(g: GoalDef, index: number, into: (ps: Piece[]) => void): void {
    const { state, mode, alliance } = this.ops;
    if (mode === 'h2h') {
      if (g.color !== 'neutral' && g.color !== alliance) this.ops.violation('SG9', `The robot removed Scoring Objects from opponent Goal ${g.id}.`);
      else if (g.color === 'neutral') this.ops.violation('SG10', `The robot removed Placed Scoring Objects from neutral Goal ${g.id}.`);
    }
    into(state.goals[g.id].splice(index));
  }

  /** Drop pieces to the floor at (x, y): a lone Pin falls over; anything else stands. */
  private dropAt(pieces: Piece[], x: number, y: number): void {
    const half = this.ops.field.perimeter.inside / 2 - CUP.rimDiameter / 2 - 0.1;
    let px = Math.max(-half, Math.min(half, x));
    let py = Math.max(-half, Math.min(half, y));
    // something dropped onto a Goal's body slides off it
    for (const g of this.ops.field.goals ?? []) {
      const clear = g.baseWidth / 2 / Math.cos(22.5 * RAD) + CUP.rimDiameter / 2 + 0.2;
      const d = Math.hypot(px - g.x, py - g.y);
      if (d >= clear) continue;
      const k = d > 1e-6 ? clear / d : 1;
      px = g.x + (d > 1e-6 ? (px - g.x) * k : clear);
      py = g.y + (d > 1e-6 ? (py - g.y) * k : 0);
    }
    if (pieces.length === 1 && pieces[0].kind === 'pin') {
      // the bottom half lands behind, the top half ahead (robot heading)
      this.ops.addLying(pieces[0].colors, px, py, this.world.pose.theta);
      return;
    }
    this.ops.addFloor(pieces, px, py);
  }

  // ---------------- rules and loaders ----------------

  private checkPossession(): void {
    const n = countPieces(this.possessed());
    if (n.pins > 1 || n.cups > 1) this.ops.violation('SG6', `The robot possesses ${n.pins} Pins and ${n.cups} Cups (limit: 1 Pin and 1 Cup).`);
  }

  /** Skills: the drive team keeps the red Loaders stocked from the Match Loads (Pins and Cups alternate in each). */
  private refillLoaders(t: number): void {
    const { state, field, mode } = this.ops;
    if (mode !== 'skills' || t < this.nextRefill) return;
    const pool = state.matchLoads.red;
    if (!pool?.length) return;
    const loaders = (field.loaders ?? []).filter((l) => l.alliance === 'red' && state.loaders[l.id].length < LOADER_CAPACITY);
    if (!loaders.length) return;
    loaders.sort((a, b) => state.loaders[a.id].length - state.loaders[b.id].length);
    // each chute alternates Pins and Cups, so a robot can build combos from one Loader
    const id = loaders[0].id;
    const i = Math.max(0, pool.findIndex((p) => p.kind !== this.lastLoaded.get(id)));
    const [piece] = pool.splice(i, 1);
    state.loaders[id].push(piece);
    this.lastLoaded.set(id, piece.kind);
    this.nextRefill = t + LOADER_REFILL_MS / 2; // two Loaders, each refilled about once a second
    this.ops.changed();
  }
}
