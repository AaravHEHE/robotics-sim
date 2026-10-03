// Deterministic 2D floor physics for Override scoring objects (Rapier, deterministic
// build: bit-identical on every platform). Top-down view: standing stacks are discs,
// lying pins are capsules, the robot is a kinematic box driven by the simulator's
// idealized drivetrain, and walls / goals / loaders are static. Floor friction is
// modelled as damping. Stacking and pickup are not physical — they are rule-exact
// "snap" operations in game.ts (hybrid model).

import RAPIER from '@dimforge/rapier2d-deterministic-compat';
import type { FieldDef } from '../../sim/field.ts';
import { fieldObstacles } from '../../sim/world.ts';
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

  constructor(field: FieldDef, robotSize: { width: number; length: number }, start: BodyPose) {
    this.world = new RAPIER.World({ x: 0, y: 0 });
    this.world.timestep = PHYSICS_DT_MS / 1000;
    const statics = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
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
  }

  addLying(p: LyingPin, asleep = true): void {
    const body = this.dynamic(p.x, p.y, p.heading, asleep);
    // capsule along local +y = the pin's axis; radius ~ the cone (collar is short)
    const r = (PIN.coneDiameter / 2) * M;
    const halfLen = (PIN.length / 2) * M - r;
    this.world.createCollider(RAPIER.ColliderDesc.capsule(halfLen, r).setMass(PIECE_MASS.pin).setFriction(0.4).setRestitution(0.1), body);
    this.bodies.set(p.id, body);
  }

  remove(id: string): void {
    const b = this.bodies.get(id);
    if (!b) return;
    this.world.removeRigidBody(b);
    this.bodies.delete(id);
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
