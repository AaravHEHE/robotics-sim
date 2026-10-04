// Box-robot visuals for game manipulators (lifts, claws, intakes, staging, wrists, Toggle
// tools) and the pieces each one holds or carries. Everything lives in the robot group's
// local frame: three (x, y, z) = robot (x right, z up, -forward).
//
// Pieces in motion are animated from the game state's `transit` entries: a piece an intake
// picks up rises from where it was (a lying Pin turns upright) and rides along the
// intake's path to its staging tray or claw, arriving when the simulator hands it over; a
// claw draws in what it closes on.

import * as THREE from 'three';
import { layoutStack, type Piece } from '../games/override/elements.ts';
import { clawClosed } from '../games/override/manipulators.ts';
import type { OverrideState, Transit } from '../games/override/state.ts';
import { clawEffector, liftEffector, toRobot, type Point3 } from '../sim/lift.ts';
import type { ClawSpec, IntakeSpec, LiftSpec, MechanismSpec, RobotProfile, StagingSpec } from '../sim/profile.ts';
import { cupMesh, pinMesh } from './override-meshes.ts';

const local = (p: Point3) => new THREE.Vector3(p.x, p.z, -p.y);
const DEG = Math.PI / 180;
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
/**
 * Rollers are drawn turning at this fraction of their real speed: a 600 rpm roller
 * sampled at 60 frames per second would strobe (look still or turn backwards).
 */
const VISUAL_SPIN = 0.12;
/** The capture part of an intake pickup (ms): from the floor into the intake's mouth. */
const CAPTURE_MS = 150;
const CUP_HEIGHT = 6.5;

type ValueOf = (m: MechanismSpec) => number;
type Pose = { x: number; y: number; theta: number };

/** A bar from a to b (robot-local three coordinates), as a unit box scaled each update. */
function bar(color: number, thickness = 0.8): { mesh: THREE.Mesh; set(a: THREE.Vector3, b: THREE.Vector3): void } {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, 1), new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.5 }));
  return {
    mesh,
    set(a, b) {
      const len = Math.max(0.01, a.distanceTo(b));
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.scale.set(1, 1, len);
      mesh.quaternion.setFromUnitVectors(Z, b.clone().sub(a).normalize());
    },
  };
}

function stackMeshes(pieces: Piece[]): THREE.Group {
  const g = new THREE.Group();
  for (const slot of layoutStack(pieces, 0, false)) {
    const m = slot.piece.kind === 'pin' ? pinMesh(slot.piece.colors) : cupMesh(slot.piece.up);
    m.position.y = slot.bottom;
    g.add(m);
  }
  return g;
}

/** A roller with flex-wheel flaps, spinning about the robot's x axis (or y with `upright`). */
function roller(length: number, radius: number, color: number, upright = false): THREE.Group {
  const spin = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const flapMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.8 });
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 14), mat);
  if (!upright) drum.rotation.z = Math.PI / 2;
  spin.add(drum);
  for (let k = 0; k < 6; k++) {
    const flap = new THREE.Mesh(upright ? new THREE.BoxGeometry(0.12, length * 0.9, radius * 0.9) : new THREE.BoxGeometry(length * 0.9, 0.12, radius * 0.9), flapMat);
    const a = (k / 6) * Math.PI * 2;
    if (upright) {
      flap.position.set(Math.cos(a) * radius * 1.3, 0, Math.sin(a) * radius * 1.3);
      flap.rotation.y = -a;
    } else {
      flap.position.set(0, Math.cos(a) * radius * 1.3, Math.sin(a) * radius * 1.3);
      flap.rotation.x = a;
    }
    spin.add(flap);
  }
  return spin;
}

/** Robot-local three position of a field point at height z, for the robot at `pose`. */
function fromField(pose: Pose, x: number, y: number, z: number): THREE.Vector3 {
  const [lx, ly] = toRobot(pose, x, y);
  return new THREE.Vector3(lx, z, -ly);
}

/** Orientation that lays a piece (axis +y) along a field heading, seen from the robot. */
function lyingQuat(pose: Pose, heading: number): THREE.Quaternion {
  const h = (heading - pose.theta) * DEG;
  return new THREE.Quaternion().setFromUnitVectors(Y, new THREE.Vector3(Math.sin(h), 0, -Math.cos(h)));
}

const ease = (k: number) => k * k * (3 - 2 * k);
const progress = (tr: Transit, t: number) => (tr.t1 > tr.t0 ? Math.max(0, Math.min(1, (t - tr.t0) / (tr.t1 - tr.t0))) : 1);

interface ClawVis {
  spec: ClawSpec;
  /** At the grip point; turns with the arm / wrist. */
  pivot: THREE.Group;
  /** The held stack, its bottom `grip` below the grip point. */
  stack: THREE.Group;
}

interface IntakeVis {
  spec: IntakeSpec;
  /** Pieces riding through it: pieces that came in together ride together, as one stack. */
  riding: THREE.Group;
  groups: Array<{ id: string; mesh: THREE.Group }>;
  dest: ClawSpec | StagingSpec | null;
}

export class ManipulatorVisuals {
  private readonly profile: RobotProfile;
  private readonly claws: ClawVis[] = [];
  private readonly intakes: IntakeVis[] = [];
  /** Staging trays: their contents. */
  private readonly trays = new Map<string, THREE.Group>();
  private readonly updates: Array<(v: ValueOf) => void> = [];
  private state: OverrideState | null = null;

  /** `boxes`: draw mechanisms (box robot); otherwise only held pieces (GLB models). */
  constructor(profile: RobotProfile, root: THREE.Group, boxes: boolean) {
    this.profile = profile;
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.7 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xffb020, roughness: 0.5 });
    for (const m of profile.mechanisms) {
      if (m.kind === 'lift' && boxes) this.lift(m, root);
      if (m.kind === 'claw') {
        const pivot = new THREE.Group();
        const stack = new THREE.Group();
        pivot.add(stack);
        root.add(pivot);
        this.claws.push({ spec: m, pivot, stack });
        if (boxes && m.grip === 'roller') {
          // two upright rollers either side of the mouth, spinning opposite ways
          const rollers = [-1, 1].map((side) => {
            const r = roller(3.5, 0.7, 0x2d6cdf, true);
            r.position.set(side * 2.4, 1.2, 0);
            pivot.add(r);
            return { r, side };
          });
          this.updates.push((v) => rollers.forEach(({ r, side }) => (r.rotation.y = side * v(m) * DEG * VISUAL_SPIN)));
        } else if (boxes) {
          const fingers = [-1, 1].map((side) => {
            const f = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.5, 2), accent);
            pivot.add(f);
            return { f, side };
          });
          this.updates.push((v) => {
            const gap = clawClosed(m, v(m)) ? 1.9 : 2.8;
            fingers.forEach(({ f, side }) => f.position.set(side * gap, 0, 0));
          });
        }
      }
      if (m.kind === 'intake') {
        const riding = new THREE.Group();
        root.add(riding);
        const dest = (m.into ? profile.mechanisms.find((x) => x.name === m.into) : null) as ClawSpec | StagingSpec | null;
        this.intakes.push({ spec: m, riding, groups: [], dest });
        if (boxes) {
          // a roller at the mouth, and one where the path crests (pieces ride between them)
          const front = roller(m.zone.width, 1, 0x2d6cdf);
          front.position.copy(local({ x: m.zone.x, y: m.zone.y + m.zone.length / 2 - 1, z: 1.5 }));
          root.add(front);
          const spinners = [front];
          if (dest) {
            // the roller that carries pieces over the deck, just above the path's high point
            const top = roller(m.zone.width * 0.8, 0.8, 0x2d6cdf);
            top.position.copy(this.pathOf(m, dest, () => 0).getPoint(0.5)).add(new THREE.Vector3(0, CUP_HEIGHT + 1, 0));
            root.add(top);
            spinners.push(top);
          }
          this.updates.push((v) => spinners.forEach((s) => (s.rotation.x = -v(m) * DEG * VISUAL_SPIN)));
        }
      }
      if (m.kind === 'staging') {
        const holder = new THREE.Group();
        holder.position.copy(local({ x: m.at.x ?? 0, y: m.at.y, z: m.at.z }));
        root.add(holder);
        this.trays.set(m.name, holder);
        if (boxes) {
          const tray = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 4), dark);
          tray.position.copy(holder.position).add(new THREE.Vector3(0, -0.2, 0));
          root.add(tray);
        }
      }
      if (m.kind === 'toggleTool' && boxes) {
        const h = m.top - m.bottom;
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(m.box.width, h, m.box.length),
          new THREE.MeshStandardMaterial({ color: m.tool === 'roller' ? 0x2d6cdf : 0x8a5cf6, roughness: 0.5, transparent: true, opacity: 0.9 }),
        );
        const at = local({ x: m.box.x, y: m.box.y, z: m.bottom + h / 2 });
        box.position.copy(at);
        root.add(box);
        if (m.tool === 'plate') {
          // retracted, the plate sits back toward the robot's center (front or rear plate)
          const inward = m.box.y >= 0 ? 1 : -1;
          this.updates.push((v) => {
            const out = v(m) >= 0.5;
            box.position.copy(at).add(new THREE.Vector3(0, 0, out ? 0 : inward * (m.box.length + 1)));
            (box.material as THREE.MeshStandardMaterial).opacity = out ? 0.9 : 0.35;
          });
        }
        if (m.tool === 'roller') this.updates.push((v) => (box.rotation.x = -v(m) * DEG * VISUAL_SPIN));
      }
    }
  }

  /**
   * The path an intake carries pieces along (robot-local three coordinates of a piece's
   * bottom): from the floor at its mouth, over the drive base and electronics, to where it
   * hands them over.
   */
  private pathOf(spec: IntakeSpec, dest: ClawSpec | StagingSpec | null, v: ValueOf): THREE.Curve<THREE.Vector3> {
    const mouth = local({ x: spec.zone.x, y: spec.zone.y, z: 0 });
    const end = this.endOf(spec, dest, v);
    if (mouth.distanceTo(end) < 4) return new THREE.LineCurve3(mouth, end);
    const over = mouth.clone().lerp(end, 0.5);
    over.y = Math.max(end.y, this.profile.drivetrain.wheelDiameter / 2 + 3);
    return new THREE.CatmullRomCurve3([mouth, over, end], false, 'centripetal');
  }

  /** Where an intake's path ends: its destination's receiving point, or behind the zone. */
  private endOf(spec: IntakeSpec, dest: ClawSpec | StagingSpec | null, v: ValueOf): THREE.Vector3 {
    if (dest?.kind === 'staging') return local({ x: dest.at.x ?? 0, y: dest.at.y, z: dest.at.z });
    if (dest?.kind === 'claw') return local(clawEffector(this.profile, dest, v));
    return local({ x: spec.zone.x, y: spec.zone.y - spec.zone.length / 2 - 2, z: 0.5 });
  }

  private lift(m: LiftSpec, root: THREE.Group): void {
    const L = m.length ?? 0;
    const a0 = (m.startAngle ?? 0) * DEG;
    const out = m.facing === 'rear' ? -1 : 1;
    const x0 = m.home.x ?? 0;
    if (m.lift === 'arm' || m.lift === 'fourbar' || m.lift === 'sixbar') {
      // bars from a fixed tower pivot to the end effector (a 6-bar's second stage drawn as one)
      const pivot = local({ x: x0, y: m.home.y - out * L * Math.cos(a0), z: m.home.z - (m.lift === 'sixbar' ? 2 : 1) * L * Math.sin(a0) });
      const tower = bar(0x8a9099, 1);
      root.add(tower.mesh);
      tower.set(new THREE.Vector3(pivot.x, 0.5, pivot.z), pivot);
      const bars = [-1.5, 1.5].map(() => bar(0xb9bec5));
      for (const b of bars) root.add(b.mesh);
      this.updates.push((v) => {
        const e = local(liftEffector(m, v(m)));
        bars.forEach((b, i) => {
          const dx = new THREE.Vector3(i ? 1.5 : -1.5, 0, 0);
          b.set(pivot.clone().add(dx), e.clone().add(dx));
        });
      });
      return;
    }
    if (m.lift === 'dr4b') {
      // two stacked 4-bar stages on a tower: the lower one folds out toward the robot's
      // center to an elbow, the upper one back to the carriage, which rises straight up
      const baseZ = m.home.z - 2 * L * Math.sin(a0);
      const inward = m.home.y >= 0 ? -1 : 1;
      const yb = m.home.y + inward * 1.5;
      const tower = bar(0x8a9099, 1);
      root.add(tower.mesh);
      tower.set(local({ x: x0, y: yb, z: 0.5 }), local({ x: x0, y: yb, z: baseZ }));
      const stages = [-1.5, 1.5].map((dx) => ({ dx, lower: bar(0xb9bec5), upper: bar(0xd0d4d9) }));
      for (const st of stages) root.add(st.lower.mesh, st.upper.mesh);
      this.updates.push((v) => {
        const a = a0 + v(m) * DEG;
        const elbow = { y: yb + inward * L * Math.cos(a), z: baseZ + L * Math.sin(a) };
        const top = { y: yb, z: baseZ + 2 * L * Math.sin(a) };
        for (const { dx, lower, upper } of stages) {
          lower.set(local({ x: x0 + dx, y: yb, z: baseZ }), local({ x: x0 + dx, ...elbow }));
          upper.set(local({ x: x0 + dx, ...elbow }), local({ x: x0 + dx, ...top }));
        }
      });
      return;
    }
    if (m.lift === 'cascade') {
      // nested slide stages, each rising its share of the carriage travel
      const n = (m.stages ?? 1) + 1;
      const rails = Array.from({ length: n }, (_, k) => bar(k % 2 ? 0xd0d4d9 : 0xb9bec5, 0.7));
      for (const b of rails) root.add(b.mesh);
      const h0 = m.home.z;
      this.updates.push((v) => {
        const e = liftEffector(m, v(m));
        const rise = e.z - h0;
        rails.forEach((b, k) => {
          const bottom = 0.5 + (rise * k) / n;
          const dx = (k - (n - 1) / 2) * 0.8;
          b.set(local({ x: x0 + dx, y: m.home.y + 1.5, z: bottom }), local({ x: x0 + dx, y: m.home.y + 1.5, z: bottom + h0 + 8 }));
        });
      });
      return;
    }
    // piston lift: a cylinder from the deck to the effector
    const rod = bar(0xb9bec5, 0.6);
    root.add(rod.mesh);
    this.updates.push((v) => rod.set(local({ x: x0, y: m.home.y, z: 0.5 }), local(liftEffector(m, v(m)))));
  }

  /** Show what each holder has (from a game state snapshot). */
  setHeld(state: OverrideState | null): void {
    this.state = state;
    for (const c of this.claws) {
      c.stack.clear();
      const pieces = state?.held[c.spec.name] ?? [];
      if (pieces.length) c.stack.add(stackMeshes(pieces));
    }
    for (const [name, tray] of this.trays) {
      tray.clear();
      const pieces = state?.held[name] ?? [];
      if (pieces.length) tray.add(stackMeshes(pieces));
    }
    for (const i of this.intakes) {
      i.riding.clear();
      const byStart = new Map<number, Piece[]>();
      for (const p of state?.held[i.spec.name] ?? []) {
        const t0 = state?.transit?.[p.id]?.t0 ?? -1;
        byStart.set(t0, [...(byStart.get(t0) ?? []), p]);
      }
      i.groups = [...byStart.values()].map((ps) => ({ id: ps[0].id, mesh: stackMeshes(ps) }));
      for (const g of i.groups) i.riding.add(g.mesh);
    }
  }

  /**
   * Pose everything for the mechanisms' outputs at time `t` (ms), with the robot at `pose`
   * (needed to draw pieces coming in from the field).
   */
  update(valueOf: ValueOf, t = 0, pose: Pose = { x: 0, y: 0, theta: 0 }): void {
    for (const u of this.updates) u(valueOf);
    const state = this.state;
    for (const c of this.claws) this.poseClaw(c, valueOf, t, pose);
    for (const i of this.intakes) this.poseIntake(i, valueOf, t, pose, state);
  }

  private poseClaw(c: ClawVis, v: ValueOf, t: number, pose: Pose): void {
    const state = this.state;
    const e = local(clawEffector(this.profile, c.spec, v));
    c.pivot.position.copy(e);
    // a claw on a single-pivot arm pitches with the arm; a motor wrist turns it
    const lift = c.spec.lift ? this.profile.mechanisms.find((m): m is LiftSpec => m.kind === 'lift' && m.name === c.spec.lift) : undefined;
    let pitch = lift?.lift === 'arm' ? v(lift) * (lift.facing === 'rear' ? -1 : 1) : 0;
    const wrist = this.profile.mechanisms.find((m) => m.kind === 'wrist' && m.claw === c.spec.name);
    if (wrist && !wrist.adi) pitch += v(wrist) - (state?.flipped?.[c.spec.name] ? 180 : 0);
    c.pivot.rotation.set(pitch * DEG, 0, 0);
    c.stack.position.set(0, -(state?.grip[c.spec.name] ?? 0), 0);
    c.stack.quaternion.identity();
    // drawing in what it just closed on
    const tr = state?.transit?.[`claw:${c.spec.name}`];
    if (tr && t < tr.t1) {
      const k = ease(progress(tr, t));
      const start = c.pivot.worldToLocal(c.pivot.parent!.localToWorld(fromField(pose, tr.from.x, tr.from.y, tr.from.z)));
      c.stack.position.lerp(start, 1 - k);
      if (tr.lying !== undefined) c.stack.quaternion.copy(lyingQuat(pose, tr.lying)).slerp(new THREE.Quaternion(), k);
    }
  }

  private poseIntake(i: IntakeVis, v: ValueOf, t: number, pose: Pose, state: OverrideState | null): void {
    if (!i.groups.length) return;
    const curve = this.pathOf(i.spec, i.dest, v);
    const mouth = curve.getPoint(0);
    const end = curve.getPoint(1);
    // the ones that got there wait at the end (until the destination can take them)
    for (const { id, mesh } of i.groups) {
      const tr = state?.transit?.[id];
      mesh.quaternion.identity();
      if (!tr || t >= tr.t1) {
        mesh.position.copy(end);
        continue;
      }
      const capture = Math.min(CAPTURE_MS, (tr.t1 - tr.t0) * 0.4);
      const tc = t - tr.t0;
      if (tc < capture) {
        // lifted off the floor into the mouth, turning upright if it was lying
        const k = ease(Math.max(0, tc / capture));
        mesh.position.copy(fromField(pose, tr.from.x, tr.from.y, tr.from.z)).lerp(mouth, k);
        if (tr.lying !== undefined) mesh.quaternion.copy(lyingQuat(pose, tr.lying)).slerp(new THREE.Quaternion(), k);
        continue;
      }
      const s = (tc - capture) / Math.max(1, tr.t1 - tr.t0 - capture);
      mesh.position.copy(curve.getPoint(Math.min(1, s)));
    }
  }

  /** Mechanism kinds drawn here rather than by the generic roller / piston visuals. */
  static handles(m: MechanismSpec): boolean {
    return ['lift', 'claw', 'intake', 'staging', 'wrist', 'toggleTool'].includes(m.kind);
  }
}
