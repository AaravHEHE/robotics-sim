// Deterministic 2D floor physics for Override scoring objects (Rapier, deterministic
// build: bit-identical on every platform). Top-down view: standing stacks are discs,
// lying pins are capsules, the robot is a kinematic box driven by the simulator's
// idealized drivetrain, and walls / goals / loaders are static. Floor friction is
// modelled as damping. Stacking and pickup are not physical — they are rule-exact
// "snap" operations in game.ts (hybrid model).

import RAPIER from '@dimforge/rapier2d-deterministic-compat';
import { dcos, dhypot, dsin } from '../../sim/dmath.ts';
import type { FieldDef, Vec2 } from '../../sim/field.ts';
import { box, fieldObstacles, octagon, satMtv, type Obstacle } from '../../sim/world.ts';
import { CUP, PIN, stackTop, type Piece } from './elements.ts';
import type { FloorStack, LyingPin } from './state.ts';

const M = 0.0254; // inches -> metres (Rapier is tuned for SI units)
const RAD = Math.PI / 180;
/** Physics timestep (s); the simulator steps the robot at 1 ms and physics at 5 ms. */
export const PHYSICS_DT_MS = 5;

let ready: Promise<void> | null = null;
export const initPhysics = (): Promise<void> => (ready ??= RAPIER.init());

const PIECE_MASS = { cup: 0.077, pin: 0.072 }; // kg (community-measured)
const FLOOR_DAMPING = 6; // 1/s: objects slide a few inches after a push, then stop
/** Contact stiffness (Hz; Rapier default 30). */
const CONTACT_HZ = 150;
/**
 * Rapier's length scale (m): the size of a typical object, here a piece's rim (80 mm). Its
 * contact tolerances scale with it; at the 1 m default a robot corner grazing a piece left
 * the piece up to 2" inside the robot for a tenth of a second.
 */
const LENGTH_UNIT = 0.08;
/**
 * Overlap (in) at which a piece the robot presses on counts as stuck when it is up against a
 * wall, Goal or Loader: as soon as they touch. Waiting for more lets the robot drive the piece
 * into the wall instead (the contact with the wall gives way before the robot does).
 */
const PINNED_DEPTH = 0.01;
/** A stuck piece keeps blocking the robot until they are this far apart (in). */
const PINNED_RELEASE = 0.05;

/** Footprint radius of a standing stack: the widest piece (cup rim or pin collar). */
function stackRadius(pieces: Piece[]): number {
  return Math.max(...pieces.map((p) => (p.kind === 'cup' ? CUP.rimDiameter : PIN.collarDiameter) / 2));
}

export interface BodyPose {
  x: number;
  y: number;
  heading: number;
}

/** Something the robot carries that pushes floor pieces: a held stack (field frame, in). */
export interface Carried {
  /** The carrying part (a claw): the same body whatever it holds. */
  id: string;
  x: number;
  y: number;
  r: number;
  /** Height of its lowest point (in): it passes over pieces shorter than this. */
  bottom: number;
}

/** A part of the robot that presses on pieces: its outline (field frame) and the height of its bottom. */
export interface RobotShape {
  poly: Vec2[];
  bottom: number;
  /** Pieces it may overlap without pressing on them (it came down onto them from above). */
  passes?: (pieceId: string) => boolean;
}

export class FloorPhysics {
  private readonly world: RAPIER.World;
  private readonly robot: RAPIER.RigidBody;
  private readonly bodies = new Map<string, RAPIER.RigidBody>();
  /** Collision outline of each body for blocking the robot: a disc radius or a pin capsule, and its height. */
  private readonly outline = new Map<string, { r: number; length?: number; top: number }>();
  /** Body handle -> piece id. */
  private readonly pieceOf = new Map<number, string>();
  /** Held stacks the robot carries: kinematic discs that push pieces they are level with. */
  private readonly carried = new Map<string, { body: RAPIER.RigidBody; c: Carried }>();
  private readonly carriedOf = new Map<number, Carried>();
  /** Carried id + piece id pairs that overlap without pushing (see Carried / RobotShape.passes). */
  private readonly passing = new Set<string>();
  private readonly hooks: RAPIER.PhysicsHooks;
  private readonly events = new RAPIER.EventQueue(true);
  /** Pieces stuck between the robot and something fixed: the robot can't drive through them. */
  private readonly pinned = new Set<string>();
  /** How far the robot was into each piece at the previous physics step (in). */
  /** The fixed body all walls, Goals and Loaders belong to. */
  private readonly statics: RAPIER.RigidBody;

  constructor(field: FieldDef, robotSize: { width: number; length: number }, start: BodyPose) {
    this.world = new RAPIER.World({ x: 0, y: 0 });
    this.world.timestep = PHYSICS_DT_MS / 1000;
    // stiff contacts: pieces the robot runs into are shoved out of it within a few steps
    // (the default lets a robot sliding past sit inches inside a piece for a quarter second)
    this.world.integrationParameters.contact_natural_frequency = CONTACT_HZ;
    this.world.integrationParameters.lengthUnit = LENGTH_UNIT;
    const statics = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.statics = statics;
    // perimeter walls
    const half = field.perimeter.inside / 2;
    const t = 4; // collision thickness (in), outside the field
    for (const [x, y, hx, hy] of [
      [0, half + t / 2, half + t, t / 2],
      [0, -half - t / 2, half + t, t / 2],
      [half + t / 2, 0, t / 2, half + t],
      [-half - t / 2, 0, t / 2, half + t],
    ]) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx * M, hy * M).setTranslation(x * M, y * M), statics);
    }
    // goals, loaders, fixed objects
    for (const ob of fieldObstacles(field)) {
      const pts = new Float32Array(ob.poly.flatMap(([x, y]) => [x * M, y * M]));
      const desc = RAPIER.ColliderDesc.convexHull(pts);
      if (desc) this.world.createCollider(desc, statics);
    }
    // robot (kinematic)
    this.robot = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x * M, start.y * M).setRotation(-start.heading * RAD),
    );
    this.world.createCollider(RAPIER.ColliderDesc.cuboid((robotSize.width / 2) * M, (robotSize.length / 2) * M), this.robot);
    // a carried stack only pushes the pieces it is level with, and not ones it came down onto
    this.hooks = {
      filterContactPair: (_c1, _c2, b1, b2) => {
        const held = this.carriedOf.get(b1) ?? this.carriedOf.get(b2);
        if (!held) return RAPIER.SolverFlags.COMPUTE_IMPULSE;
        const piece = this.pieceOf.get(b1) ?? this.pieceOf.get(b2);
        if (!piece) return RAPIER.SolverFlags.EMPTY;
        return this.blocks(held, piece) ? RAPIER.SolverFlags.COMPUTE_IMPULSE : RAPIER.SolverFlags.EMPTY;
      },
      filterIntersectionPair: () => true,
    };
  }

  /** Does a carried stack push a piece (rather than pass over it, or sit on it)? */
  private blocks(held: Carried, piece: string): boolean {
    const o = this.outline.get(piece);
    return !!o && held.bottom < o.top && !this.passing.has(held.id + '\n' + piece);
  }

  private dynamic(x: number, y: number, heading: number, asleep: boolean): RAPIER.RigidBody {
    return this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x * M, y * M)
        .setRotation(-heading * RAD)
        .setLinearDamping(FLOOR_DAMPING)
        .setAngularDamping(FLOOR_DAMPING)
        .setCanSleep(true)
        // start at rest: objects placed touching (e.g. wall-group cups) must not drift
        .setSleeping(asleep),
    );
  }

  /** Add a standing stack; `asleep` for the starting layout, awake for dropped objects. */
  addStack(s: FloorStack, asleep = true): void {
    const body = this.dynamic(s.x, s.y, 0, asleep);
    const r = stackRadius(s.pieces) * M;
    const mass = s.pieces.reduce((m, p) => m + PIECE_MASS[p.kind], 0);
    this.world.createCollider(RAPIER.ColliderDesc.ball(r).setMass(mass).setFriction(0.4).setRestitution(0.1), body);
    this.bodies.set(s.id, body);
    this.pieceOf.set(body.handle, s.id);
    this.outline.set(s.id, { r: r / M, top: stackTop(s.pieces, 0, false) });
  }

  /**
   * A stack's pieces changed (taken from or added to): the same body, with the new collider,
   * left as it was (asleep or not). A new body would wake up against the pieces it was laid
   * out touching (the wall groups) and drift.
   */
  restack(s: FloorStack): void {
    const body = this.bodies.get(s.id);
    if (!body) return this.addStack(s, false);
    while (body.numColliders()) this.world.removeCollider(body.collider(0), false);
    const r = stackRadius(s.pieces) * M;
    const mass = s.pieces.reduce((m, p) => m + PIECE_MASS[p.kind], 0);
    this.world.createCollider(RAPIER.ColliderDesc.ball(r).setMass(mass).setFriction(0.4).setRestitution(0.1), body);
    this.outline.set(s.id, { r: r / M, top: stackTop(s.pieces, 0, false) });
  }

  addLying(p: LyingPin, asleep = true): void {
    const body = this.dynamic(p.x, p.y, p.heading, asleep);
    // capsule along local +y = the pin's axis; radius ~ the cone (collar is short)
    const r = (PIN.coneDiameter / 2) * M;
    const halfLen = (PIN.length / 2) * M - r;
    this.world.createCollider(RAPIER.ColliderDesc.capsule(halfLen, r).setMass(PIECE_MASS.pin).setFriction(0.4).setRestitution(0.1), body);
    this.bodies.set(p.id, body);
    this.pieceOf.set(body.handle, p.id);
    // lying on its side, the collar is the highest point
    this.outline.set(p.id, { r: r / M, length: PIN.length, top: PIN.collarDiameter });
  }

  remove(id: string): void {
    const b = this.bodies.get(id);
    if (!b) return;
    this.pieceOf.delete(b.handle);
    this.world.removeRigidBody(b);
    this.bodies.delete(id);
    this.outline.delete(id);
    this.pinned.delete(id);
    for (const key of [...this.passing]) if (key.endsWith('\n' + id)) this.passing.delete(key);
  }

  /** Does a piece's outline overlap a disc? */
  private overlapsDisc(id: string, x: number, y: number, r: number): boolean {
    const b = this.bodies.get(id)!;
    const o = this.outline.get(id)!;
    const t = b.translation();
    const px = t.x / M;
    const py = t.y / M;
    if (!o.length) return dhypot(px - x, py - y) < o.r + r;
    // capsule: distance from the disc centre to the Pin's axis
    const h = o.length / 2 - o.r;
    const ux = -dsin(b.rotation());
    const uy = dcos(b.rotation());
    const k = Math.max(-h, Math.min(h, (x - px) * ux + (y - py) * uy));
    return dhypot(x - px - k * ux, y - py - k * uy) < o.r + r;
  }

  /**
   * Set what the robot carries this step. A carried stack that came down onto a piece from
   * above passes through that piece until they are apart; otherwise it shoves the pieces it is
   * level with, like the chassis does (one that appears next to a piece, picked up beside it,
   * nudges it aside).
   */
  setCarried(list: Carried[]): void {
    const ids = new Set(list.map((c) => c.id));
    for (const [id, h] of this.carried) {
      if (ids.has(id)) continue;
      this.carriedOf.delete(h.body.handle);
      this.world.removeRigidBody(h.body);
      this.carried.delete(id);
      for (const key of [...this.passing]) if (key.startsWith(id + '\n')) this.passing.delete(key);
    }
    for (const c of list) {
      let h = this.carried.get(c.id);
      // taken out of a floor stack: it starts out passing through what is left of that stack
      for (let k = this.expected.length - 1; k >= 0; k--) {
        if (c.id !== this.expected[k].carried) continue;
        this.passing.add(c.id + '\n' + this.expected[k].piece);
        this.expected.splice(k, 1);
      }
      if (h && h.c.r !== c.r) {
        // what it carries changed size: a new outline, same pairs
        this.carriedOf.delete(h.body.handle);
        this.world.removeRigidBody(h.body);
        this.carried.delete(c.id);
        h = undefined;
      }
      if (!h) {
        const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(c.x * M, c.y * M));
        this.world.createCollider(RAPIER.ColliderDesc.ball(c.r * M).setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS), body);
        h = { body, c };
        this.carried.set(c.id, h);
        this.carriedOf.set(body.handle, c);
      }
      h.c.x = c.x;
      h.c.y = c.y;
      h.c.bottom = c.bottom;
      h.c.r = c.r;
      for (const id of this.bodies.keys()) {
        const key = c.id + '\n' + id;
        if (!this.overlapsDisc(id, c.x, c.y, c.r)) this.passing.delete(key);
        else if (c.bottom >= this.outline.get(id)!.top) this.passing.add(key);
      }
      h.body.setNextKinematicTranslation({ x: c.x * M, y: c.y * M });
    }
    this.expected.length = 0; // only for the stack picked up just before this step
  }

  /** A carried stack (`carried`: its id) is taking pieces out of this piece: they start out overlapping. */
  private readonly expected: Array<{ carried: string; piece: string }> = [];
  expectOverlap(carried: string, piece: string): void {
    this.expected.push({ carried, piece });
  }

  /** Does a carried stack pass through a piece right now (see setCarried)? */
  passes(carriedId: string, pieceId: string): boolean {
    return this.passing.has(carriedId + '\n' + pieceId);
  }

  /** Height of a piece's top (in). */
  top(id: string): number {
    return this.outline.get(id)?.top ?? 0;
  }

  has(id: string): boolean {
    return this.bodies.has(id);
  }

  /** Move the robot instantly (no sweeping through objects), e.g. when setPose() places it. */
  teleportRobot(pose: BodyPose): void {
    this.robot.setTranslation({ x: pose.x * M, y: pose.y * M }, true);
    this.robot.setRotation(-pose.heading * RAD, true);
    // what it carries is placed with it (not swept across the field): it starts out like a pickup
    this.setCarried([]);
  }

  setRobot(pose: BodyPose): void {
    this.robot.setNextKinematicTranslation({ x: pose.x * M, y: pose.y * M });
    this.robot.setNextKinematicRotation(-pose.heading * RAD);
  }

  step(): void {
    // this Rapier build only runs the hooks (the carried-stack contact filter) when stepping with
    // an event queue; it drains itself, nothing reads the events
    this.world.step(this.events, this.hooks);
  }

  pose(id: string): BodyPose | null {
    const b = this.bodies.get(id);
    if (!b) return null;
    const t = b.translation();
    return { x: t.x / M, y: t.y / M, heading: -b.rotation() / RAD };
  }

  /**
   * Pieces the robot is pressing that can't get out of the way, as obstacles: a real robot
   * stops against them instead of driving through. `robot` is the robot's parts that press on
   * pieces: its footprint (bottom 0) and what it carries (field frame, in). A piece is trapped
   * when the robot is into it and it is up against something fixed (a wall, Goal or Loader),
   * directly or through other pieces. It stays an obstacle until the robot moves off it.
   */
  pinnedObstacles(robot: RobotShape[]): Obstacle[] {
    const out: Obstacle[] = [];
    for (const [id, b] of this.bodies) {
      const t = b.translation();
      const o = this.outline.get(id)!;
      const x = t.x / M;
      const y = t.y / M;
      const shape = (grow: number) => (o.length ? box(x, y, 2 * (o.r + grow), o.length + 2 * grow, -b.rotation() / RAD) : octagon(x, y, 2 * (o.r + grow)));
      const poly = shape(0);
      const presses = robot.filter((r) => r.bottom < o.top && !r.passes?.(id));
      let depth = 0;
      for (const r of presses) {
        const mtv = satMtv(poly, r.poly);
        if (mtv) depth = Math.max(depth, dhypot(mtv[0], mtv[1]));
      }
      if (depth > 0 && b.isSleeping()) b.wakeUp(); // a resting piece the robot runs into gets pushed
      if (depth > PINNED_DEPTH && this.anchored(b)) this.pinned.add(id);
      else if (this.pinned.has(id) && !presses.some((r) => satMtv(shape(PINNED_RELEASE), r.poly))) this.pinned.delete(id);
      if (this.pinned.has(id)) out.push({ id: `piece ${id}`, poly, top: o.top });
    }
    return out;
  }

  /** Is a piece up against something fixed, directly or through a chain of pieces? */
  private anchored(start: RAPIER.RigidBody): boolean {
    const seen = new Set<number>([start.handle]);
    const queue = [start];
    while (queue.length) {
      const b = queue.shift()!;
      for (let i = 0; i < b.numColliders(); i++) {
        const c = b.collider(i);
        let fixed = false;
        this.world.contactPairsWith(c, (other) => {
          const ob = other.parent();
          if (!ob || seen.has(ob.handle) || ob.handle === this.robot.handle || this.carriedOf.has(ob.handle)) return;
          let touching = false;
          this.world.contactPair(c, other, (m) => {
            for (let k = 0; k < m.numContacts(); k++) if (m.contactDist(k) <= 0.002) touching = true;
          });
          if (!touching) return;
          if (ob.handle === this.statics.handle) fixed = true;
          else if (ob.isDynamic()) {
            seen.add(ob.handle);
            queue.push(ob);
          }
        });
        if (fixed) return true;
      }
    }
    return false;
  }

  /** Is an object's body touching the robot (its chassis, or a stack it carries) right now? */
  touchingRobot(id: string): boolean {
    const b = this.bodies.get(id);
    if (!b) return false;
    // a narrow-phase pair also exists for overlapping bounding boxes: require a contact point
    let touching = false;
    for (const r of [this.robot, ...[...this.carried.values()].map((h) => h.body)]) {
      for (let i = 0; i < b.numColliders() && !touching; i++) {
        for (let j = 0; j < r.numColliders() && !touching; j++) {
          this.world.contactPair(b.collider(i), r.collider(j), (m) => {
            for (let k = 0; k < m.numContacts(); k++) if (m.contactDist(k) <= 0.002) touching = true;
          });
        }
      }
    }
    return touching;
  }

  /**
   * Mass (kg) of the free pieces the robot is pushing right now: the ones touching it that are
   * not wedged against something (those stop the chassis instead, see `pinnedObstacles`).
   */
  pushedMass(): number {
    let kg = 0;
    for (const [id, b] of this.bodies) {
      if (this.pinned.has(id) || !this.touchingRobot(id)) continue;
      kg += b.mass();
    }
    return kg;
  }

  /** Floor friction on a sliding piece (Coulomb coefficient; the colliders' own value). */
  static readonly FLOOR_FRICTION = 0.4;

  free(): void {
    this.events.free();
    this.world.free();
  }
}
