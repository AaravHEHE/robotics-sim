// The robot drawn from its profile alone (no 3D model of its own), built from the VEX parts
// kit the way a team would build it, so nothing floats: drilled C-channel drive rails either
// side of the wheels, joined by standoffs; each wheel on a shaft through bearing flats with
// spacers filling the gaps and collars at the ends, driven by a motor screwed to the inside
// of the rail; crossbars bolted across the rails; the brain on standoffs, the battery
// zip-tied down, the air tank clamped, Smart Cables and air tubing run to them, towers
// gusseted to the rails, and license plates screwed to the crossbars. Game manipulators are
// drawn by ManipulatorVisuals (from the same parts, on the same frame: see chassisLayout).
// Shared by the field viewer and the robot editor's preview.

import * as THREE from 'three';
import { isPneumatic, type MechanismSpec, type RobotProfile } from '../sim/profile.ts';
import { ManipulatorVisuals } from './manipulator-meshes.ts';
import { partSize } from './parts/assembly.ts';
import { mergeRigid } from './parts/batch.ts';
import { partDef } from './parts/catalog.ts';
import { chassisLayout, holes, wheelPart } from './chassis-layout.ts';
import { Kit, WALL } from './parts/fasteners.ts';

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

const licenseMat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.55 });

export function buildBoxRobot(p: RobotProfile, opts: { merge?: boolean } = {}): { group: THREE.Group; mechs: MechVisual[] } {
  const mechs: MechVisual[] = [];
  const g = new THREE.Group();
  // parts are placed in the robot frame (x right, y forward, z up, inches) inside `frame`
  const frame = new THREE.Group();
  frame.rotation.x = -Math.PI / 2;
  g.add(frame);
  const kit = new Kit(frame);
  const lay = chassisLayout(p);
  const { r, inner, outer, railTop, deck, deckTop, crossHalf } = lay;
  const { width: W, length: L, height: H } = p.size;
  const d = p.drivetrain;
  const half = d.trackWidth / 2;
  const omni = wheelPart(d.wheelDiameter, 'omni');
  const traction = wheelPart(d.wheelDiameter, 'traction');
  const ww = omni.width ?? 1;
  const n = lay.wheelY.length;
  const motors = Math.max(1, d.left.length);
  const railLen = holes(L - 0.5);
  const railZ = railTop - 0.5;
  const pneumatic = p.devices.some((x) => x.type === 'adi_digital_out');
  /** Ports at the back of each motor, for its Smart Cable. */
  const ports: THREE.Vector3[] = [];

  // ---- drive: rails either side of the wheels, axles, wheels, motors ----
  for (const s of [-1, 1]) {
    const sx = (a: number) => s * a;
    const out = X.clone().multiplyScalar(s);
    // a 1×2×1 C-channel on its side: web on the inside (motors screw to it), flanges outward
    kit.part('c-channel-1x2x1', V(sx(inner), 0, railZ), Y, Z.clone().multiplyScalar(s), { length: railLen });
    if (outer !== null) kit.part('c-channel-1x2x1', V(sx(outer), 0, railZ), Y, Z.clone().multiplyScalar(-s), { length: railLen });
    const innerWeb = inner - 0.25; // inside face of the inner rail's web
    const outerWeb = outer === null ? 0 : outer + 0.25; // outside face of the outer rail's web
    for (let i = 0; i < n; i++) {
      const y = lay.wheelY[i];
      // a 6-wheel drive's middle wheel is a traction wheel (it keeps the robot from being pushed sideways)
      const wheel = n === 3 && i === 1 ? traction : omni;
      kit.part(wheel.id, V(sx(half), y, r), X, Y);
      const powered = motors >= n || i === 0;
      // inside: the motor on the rail's web (the shaft in its cartridge), or a bearing and collar
      let a0: number;
      if (powered) {
        const [ml] = kit.size('v5-motor');
        kit.part('v5-motor', V(sx(innerWeb - ml / 2), y, r), out, Y, { cartridge: d.cartridge });
        ports.push(V(sx(innerWeb - ml), y, r));
        // two screws through the rail into the motor's face, from the wheel side
        for (const dy of [-0.5, 0.5]) kit.screw(V(sx(innerWeb + WALL), y + dy, r + 0.5), out.clone().negate(), WALL, null, 0.2);
        a0 = innerWeb - 0.35;
      } else {
        kit.bearing(V(sx(innerWeb), y, r), out.clone().negate(), Y);
        kit.collar(V(sx(innerWeb - 0.153), y, r), out.clone().negate());
        a0 = innerWeb - 0.153 - 0.3 - 0.1;
      }
      // spacers from the rail to the wheel, and on past it to the outer rail
      kit.spacers(V(sx(innerWeb + WALL), y, r), out, half - ww / 2 - (innerWeb + WALL));
      let a1: number;
      if (outer !== null) {
        kit.spacers(V(sx(half + ww / 2), y, r), out, outerWeb - WALL - (half + ww / 2));
        kit.bearing(V(sx(outerWeb), y, r), out, Y);
        kit.collar(V(sx(outerWeb + 0.153), y, r), out);
        a1 = outerWeb + 0.153 + 0.3 + 0.05;
      } else {
        kit.collar(V(sx(half + ww / 2), y, r), out);
        a1 = half + ww / 2 + 0.35;
      }
      kit.shaft(V(sx(a0), y, r), V(sx(a1), y, r));
    }
    // one motor a side turns the other wheels by chain: 12-tooth sprockets beside the rail
    if (motors < n) {
      const sp = innerWeb + WALL + 0.07;
      const pd = 0.25 / Math.sin(Math.PI / 12);
      for (const y of lay.wheelY) kit.part('sprocket-12', V(sx(sp), y, r), X, Y);
      for (let i = 0; i + 1 < n; i++) {
        const y0 = lay.wheelY[i];
        const y1 = lay.wheelY[i + 1];
        const links = Math.round((y1 - y0) / 0.25);
        for (const dz of [-pd / 2, pd / 2]) kit.part('chain-25', V(sx(sp), (y0 + y1) / 2, r + dz), Y, X, { length: links });
      }
    }
    // the outer rail held to the inner one by standoffs between the wheels
    if (outer !== null) {
      for (let i = 0; i + 1 < n; i++) {
        const y = (lay.wheelY[i] + lay.wheelY[i + 1]) / 2;
        kit.standoff(V(sx(innerWeb + WALL), y, r + 0.5), V(sx(outerWeb - WALL), y, r + 0.5));
      }
    }
  }

  // ---- crossbars on top of the inner rails, flanges up, bolted at every crossing ----
  const cb = lay.crossbars;
  const crossYs = [cb.rear, cb.mid, cb.front2, cb.front, ...(cb.tank !== null ? [cb.tank] : [])];
  for (const y of crossYs) {
    kit.part('c-channel-1x2x1', V(0, y, railTop + 0.25), X, Y, { length: holes(2 * crossHalf) });
    for (const s of [-1, 1]) kit.screw(V(s * inner, y + 0.25, deck), Z.clone().negate(), 2 * WALL);
  }

  // ---- electronics and air ----
  if (lay.brain) {
    const { y: by, z: bz, size } = lay.brain;
    kit.part('v5-brain', V(0, by, bz), X, Y);
    // on four 1/2 in standoffs in the rear crossbars' troughs, screwed from below and above
    for (const y of [cb.rear, cb.mid]) {
      for (const s of [-1, 1]) {
        const x = s * 2.25;
        kit.part('standoff', V(x, y, deck + 0.25), X, Y, { length: 1 });
        kit.screw(V(x, y, railTop), Z, WALL, null, 0.2);
        kit.screw(V(x, y, bz + size[2] / 2), Z.clone().negate(), size[2], null, 0.2);
      }
    }
    // the battery across the front crossbars, zip-tied to each
    const [bw, bd, bh] = partSize(partDef('v5-battery'), {});
    const batY = (cb.front2 + cb.front) / 2;
    kit.part('v5-battery', V(0, batY, deckTop + bh / 2), X, Y);
    for (const y of [cb.front2, cb.front]) kit.strap(V(0, y, (railTop + deckTop + bh) / 2), X, bw / 2 + 0.02, Z, (deckTop + bh - railTop) / 2);
    void bd;
    // its power cable to the brain
    kit.cable([V(-bw / 2, batY, deckTop + bh / 2), V(-bw / 2 - 0.4, batY - 1, deckTop + 0.9), V(-lay.brain.size[0] / 2 - 0.3, by + 1, bz), V(-lay.brain.size[0] / 2, by + 0.6, bz)]);
    // a Smart Cable from each drive motor up over the deck to the brain
    for (const port of ports) {
      const s = Math.sign(port.x);
      const side = V(s * (size[0] / 2), by + Math.max(-1.6, Math.min(1.6, (port.y - by) * 0.3)), bz);
      kit.cable([port, port.clone().add(V(-s * 0.4, 0, 0.3)), V(s * (size[0] / 2 + 0.6), (port.y + by) / 2, deckTop + 0.4), side]);
    }
  }
  if (pneumatic && W >= 9 && cb.tank !== null) {
    // the air tank across its own crossbar, clamped by two zip ties; the solenoid beside it
    const [tl, td] = partSize(partDef('air-tank'), {});
    const tz = deckTop + td / 2;
    kit.part('air-tank', V(0, cb.tank, tz), X, Y);
    for (const x of [-tl / 4, tl / 4]) kit.strap(V(x, cb.tank, (railTop + deckTop + td) / 2), Y, td / 2, Z, (deckTop + td - railTop) / 2);
    // the solenoid in the trough of the crossbar under the battery, beside it
    const [sl, , sh] = partSize(partDef('solenoid'), {});
    const solX = Math.min(crossHalf - sl / 2 - 0.1, 2.45 + sl / 2 + 0.15);
    kit.part('solenoid', V(solX, cb.front2, deck + sh / 2), X, Y);
    kit.cable([V(tl / 2, cb.tank, tz), V(tl / 2 + 0.4, cb.tank + 0.3, tz), V(solX - sl / 2 - 0.3, cb.front2 - 0.4, deckTop + 0.3), V(solX - sl / 2, cb.front2, deck + sh / 2)], 'tubing');
  }

  // ---- towers up to the robot's height (when no lift stands there): gusseted, braced ----
  const towerH = H - railTop - 0.5;
  const lifts = p.mechanisms.some((m) => m.kind === 'lift');
  if (towerH > 2 && !lifts) {
    const ty = Math.max(cb.mid + 1, Math.min(cb.front2 - 1, L * 0.2));
    const len = holes(towerH);
    const top = railTop + len * 0.5;
    for (const s of [-1, 1]) {
      kit.part('c-channel-1x2x1', V(s * inner, ty, railTop + (len * 0.5) / 2), Z, Y.clone().multiplyScalar(s), { length: len });
      // a gusset on its front flange, down onto the rail's top flange
      kit.gusset(V(s * inner, ty + 0.5, railTop), Y, Z);
      kit.screw(V(s * inner, ty + 0.75 + 0.25, railTop + WALL), Z.clone().negate(), 2 * WALL);
      kit.screw(V(s * inner, ty + 0.5 + WALL, railTop + 0.75), Y.clone().negate(), 2 * WALL);
    }
    // a 1×1 angle across the tops, bolted to both towers' front flanges
    kit.part('angle-1x1', V(0, ty + 0.5 + 0.25, top - 0.25), X, Y, { length: holes(2 * inner + 0.5) });
    for (const s of [-1, 1]) kit.screw(V(s * inner, ty + 0.5 + WALL, top - 0.25), Y.clone().negate(), 2 * WALL);
  }

  // ---- license plates on the front and back crossbars' outer flanges ----
  for (const s of [-1, 1]) {
    const pw = Math.min(8, W * 0.55);
    const face = s * (L / 2 - 0.25);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.08, 1.6), licenseMat(s > 0 ? 0xd8343a : 0xb2272c));
    plate.position.set(0, face + s * 0.04, railTop + 0.25);
    plate.userData.part = 'license-plate';
    frame.add(plate);
    for (const x of [-pw / 2 + 0.75, pw / 2 - 0.75]) kit.screw(V(x, face + s * 0.08, railTop + 0.25), Y.clone().multiplyScalar(-s), 0.08 + WALL);
  }

  // ---- generic mechanisms (game manipulators are drawn by ManipulatorVisuals) ----
  let pistonSlot = 0;
  for (const m of p.mechanisms) {
    if (ManipulatorVisuals.handles(m)) continue;
    // these move in the robot group's own frame (three.js: x, up, -forward)
    const holder = new THREE.Group();
    holder.userData.moving = true;
    const hf = new THREE.Group();
    hf.rotation.x = -Math.PI / 2;
    holder.add(hf);
    const hk = new THREE.Group();
    if (isPneumatic(m)) {
      // a cylinder on a mast standing on the rear crossbar, pushing a drilled plate out the back
      const x = (lay.brain ? lay.brain.size[0] / 2 : 0) + 0.9 + pistonSlot * 0.0;
      const z = deckTop + 1.5 + pistonSlot * 2;
      const mastLen = holes(z + 0.75 - deck);
      kit.part('c-channel-1x2x1', V(x, cb.rear, deck + (mastLen * 0.5) / 2), Z, X, { length: mastLen });
      kit.screw(V(x, cb.rear, railTop), Z, WALL, null, 0.2);
      const [pl] = partSize(partDef('piston'), {});
      // the cylinder's body from the mast toward the back
      kit.part('piston', V(x, cb.rear - 0.25 - pl / 2, z), Y, X);
      kit.screw(V(x, cb.rear + 0.25, z), Y.clone().negate(), WALL, null, 0.2);
      // what moves: its rod, and the plate on the rod's end
      const rodEnd = cb.rear - 0.25 - pl;
      const mk = new Kit(hf);
      mk.part('standoff', V(x, rodEnd - 0.5, z), X, Z, { length: 2 });
      mk.part('plate-5', V(0, rodEnd - 1 - WALL / 2, z), X, Z, { length: holes(W * 0.5) }).userData.part = 'piston plate';
      holder.position.set(0, 0, 0);
      pistonSlot++;
    } else {
      // a roller across the front between two side plates bolted to the front crossbar
      const span = 2 * (inner - 0.25) - 1.2;
      const ry = L / 2 + 1.2;
      const rz = r + 1.5;
      for (const s of [-1, 1]) {
        const x = s * (span / 2 + 0.25);
        const plateLen = holes(ry - cb.front + 1);
        kit.part('plate-2', V(x, (cb.front - 0.5 + ry + 0.5) / 2, (rz + deckTop) / 2 - 0.25), Y, Z, { length: plateLen });
        kit.screw(V(x + s * WALL, cb.front, deck + 0.25), X.clone().multiplyScalar(-s), 2 * WALL);
        kit.bearing(V(x + s * WALL / 2, ry, rz), X.clone().multiplyScalar(s), Y);
        kit.collar(V(x + s * (WALL / 2 + 0.153), ry, rz), X.clone().multiplyScalar(s));
      }
      // what moves: the shaft and its flex wheels, spinning about x
      holder.position.set(0, rz, -ry);
      const mk = new Kit(hf);
      mk.shaft(V(-span / 2 - 0.7, 0, 0), V(span / 2 + 0.7, 0, 0));
      for (let x = -span / 2 + 0.5; x <= span / 2 - 0.5 + 1e-6; x += 1) mk.part('flex-2', V(x, 0, 0), X, Y);
    }
    void hk;
    g.add(holder);
    mechs.push({ spec: m, object: holder, base: { rotation: holder.rotation.clone(), position: holder.position.clone() } });
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  if (opts.merge !== false) {
    mergeRigid(frame);
    for (const m of mechs) mergeRigid(m.object);
  }
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
