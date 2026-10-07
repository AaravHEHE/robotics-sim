import { readdirSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { OBB } from 'three/examples/jsm/math/OBB.js';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { ManipulatorVisuals } from '../src/app/manipulator-meshes.ts';
import { buildBoxRobot } from '../src/app/robot-meshes.ts';
import { isMotorized, type MechanismSpec } from '../src/sim/profile.ts';
import { robot } from './helpers.ts';

/** How close two parts must be to count as touching (in). */
const TOUCH = 0.06;

interface Part {
  name: string;
  obb: OBB;
  where: THREE.Vector3;
}

/** Every tagged part under `root`, with its oriented box in world space. */
function parts(root: THREE.Object3D): Part[] {
  root.updateMatrixWorld(true);
  const out: Part[] = [];
  const visit = (o: THREE.Object3D) => {
    if (o.userData.piece) return; // a game piece, not part of the robot
    // a mesh no builder tagged counts as a part of its own
    if (o.userData.part !== undefined || (o as THREE.Mesh).isMesh) {
      // its box in its own frame, from its meshes
      const inv = o.matrixWorld.clone().invert();
      const box = new THREE.Box3();
      o.traverse((m) => {
        const mesh = m as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.computeBoundingBox();
        box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(inv.clone().multiply(mesh.matrixWorld)));
      });
      if (box.isEmpty()) return;
      const obb = new OBB().fromBox3(box);
      obb.halfSize.addScalar(TOUCH / 2);
      // (OBB.applyMatrix4 doesn't turn the box's centre with it: place it by hand)
      const pos = new THREE.Vector3();
      const rot = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      o.matrixWorld.decompose(pos, rot, scale);
      obb.center.applyMatrix4(o.matrixWorld);
      obb.halfSize.multiply(new THREE.Vector3(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)));
      obb.rotation.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(rot));
      out.push({ name: String(o.userData.part ?? `untagged ${(o as THREE.Mesh).geometry?.type}`), obb, where: obb.center.clone() });
      return;
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  return out;
}

/** The parts not connected (through touching parts) to the wheels. */
function floating(ps: Part[]): Part[] {
  const parent = ps.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      if (find(i) === find(j)) continue;
      if (ps[i].obb.center.distanceTo(ps[j].obb.center) > ps[i].obb.halfSize.length() + ps[j].obb.halfSize.length()) continue;
      if (ps[i].obb.intersectsOBB(ps[j].obb)) parent[find(i)] = find(j);
    }
  }
  const wheel = ps.findIndex((p) => /^(omni|traction|mecanum)-/.test(p.name));
  const root = find(wheel);
  return ps.filter((_, i) => find(i) !== root);
}

const toRobot = (v: THREE.Vector3) => `(${v.x.toFixed(2)}, ${(-v.z).toFixed(2)}, ${v.y.toFixed(2)})`;

/** A mechanism's output at a fraction of its travel (0 = at rest). */
function at(m: MechanismSpec, k: number): number {
  if ('range' in m && m.range) return m.range[0] + (m.range[1] - m.range[0]) * k;
  if (!isMotorized(m)) return k >= 0.5 ? 1 : 0;
  return k * 90;
}

const ids = readdirSync(path.join(repoRoot, 'data/robots')).map((f) => f.replace(/\.json$/, ''));

describe('robots drawn from their profiles hold together', () => {
  for (const id of ids) {
    it(`${id}: every part is fastened to the rest of the robot`, async () => {
      const p = await robot(id);
      for (const k of [0, 0.5, 1]) {
        const { group, mechs } = buildBoxRobot(p, { merge: false });
        const vis = new ManipulatorVisuals(p, group, true, { merge: false });
        vis.update((m) => at(m, k));
        for (const mv of mechs) {
          // the viewer moves generic mechanisms this way (see viewer.ts)
          if (mv.spec.kind === 'piston') mv.object.translateZ(-2 * (k >= 0.5 ? 1 : 0));
          else mv.object.rotateX((-at(mv.spec, k) * Math.PI) / 180);
        }
        const loose = floating(parts(group)).map((q) => `${q.name} at ${toRobot(q.where)}`);
        expect(loose, `${id} at ${k * 100}% travel`).toEqual([]);
      }
    });
  }
});
