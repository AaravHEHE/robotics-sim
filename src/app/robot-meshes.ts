// The robot drawn from its profile alone (no 3D model of its own), built from the VEX parts
// kit as a team would CAD it: drilled C-channel drive rails and crossbars, omni wheels (a
// traction wheel in the middle of a 6-wheel drive) on axles at the real track width, the
// drive motors with their cartridge colors, the brain, battery and air tank, channel towers
// up to the real height, and team license plates. Game manipulators are drawn by
// ManipulatorVisuals (from the same parts). Shared by the field viewer and the robot
// editor's preview.

import * as THREE from 'three';
import type { MechanismSpec, RobotProfile } from '../sim/profile.ts';
import { ManipulatorVisuals } from './manipulator-meshes.ts';
import { partSize, type PartDef } from './parts/assembly.ts';
import { CATALOG, partDef } from './parts/catalog.ts';
import { centeredPart } from './parts/geometry.ts';

/** A mechanism's moving part, and its pose at rest (it is animated from there). */
export interface MechVisual {
  spec: MechanismSpec;
  object: THREE.Object3D;
  base: { rotation: THREE.Euler; position: THREE.Vector3 };
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const X = V(1, 0, 0);
const Y = V(0, 1, 0);
const Z = V(0, 0, 1);
/** Holes (0.5 in) for a length in inches, at least `min`. */
const holes = (inches: number, min = 2) => Math.max(min, Math.round(inches / 0.5));

/** The wheel part closest to the profile's wheels. */
function wheelPart(diameter: number, style: 'omni' | 'traction'): PartDef {
  const wheels = CATALOG.parts.filter((d) => d.kind === 'wheel' && d.style === style);
  return wheels.reduce((a, b) => (Math.abs((b.diameter ?? 0) - diameter) < Math.abs((a.diameter ?? 0) - diameter) ? b : a));
}

const licenseMat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.55 });

export function buildBoxRobot(p: RobotProfile): { group: THREE.Group; mechs: MechVisual[] } {
  const mechs: MechVisual[] = [];
  const g = new THREE.Group();
  // parts are placed in the robot frame (x right, y forward, z up, inches) inside `frame`
  const frame = new THREE.Group();
  frame.rotation.x = -Math.PI / 2;
  g.add(frame);
  const put = (id: string, opts: { length?: number; cartridge?: string }, center: THREE.Vector3, xDir: THREE.Vector3, yDir: THREE.Vector3) => {
    const o = centeredPart(partDef(id), opts, center, xDir, yDir);
    frame.add(o);
    return o;
  };

  const { width: W, length: L, height: H } = p.size;
  const d = p.drivetrain;
  const r = d.wheelDiameter / 2;
  const half = d.trackWidth / 2;
  const n = Math.max(2, Math.min(4, d.left.length));
  const omni = wheelPart(d.wheelDiameter, 'omni');
  const traction = wheelPart(d.wheelDiameter, 'traction');
  const ww = omni.width ?? 1;
  const wheelY = (i: number) => -L / 2 + r + 0.5 + (i * (L - 2 * r - 1)) / (n - 1);

  // ---- drive: rails either side of the wheels, axles, wheels, motors ----
  const railLen = holes(L - 0.5);
  const inner = half - ww / 2 - 0.4;
  const outer = half + ww / 2 + 0.4;
  const hasOuter = outer + 0.25 <= W / 2 + 0.05;
  for (const s of [-1, 1]) {
    // a 1×2×1 C-channel on its side (web up and down), flanges toward the inside of the drive
    put('c-channel-1x2x1', { length: railLen }, V(s * inner, 0, r), Y, Z.clone().multiplyScalar(s));
    if (hasOuter) put('c-channel-1x2x1', { length: railLen }, V(s * outer, 0, r), Y, Z.clone().multiplyScalar(-s));
    for (let i = 0; i < n; i++) {
      const y = wheelY(i);
      // a 6-wheel drive's middle wheel is a traction wheel (it keeps the robot from being pushed sideways)
      const wheel = n === 3 && i === 1 ? traction : omni;
      put(wheel.id, {}, V(s * half, y, r), X, Y);
      const a0 = inner - 0.3;
      const a1 = hasOuter ? outer + 0.35 : half + ww / 2 + 0.2;
      put('shaft', { length: holes(a1 - a0, 1) }, V((s * (a0 + a1)) / 2, y, r), X, Y);
    }
    // the drive motors on the inside of the rail, cartridge caps toward the wheels
    const motors = Math.max(1, d.left.length);
    const motorX = inner - 0.25 - 1.3;
    for (let k = 0; k < motors; k++) {
      const y = motors === 1 ? 0 : -L / 2 + 2 + (k * (L - 4)) / (motors - 1);
      if (motorX < 1.4) break; // no room inside a very narrow drive
      put('v5-motor', { cartridge: d.cartridge }, V(s * motorX, y, r + 0.1), X.clone().multiplyScalar(s), Y);
    }
  }
  // crossbars on top of the inner rails, flanges up
  const deckZ = r + 0.5 + 0.25;
  const crossLen = holes(2 * inner + 0.5);
  for (const y of [L / 2 - 0.9, -L / 2 + 0.9, -L * 0.12]) put('c-channel-1x2x1', { length: crossLen }, V(0, y, deckZ), X, Y);

  // ---- electronics and air ----
  const top = deckZ + 0.3;
  if (W >= 8 && L >= 10) {
    put('v5-brain', {}, V(0, -L * 0.13, top + 0.65), X, Y);
    put('v5-battery', {}, V(0, L * 0.22, top + 0.8), X, Y);
  }
  if (p.devices.some((x) => x.type === 'adi_digital_out') && W >= 9) put('air-tank', {}, V(0, -L / 2 + 1.6, top + 0.8 + 1.4), X, Y);

  // ---- towers up to the robot's height, braced across the top ----
  const towerH = H - deckZ - 0.5;
  if (towerH > 2) {
    const tx = W / 2 - 1.75;
    const ty = L * 0.2;
    for (const s of [-1, 1]) put('c-channel-1x2x1', { length: holes(towerH) }, V(s * tx, ty, deckZ + towerH / 2), Z, X);
    put('angle-1x1', { length: holes(2 * tx + 1) }, V(0, ty, H - 0.25), X, Y);
  }

  // ---- license plates front and back (they also show which way is front) ----
  for (const s of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(Math.min(8, W * 0.55), 0.08, 1.6), licenseMat(s > 0 ? 0xd8343a : 0xb2272c));
    plate.position.set(0, s * (L / 2 + 0.1), r + 0.6);
    frame.add(plate);
  }

  // ---- generic mechanisms (game manipulators are drawn by ManipulatorVisuals) ----
  let pistonSlot = 0;
  for (const m of p.mechanisms) {
    if (ManipulatorVisuals.handles(m)) continue;
    // these move in the robot group's own frame (three.js: x, up, -forward)
    const holder = new THREE.Group();
    if (m.kind === 'piston') {
      // a pneumatic cylinder pushing a drilled plate
      holder.add(centeredPart(partDef('plate-5'), { length: holes(W * 0.5) }, V(0, 0, 0), X, Y));
      holder.add(centeredPart(partDef('piston'), {}, V(0, 0, 2), Z, X));
      holder.position.set(0, r + 4 + pistonSlot * 3, -L / 2 + 1.2);
      pistonSlot++;
    } else {
      // a roller: flex wheels on a square shaft across the robot
      const span = W - 3;
      holder.add(centeredPart(partDef('shaft'), { length: holes(span) }, V(0, 0, 0), X, Y));
      const flex = partDef('flex-2');
      for (let x = -span / 2 + 0.5; x <= span / 2 - 0.5; x += 1) holder.add(centeredPart(flex, {}, V(x, 0, 0), X, Y));
      holder.position.set(0, r + 1.5, -L / 2 - 1.2);
    }
    g.add(holder);
    mechs.push({ spec: m, object: holder, base: { rotation: holder.rotation.clone(), position: holder.position.clone() } });
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return { group: g, mechs };
}

/** Size check for tests: the parts the chassis is made of fit the profile's box. */
export function chassisFits(p: RobotProfile): boolean {
  const { group } = buildBoxRobot(p);
  group.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(group);
  const s = b.getSize(new THREE.Vector3());
  const wheelW = partSize(wheelPart(p.drivetrain.wheelDiameter, 'omni'), {})[0];
  return s.x <= Math.max(p.size.width, p.drivetrain.trackWidth + wheelW) + 0.6 && s.y <= p.size.height + 0.6;
}
