// Deterministic 2D floor physics for Override scoring objects (Rapier, deterministic
// build: bit-identical on every platform). Top-down view: standing stacks are discs,
// lying pins are capsules, the robot is a kinematic box driven by the simulator's
// idealized drivetrain, and walls / goals / loaders are static. Floor friction is
// modelled as damping. Stacking and pickup are not physical — they are rule-exact
// "snap" operations in game.ts (hybrid model).

import RAPIER from '@dimforge/rapier2d-deterministic-compat';
import type { FieldDef, Vec2 } from '../../sim/field.ts';
import { box, fieldObstacles, octagon, satMtv, type Obstacle } from '../../sim/world.ts';
import { CUP, PIN, type Piece } from './elements.ts';
import type { FloorStack, LyingPin } from './state.ts';

const M = 0.0254; // inches -> metres (Rapier is tuned for SI units)
const RAD = Math.PI / 180;
/** Physics timestep (s); the simulator steps the robot at 1 ms and physics at 5 ms. */
export const PHYSICS_DT_MS = 5;

let ready: Promise<void> | null = null;
export const initPhysics = (): Promise<void> => (ready ??= RAPIER.init());

const PIECE_MASS = { cup: 0.077, pin: 0.072 }; // kg (community-measured)
const FLOOR_DAMPING = 6; // 1/s: objects slide a few inches after a push, then stop
/** Overlap (in) at which a piece the robot pushes counts as stuck (against a wall, goal, ...). */
/** Contact stiffness (Hz; Rapier default 30). */
const CONTACT_HZ = 150;
const PINNED_DEPTH = 0.1;
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

export class FloorPhysics {
  private readonly world: RAPIER.World;
  private readonly robot: RAPIER.RigidBody;
  private readonly bodies = new Map<string, RAPIER.RigidBody>();
  /** Collision outline of each body for blocking the robot: a disc radius or a pin capsule. */
  private readonly outline = new Map<string, { r: number; length?: number }>();
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
    this.outline.set(s.id, { r: r / M });
  }

  addLying(p: LyingPin, asleep = true): void {
    const body = this.dynamic(p.x, p.y, p.heading, asleep);
    // capsule along local +y = the pin's axis; radius ~ the cone (collar is short)
    const r = (PIN.coneDiameter / 2) * M;
    const halfLen = (PIN.length / 2) * M - r;
    this.world.createCollider(RAPIER.ColliderDesc.capsule(halfLen, r).setMass(PIECE_MASS.pin).setFriction(0.4).setRestitution(0.1), body);
    this.bodies.set(p.id, body);
    this.outline.set(p.id, { r: r / M, length: PIN.length });
  }

  remove(id: string): void {
    const b = this.bodies.get(id);
    if (!b) return;
    this.world.removeRigidBody(b);
    this.bodies.delete(id);
    this.outline.delete(id);
    this.pinned.delete(id);
  }

  has(id: string): boolean {
    return this.bodies.has(id);
  }

  /** Move the robot instantly (no sweeping through objects), e.g. when setPose() places it. */
  teleportRobot(pose: BodyPose): void {
    this.robot.setTranslation({ x: pose.x * M, y: pose.y * M }, true);
    this.robot.setRotation(-pose.heading * RAD, true);
  }

  setRobot(pose: BodyPose): void {
    this.robot.setNextKinematicTranslation({ x: pose.x * M, y: pose.y * M });
    this.robot.setNextKinematicRotation(-pose.heading * RAD);
  }

  step(): void {
    this.world.step();
  }

  pose(id: string): BodyPose | null {
    const b = this.bodies.get(id);
    if (!b) return null;
    const t = b.translation();
    return { x: t.x / M, y: t.y / M, heading: -b.rotation() / RAD };
  }

  /**
   * Pieces the robot is pressing that can't get out of the way, as obstacles: a real robot
   * stops against them instead of driving through. `robot` is the robot's footprint (field
   * frame, in). A piece is trapped when the robot is into it and it is up against something
   * fixed (a wall, Goal or Loader), directly or through other pieces. It stays an obstacle
   * until the robot moves off it.
   */
  pinnedObstacles(robot: Vec2[]): Obstacle[] {
    const out: Obstacle[] = [];
    for (const [id, b] of this.bodies) {
      const t = b.translation();
      const o = this.outline.get(id)!;
      const x = t.x / M;
      const y = t.y / M;
      const shape = (grow: number) => (o.length ? box(x, y, 2 * (o.r + grow), o.length + 2 * grow, -b.rotation() / RAD) : octagon(x, y, 2 * (o.r + grow)));
      const poly = shape(0);
      const mtv = satMtv(poly, robot);
      const depth = mtv ? Math.hypot(mtv[0], mtv[1]) : 0;
      if (depth > 0 && b.isSleeping()) b.wakeUp(); // a resting piece the robot runs into gets pushed
      if (depth > PINNED_DEPTH && this.anchored(b)) this.pinned.add(id);
      else if (this.pinned.has(id) && !satMtv(shape(PINNED_RELEASE), robot)) this.pinned.delete(id);
      if (this.pinned.has(id)) out.push({ id: `piece ${id}`, poly });
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
          if (!ob || seen.has(ob.handle) || ob.handle === this.robot.handle) return;
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

  /** Is an object's body touching the robot right now? */
  touchingRobot(id: string): boolean {
    const b = this.bodies.get(id);
    if (!b) return false;
    // a narrow-phase pair also exists for overlapping bounding boxes: require a contact point
    let touching = false;
    for (let i = 0; i < b.numColliders() && !touching; i++) {
      for (let j = 0; j < this.robot.numColliders() && !touching; j++) {
        this.world.contactPair(b.collider(i), this.robot.collider(j), (m) => {
          for (let k = 0; k < m.numContacts(); k++) if (m.contactDist(k) <= 0.002) touching = true;
        });
      }
    }
    return touching;
  }

  free(): void {
    this.world.free();
  }
}
