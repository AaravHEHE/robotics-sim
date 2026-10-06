// The robot drawn from its profile alone (no 3D model): chassis, wheels at the real track
// width, a tower at the real height, and the generic mechanisms (pistons, rollers). Game
// manipulators are drawn by ManipulatorVisuals. Shared by the field viewer and the robot
// editor's preview.

import * as THREE from 'three';
import type { MechanismSpec, RobotProfile } from '../sim/profile.ts';
import { ManipulatorVisuals } from './manipulator-meshes.ts';

/** A mechanism's moving part, and its pose at rest (it is animated from there). */
export interface MechVisual {
  spec: MechanismSpec;
  object: THREE.Object3D;
  base: { rotation: THREE.Euler; position: THREE.Vector3 };
}

export function buildBoxRobot(p: RobotProfile): { group: THREE.Group; mechs: MechVisual[] } {
  const mechs: MechVisual[] = [];
  const g = new THREE.Group();
  const { width, length, height } = p.size;
  const metal = new THREE.MeshStandardMaterial({ color: 0xb9bec5, metalness: 0.55, roughness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xd8343a, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.8 });
  const wheelR = p.drivetrain.wheelDiameter / 2;

  // drive rails, cross members and a deck
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1, 2, length), metal);
    rail.position.set((sx * (width - 1)) / 2, wheelR + 0.5, 0);
    g.add(rail);
  }
  for (const sz of [-1, 0, 1]) {
    const cross = new THREE.Mesh(new THREE.BoxGeometry(width - 2, 1, 1), metal);
    cross.position.set(0, wheelR + 1, (sz * (length - 2)) / 2);
    g.add(cross);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(width - 3, 0.25, length * 0.55), dark);
  deck.position.set(0, wheelR + 1.7, length * 0.08);
  g.add(deck);
  const brain = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1, 3), dark);
  brain.position.set(0, wheelR + 2.3, length * 0.15);
  g.add(brain);
  // tower so the robot reads at its real height
  const tower = new THREE.Mesh(new THREE.BoxGeometry(1, height - wheelR - 2, 1), metal);
  for (const sx of [-1, 1]) {
    const t = tower.clone();
    t.position.set((sx * (width - 4)) / 2, (height + wheelR + 2) / 2, length * 0.2);
    g.add(t);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(width - 3, 1, 1), accent);
  bar.position.set(0, height - 0.5, length * 0.2);
  g.add(bar);

  // wheels at the profile's track width
  const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 1.1, 24);
  wheelGeo.rotateZ(Math.PI / 2);
  const rollers = new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.7 });
  const nWheels = Math.max(2, Math.min(4, p.drivetrain.left.length));
  for (const sx of [-1, 1]) {
    for (let i = 0; i < nWheels; i++) {
      const w = new THREE.Mesh(wheelGeo, rollers);
      const z = -length / 2 + wheelR + 0.5 + (i * (length - 2 * wheelR - 1)) / (nWheels - 1);
      w.position.set((sx * p.drivetrain.trackWidth) / 2, wheelR, z);
      w.castShadow = true;
      g.add(w);
    }
  }
  // front marker
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.4, 3), accent);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, wheelR + 2.5, -length / 2 - 0.6);
  g.add(nose);

  // mechanisms
  let pistonSlot = 0;
  for (const m of p.mechanisms) {
    if (ManipulatorVisuals.handles(m)) continue;
    if (m.kind === 'piston') {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(width * 0.5, 2.5, 0.6), accent);
      plate.position.set(0, wheelR + 4 + pistonSlot * 3, -length / 2 + 1.2);
      pistonSlot++;
      g.add(plate);
      mechs.push({ spec: m, object: plate, base: { rotation: plate.rotation.clone(), position: plate.position.clone() } });
    } else {
      const roller = new THREE.Group();
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, width - 3, 16), new THREE.MeshStandardMaterial({ color: 0x2d6cdf, roughness: 0.5 }));
      drum.rotation.z = Math.PI / 2;
      const flap = new THREE.Mesh(new THREE.BoxGeometry(width - 3.2, 0.3, 2.8), dark);
      flap.position.y = 1.2;
      roller.add(drum, flap);
      roller.position.set(0, wheelR + 1.5, -length / 2 - 1.2);
      g.add(roller);
      mechs.push({ spec: m, object: roller, base: { rotation: roller.rotation.clone(), position: roller.position.clone() } });
    }
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return { group: g, mechs };
}
