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
import { baseOffset, clawEffector, liftEffector, liftPosition, toRobot, type Point3 } from '../sim/lift.ts';
import type { ClawSpec, IntakeSpec, LiftSpec, MechanismSpec, RobotProfile, StagingSpec } from '../sim/profile.ts';
import { cupMesh, pinMesh } from './override-meshes.ts';
import { partSize } from './parts/assembly.ts';
import { partDef } from './parts/catalog.ts';
import { centeredPart, partShape } from './parts/geometry.ts';

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

/**
 * A structural bar from a to b (robot-local three coordinates): a drilled VEX C-channel (or
 * `part`) cut to the nearest hole, rebuilt only when its length changes by a hole.
 */
function bar(part = 'c-channel-1x2x1'): { mesh: THREE.Group; set(a: THREE.Vector3, b: THREE.Vector3): void } {
  const mesh = new THREE.Group();
  const def = partDef(part);
  let built = -1;
  return {
    mesh,
    set(a, b) {
      const len = Math.max(0.5, a.distanceTo(b));
      const holes = Math.max(2, Math.round(len / 0.5));
      if (holes !== built) {
        mesh.clear();
        const shape = partShape(def, { length: holes });
        const [, w, h] = partSize(def, { length: holes });
        // along the bar from a, centered across it
        shape.position.set((len - holes * 0.5) / 2, -w / 2, -h / 2);
        mesh.add(shape);
        built = holes;
      }
      const dir = b.clone().sub(a).normalize();
      // keep the channel's web facing sideways (across the robot) where it can
      const side = Math.abs(dir.x) > 0.95 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      const across = side.sub(dir.clone().multiplyScalar(side.dot(dir))).normalize();
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, across, dir.clone().cross(across)));
      mesh.position.copy(a);
    },
  };
}

/** A piston rod from a to b: a cylinder stretched to fit (it really does slide). */
function rodBar(): { mesh: THREE.Mesh; set(a: THREE.Vector3, b: THREE.Vector3): void } {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 16).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc9cdd2, metalness: 0.7, roughness: 0.3 }));
  return {
    mesh,
    set(a, b) {
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.scale.set(1, 1, Math.max(0.01, a.distanceTo(b)));
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

/**
 * A roller as teams build them: flex wheels on a square shaft, spinning about the robot's x
 * axis (or y with `upright`). `radius` picks the flex wheel (2 or 3 in).
 */
function roller(length: number, radius: number, _color?: number, upright = false): THREE.Group {
  const spin = new THREE.Group();
  const axis = upright ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const across = upright ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  spin.add(centeredPart(partDef('shaft'), { length: Math.max(2, Math.round((length + 1) / 0.5)) }, new THREE.Vector3(), axis, across));
  const flex = partDef(radius >= 1.2 ? 'flex-3' : 'flex-2');
  const n = Math.max(1, Math.floor(length / 1.1));
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0 : -length / 2 + 0.5 + (k * (length - 1)) / (n - 1);
    spin.add(centeredPart(flex, {}, axis.clone().multiplyScalar(t), axis, across));
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
          // two 1×1 angle fingers, 2.5 in long, either side of the mouth
          const fingers = [-1, 1].map((side) => {
            const f = centeredPart(partDef('angle-1x1'), { length: 5 }, new THREE.Vector3(), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, side));
            pivot.add(f);
            return { f, side };
          });
          // the piston (or motor) that closes them, across the back
          const closer = m.grip === 'piston' ? centeredPart(partDef('piston'), {}, new THREE.Vector3(0, 1.4, 1.2), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)) : centeredPart(partDef('exp-motor'), { cartridge: 'green' }, new THREE.Vector3(0, 1.6, 1.4), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1));
          pivot.add(closer);
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
          // a 2.5 in wide drilled plate on standoffs
          const tray = centeredPart(partDef('plate-5'), { length: 8 }, holder.position.clone().add(new THREE.Vector3(0, -0.1, 0)), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1));
          root.add(tray);
          for (const dx of [-1.6, 1.6]) {
            const post = centeredPart(partDef('standoff'), { length: Math.max(1, Math.round(m.at.z / 0.5)) }, holder.position.clone().add(new THREE.Vector3(dx, -m.at.z / 2, 0)), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));
            root.add(post);
          }
        }
      }
      if (m.kind === 'toggleTool' && boxes) {
        const h = m.top - m.bottom;
        const at = local({ x: m.box.x, y: m.box.y, z: m.bottom + h / 2 });
        const box = new THREE.Group();
        if (m.tool === 'roller') {
          box.add(roller(m.box.width, Math.min(1.5, h / 2)));
        } else if (m.tool === 'jammer') {
          // a C-channel wedge on a piston
          box.add(centeredPart(partDef('c-channel-1x2x1'), { length: Math.max(2, Math.round(m.box.length / 0.5)) }, new THREE.Vector3(), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)));
        } else {
          // a drilled plate at Toggle height, with a black rubber strip where it hits
          box.add(centeredPart(partDef('plate-5'), { length: Math.max(2, Math.round(m.box.width / 0.5)) }, new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)));
          const pad = new THREE.Mesh(new THREE.BoxGeometry(m.box.width, Math.min(h, 1), 0.25), new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.95 }));
          pad.position.z = -0.15;
          box.add(pad);
          // standoffs back to the robot
          for (const dx of [-m.box.width / 2 + 0.5, m.box.width / 2 - 0.5]) {
            box.add(centeredPart(partDef('standoff'), { length: 2 }, new THREE.Vector3(dx, -h / 2 + 0.3, 0.6), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
          }
        }
        box.position.copy(at);
        root.add(box);
        if (m.tool === 'plate' || m.tool === 'jammer') {
          // retracted, the plate sits back toward the robot's center (front or rear plate)
          const inward = m.box.y >= 0 ? 1 : -1;
          this.updates.push((v) => {
            const out = v(m) >= 0.5;
            box.position.copy(at).add(new THREE.Vector3(0, 0, out ? 0 : inward * (m.box.length + 1)));
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
    if (spec.handoff) return local({ x: spec.handoff.x ?? 0, y: spec.handoff.y, z: spec.handoff.z });
    if (dest?.kind === 'staging') return local({ x: dest.at.x ?? 0, y: dest.at.y, z: dest.at.z });
    if (dest?.kind === 'claw') return local(clawEffector(this.profile, dest, v));
    return local({ x: spec.zone.x, y: spec.zone.y - spec.zone.length / 2 - 2, z: 0.5 });
  }

  private lift(m: LiftSpec, root: THREE.Group): void {
    const L = m.length ?? 0;
    const a0 = (m.startAngle ?? 0) * DEG;
    const out = m.facing === 'rear' ? -1 : 1;
    const x0 = m.home.x ?? 0;
    if (m.lift === 'arm' || m.lift === 'fourbar' || m.lift === 'sixbar' || m.lift === 'chainbar') {
      // bars from a pivot to the end effector (a 6-bar's second stage drawn as one). A chain bar
      // pivots on its base lift's carriage and rides up with it; the others on a fixed tower.
      const pivot0 = local({ x: x0, y: m.home.y - out * L * Math.cos(a0), z: m.home.z - (m.lift === 'sixbar' ? 2 : 1) * L * Math.sin(a0) });
      if (!m.base) {
        const tower = bar();
        root.add(tower.mesh);
        tower.set(new THREE.Vector3(pivot0.x, 0.5, pivot0.z), pivot0);
      }
      const chain = m.lift === 'chainbar';
      const bars = (chain ? [-2.2, 2.2] : [-1.5, 1.5]).map(() => bar());
      for (const b of bars) root.add(b.mesh);
      // a chain bar's sprocket at the pivot
      // the pivot: a 60-tooth gear driving the bars (a 36-tooth sprocket-style gear on a chain bar)
      const hub = new THREE.Group();
      hub.add(centeredPart(partDef(chain ? 'gear-36' : 'gear-60'), {}, new THREE.Vector3(-(chain ? 2.6 : 1.9), 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)));
      hub.add(centeredPart(partDef('shaft'), { length: chain ? 12 : 9 }, new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)));
      hub.position.copy(pivot0);
      root.add(hub);
      this.updates.push((v) => {
        const pivot = pivot0.clone().add(local(baseOffset(this.profile, m, v)));
        const e = local(liftPosition(this.profile, m, v));
        hub.position.copy(pivot);
        bars.forEach((b, i) => {
          const off = chain ? 2.2 : 1.5; // either side of the claw
          const dx = new THREE.Vector3(i ? off : -off, 0, 0);
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
      const tower = bar();
      root.add(tower.mesh);
      tower.set(local({ x: x0, y: yb, z: 0.5 }), local({ x: x0, y: yb, z: baseZ }));
      const stages = [-1.5, 1.5].map((dx) => ({ dx, lower: bar(), upper: bar() }));
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
      // each stage a C-channel slide (1×3×1 for the outer stage)
      const rails = Array.from({ length: n }, (_, k) => bar(k ? 'c-channel-1x2x1' : 'c-channel-1x3x1'));
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
    const rod = rodBar();
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
