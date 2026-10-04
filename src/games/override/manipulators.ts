// Robot manipulators on the Override field: claws, intakes, staging, wrists and Toggle
// tools from the robot profile, driven by the user's code through the motors and
// solenoids they are mapped to. Pickup, placement and dropping are rule-exact "snap"
// operations (hybrid model): a claw that closes on an object takes it; one that opens
// over a Goal or stack, at the right height, nests what it holds; anywhere else it drops
// to the floor.

import { dcos, dhypot, dsin } from '../../sim/dmath.ts';
import type { Alliance, FieldDef, GoalDef, LoaderDef, Vec2 } from '../../sim/field.ts';
import { clawEffector, clawTilt, toField, toRobot, type Point3 } from '../../sim/lift.ts';
import { box, octagon, satMtv } from '../../sim/world.ts';
import type { Capacity, ClawSpec, IntakeSpec, MechanismSpec, PreloadOrientation, RobotProfile, StagingSpec, ToggleToolSpec, WristSpec } from '../../sim/profile.ts';
import type { World } from '../../sim/world.ts';
import { CUP, layoutStack, PIN, type Piece, type PinColor } from './elements.ts';
import type { FloorStack, LyingPin, OverrideState, Transit } from './state.ts';
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
/** Spacing between pieces travelling through an intake (in): one piece's length. */
const INTAKE_SPACING = PIN.length;
/** Intake roller diameter when the profile doesn't give one (in): a 2.75" flex wheel. */
const ROLLER_DIAMETER = 2.75;
/** Half the width between a claw's jaws (in): what is further to the side isn't gripped. */
const JAW_HALF_WIDTH = 1.25;
/** A Placed piece is only taken off a Goal when centered in the jaws (in). */
const GOAL_GRAB_RADIUS = 1.5;
/** Most a claw may be tilted from upright and still close around or set down a standing stack (degrees). */
export const MAX_TILT = 20;
/** A motor wrist flips past 90° ± this (degrees), so it doesn't chatter around 90°. */
const WRIST_HYSTERESIS = 5;
/** Pieces a Loader chute holds, and how often the drive team adds one (Skills). */
const LOADER_CAPACITY = 2;
const LOADER_REFILL_MS = 1000;
/** After the bottom piece is pulled out, the next one falls into a Loader's opening (ms). */
const LOADER_DROP_MS = 200;
const DEFAULT_CAPACITY: Capacity = { pins: 1, cups: 1 };
/** How long a claw takes to draw in what it closes on (ms; for the viewer). */
const GRAB_MS = 180;
/** Gravity (in/s^2): dropped pieces fall this fast. */
const GRAVITY = 386;
/** How long an intake takes to pull a piece in when it keeps it (no `into`) (ms). */
const CAPTURE_MS = 250;

/** What the manipulators need from the game. */
export interface GameOps {
  readonly field: FieldDef;
  readonly state: OverrideState;
  readonly mode: 'h2h' | 'skills';
  readonly alliance: Alliance;
  removeFloor(id: string): void;
  /** Add a standing stack / lying Pin to the floor; returns its id. */
  addFloor(pieces: Piece[], x: number, y: number): string;
  addLying(colors: [PinColor, PinColor], x: number, y: number, heading: number): string;
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

/** Footprint radius of a standing stack: its widest piece (Cup rim or Pin collar). */
function stackRadius(pieces: Piece[]): number {
  return Math.max(...pieces.map((p) => (p.kind === 'cup' ? CUP.rimDiameter : PIN.collarDiameter) / 2));
}

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return [a[0] + k * dx, a[1] + k * dy];
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return dhypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dy);
}

const RAD = Math.PI / 180;
/** End points of a lying pin: [colors[0] end, colors[1] end]. */
function pinEnds(l: LyingPin): [Vec2, Vec2] {
  const h = PIN.length / 2;
  const ux = dsin(l.heading * RAD);
  const uy = dcos(l.heading * RAD);
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
  /**
   * The held pieces were fed in by an intake while the claw was open: they rest in the
   * open claw (it hasn't closed on them yet) and fall out if it is raised before closing.
   */
  cradled: boolean;
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
  private readonly lastIntake = new Map<string, number>();
  private nextRefill = 0;
  /** Current time (ms) and when each Loader's bottom piece is next within reach. */
  private now = 0;
  private readonly loaderReady = new Map<string, number>();
  /** Kind of the piece last put in each Loader. */
  private readonly lastLoaded = new Map<string, Piece['kind']>();

  constructor(ops: GameOps, world: World) {
    this.ops = ops;
    this.world = world;
    this.profile = world.profile;
    const of = <K extends MechanismSpec['kind']>(k: K) => this.profile.mechanisms.filter((m): m is Extract<MechanismSpec, { kind: K }> => m.kind === k);
    this.claws = of('claw').map((spec) => ({ spec, closed: false, grip: 0, flipped: false, cradled: false }));
    this.intakes = of('intake');
    this.stagings = of('staging');
    this.wrists = of('wrist');
    this.tools = of('toggleTool');
    for (const m of [...of('claw'), ...this.intakes, ...this.stagings]) ops.state.held[m.name] = [];
    this.loadPreload();
    // a piston claw that holds the Preload was closed on it by hand before the match: the
    // cylinder starts there (if the code then leaves the solenoid off, it opens and drops it)
    for (const c of this.claws) {
      if (c.spec.grip === 'piston' && c.spec.adi && ops.state.held[c.spec.name]?.length) {
        world.pistons.set(c.spec.adi.toUpperCase(), (c.spec.closedWhen ?? 'extended') === 'extended' ? 1 : 0);
      }
      // likewise a motor claw starts physically closed on it (its encoder still reads from there)
      if (c.spec.grip === 'motor' && c.spec.motors?.length && ops.state.held[c.spec.name]?.length) {
        for (const port of c.spec.motors) world.motor(Math.abs(port)).angle = (c.spec.closedAt ?? 0) / (c.spec.ratio ?? 1);
      }
      c.closed = this.isClosed(c) || (c.spec.grip === 'motor' && ops.state.held[c.spec.name]?.length > 0);
    }
    this.checkPossession();
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
    this.now = t;
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

  /** How far a claw is tilted from upright (degrees). */
  tilt(spec: ClawSpec): number {
    return clawTilt(this.profile, spec, (m) => this.world.mechanismState(m));
  }

  private stepClaw(c: ClawRuntime): void {
    const held = this.ops.state.held[c.spec.name];
    if (c.spec.grip === 'roller') {
      const spin = this.world.mechanismRpm(c.spec) * (c.spec.inward ?? 1);
      if (spin > SPIN_RPM) this.grab(c);
      else if (spin < -SPIN_RPM && held.length) {
        // rollers push pieces out of the mouth one at a time, bottom first, at roller speed
        const surface = (-spin / 60) * Math.PI * ROLLER_DIAMETER;
        if (this.now - (this.lastIntake.get(c.spec.name) ?? -1e9) >= (1000 * INTAKE_SPACING) / surface) {
          this.lastIntake.set(c.spec.name, this.now);
          this.release(c, 1);
        }
      }
      return;
    }
    const closed = this.isClosed(c);
    if (closed && !c.closed) this.grab(c);
    if (closed) c.cradled = false; // now gripped
    // an open claw doesn't hold anything: what it gripped falls (or is Placed) as soon as it
    // opens, and what an intake fed into it stays only while the claw is down to receive it
    if (!closed && held.length && (!c.cradled || !this.lowered(c.spec))) {
      c.cradled = false;
      this.release(c);
    }
    c.closed = closed;
  }

  /** A piece's position relative to a claw's grip point: [sideways, along the jaws] (in). */
  private jawOffset(e: { robot: Point3 }, fx: number, fy: number): [number, number] {
    const [lx, ly] = toRobot(this.world.pose, fx, fy);
    return [Math.abs(lx - e.robot.x), Math.abs(ly - e.robot.y)];
  }

  /** Is a point between the claw's jaws: within `reach` along them, and not off to the side? */
  private between(e: { robot: Point3 }, fx: number, fy: number, reach: number): boolean {
    const [side, along] = this.jawOffset(e, fx, fy);
    return side <= Math.min(JAW_HALF_WIDTH, reach) && along <= reach;
  }

  private grab(c: ClawRuntime): void {
    const { state, field } = this.ops;
    const held = state.held[c.spec.name];
    // a claw closing on what it already holds just secures it (rollers keep pulling in)
    if (held.length && c.spec.grip !== 'roller') return;
    const e = this.effector(c.spec);
    const reach = c.spec.reach ?? 2;
    // a tilted claw can't close around a standing stack (only a lying Pin)
    const upright = this.tilt(c.spec) <= MAX_TILT;
    type Cand = { d: number; take: () => void; pieces: Piece[]; from?: Transit['from']; lying?: number };
    const cands: Cand[] = [];
    const ok = (pieces: Piece[]) => pieces.length > 0 && fits(c.spec.capacity, held, pieces);

    for (const s of upright ? this.stagings : []) {
      const items = state.held[s.name];
      const d = dhypot(e.robot.x - (s.at.x ?? 0), e.robot.y - s.at.y);
      if (d <= reach && Math.abs(e.robot.z - s.at.z) <= 1.5 && ok(items)) {
        const [sx, sy] = toField(this.world.pose, { x: s.at.x ?? 0, y: s.at.y });
        cands.push({ d, pieces: items, from: { x: sx, y: sy, z: s.at.z }, take: () => this.receive(c, state.held[s.name].splice(0), 0) });
      }
    }
    if (e.z <= LOW_REACH) {
      for (const l of upright ? field.loaders ?? [] : []) {
        const items = state.loaders[l.id];
        const [mx, my] = loaderMouth(field, l);
        const d = dhypot(e.x - mx, e.y - my);
        if (items.length && this.loaderOpen(l.id) && d <= reach + 1 && ok(items.slice(0, 1))) cands.push({ d, pieces: items.slice(0, 1), from: { x: mx, y: my, z: 0 }, take: () => this.receive(c, this.takeFromLoader(l.id), e.z) });
      }
      for (const l of state.lying) {
        const [a, b] = pinEnds(l);
        const d = distToSegment([e.x, e.y], a, b);
        // the point of the Pin nearest the grip point must be between the jaws
        const [cx, cy] = closestOnSegment([e.x, e.y], a, b);
        const pin: Piece = { kind: 'pin', id: l.id, colors: this.uprightColors(l) };
        if (d <= reach && this.between(e, cx, cy, reach) && ok([pin])) {
          const lying = pin.colors[0] === l.colors[0] ? l.heading : l.heading + 180;
          cands.push({ d, pieces: [pin], from: { x: l.x, y: l.y, z: 0 }, lying, take: () => this.takeLying(l, (p) => this.receive(c, [p], e.z)) });
        }
      }
    }
    for (const g of upright ? field.goals ?? [] : []) {
      const pieces = state.goals[g.id];
      const d = dhypot(e.x - g.x, e.y - g.y);
      // Placed pieces come off a Goal only when the claw is centered on them (deliberately)
      if (!pieces.length || d > Math.min(reach, GOAL_GRAB_RADIUS) || !this.between(e, g.x, g.y, reach)) continue;
      const slot = slotAt(pieces, g.height, true, e.z);
      if (slot && ok(pieces.slice(slot.index))) {
        // loose pieces nearby are taken first
        cands.push({ d: d + reach, pieces: pieces.slice(slot.index), from: { x: g.x, y: g.y, z: slot.bottom }, take: () => this.takeFromGoal(g, slot.index, (ps) => this.receive(c, ps, e.z - slot.bottom)) });
      }
    }
    for (const s of upright ? state.floor : []) {
      const d = dhypot(e.x - s.x, e.y - s.y);
      if (d > reach || !this.between(e, s.x, s.y, reach)) continue;
      const slot = slotAt(s.pieces, 0, false, e.z);
      if (slot && ok(s.pieces.slice(slot.index))) {
        cands.push({ d, pieces: s.pieces.slice(slot.index), from: { x: s.x, y: s.y, z: slot.bottom }, take: () => this.takeFromFloor(s, slot.index, (ps) => this.receive(c, ps, e.z - slot.bottom)) });
      }
    }
    if (!cands.length) return;
    cands.sort((a, b) => a.d - b.d);
    const best = cands[0];
    best.take();
    if (best.from) this.setTransit(`claw:${c.spec.name}`, { from: best.from, lying: best.lying, t0: this.now, t1: this.now + GRAB_MS });
    this.checkPossession();
    this.ops.changed();
  }

  /** Put pieces into a claw; `grip` = how far above the stack bottom it holds them. */
  private receive(c: ClawRuntime, pieces: Piece[], grip: number): void {
    const held = this.ops.state.held[c.spec.name];
    if (!held.length) c.grip = Math.max(0, grip);
    this.ops.state.held[c.spec.name] = merge(held, pieces);
  }

  /** Let go of the held stack, or only its bottom `count` pieces (a roller claw spitting out). */
  private release(c: ClawRuntime, count = Infinity): void {
    const { state, field } = this.ops;
    const held = state.held[c.spec.name];
    const e = this.effector(c.spec);
    const bottom = e.z - c.grip;
    const first = held[0];
    const slots = layoutStack(held, 0, false);
    const upright = this.tilt(c.spec) <= MAX_TILT;
    const nests = (existing: Piece[], base: number, onGoal: boolean) => {
      // a tilted stack doesn't go on; a stack alternates Pin, Cup, Pin...: a Pin can't stand on a Pin, nor a Cup on a Cup
      if (!upright) return false;
      if (existing.length && existing[existing.length - 1].kind === first.kind) return false;
      const rest = restingBottom(existing, base, onGoal, first);
      return bottom >= rest - PLACE_BELOW && bottom <= rest + PLACE_ABOVE;
    };
    const pieces = held.splice(0, count);
    // what stays in the claw is held by its new bottom piece
    c.grip = held.length ? c.grip - (slots[pieces.length].bottom - slots[0].bottom) : 0;
    for (const g of field.goals ?? []) {
      if (dhypot(e.x - g.x, e.y - g.y) > PLACE_TOLERANCE) continue;
      if (!nests(state.goals[g.id], g.height, true)) break; // over a Goal but it won't sit: falls off
      if (this.ops.mode === 'h2h' && g.color !== 'neutral' && g.color !== this.ops.alliance) {
        this.ops.violation('SG9', `The robot added Scoring Objects to opponent Goal ${g.id}.`);
      }
      state.goals[g.id].push(...pieces);
      this.ops.changed();
      return;
    }
    for (const s of state.floor) {
      if (dhypot(e.x - s.x, e.y - s.y) > PLACE_TOLERANCE || !nests(s.pieces, 0, false)) continue;
      s.pieces.push(...pieces);
      this.ops.rebuildFloor(s);
      this.ops.changed();
      return;
    }
    this.dropAt(pieces, e.x, e.y, bottom);
    this.ops.changed();
  }

  private stepWrist(w: WristSpec): void {
    const c = this.claws.find((x) => x.spec.name === w.claw);
    if (!c) return;
    const v = this.world.mechanismState(w);
    const a = ((v % 360) + 360) % 360;
    const band = c.flipped ? -WRIST_HYSTERESIS : WRIST_HYSTERESIS;
    const flipped = w.adi ? v >= 0.5 : a > 90 + band && a < 270 - band;
    if (flipped === c.flipped) return;
    c.flipped = flipped;
    this.ops.state.flipped[c.spec.name] = flipped;
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
      const ready = mine.filter((p) => (state.transit[p.id]?.t1 ?? 0) <= t);
      // pieces that came in together (a stack) move on together, keeping their order;
      // otherwise one at a time, as far as there is room
      const batches = fits(destSpec.capacity, state.held[spec.into], ready) ? [ready] : ready.map((p) => [p]);
      for (const batch of batches) {
        if (!batch.length || !fits(destSpec.capacity, state.held[spec.into], batch)) continue;
        const claw = this.claws.find((c) => c.spec.name === spec.into);
        if (claw && !state.held[spec.into].length) claw.grip = 0;
        if (claw && claw.spec.grip !== 'roller') claw.cradled = true;
        for (const p of batch) {
          mine.splice(mine.indexOf(p), 1);
          delete state.transit[p.id];
        }
        state.held[spec.into] = merge(state.held[spec.into], batch);
        this.ops.changed();
      }
    }
    const spin = this.world.mechanismRpm(spec) * (spec.inward ?? 1);
    // pieces follow each other through the rollers one piece-length apart, at roller speed
    const surface = (Math.abs(spin) / 60) * Math.PI * (spec.rollerDiameter ?? ROLLER_DIAMETER); // in/s
    if (Math.abs(spin) <= SPIN_RPM || t - (this.lastIntake.get(spec.name) ?? -1e9) < (1000 * INTAKE_SPACING) / surface) return;
    if (spin < 0) {
      // reversing spits out what is still in the intake
      const p = mine.pop();
      if (!p) return;
      delete state.transit[p.id];
      const [x, y] = toField(this.world.pose, { x: spec.zone.x, y: spec.zone.y + spec.zone.length / 2 + 3 });
      this.dropAt([p], x, y, 0.5);
      this.lastIntake.set(spec.name, t);
      this.ops.changed();
      return;
    }
    const got = this.intakeOne(spec);
    if (!got) return;
    const acquired = got.pieces;
    // each piece rides through the intake from where it was: the viewer animates it
    const t1 = t + (spec.into ? (spec.transferMs ?? 300) : CAPTURE_MS);
    for (const p of acquired) this.setTransit(p.id, { from: got.from, lying: got.lying, t0: t, t1 });
    state.held[spec.name] = merge(state.held[spec.name], acquired);
    this.lastIntake.set(spec.name, t);
    this.checkPossession();
    this.ops.changed();
  }

  /** A claw fed by an intake takes pieces only while lowered and open; staging always can. */
  private canReceive(dest: ClawSpec | StagingSpec): boolean {
    if (dest.kind !== 'claw') return true;
    if (dest.grip !== 'roller' && clawClosed(dest, this.world.mechanismState(dest))) return false;
    return this.lowered(dest);
  }

  /** Is a claw down where its intake hands pieces over (its lift near home)? */
  private lowered(dest: ClawSpec): boolean {
    if (!dest.lift) return true;
    const lift = this.profile.mechanisms.find((m) => m.name === dest.lift);
    return !lift || clawEffector(this.profile, dest, (m) => this.world.mechanismState(m)).z <= (lift as { home: Point3 }).home.z + 2;
  }

  private inZone(spec: IntakeSpec, fx: number, fy: number, margin: number): boolean {
    const [lx, ly] = toRobot(this.world.pose, fx, fy);
    const z = spec.zone;
    return Math.abs(lx - z.x) <= z.width / 2 + margin && Math.abs(ly - z.y) <= z.length / 2 + margin;
  }

  private intakeOne(spec: IntakeSpec): { pieces: Piece[]; from: Transit['from']; lying?: number } | null {
    const { state, field } = this.ops;
    const acc = { pins: true, cups: true, lying: true, ...spec.accepts };
    const mine = state.held[spec.name];
    const accepted = (ps: Piece[]) => ps.every((p) => (p.kind === 'pin' ? acc.pins : acc.cups)) && fits(spec.capacity, mine, ps);
    for (const l of field.loaders ?? []) {
      const items = state.loaders[l.id];
      const [mx, my] = loaderMouth(field, l);
      if (items.length && this.loaderOpen(l.id) && this.inZone(spec, mx, my, 0.5) && accepted(items.slice(0, 1))) return { pieces: this.takeFromLoader(l.id), from: { x: mx, y: my, z: 0 } };
    }
    for (const s of state.floor) {
      if (!this.inZone(spec, s.x, s.y, stackRadius(s.pieces)) || !accepted(s.pieces)) continue;
      this.ops.removeFloor(s.id);
      state.floor.splice(state.floor.indexOf(s), 1);
      return { pieces: s.pieces, from: { x: s.x, y: s.y, z: 0 } };
    }
    if (acc.lying && acc.pins) {
      for (const l of state.lying) {
        if (!this.inZone(spec, l.x, l.y, PIN.coneDiameter / 2)) continue;
        const pin: Piece = { kind: 'pin', id: l.id, colors: this.uprightColors(l) };
        if (!accepted([pin])) continue;
        let got: Piece[] = [];
        const from = { x: l.x, y: l.y, z: 0 };
        // it ends up standing with the end nearer the robot down: point the lying axis that way
        const lying = pin.colors[0] === l.colors[0] ? l.heading : l.heading + 180;
        this.takeLying(l, (p) => (got = [p]));
        return { pieces: got, from, lying };
      }
    }
    return null;
  }

  // ---------------- taking and dropping ----------------

  private loaderOpen(id: string): boolean {
    return this.now >= (this.loaderReady.get(id) ?? 0);
  }

  /** The bottom piece of a Loader; the one above it then drops into the opening. */
  private takeFromLoader(id: string): Piece[] {
    this.loaderReady.set(id, this.now + LOADER_DROP_MS);
    return this.ops.state.loaders[id].splice(0, 1);
  }

  /** A lying pin picked up stands with the end nearer the robot at the bottom. */
  private uprightColors(l: LyingPin): [PinColor, PinColor] {
    const [a, b] = pinEnds(l);
    const { x, y } = this.world.pose;
    return dhypot(a[0] - x, a[1] - y) <= dhypot(b[0] - x, b[1] - y) ? [l.colors[0], l.colors[1]] : [l.colors[1], l.colors[0]];
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

  /**
   * Drop pieces to the floor at (x, y), let go with their bottom `z` inches up: a lone Pin
   * falls over; anything else stands.
   */
  private dropAt(pieces: Piece[], x: number, y: number, z = 0): void {
    const half = this.ops.field.perimeter.inside / 2 - CUP.rimDiameter / 2 - 0.1;
    let px = Math.max(-half, Math.min(half, x));
    let py = Math.max(-half, Math.min(half, y));
    // something dropped onto a Goal's body slides off it
    for (const g of this.ops.field.goals ?? []) {
      const clear = g.baseWidth / 2 / dcos(22.5 * RAD) + CUP.rimDiameter / 2 + 0.2;
      const d = dhypot(px - g.x, py - g.y);
      if (d >= clear) continue;
      const k = d > 1e-6 ? clear / d : 1;
      px = g.x + (d > 1e-6 ? (px - g.x) * k : clear);
      py = g.y + (d > 1e-6 ? (py - g.y) * k : 0);
    }
    const lone = pieces.length === 1 && pieces[0].kind === 'pin';
    const heading = this.world.pose.theta;
    // it lands beside the robot (or a Loader, or another stack), never inside it
    const outline = (x: number, y: number) => (lone ? box(x, y, PIN.coneDiameter, PIN.length, heading) : octagon(x, y, stackRadius(pieces) * 2));
    const solids = [this.world.footprint(), ...this.world.obstacles.filter((o) => o.id.startsWith('loader ')).map((o) => o.poly)];
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const solid of solids) {
        const mtv = satMtv(outline(px, py), solid);
        if (!mtv) continue;
        px += mtv[0] * 1.02;
        py += mtv[1] * 1.02;
        moved = true;
      }
      for (const st of this.ops.state.floor) {
        const gap = stackRadius(st.pieces) + (lone ? PIN.coneDiameter / 2 : stackRadius(pieces));
        const d = dhypot(px - st.x, py - st.y);
        if (d >= gap) continue;
        const k = d > 1e-6 ? gap / d : 1;
        px = st.x + (d > 1e-6 ? (px - st.x) * k : gap);
        py = st.y + (d > 1e-6 ? (py - st.y) * k : 0);
        moved = true;
      }
      if (!moved) break;
    }
    px = Math.max(-half, Math.min(half, px));
    py = Math.max(-half, Math.min(half, py));
    const id =
      lone && pieces[0].kind === 'pin'
        ? // the bottom half lands behind, the top half ahead (robot heading)
          this.ops.addLying(pieces[0].colors, px, py, heading)
        : this.ops.addFloor(pieces, px, py);
    if (z > 0.25) this.setTransit(id, { from: { x: px, y: py, z }, t0: this.now, t1: this.now + 1000 * Math.sqrt((2 * z) / GRAVITY) });
  }

  /** Record a piece in motion for the viewer, forgetting ones that arrived a while ago. */
  private setTransit(key: string, tr: Transit): void {
    const { transit, held } = this.ops.state;
    const riding = new Set(this.intakes.flatMap((i) => held[i.name].map((p) => p.id)));
    for (const [k, v] of Object.entries(transit)) if (v.t1 < this.now - 1000 && !riding.has(k)) delete transit[k];
    transit[key] = tr;
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
