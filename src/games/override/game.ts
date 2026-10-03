// The Override game running inside a simulation: owns the game state and the floor
// physics, steps them with the simulator, and records what the replay viewer needs.

import type { FieldDef } from '../../sim/field.ts';
import type { World } from '../../sim/world.ts';
import { FloorPhysics, initPhysics, PHYSICS_DT_MS } from './physics.ts';
import { initialState, type OverrideState } from './state.ts';

/** Replay data: full-state snapshots when the structure changes, plus motion tracks. */
export interface OverrideRecording {
  id: 'override';
  layout: string;
  /** Snapshots in time order; the first is at t = 0. */
  snapshots: Array<{ t: number; state: OverrideState }>;
  /** Object or toggle id -> flat [t, x, y, heading, ...] samples (toggles: [t, angle, 0, 0]). */
  tracks: Record<string, number[]>;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class OverrideGame {
  readonly field: FieldDef;
  readonly layout: string;
  readonly state: OverrideState;
  private readonly world: World;
  private readonly physics: FloorPhysics;
  private physicsClock = 0;
  private readonly rec: OverrideRecording;
  private readonly lastTrack = new Map<string, [number, number, number]>();

  private constructor(field: FieldDef, layout: string, world: World) {
    this.field = field;
    this.layout = layout;
    this.world = world;
    this.state = initialState(field, layout);
    this.physics = new FloorPhysics(field, world.profile.size, { x: world.pose.x, y: world.pose.y, heading: world.pose.theta });
    for (const s of this.state.floor) this.physics.addStack(s);
    for (const p of this.state.lying) this.physics.addLying(p);
    this.rec = { id: 'override', layout, snapshots: [{ t: 0, state: clone(this.state) }], tracks: {} };
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
    this.physicsClock += dtMs;
    while (this.physicsClock >= PHYSICS_DT_MS) {
      this.physicsClock -= PHYSICS_DT_MS;
      this.physics.setRobot({ x: this.world.pose.x, y: this.world.pose.y, heading: this.world.pose.theta });
      this.physics.step();
      this.syncFromPhysics();
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

  /** Record motion samples for objects that moved since their last sample. */
  recordFrame(t: number): void {
    const sample = (id: string, a: number, b: number, c: number) => {
      const last = this.lastTrack.get(id);
      if (last && Math.abs(last[0] - a) < 1e-3 && Math.abs(last[1] - b) < 1e-3 && Math.abs(last[2] - c) < 1e-2) return;
      // first movement: also record the resting value just before, so replays interpolate from it
      (this.rec.tracks[id] ??= []).push(t, a, b, c);
      this.lastTrack.set(id, [a, b, c]);
    };
    for (const s of this.state.floor) sample(s.id, s.x, s.y, 0);
    for (const l of this.state.lying) sample(l.id, l.x, l.y, l.heading);
    for (const tg of this.state.toggles) sample(tg.id, tg.angle, 0, 0);
  }

  /** Record a structural change (pickup, placement, drop) at time t. */
  snapshot(t: number): void {
    this.rec.snapshots.push({ t, state: clone(this.state) });
  }

  finish(): OverrideRecording {
    this.physics.free();
    return this.rec;
  }
}
