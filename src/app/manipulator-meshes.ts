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

import type { OverrideState, Transit } from '../games/override/state.ts';
import { baseOffset, clawEffector, clawPitch, liftEffector, liftPosition, toRobot, type Point3 } from '../sim/lift.ts';
import { isMotorized, type ClawSpec, type IntakeSpec, type LiftSpec, type MechanismSpec, type RobotProfile, type StagingSpec, type ToggleToolSpec, type WristSpec } from '../sim/profile.ts';
import { cupMesh, pinMesh } from './override-meshes.ts';
import { mergeRigid } from './parts/batch.ts';
import { Kit, WALL } from './parts/fasteners.ts';
import { buildClaw, CLAW_HALF, type ClawBuild } from './claw-meshes.ts';
import { chassisLayout, holes, liftPivot, type ChassisLayout } from './chassis-layout.ts';

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

/** A piston rod (or, thin, a string) from a to b: a cylinder stretched to fit. */
function rodBar(radius = 0.35, color = 0xc9cdd2): { mesh: THREE.Mesh; set(a: THREE.Vector3, b: THREE.Vector3): void } {
  const metal = color === 0xc9cdd2;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, metal ? 16 : 6).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color, metalness: metal ? 0.7 : 0, roughness: metal ? 0.3 : 0.9 }));
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

/** Robot-frame point (x right, y forward, z up) -> the robot group's three.js frame. */
const toThree = (p: THREE.Vector3) => new THREE.Vector3(p.x, p.z, -p.y);

/**
 * A roller as teams build them: flex wheels on a square shaft, spinning about the robot's x
 * axis (or its vertical axis with `upright`). `radius` picks the flex wheel (2 or 3 in).
 */
function rollerGroup(length: number, radius: number, upright = false): THREE.Group {
  const spin = new THREE.Group();
  spin.userData.moving = true;
  const k = new Kit(spin);
  const axis = upright ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const across = upright ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  k.part('shaft', new THREE.Vector3(), axis, across, { length: Math.max(2, Math.round((length + 1) / 0.5)) });
  const flex = radius >= 1.2 ? 'flex-3' : 'flex-2';
  const n = Math.max(1, Math.floor(length / 1.1));
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : -length / 2 + 0.5 + (i * (length - 1)) / (n - 1);
    k.part(flex, axis.clone().multiplyScalar(t), axis, across);
  }
  spin.userData.rigid = true;
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

/** Gear pairs (small, big) for a lift's ratio (output / motor), from VEX's gears. */
const GEARS = [12, 36, 48, 60, 72, 84];
function gearPair(ratio: number): [number, number] | null {
  if (Math.abs(ratio - 1) < 0.05) return null;
  let best: [number, number] = [12, 60];
  for (const a of GEARS) for (const b of GEARS) if (a < b && Math.abs(a / b - ratio) < Math.abs(best[0] / best[1] - ratio)) best = [a, b];
  return best;
}
/** Centre distance of two meshing gears (in): their pitch radii, teeth / 48 each. */
const meshDistance = ([a, b]: [number, number]) => (a + b) / 48;

/** A group whose frame is the robot's (x right, y forward, z up), inside a group in three's robot frame (x, up, -forward). */
function robotFrame(parent: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  g.rotation.x = -Math.PI / 2;
  parent.add(g);
  return g;
}
const R = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const RX = R(1, 0, 0);
const RY = R(0, 1, 0);
const RZ = R(0, 0, 1);
/** Fourbar and six-bar bars: the second, parallel bar is this far above the first (in). */
const PARALLEL = 2;

/**
 * A lift bar: a C-channel from joint a to joint b that turns as one piece, with what is
 * fastened to it. Its own frame: x along it from a, y across its web, z sideways, out of the
 * robot (its web is at z 0 to WALL, its flanges out to z 0.5).
 */
interface Link {
  group: THREE.Group;
  kit: Kit;
  set(a: THREE.Vector3, b: THREE.Vector3): void;
}

/** Merge each moving part's meshes once built (off for tests that check each part). */
let mergeParts = true;

function makeLink(root: THREE.Object3D, side: number, length: number, extras: (kit: Kit, len: number) => void = () => {}): Link {
  const group = new THREE.Group();
  group.userData.moving = true;
  root.add(group);
  const kit = new Kit(group);
  let built = -1;
  const build = (len: number) => {
    group.clear();
    kit.part('c-channel-1x2x1', R(len / 2, 0, 0.25), RX, RY, { length: holes(len + 0.5) });
    // a collar on the shaft at each joint, in the channel's trough
    kit.collar(R(0, 0, WALL), RZ);
    kit.collar(R(len, 0, WALL), RZ);
    extras(kit, len);
    if (mergeParts) mergeRigid(group);
    built = len;
  };
  build(length);
  const out = new THREE.Vector3(side, 0, 0);
  return {
    group,
    kit,
    set(a, b) {
      const len = a.distanceTo(b);
      if (Math.abs(len - built) > 0.25) build(len);
      const dir = b.clone().sub(a).normalize();
      const y = out.clone().cross(dir).normalize();
      group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, y, out));
      group.position.copy(a);
    },
  };
}

interface ClawVis {
  spec: ClawSpec;
  /** At the grip point; turns with the arm / wrist. */
  pivot: THREE.Group;
  /** The held stack, its bottom `grip` below the grip point. */
  stack: THREE.Group;
  /** The jaws (box robots), posed for the claw's actuator and what it holds. */
  build?: ClawBuild;
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
  private readonly lay: ChassisLayout;
  /** Parts fixed to the drive base (robot frame). */
  private readonly fixed: Kit;
  /** Where each lift's bars run, their inner face (|x|), and the part a claw on it hangs from. */
  private readonly barX = new Map<string, number>();
  /** Posts standing at the front and back of the drive base, for Toggle tools (built once each). */
  private readonly posts = new Map<number, { x: number; face: number; top: number }>();

  /** `boxes`: draw mechanisms (box robot); otherwise only held pieces (GLB models). */
  constructor(profile: RobotProfile, root: THREE.Group, boxes: boolean, opts: { merge?: boolean } = {}) {
    this.profile = profile;
    mergeParts = opts.merge !== false;
    this.lay = chassisLayout(profile);
    const fixedFrame = robotFrame(root);
    this.fixed = new Kit(fixedFrame);
    // lifts first: claws and wrists hang on them
    if (boxes) for (const m of profile.mechanisms) if (m.kind === 'lift') this.lift(m, root);
    for (const m of profile.mechanisms) {
      if (m.kind === 'claw') {
        const pivot = new THREE.Group();
        pivot.userData.moving = true;
        pivot.userData.rigid = true;
        const stack = new THREE.Group();
        stack.userData.piece = true;
        stack.userData.moving = true; // (kept out of merging: what the claw holds goes in here)
        pivot.add(stack);
        root.add(pivot);
        const vis: ClawVis = { spec: m, pivot, stack };
        this.claws.push(vis);
        if (boxes) this.claw(vis, m, pivot, root);
      }
      if (m.kind === 'intake') {
        const riding = new THREE.Group();
        riding.userData.piece = true;
        root.add(riding);
        const dest = (m.into ? profile.mechanisms.find((x) => x.name === m.into) : null) as ClawSpec | StagingSpec | null;
        this.intakes.push({ spec: m, riding, groups: [], dest });
        if (boxes) this.intake(m, dest, root);
      }
      if (m.kind === 'staging') {
        const holder = new THREE.Group();
        holder.userData.piece = true;
        holder.position.copy(local({ x: m.at.x ?? 0, y: m.at.y, z: m.at.z }));
        root.add(holder);
        this.trays.set(m.name, holder);
        if (boxes) this.staging(m);
      }
      if (m.kind === 'toggleTool' && boxes) this.toggleTool(m, root);
    }
    if (boxes && opts.merge !== false) {
      mergeRigid(fixedFrame);
      const rigid: THREE.Object3D[] = [];
      root.traverse((o) => {
        if (o.userData.rigid) rigid.push(o);
      });
      for (const o of rigid) mergeRigid(o);
    }
  }

  // ---------------- the drive base's mounting points ----------------

  /**
   * A tower on each inner drive rail at y, up to `top`: a C-channel standing on the rail's top
   * flange (on a crossbar's flanges, if one is there), web outward, gusseted and bolted to it.
   */
  private towers(y: number, top: number): void {
    const { inner, railTop, deckTop, crossbars } = this.lay;
    const onCross = Object.values(crossbars).some((c) => c !== null && Math.abs(c - y) < 1);
    const base = onCross ? deckTop : railTop;
    const len = holes(top - base);
    for (const s of [-1, 1]) {
      this.fixed.part('c-channel-1x2x1', R(s * inner, y, base + (len * 0.5) / 2), RZ, RY.clone().multiplyScalar(s), { length: len });
      // a gusset on its front flange, bolted down to what it stands on and to the tower
      this.fixed.gusset(R(s * inner, y + 0.5, base), RY, RZ);
      this.fixed.screw(R(s * inner, y + 1.0, base + WALL), RZ.clone().negate(), 2 * WALL);
      this.fixed.screw(R(s * inner, y + 0.5 + WALL, base + 0.75), RY.clone().negate(), 2 * WALL);
    }
    // braced across, near the top, by a 1×1 angle bolted to both towers' rear flanges
    const bz = base + len * 0.5 - 1.25;
    this.fixed.part('angle-1x1', R(0, y - 0.5 - 0.25, bz), RX, RY.clone().negate(), { length: holes(2 * inner + 0.5) });
    for (const s of [-1, 1]) this.fixed.screw(R(s * inner, y - 0.5 - WALL, bz), RY, 2 * WALL);
  }

  /**
   * The motor that drives a pivot at (y, z) on a tower: inside the tower, below the pivot (or
   * above it when `above`), its shaft through the tower to a gear meshing with the pivot's gear.
   * Returns the pivot gear's teeth (null: the motor drives the pivot directly).
   */
  private towerMotor(s: number, y: number, z: number, ratio: number, above = false): number | null {
    const { inner } = this.lay;
    const ti = inner + 0.25; // the tower web's outer face
    const pair = gearPair(ratio);
    const mz = pair ? z + (above ? 1 : -1) * meshDistance(pair) : z;
    const [ml] = this.fixed.size('v5-motor');
    const out = RX.clone().multiplyScalar(s);
    this.fixed.part('v5-motor', R(s * (ti - WALL - ml / 2), y, mz), out, RY);
    for (const dz of [-0.5, 0.5]) this.fixed.screw(R(s * ti, y + 0.25, mz + dz), out.clone().negate(), WALL, null, 0.2);
    this.cableToBrain(R(s * (ti - WALL - ml), y, mz));
    if (!pair) return null;
    // the motor's shaft out through the tower: a bearing, a spacer, the small gear, a collar
    this.fixed.bearing(R(s * ti, y, mz), out, RZ);
    this.fixed.spacers(R(s * (ti + 0.153), y, mz), out, 0.03);
    this.fixed.part(`gear-${pair[0]}`, R(s * (ti + 0.283), y, mz), RX, RY);
    this.fixed.collar(R(s * (ti + 0.383), y, mz), out);
    this.fixed.shaft(R(s * (ti - WALL - 0.3), y, mz), R(s * (ti + 0.383 + 0.35), y, mz));
    return pair[1];
  }

  /** A Smart Cable from a motor's port (robot frame) over the deck to the brain. */
  private cableToBrain(port: THREE.Vector3): void {
    const b = this.lay.brain;
    if (!b) return;
    const s = Math.sign(port.x) || 1;
    const side = R(s * (b.size[0] / 2), b.y + Math.max(-1.6, Math.min(1.6, (port.y - b.y) * 0.3)), b.z);
    const mid = R(s * (b.size[0] / 2 + 0.7), (port.y + b.y) / 2, Math.max(this.lay.deckTop + 0.4, (port.z + b.z) / 2));
    this.fixed.cable([port, port.clone().add(R(-s * 0.3, 0, 0.2)), mid, side]);
  }

  /** The static half of a pivot on a tower: its bearing, and spacers out to the bar or gear. */
  private pivotBearing(s: number, y: number, z: number, gap = 0.23): void {
    const ti = this.lay.inner + 0.25;
    const out = RX.clone().multiplyScalar(s);
    this.fixed.bearing(R(s * ti, y, z), out, RZ);
    this.fixed.spacers(R(s * (ti + 0.153), y, z), out, gap);
    // the shaft: from inside the tower (a collar there) out through the bar
    this.fixed.collar(R(s * (this.lay.inner - 0.25), y, z), out.clone().negate());
    this.fixed.shaft(R(s * (this.lay.inner - 0.25 - 0.3 - 0.05), y, z), R(s * (ti + 0.383 + 0.5), y, z));
  }

  // ---------------- lifts ----------------

  private lift(m: LiftSpec, root: THREE.Group): void {
    const L = m.length ?? 0;
    const out = m.facing === 'rear' ? -1 : 1;
    const ti = this.lay.inner + 0.25;
    /** The bars' inner face (|x|): outside the towers, past the bearing and the pivot gear. */
    const bx = ti + 0.383;
    this.barX.set(m.name, bx);
    const motors = m.motors?.length ?? 0;
    const ratio = m.ratio ?? 1;
    const at = (y: number, z: number, s: number) => toThree(R(s * bx, y, z));
    const pv = liftPivot(this.profile, m);
    if (m.lift === 'arm' || m.lift === 'fourbar' || m.lift === 'sixbar' || (m.lift === 'chainbar' && pv)) {
      const p0 = pv!;
      const four = m.lift === 'fourbar' || m.lift === 'sixbar';
      const top = p0.z + (four ? PARALLEL + 0.75 : 0.75);
      this.towers(p0.y, top);
      const sides = [-1, 1];
      const gears = sides.map((s, i) => (i < Math.max(1, motors) && motors ? this.towerMotor(s, p0.y, p0.z, ratio / (m.lift === 'sixbar' ? 1 : 1), four && false) : null));
      for (const s of sides) {
        this.pivotBearing(s, p0.y, p0.z, gears[sides.indexOf(s)] ? 0.03 : 0.23);
        if (four) this.pivotBearing(s, p0.y, p0.z + PARALLEL);
      }
      const gearOn = (s: number) => (kit: Kit) => {
        const t = gears[sides.indexOf(s)];
        if (!t) return;
        // the pivot gear, screwed to the bar's web
        kit.part(`gear-${t}`, R(0, 0, -0.1), RZ, RX);
        for (const x of [-0.75, 0.75]) kit.screw(R(x, 0, WALL), RZ.clone().negate(), WALL + 0.2, null, 0.05);
      };
      if (m.lift === 'sixbar') {
        // two 4-bar stages: the first from the tower to a middle link, the second from it to the end
        const st1 = sides.map((s) => [makeLink(root, s, L, gearOn(s)), makeLink(root, s, L)]);
        const st2 = sides.map((s) => [makeLink(root, s, L), makeLink(root, s, L)]);
        const mids = sides.map((s) => this.coupler(root, s, bx));
        const ends = sides.map((s) => this.coupler(root, s, bx));
        this.updates.push((v) => {
          const e = liftPosition(this.profile, m, v);
          // the middle joint: L from the pivot and L from the end, folding back toward the robot
          const dy = e.y - p0.y;
          const dz = e.z - p0.z;
          const d = Math.hypot(dy, dz);
          const h = Math.sqrt(Math.max(0, L * L - (d / 2) ** 2));
          const mid = { y: p0.y + dy / 2 + (dz / d) * h * out, z: p0.z + dz / 2 - (dy / d) * h * out };
          sides.forEach((s, i) => {
            st1[i][0].set(at(p0.y, p0.z, s), at(mid.y, mid.z, s));
            st1[i][1].set(at(p0.y, p0.z + PARALLEL, s), at(mid.y, mid.z + PARALLEL, s));
            st2[i][0].set(at(mid.y, mid.z, s), at(e.y, e.z, s));
            st2[i][1].set(at(mid.y, mid.z + PARALLEL, s), at(e.y, e.z + PARALLEL, s));
            mids[i].position.copy(toThree(R(0, mid.y, mid.z)));
            ends[i].position.copy(toThree(R(0, e.y, e.z)));
          });
        });
        return;
      }
      const lower = sides.map((s) => makeLink(root, s, L, gearOn(s)));
      const upper = four ? sides.map((s) => makeLink(root, s, L)) : [];
      const ends = four ? sides.map((s) => this.coupler(root, s, bx)) : [];
      // an arm's two bars are joined at the end by a crossbar under the claw
      const cross = !four ? this.armCross(root, bx) : null;
      this.updates.push((v) => {
        const base = baseOffset(this.profile, m, v);
        const e = liftPosition(this.profile, m, v);
        const py = p0.y + base.y;
        const pz = p0.z + base.z;
        sides.forEach((s, i) => {
          lower[i].set(at(py, pz, s), at(e.y, e.z, s));
          if (four) {
            upper[i].set(at(py, pz + PARALLEL, s), at(e.y, e.z + PARALLEL, s));
            ends[i].position.copy(toThree(R(0, e.y, e.z)));
          }
        });
        if (cross) {
          cross.position.copy(toThree(R(0, e.y, e.z)));
          cross.quaternion.copy(lower[1].group.quaternion);
        }
      });
      return;
    }
    if (m.lift === 'chainbar') {
      this.chainBar(m, root, bx);
      return;
    }
    if (m.lift === 'dr4b') {
      this.dr4b(m, root, pv!, bx);
      return;
    }
    if (m.lift === 'cascade') {
      this.cascade(m, root);
      return;
    }
    // piston lift: a cylinder standing on a crossbar, its rod up to the effector
    const x0 = m.home.x ?? 0;
    this.fixed.part('piston', R(x0, m.home.y, this.lay.deckTop + 1.75), RZ, RX);
    const rod = rodBar(0.12);
    root.add(rod.mesh);
    rod.mesh.userData.part = 'piston rod';
    rod.mesh.userData.moving = true;
    this.updates.push((v) => rod.set(local({ x: x0, y: m.home.y, z: this.lay.deckTop + 3.5 }), local(liftEffector(m, v(m)))));
  }

  /**
   * The link at the end of a 4-bar's bars (one side): a short C-channel standing between the
   * two bars' ends, screwed to both; it stays upright as the bars swing. Its origin is at the
   * lower joint (robot frame y, z; x 0).
   */
  private coupler(root: THREE.Object3D, s: number, bx: number): THREE.Group {
    const g = new THREE.Group();
    g.userData.moving = true;
    g.userData.rigid = true;
    root.add(g);
    const k = new Kit(robotFrame(g));
    const len = holes(PARALLEL + 0.5);
    k.part('c-channel-1x2x1', R(s * (bx - 0.25), 0, PARALLEL / 2), RZ, RY.clone().multiplyScalar(s), { length: len });
    // a screw joint at each bar: shoulder screw through the bar and the link, a nylock nut inside
    for (const z of [0, PARALLEL]) k.screw(R(s * (bx + WALL), 0, z), RX.clone().multiplyScalar(-s), 2 * WALL, 'nut-nylock');
    return g;
  }

  /** A crossbar joining an arm's two bars at their ends (it turns with them). */
  private armCross(root: THREE.Object3D, bx: number): THREE.Group {
    const g = new THREE.Group();
    g.userData.moving = true;
    g.userData.rigid = true;
    root.add(g);
    // in the bars' own frame (x along them, y across, z sideways out of the robot = +x three for
    // the right bar): a channel across, behind the joint, screwed to both bars
    const k = new Kit(g);
    k.part('c-channel-1x2x1', R(-1.25, 0, 0), RZ, RY, { length: holes(2 * bx) });
    for (const s of [-1, 1]) k.screw(R(-1.25, 0.25, s * (bx + WALL)), RZ.clone().multiplyScalar(-s), 2 * WALL);
    return g;
  }

  /**
   * A chain bar riding a cascade's carriage: its pivot shaft runs across through the top
   * stage, a sprocket on it driven by chain from a motor on the carriage's crossbar; a fixed
   * sprocket at the pivot and chain along each bar to a sprocket at the claw keep the claw level.
   */
  private chainBar(m: LiftSpec, root: THREE.Group, bx: number): void {
    const L = m.length ?? 0;
    const a0 = ((m.startAngle ?? 0) * Math.PI) / 180;
    const p0 = { y: m.home.y - L * Math.cos(a0), z: m.home.z - L * Math.sin(a0) };
    const ti = this.lay.inner + 0.25;
    const pd18 = 0.25 / Math.sin(Math.PI / 18);
    // the carriage: what rides the top stage with the pivot
    const carriage = new THREE.Group();
    carriage.userData.moving = true;
    carriage.userData.rigid = true;
    root.add(carriage);
    const k = new Kit(robotFrame(carriage));
    for (const s of [-1, 1]) {
      const out = RX.clone().multiplyScalar(s);
      k.bearing(R(s * ti, 0, 0), out, RZ);
      k.spacers(R(s * (ti + 0.153), 0, 0), out, 0.03);
      // the fixed sprocket the level chain runs on, screwed to the stage
      k.part('sprocket-18', R(s * (ti + 0.25), 0, 0), RX, RY);
    }
    k.shaft(R(-(bx + 0.6), 0, 0), R(bx + 0.6, 0, 0));
    // the crossbar behind the top stages carrying the chain bar's motor, its chain to the shaft
    const cy = -1.25;
    const cz = -0.25;
    k.part('c-channel-1x2x1', R(0, cy, cz), RX, RY, { length: holes(2 * ti) });
    for (const s of [-1, 1]) k.part('l-bracket', R(s * (this.lay.inner - 0.5), cy + 0.75, cz + 0.4), RY, RX.clone().multiplyScalar(-s), { length: 2 });
    const [ml, mw, mh] = k.size('v5-motor');
    k.part('v5-motor', R(1.6, cy, cz + 0.25 + mh / 2 + 0.05), RX.clone().negate(), RY);
    void mw;
    const pd12 = 0.25 / Math.sin(Math.PI / 12);
    const sx = 1.6 - ml / 2 - 0.25;
    k.part('sprocket-12', R(sx, cy, cz + 0.3 + mh / 2), RX, RY);
    k.part('sprocket-36', R(sx, 0, 0), RX, RY);
    for (const sgn of [-1, 1]) {
      const a = R(sx, cy, cz + 0.3 + mh / 2 + (sgn * pd12) / 2);
      const b = R(sx, 0, (sgn * (0.25 / Math.sin(Math.PI / 36))) / 2);
      k.part('chain-25', a.clone().add(b).multiplyScalar(0.5), b.clone().sub(a).normalize(), RX, { length: Math.round(a.distanceTo(b) / 0.25) });
    }
    const sides = [-1, 1];
    const bars = sides.map((s) =>
      makeLink(root, s, L, (kit, len) => {
        // the level chain along the bar, on its inner side
        for (const y of [-pd18 / 2, pd18 / 2]) kit.part('chain-25', R(len / 2, y, -0.25), RX, RZ, { length: Math.round(len / 0.25) });
      }),
    );
    this.updates.push((v) => {
      const base = baseOffset(this.profile, m, v);
      const e = liftPosition(this.profile, m, v);
      const py = p0.y + base.y;
      const pz = p0.z + base.z;
      carriage.position.copy(toThree(R(0, py, pz)));
      sides.forEach((s, i) => bars[i].set(toThree(R(s * bx, py, pz)), toThree(R(s * bx, e.y, e.z))));
    });
  }

  /**
   * A double reverse 4-bar: its fixed stage pivots at the top of towers at the end of the
   * drive base; the lower bars swing out toward the robot's center to an elbow, the upper bars
   * back in to the carriage, which goes straight up and down below the pivots; from the carriage
   * two arms reach out to the claw. Crossed rubber bands at the elbows take the lift's weight.
   */
  private dr4b(m: LiftSpec, root: THREE.Group, p0: { y: number; z: number }, bx: number): void {
    const L = m.length ?? 0;
    const a0 = ((m.startAngle ?? 0) * Math.PI) / 180;
    const inward = m.home.y >= 0 ? -1 : 1;
    const motors = m.motors?.length ?? 0;
    this.towers(p0.y, p0.z + 0.75);
    const gears = [-1, 1].map((s, i) => (i < motors ? this.towerMotor(s, p0.y, p0.z, m.ratio ?? 1) : null));
    for (const [i, s] of [-1, 1].entries()) this.pivotBearing(s, p0.y, p0.z, gears[i] ? 0.03 : 0.23);
    const sides = [-1, 1];
    const lower = sides.map((s, i) =>
      makeLink(root, s, L, (kit) => {
        if (!gears[i]) return;
        kit.part(`gear-${gears[i]}`, R(0, 0, -0.1), RZ, RX);
        for (const x of [-0.75, 0.75]) kit.screw(R(x, 0, WALL), RZ.clone().negate(), WALL + 0.2, null, 0.05);
      }),
    );
    const upper = sides.map((s) =>
      makeLink(root, s, L, (kit, len) => {
        // the elbow joint: the lower bar just outside this one, a spacer between their webs'
        // planes, a screw through both and a nylock nut inside this one
        kit.spacers(R(0, 0, 0.5), RZ, 0.25);
        kit.screw(R(0, 0, 0.75 + WALL), RZ.clone().negate(), 0.75 + WALL, 'nut-nylock');
        // crossed rubber bands from the elbow up the bar
        kit.part('rubber-band-64', R(len * 0.3, 0, 0.55), RZ, RX);
      }),
    );
    // the carriage: a crossbar across under the pivots, and arms out to the claw
    const carriage = new THREE.Group();
    carriage.userData.moving = true;
    carriage.userData.rigid = true;
    root.add(carriage);
    const k = new Kit(robotFrame(carriage));
    const reach = m.home.y - p0.y; // from the carriage out to the claw
    for (const s of sides) {
      // each arm: a C-channel from the upper bar's joint out to over the claw
      k.part('c-channel-1x2x1', R(s * (bx - 0.25), reach / 2, -0.5), RY, RZ, { length: holes(Math.abs(reach) + 1) });
      k.screw(R(s * (bx + WALL), 0, -0.25), RX.clone().multiplyScalar(-s), 2 * WALL, 'nut-nylock');
    }
    k.part('c-channel-1x2x1', R(0, 0, -1.25), RX, RY, { length: holes(2 * bx) });
    for (const s of sides) k.part('l-bracket', R(s * (bx - 0.5), 0, -0.85), RY, RX.clone().multiplyScalar(-s), { length: 2 });
    this.updates.push((v) => {
      const a = a0 + v(m) * DEG;
      const elbow = { y: p0.y + inward * L * Math.cos(a), z: p0.z + L * Math.sin(a) };
      const top = { y: p0.y, z: p0.z + 2 * L * Math.sin(a) };
      sides.forEach((s, i) => {
        // the lower bars outside the upper ones: they cross at the elbow
        lower[i].set(toThree(R(s * (bx + 0.25 + 0.5), p0.y, p0.z)), toThree(R(s * (bx + 0.75), elbow.y, elbow.z)));
        upper[i].set(toThree(R(s * bx, elbow.y, elbow.z)), toThree(R(s * bx, top.y, top.z)));
      });
      carriage.position.copy(toThree(R(0, top.y, top.z)));
    });
  }

  /**
   * A cascade lift: nested C-channel stages on each side, the fixed one standing on a crossbar,
   * each next one outside the last on nylon slide blocks; string from a motor-driven spool
   * behind them up over a pulley at the top of each stage and down to the bottom of the next.
   */
  private cascade(m: LiftSpec, root: THREE.Group): void {
    const n = (m.stages ?? 1) + 1;
    const { inner, deckTop } = this.lay;
    const y0 = m.home.y;
    const xs = Array.from({ length: n }, (_, k) => inner - (n - 1 - k) * 0.6);
    const S = Math.max(4, this.profile.size.height - deckTop - 0.5);
    const len = holes(S);
    const sides = [-1, 1];
    // the fixed stages, gusseted to the crossbar they stand on
    for (const s of sides) {
      this.fixed.part('c-channel-1x2x1', R(s * xs[0], y0, deckTop + (len * 0.5) / 2), RZ, RY.clone().multiplyScalar(s), { length: len });
      this.fixed.gusset(R(s * xs[0], y0 + 0.5, deckTop), RY, RZ);
      this.fixed.screw(R(s * xs[0], y0 + 1.0, deckTop + WALL), RZ.clone().negate(), 2 * WALL);
    }
    // the moving stages (each rises its share of the carriage's travel)
    const stages = Array.from({ length: n - 1 }, (_, i) => {
      const k = i + 1;
      const g = new THREE.Group();
      g.userData.moving = true;
      g.userData.rigid = true;
      root.add(g);
      const kit = new Kit(robotFrame(g));
      for (const s of sides) {
        kit.part('c-channel-1x2x1', R(s * xs[k], y0, deckTop + (len * 0.5) / 2), RZ, RY.clone().multiplyScalar(s), { length: len });
        // slide blocks: nylon spacers between this stage's web and the one inside it, top and bottom
        for (const z of [deckTop + 0.75, deckTop + len * 0.5 - 0.75]) {
          kit.spacers(R(s * (xs[k - 1] + 0.25), y0, z), RX.clone().multiplyScalar(s), xs[k] + 0.25 - WALL - (xs[k - 1] + 0.25));
        }
      }
      return g;
    });
    // the spool shaft behind the stages, on plates bolted to the fixed stages; a motor on each
    const sy = y0 - 1.8;
    const sz = deckTop + 2.2;
    const pair = gearPair(m.ratio ?? 1);
    for (const [i, s] of sides.entries()) {
      const px = s * (xs[0] + 0.25 + WALL / 2);
      this.fixed.part('plate-2', R(px, y0 - 1.25, sz), RY, RZ, { length: 5 });
      this.fixed.screw(R(px + s * WALL, y0 - 0.25, sz), RX.clone().multiplyScalar(-s), 2 * WALL);
      if (i < (m.motors?.length ?? 0)) {
        const mz = sz + (pair ? meshDistance(pair) : 0);
        const out = RX.clone().multiplyScalar(s);
        const [ml] = this.fixed.size('v5-motor');
        this.fixed.part('v5-motor', R(px + s * (WALL / 2 + ml / 2), sy, mz), out.clone().negate(), RY);
        this.cableToBrain(R(px + s * (WALL / 2 + ml), sy, mz));
        if (pair) {
          this.fixed.part(`gear-${pair[0]}`, R(px - s * 0.2, sy, mz), RX, RY);
          this.fixed.part(`gear-${pair[1]}`, R(px - s * 0.2, sy, sz), RX, RY);
          this.fixed.shaft(R(px + s * 0.5, sy, mz), R(px - s * 0.45, sy, mz));
        }
      }
      // the spool for this side's string
      this.fixed.part('spool', R(s * (xs[0] - 0.5), sy, sz), RX, RY);
    }
    this.fixed.shaft(R(-(xs[0] + 0.7), sy, sz), R(xs[0] + 0.7, sy, sz));
    for (const s of sides) this.fixed.collar(R(s * (xs[0] + 0.25 + WALL), sy, sz), RX.clone().multiplyScalar(s));
    // pulleys at the top of each stage, on short shafts out of its rear flange, and the string
    const pulleys = sides.map((s) =>
      xs.slice(0, n - 1).map((x, k) => {
        const g = new THREE.Group();
        g.userData.moving = true;
        g.userData.rigid = true;
        root.add(g);
        const kit = new Kit(robotFrame(g));
        kit.part('pulley-1', R(s * x, -0.75, 0), RY, RX);
        kit.shaft(R(s * x, -0.45, 0), R(s * x, -1.05, 0));
        kit.collar(R(s * x, -0.95, 0), RY.clone().negate());
        void k;
        return g;
      }),
    );
    const strings = sides.map(() => Array.from({ length: n }, () => rodBar(0.04, 0xe8e4d8)));
    for (const list of strings) for (const st of list) {
      st.mesh.userData.part = 'string';
      st.mesh.userData.moving = true;
      root.add(st.mesh);
    }
    const h0 = m.home.z;
    this.updates.push((v) => {
      const rise = liftEffector(m, v(m)).z - h0;
      stages.forEach((g, i) => g.position.set(0, (rise * (i + 1)) / (n - 1), 0));
      sides.forEach((s, si) => {
        const tops = xs.map((_, k) => deckTop + len * 0.5 - 0.6 + (rise * k) / (n - 1));
        pulleys[si].forEach((g, k) => g.position.copy(toThree(R(0, y0, tops[k]))));
        // spool up to the first pulley, then each pulley down to the next stage's bottom
        strings[si][0].set(toThree(R(s * (xs[0] - 0.5), sy, sz + 0.6)), toThree(R(s * (xs[0] - 0.5), y0 - 0.75, tops[0])));
        for (let k = 1; k < n; k++) {
          const bottom = deckTop + 0.4 + (rise * k) / (n - 1);
          strings[si][k].set(toThree(R(s * (xs[k - 1] + 0.5), y0 - 0.75, tops[k - 1])), toThree(R(s * (xs[k - 1] + 0.5), y0 - 0.55, bottom)));
        }
      });
    });
  }

  // ---------------- claws and wrists ----------------

  /**
   * A claw, built around its grip point (`pivot`, which turns with the arm or wrist): side
   * plates joined by a back plate; fingers on arms sliding along the back plate, closed by a
   * piston (or motor) on standoffs behind it, or two upright rollers between plates; and a
   * shaft out of each side plate through a bearing into the lift's bars.
   */
  private claw(c: ClawVis, m: ClawSpec, pivot: THREE.Group, root: THREE.Group): void {
    const lift = m.lift ? this.profile.mechanisms.find((x) => x.kind === 'lift' && x.name === m.lift) : undefined;
    // a claw on a lift (or at a point) ahead of the robot's center faces forward
    const front = (lift && lift.kind === 'lift' ? lift.home.y : (m.at?.y ?? 1)) >= 0;
    const { build, kit: k } = buildClaw(m, pivot, front);
    c.build = build;
    // the shafts out to the lift's bars (or the carriage's arms), through bearings
    const bx = lift ? (this.barX.get(lift.name) ?? null) : null;
    if (bx !== null) {
      for (const s of [-1, 1]) {
        const out = RX.clone().multiplyScalar(s);
        k.bearing(R(s * CLAW_HALF, 0, 0), out, RY);
        k.collar(R(s * (CLAW_HALF - WALL), 0, 0), out.clone().negate());
        k.spacers(R(s * (CLAW_HALF + 0.153), 0, 0), out, Math.max(0, bx - 0.5 - (CLAW_HALF + 0.153)));
        k.shaft(R(s * (CLAW_HALF - WALL - 0.35), 0, 0), R(s * (bx + 0.6), 0, 0));
      }
      this.wrist(m, k, root, bx);
    }
  }

  /**
   * A motor wrist: its gear on the claw's shaft outside the right bar, and the motor driving it
   * through a small gear, fixed to the end of the lift (it moves with the lift, not the claw).
   */
  private wrist(m: ClawSpec, clawKit: Kit, root: THREE.Group, bx: number): void {
    const w = this.profile.mechanisms.find((x): x is WristSpec => x.kind === 'wrist' && x.claw === m.name);
    if (!w || !isMotorized(w)) return;
    const pair = gearPair(w.ratio ?? 1) ?? [36, 36];
    const gx = bx + 0.5 + 0.13;
    clawKit.part(`gear-${pair[1]}`, R(gx, 0, 0), RX, RY);
    const mount = new THREE.Group();
    mount.userData.moving = true;
    mount.userData.rigid = true;
    root.add(mount);
    const k = new Kit(robotFrame(mount));
    const d = meshDistance(pair);
    const [ml] = k.size('exp-motor');
    k.part('exp-motor', R(gx + 0.15 + ml / 2, 0, -d), RX.clone().negate(), RY);
    k.part(`gear-${pair[0]}`, R(gx, 0, -d), RX, RY);
    k.shaft(R(gx - 0.2, 0, -d), R(gx + 0.5, 0, -d));
    // two standoffs from the bar's flange to the motor's face
    for (const dy of [-0.5, 0.5]) k.standoff(R(bx + 0.5, dy, -d - 0.5), R(gx + 0.15, dy, -d - 0.5), false);
    const lift = this.profile.mechanisms.find((x): x is LiftSpec => x.kind === 'lift' && x.name === m.lift);
    this.updates.push((v) => {
      const e = clawEffector(this.profile, m, v);
      mount.position.copy(local(e));
      // it turns with an arm (it is fixed to the arm's end), not with the wrist
      const pitch = lift?.lift === 'arm' ? v(lift) * (lift.facing === 'rear' ? -1 : 1) : 0;
      mount.rotation.set(pitch * DEG, 0, 0);
    });
  }

  // ---------------- intakes, staging, Toggle tools ----------------

  /**
   * Posts at the front (`end` 1) or back (-1) of the drive base, for what is mounted out
   * there: C-channels standing against the end crossbar's outer flange, bolted to it, braced.
   */
  private post(end: number, top: number): { x: number; face: number } {
    const have = this.posts.get(end);
    const { railTop, deck, crossHalf, railHalf } = this.lay;
    const x = Math.min(crossHalf - 0.5, 4.5);
    const face = railHalf; // the end crossbar's outer face (y, unsigned)
    if (have && have.top >= top) return { x, face };
    if (have) {
      // already built lower: a taller one replaces it (only before anything is mounted)
    }
    const bottom = railTop - 0.75;
    const len = holes(top - bottom);
    for (const s of [-1, 1]) {
      this.fixed.part('c-channel-1x2x1', R(s * x, end * (face + 0.25), bottom + (len * 0.5) / 2), RZ, RX.clone().multiplyScalar(end), { length: len });
      this.fixed.screw(R(s * x, end * (face + WALL), deck + 0.25), RY.clone().multiplyScalar(-end), 2 * WALL);
    }
    this.posts.set(end, { x, face, top: bottom + len * 0.5 });
    return { x, face };
  }

  private intake(m: IntakeSpec, dest: ClawSpec | StagingSpec | null, root: THREE.Group): void {
    const { deckTop, crossbars } = this.lay;
    const w = m.zone.width;
    const ry = m.zone.y + m.zone.length / 2 - 1;
    const rz = 1.5;
    const ax = w / 2 + 0.6; // the side arms (|x|)
    const pd = 0.25 / Math.sin(Math.PI / 12);
    // the roller at the mouth: flex wheels on a shaft, sprocket at its right end
    const front = rollerGroup(w, 1);
    front.userData.intake = true;
    front.position.copy(local({ x: m.zone.x, y: ry, z: rz }));
    root.add(front);
    new Kit(robotFrame(front)).part('sprocket-12', R(ax - 0.25, 0, 0), RX, RY);
    // side arms: flat plates from the front crossbar's top down to the roller, bearings and collars
    const cy = crossbars.front;
    for (const s of [-1, 1]) {
      const a = R(s * ax, cy - 0.25, deckTop + 0.25);
      const bpt = R(s * ax, ry, rz);
      const dir = bpt.clone().sub(a).normalize();
      this.fixed.part('plate-2', a.clone().add(bpt).multiplyScalar(0.5).add(dir.clone().multiplyScalar(0.25)), dir, RX.clone().cross(dir), { length: holes(a.distanceTo(bpt) + 1) });
      this.fixed.part('l-bracket', R(s * (ax - 0.25 - WALL), cy - 0.25, deckTop + 0.25), RY, RX.clone().multiplyScalar(-s), { length: 2 });
      this.fixed.bearing(R(s * (ax + WALL / 2), ry, rz), RX.clone().multiplyScalar(s), RY);
      this.fixed.collar(R(s * (ax + WALL / 2 + 0.153), ry, rz), RX.clone().multiplyScalar(s));
    }
    // the motor on the right arm near the crossbar, chain down to the roller
    const my = cy + 0.75;
    const mz = deckTop + 1.25;
    const [ml] = this.fixed.size('v5-motor');
    this.fixed.part('v5-motor', R(ax + WALL / 2 + ml / 2, my, mz), RX.clone().negate(), RY);
    this.cableToBrain(R(ax + WALL / 2 + ml, my, mz));
    this.fixed.part('sprocket-12', R(ax - 0.25, my, mz), RX, RY);
    this.fixed.shaft(R(ax - 0.5, my, mz), R(ax + 0.3, my, mz));
    for (const sgn of [-1, 1]) {
      const p = R(ax - 0.25, my, mz + (sgn * pd) / 2);
      const q = R(ax - 0.25, ry, rz + (sgn * pd) / 2);
      this.fixed.part('chain-25', p.clone().add(q).multiplyScalar(0.5), q.clone().sub(p).normalize(), RX, { length: Math.round(p.distanceTo(q) / 0.25) });
    }
    const spinners = [front];
    if (dest) {
      // the roller that carries pieces over the deck, just above the path's high point
      const top = rollerGroup(w * 0.8, 0.8);
      top.userData.intake = true;
      top.position.copy(this.pathOf(m, dest, () => 0).getPoint(0.5)).add(new THREE.Vector3(0, CUP_HEIGHT + 1, 0));
      root.add(top);
      spinners.push(top);
      const ty = -top.position.z;
      const tz = top.position.y;
      const tw = (w * 0.8) / 2;
      if (ty > this.lay.railHalf - 0.5) {
        // carried out front: plates forward from the posts there
        const p = this.post(1, tz + 1);
        for (const s of [-1, 1]) {
          const px = s * (p.x + 0.5 + WALL / 2);
          this.fixed.part('plate-2', R(px, (p.face + ty + 0.5) / 2, tz), RY, RZ, { length: holes(ty + 0.5 - p.face + 0.5) });
          this.fixed.screw(R(px + s * WALL / 2, p.face + 0.25, tz), RX.clone().multiplyScalar(-s), 2 * WALL);
          this.fixed.collar(R(px + s * WALL / 2, ty, tz), RX.clone().multiplyScalar(s));
        }
        new Kit(robotFrame(top)).shaft(R(-(p.x + 0.9), 0, 0), R(p.x + 0.9, 0, 0));
      } else {
        // over the robot: towers on the rails
        this.towers(ty, tz + 0.75);
        for (const s of [-1, 1]) this.pivotBearing(s, ty, tz, 0);
        new Kit(robotFrame(top)).shaft(R(-(this.lay.inner + 0.6), 0, 0), R(this.lay.inner + 0.6, 0, 0));
      }
      void tw;
    }
    for (const s of spinners) s.userData.moving = true;
    this.updates.push((v) => spinners.forEach((s) => (s.rotation.x = -v(m) * DEG * VISUAL_SPIN)));
  }

  /** A staging tray: a drilled plate on standoffs down to the crossbar under it. */
  private staging(m: StagingSpec): void {
    const at = R(m.at.x ?? 0, m.at.y, m.at.z);
    this.fixed.part('plate-5', at.clone().add(R(0, 0, -WALL / 2)), RX, RY, { length: 8 });
    for (const dx of [-1.5, 1.5]) this.fixed.standoff(R(at.x + dx, at.y, this.lay.deck), R(at.x + dx, at.y, at.z - WALL));
  }

  private toggleTool(m: ToggleToolSpec, root: THREE.Group): void {
    const end = m.box.y >= 0 ? 1 : -1;
    const h = m.top - m.bottom;
    const zc = m.bottom + h / 2;
    const moving = m.tool === 'plate' || m.tool === 'jammer';
    // a plate pushed by a piston slides over its posts: they stop below it
    const p = this.post(end, moving ? m.bottom - 0.6 : m.top + 0.25);
    const fy = end * p.face; // the end crossbar's outer face
    const box = new THREE.Group();
    box.userData.moving = true;
    box.userData.rigid = m.tool !== 'roller';
    const at = local({ x: m.box.x, y: m.box.y, z: zc });
    box.position.copy(at);
    root.add(box);
    const k = new Kit(robotFrame(box));
    const bx = m.box.x;
    const by = m.box.y;
    if (m.tool === 'roller') {
      // flex wheels on a shaft through bearings in the posts' flanges, a motor outside one post
      box.add(rollerGroup(m.box.width, Math.min(1.5, h / 2)));
      const y = fy + end * 0.25;
      box.position.copy(local({ x: 0, y, z: zc }));
      k.shaft(R(-(p.x + 0.9), 0, 0), R(p.x + 0.9, 0, 0));
      for (const s of [-1, 1]) {
        this.fixed.bearing(R(s * (p.x + 0.5), y, zc), RX.clone().multiplyScalar(s), RY);
        this.fixed.collar(R(s * (p.x + 0.653), y, zc), RX.clone().multiplyScalar(s));
      }
      const [ml] = this.fixed.size('v5-motor');
      this.fixed.part('v5-motor', R(p.x + 0.95 + ml / 2, y, zc), RX.clone().negate(), RY);
      this.updates.push((v) => (box.rotation.x = -v(m) * DEG * VISUAL_SPIN));
      return;
    }
    if (m.tool === 'bumper') {
      // a drilled plate across the posts' flanges, on standoffs inside them, a rubber strip in front
      box.position.copy(local({ x: 0, y: 0, z: 0 }));
      const py = fy + end * (0.5 + WALL / 2);
      k.part('plate-5', R(bx, py, zc), RX, RZ, { length: holes(m.box.width) });
      for (const s of [-1, 1]) this.fixed.standoff(R(s * p.x, fy + end * WALL, zc), R(s * p.x, fy + end * 0.5, zc));
      const pad = new THREE.Mesh(new THREE.BoxGeometry(m.box.width, Math.min(h, 1), 0.25), new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.95 }));
      pad.position.copy(local({ x: bx, y: py + end * (WALL / 2 + 0.125), z: zc }));
      pad.userData.part = 'bumper pad';
      box.add(pad);
      box.userData.moving = false;
      return;
    }
    // a plate (or a jammer's C-channel wedge) on a piston's rod: the cylinder lies on a crossbar
    // across the posts' tops, its rod reaching up to the plate
    const braceZ = this.posts.get(end)!.top;
    this.fixed.part('angle-1x1', R(0, fy + end * 0.25, braceZ + 0.25), RX, RY, { length: holes(2 * p.x + 0.5) });
    const [pl, pd] = this.fixed.size('piston');
    const cx = m.tool === 'jammer' ? bx : 0;
    const cyl = R(cx, fy + end * (0.5 - pl / 2), braceZ + 0.5 + pd / 2);
    this.fixed.part('piston', cyl, RY, RX);
    this.fixed.screw(R(cx, fy + end * 0.25, braceZ + 0.5 + WALL), RZ.clone().negate(), 2 * WALL);
    const rodEnd = cyl.y + end * (pl / 2);
    // what moves, in the box's frame (centred on the tool)
    if (m.tool === 'plate') {
      k.part('plate-5', R(0, 0, 0), RX, RZ, { length: holes(m.box.width) });
      const pad = new THREE.Mesh(new THREE.BoxGeometry(m.box.width, Math.min(h, 1), 0.25), new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.95 }));
      pad.position.set(0, 0, -end * (WALL / 2 + 0.125));
      pad.userData.part = 'bumper pad';
      box.add(pad);
    } else {
      k.part('c-channel-1x2x1', R(0, 0, 0), RY, RZ, { length: holes(m.box.length) });
    }
    // the rod from the cylinder out to the tool, and a bracket up to it
    const rodLocal = R(cx - bx, rodEnd - by, cyl.z - zc);
    const toolBack = R(cx - bx, -end * (m.tool === 'plate' ? WALL / 2 : m.box.length / 2), cyl.z - zc);
    k.standoff(rodLocal, toolBack.clone().setZ(cyl.z - zc), false);
    k.standoff(toolBack.clone().setZ(cyl.z - zc), toolBack.clone().setZ(-h / 2 + 0.1), false);
    const inward = m.box.y >= 0 ? 1 : -1;
    this.updates.push((v) => {
      const out = v(m) >= 0.5;
      // retracted, it sits back toward the robot's center
      box.position.copy(at).add(new THREE.Vector3(0, 0, out ? 0 : inward * (m.box.length + 1)));
    });
    void moving;
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
    // a claw on a single-pivot arm pitches with the arm; a motor wrist turns it (as the simulator has it)
    const pitch = clawPitch(this.profile, c.spec, v, !!state?.flipped?.[c.spec.name]);
    c.pivot.rotation.set(pitch * DEG, 0, 0);
    c.build?.update(v(c.spec), state?.held[c.spec.name] ?? [], state?.grip[c.spec.name] ?? 0);
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
