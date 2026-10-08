// The claws, drawn as mechanisms that really hold a piece: jaws on hinges that turn until
// their pads touch what the claw holds, driven by what drives the claw.
//
//  - piston and motor claws are "lobster" claws: each jaw is a curved finger on a bell-crank
//    that swings on a hinge screw; a piston (or a motor on a screw) pushes the two cranks'
//    tails apart, which closes the fingers;
//  - roller claws have two swing arms, each carrying a roller of flex wheels with its own
//    motor, that press on the stack from either side.
//
// A jaw's angle is worked out from the radius of the held stack at the grip height
// (claw-geometry.ts), so closed on a Pin or a Cup it stops with its pad against it, and
// opening lets go. All in the claw's frame (x right, y ahead, z up, the stack's axis at the
// origin); a rear-facing claw is the same turned half a circle.

import * as THREE from 'three';
import { type Piece } from '../games/override/elements.ts';
import type { ClawSpec } from '../sim/profile.ts';
import { jawContact, rot2, stackRadiusAt, type JawDef } from './claw-geometry.ts';
import { shared } from './override-meshes.ts';
import { Kit, WALL } from './parts/fasteners.ts';

type V2 = [number, number];
const R = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const RX = R(1, 0, 0);
const RY = R(0, 1, 0);
const RZ = R(0, 0, 1);
const DEG = Math.PI / 180;

/** Half the width between the side plates (in). */
export const CLAW_HALF = 3.3;
/** The back wall, and how far the side plates reach (y). */
const WALL_Y = -4.4;
/** How wide an open claw holds its jaws, and how far a motor claw's screw turns the same way. */
const VISUAL_SPIN = 0.12;

const mats = new Map<string, THREE.Material>();
function mat(key: string, color: number, metal: number, rough: number): THREE.Material {
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, side: THREE.DoubleSide });
    shared.add(m);
    mats.set(key, m);
  }
  return m;
}
const alu = () => mat('claw-alu', 0xbfc4cb, 0.6, 0.4);
const rubber = () => mat('claw-rubber', 0x1d1f23, 0, 0.95);
const steel = () => mat('claw-steel', 0x9aa0a6, 0.8, 0.3);

/** A band along an arc (radii r0..r1 about `c`, angles a0..a1 rad), `height` tall, centred on z = 0. */
function arcBand(c: V2, r0: number, r1: number, a0: number, a1: number, height: number, side: number, m: THREE.Material, part: string): THREE.Mesh {
  const pt = (r: number, a: number): V2 => [c[0] + r * Math.cos(a) * side, c[1] + r * Math.sin(a)];
  const shape = new THREE.Shape();
  const n = 18;
  shape.moveTo(...pt(r1, a0));
  for (let k = 1; k <= n; k++) shape.lineTo(...pt(r1, a0 + ((a1 - a0) * k) / n));
  for (let k = n; k >= 0; k--) shape.lineTo(...pt(r0, a0 + ((a1 - a0) * k) / n));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geo.translate(0, 0, -height / 2);
  shared.add(geo);
  const mesh = new THREE.Mesh(geo, m);
  mesh.userData.part = part;
  mesh.castShadow = true;
  return mesh;
}

/** A thin cylinder along x of unit length, scaled to run between two points of its frame. */
function line(radius: number, m: THREE.Material, part: string): { mesh: THREE.Mesh; set(a: THREE.Vector3, b: THREE.Vector3): void } {
  const geo = new THREE.CylinderGeometry(radius, radius, 1, 10).rotateZ(Math.PI / 2);
  shared.add(geo);
  const mesh = new THREE.Mesh(geo, m);
  mesh.userData.part = part;
  return {
    mesh,
    set(a, b) {
      const d = b.clone().sub(a);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.scale.set(Math.max(0.01, d.length()), 1, 1);
      mesh.quaternion.setFromUnitVectors(RX, d.normalize());
    },
  };
}

type Mover = (v: number, held: Piece[], grip: number) => void;

export interface ClawBuild {
  /** Pose the jaws for the claw's actuator output `v` and what it holds (`grip` in above its bottom). */
  update(v: number, held: Piece[], grip: number): void;
}

/** 0 = open, 1 = closed, from the claw's actuator output. */
export function closedness(m: ClawSpec, v: number): number {
  if (m.grip === 'piston') return (m.closedWhen ?? 'extended') === 'extended' ? v : 1 - v;
  if (m.grip === 'motor') {
    const at = m.closedAt ?? 0;
    return at === 0 ? (v >= 0 ? 1 : 0) : Math.max(0, Math.min(1, v / at));
  }
  return 0;
}

const group = (parent: THREE.Object3D, moving = false, rigid = false): THREE.Group => {
  const g = new THREE.Group();
  if (moving) g.userData.moving = true;
  if (rigid) g.userData.rigid = true;
  parent.add(g);
  return g;
};

/** The same shapes as a bar from a to b (claw frame), flat in the plane z, laid on a kit. */
function flatBar(kit: Kit, a: V2, b: V2, z: number, id = 'bar'): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 0.05) return;
  const dir = R(dx / len, dy / len, 0);
  kit.part(id, R((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z), dir, R(-dir.y, dir.x, 0), { length: Math.max(2, Math.round(len / 0.5)) });
}

/**
 * Build a claw into `pivot` (a group in the robot's own frame at the claw's grip point).
 * `front`: whether it faces the front of the robot (else the back).
 */
export function buildClaw(spec: ClawSpec, pivot: THREE.Group, front: boolean): { build: ClawBuild; kit: Kit } {
  // the claw's own frame is the robot's (x right, y ahead, z up) inside the pivot (three: y up)
  const robot = group(pivot);
  robot.rotation.x = -Math.PI / 2;
  const base = new Kit(robot);
  const face = group(robot, false, true);
  face.rotation.z = front ? 0 : Math.PI;
  const k = new Kit(face);
  const roller = spec.grip === 'roller';
  // ---- the frame: side plates joined by a back wall ----
  for (const s of [-1, 1]) k.part('plate-5', R(s * (CLAW_HALF - WALL / 2), (WALL_Y + 0.5) / 2, 0), RY, RZ, { length: Math.round((0.5 - WALL_Y) / 0.5) });
  k.part('plate-5', R(0, WALL_Y, 0), RX, RZ, { length: Math.round((2 * CLAW_HALF - 0.1) / 0.5) });
  const movers: Mover[] = [];
  if (roller) rollerClaw(spec, face, k, movers);
  else lobsterClaw(spec, face, k, movers);
  const build: ClawBuild = { update: (v, held, grip) => movers.forEach((f) => f(v, held, grip)) };
  return { build, kit: base };
}

// ---------------- lobster claw (piston or motor) ----------------

/** The right jaw, open: where it hinges, where the arc its pad lies on is centred, and its tail pin. */
const LOBSTER: JawDef & { tail: V2 } = {
  hinge: [3.0, -1.0],
  pad: [0.9, 1.37],
  padR: 1.7,
  outer: false,
  // opened 14° out from the reference: the pads are 0.9 in clear of a Pin's collar
  open: -0.25,
  maxClose: 0.95,
  tail: [1.6, -2.8],
};

function lobsterClaw(spec: ClawSpec, face: THREE.Group, k: Kit, movers: Mover[]): void {
  const J = LOBSTER;
  const motor = spec.grip === 'motor';
  const jaws = [-1, 1].map((side) => {
    const H: V2 = [side * J.hinge[0], J.hinge[1]];
    const g = group(face, true, true);
    g.position.set(H[0], H[1], 0);
    const jk = new Kit(g);
    const rel = (p: V2): V2 => [side * (p[0] - J.hinge[0]), p[1] - J.hinge[1]];
    const c = rel(J.pad);
    // the finger: a curved plate around the piece, with a rubber pad on its inside
    const a0 = -70 * DEG;
    const a1 = 12 * DEG;
    g.add(arcBand(c, J.padR + 0.12, J.padR + 0.4, a0, a1, 1.6, side, alu(), 'claw finger'));
    g.add(arcBand(c, J.padR, J.padR + 0.12, a0 + 8 * DEG, a1 - 4 * DEG, 1.4, side, rubber(), 'claw pad'));
    // the bell-crank: a bar from the hinge to the finger's rear end, and a tail behind, in two layers
    const rear: V2 = [c[0] + (J.padR + 0.25) * Math.cos(a0) * side, c[1] + (J.padR + 0.25) * Math.sin(a0)];
    const tail = rel(J.tail);
    for (const z of [-0.75, 0.75]) {
      flatBar(jk, [0, 0], rear, z);
      flatBar(jk, [0, 0], tail, z);
    }
    // the hinge: a standoff between the layers, nylon spacers up to the plates the screw holds
    jk.standoff(R(0, 0, -0.75), R(0, 0, 0.75), false);
    jk.standoff(R(rear[0], rear[1], -0.75), R(rear[0], rear[1], 0.75), false);
    jk.standoff(R(tail[0], tail[1], -0.75), R(tail[0], tail[1], 0.75), false);
    for (const z of [-1, 1]) jk.spacers(R(0, 0, z * 0.78), R(0, 0, z), 0.375);
    // plates the hinges are screwed to, either side, up and down
    for (const z of [-1, 1]) {
      k.part('plate-2', R(side * 2.55, H[1], z * 1.19), RX, RY, { length: 3 });
      k.screw(R(H[0], H[1], z * 1.22), R(0, 0, -z), 0.5, null, 0.25);
    }
    return { side, g };
  });
  // ---- the actuator between the two tails ----
  const act = group(face, true);
  const body = group(act, false, true);
  const ak = new Kit(body);
  const bodyLen = motor ? 1.9 : 2.5; // an actuator's body starts right at its pin
  if (motor) ak.part('exp-motor', R(bodyLen / 2, 0, 0), RX, RY);
  else ak.part('piston-25', R(bodyLen / 2, 0, 0), RX, RY);
  const rod = line(motor ? 0.07 : 0.12, steel(), motor ? 'screw' : 'piston rod');
  act.add(rod.mesh);
  movers.push((v, held, grip) => {
    const r = stackRadiusAt(held, grip);
    const theta = J.open + (jawContact(J, r) - J.open) * closedness(spec, v);
    for (const { side, g } of jaws) g.rotation.z = side * theta;
    // the right jaw's tail pin (the left is its mirror image): the actuator runs between them
    const [tx, ty] = rot2([J.tail[0] - J.hinge[0], J.tail[1] - J.hinge[1]], theta);
    const rx = J.hinge[0] + tx;
    const ry = J.hinge[1] + ty;
    const left = R(-rx, ry, 0);
    const d = R(rx, ry, 0).sub(left);
    act.position.copy(left);
    act.quaternion.setFromUnitVectors(RX, d.clone().normalize());
    rod.set(R(bodyLen, 0, 0), R(d.length(), 0, 0));
  });
}

// ---------------- roller claw ----------------

const ROLLER: JawDef = {
  hinge: [3.0, -1.6],
  pad: [2.85, 0.45],
  padR: 1.0,
  outer: true,
  open: -0.12,
  maxClose: 0.6,
};

/** Where a roller's motor sits (the right jaw's frame, open): behind the frame's corner, beyond the stack. */
const MOTOR: V2 = [1.5, -3.3];

function rollerClaw(spec: ClawSpec, face: THREE.Group, k: Kit, movers: Mover[]): void {
  const J = ROLLER;
  const arms = [-1, 1].map((side) => {
    const H: V2 = [side * J.hinge[0], J.hinge[1]];
    const g = group(face, true, true);
    g.position.set(H[0], H[1], 0);
    const jk = new Kit(g);
    const rel = (p: V2): V2 => [side * (p[0] - J.hinge[0]), p[1] - J.hinge[1]];
    const c = rel(J.pad);
    // two bars from the hinge to the roller's shaft, above and below the wheels
    for (const z of [-0.95, 0.95]) flatBar(jk, [0, 0], c, z, 'plate-2');
    jk.standoff(R(0, 0, -0.95), R(0, 0, 0.95), false);
    for (const z of [-1, 1]) jk.spacers(R(0, 0, z * 0.98), R(0, 0, z), 0.125);
    for (const z of [-1, 1]) {
      k.part('plate-2', R(side * 2.55, H[1], z * 1.137), RX, RY, { length: 3 });
      k.screw(R(H[0], H[1], z * 1.17), R(0, 0, -z), 0.31, null, 0.25);
    }
    // the roller: flex wheels on a vertical shaft through both bars, a collar outside each
    const spin = group(g, true, true);
    spin.position.set(c[0], c[1], 0);
    const sk = new Kit(spin);
    sk.part('shaft', R(0, 0, 0), RZ, RX, { length: 6 });
    for (const z of [-0.5, 0.5]) sk.part('flex-2', R(0, 0, z), RZ, RX);
    sk.spacers(R(0, 0, -0.92), RZ, 0.12);
    sk.spacers(R(0, 0, -0.2), RZ, 0.4);
    sk.spacers(R(0, 0, 0.8), RZ, 0.12);
    for (const z of [-1, 1]) sk.collar(R(0, 0, z * 0.985), R(0, 0, z));
    // its motor behind it, over the frame's back corner (clear of what the rollers hold, however
    // high up it they grip), output down to a sprocket; chain to the roller's
    const m = rel(MOTOR);
    flatBar(jk, [0, 0], m, 0.95, 'plate-2');
    for (const dx of [-0.5, 0.5]) jk.standoff(R(m[0] + dx, m[1], 0.95), R(m[0] + dx, m[1], 1.5), false);
    jk.part('v5-motor', R(m[0], m[1], 1.5 + 1.25), R(0, 0, -1), RX, { cartridge: 'green' });
    for (const dx of [-0.5, 0.5]) jk.screw(R(m[0] + dx, m[1] - 0.5, 0.98), RZ, 0.6, null, 0.4);
    jk.part('sprocket-12', R(m[0], m[1], 1.25), RZ, RX);
    sk.part('sprocket-12', R(0, 0, 1.25), RZ, RX);
    sk.collar(R(0, 0, 1.5), R(0, 0, 1));
    const pd = 0.25 / Math.sin(Math.PI / 12);
    const dir = R(c[0] - m[0], c[1] - m[1], 0);
    const span = dir.length();
    dir.normalize();
    const across = R(-dir.y, dir.x, 0);
    for (const sgn of [-1, 1]) {
      const mid = R((c[0] + m[0]) / 2, (c[1] + m[1]) / 2, 1.25).add(across.clone().multiplyScalar((sgn * pd) / 2));
      jk.part('chain-25', mid, dir, RZ, { length: Math.round(span / 0.25) });
    }
    return { side, g, spin };
  });
  movers.push((v, held, grip) => {
    const r = stackRadiusAt(held, grip);
    // nothing in the claw: it rests open; holding something, the rollers press on it
    const theta = held.length ? jawContact(J, r) : J.open;
    for (const { side, g, spin } of arms) {
      g.rotation.z = side * theta;
      spin.rotation.z = -side * v * DEG * VISUAL_SPIN;
    }
  });
  void k;
}
