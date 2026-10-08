import * as THREE from 'three';
import { OBB } from 'three/examples/jsm/math/OBB.js';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { pieceRadiusAt } from '../src/app/claw-geometry.ts';
import { ManipulatorVisuals } from '../src/app/manipulator-meshes.ts';
import { buildBoxRobot } from '../src/app/robot-meshes.ts';
import { layoutStack, type Piece } from '../src/games/override/elements.ts';
import { clawEffector } from '../src/sim/lift.ts';
import type { ClawSpec, IntakeSpec, LiftSpec, MechanismSpec } from '../src/sim/profile.ts';
import { robot } from './helpers.ts';

const STACK: Piece[] = [{ kind: 'pin', id: 'p', colors: ['red', 'yellow'] }, { kind: 'cup', id: 'c', up: 'gray' }];
/** Hardware passes through holes in what it holds: it is not a clearance problem. */
const HARDWARE = /^(screw|nut|washer|spacer|collar|standoff|shaft|bearing|zip-tie|cable|tubing|plug|string|piston rod|sprocket|chain|gear|pulley|spool|rubber-band|untagged)/;

interface Box {
  name: string;
  obb: OBB;
  /** Whether it is part of an intake (its rollers meet the stack by design), or of the claw. */
  intake: boolean;
  claw: boolean;
}

function boxesOf(root: THREE.Object3D, claws: THREE.Object3D[], shrink: number): Box[] {
  root.updateMatrixWorld(true);
  const out: Box[] = [];
  const inClaw = (o: THREE.Object3D) => {
    for (let a: THREE.Object3D | null = o; a; a = a.parent) if (claws.includes(a)) return true;
    return false;
  };
  const walk = (o: THREE.Object3D, intake: boolean) => {
    if (o.userData.piece) return;
    const isIntake = intake || !!o.userData.intake;
    if (o.userData.part !== undefined || (o as THREE.Mesh).isMesh) {
      const inv = o.matrixWorld.clone().invert();
      const b = new THREE.Box3();
      o.traverse((m) => {
        const me = m as THREE.Mesh;
        if (!me.isMesh) return;
        me.geometry.computeBoundingBox();
        b.union(me.geometry.boundingBox!.clone().applyMatrix4(inv.clone().multiply(me.matrixWorld)));
      });
      if (b.isEmpty()) return;
      const obb = new OBB().fromBox3(b);
      const pos = new THREE.Vector3();
      const rot = new THREE.Quaternion();
      const sc = new THREE.Vector3();
      o.matrixWorld.decompose(pos, rot, sc);
      obb.center.applyMatrix4(o.matrixWorld);
      obb.halfSize.multiply(new THREE.Vector3(Math.abs(sc.x), Math.abs(sc.y), Math.abs(sc.z))).subScalar(shrink).max(new THREE.Vector3(0.001, 0.001, 0.001));
      obb.rotation.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(rot));
      out.push({ name: String(o.userData.part ?? `untagged ${(o as THREE.Mesh).geometry?.type}`), obb, intake: isIntake, claw: inClaw(o) });
      return;
    }
    for (const c of o.children) walk(c, isIntake);
  };
  walk(root, false);
  return out;
}

/** The box's own points (its volume, on a grid), in world space. */
function pointsOf(b: Box, step = 0.25): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const h = b.obb.halfSize;
  const n = (e: number) => Math.max(1, Math.ceil((2 * e) / step));
  const m = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().identity());
  void m;
  const rot = new THREE.Matrix4().setFromMatrix3(b.obb.rotation);
  for (let i = 0; i <= n(h.x); i++) {
    for (let j = 0; j <= n(h.y); j++) {
      for (let k = 0; k <= n(h.z); k++) {
        const v = new THREE.Vector3(-h.x + (2 * h.x * i) / n(h.x), -h.y + (2 * h.y * j) / n(h.y), -h.z + (2 * h.z * k) / n(h.z));
        out.push(v.applyMatrix4(rot).add(b.obb.center));
      }
    }
  }
  return out;
}

/**
 * Part names the stack (a Cup over a Pin, or a Pin) cuts into as its bottom goes through
 * `bottoms` (three-frame): points of each part that are inside the stack's solid of revolution.
 */
function stackHits(boxes: Box[], bottoms: THREE.Vector3[], skip: (b: Box) => boolean, pieces: Piece[] = STACK): Map<string, number> {
  const hits = new Map<string, number>();
  const slots = layoutStack(pieces, 0, false);
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const b of bottoms) {
    lo.min(b);
    hi.max(b);
  }
  lo.add(new THREE.Vector3(-1.7, 0, -1.7));
  hi.add(new THREE.Vector3(1.7, 10.2, 1.7));
  const region = new THREE.Box3(lo, hi);
  for (const b of boxes) {
    if (skip(b)) continue;
    // (only boxes near the stack's sweep)
    const reach = Math.hypot(b.obb.halfSize.x, b.obb.halfSize.y, b.obb.halfSize.z);
    if (!region.clone().expandByScalar(reach).containsPoint(b.obb.center)) continue;
    let n = 0;
    for (const p of pointsOf(b)) {
      if (!region.containsPoint(p)) continue;
      inside: for (const c of bottoms) {
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d >= 1.7) continue;
        for (const s of slots) {
          if (pieceRadiusAt(s.piece, p.y - c.y - s.bottom) - 0.12 > d) {
            n++;
            break inside;
          }
        }
      }
    }
    if (n) {
      const key = process.env.DBG ? `${b.name}@${[b.obb.center.x, -b.obb.center.z, b.obb.center.y].map((v) => v.toFixed(1))}` : b.name;
      hits.set(key, (hits.get(key) ?? 0) + n);
    }
  }
  return hits;
}

const IDS = ['override-banshee', 'override-claw-gate', 'override-dr4b-intake'];

describe('intakes and claws clear the robot', () => {
  for (const id of IDS) {
    it(`${id}: a stack riding the intake never cuts into the robot`, async () => {
      const p = await robot(id);
      const { group } = buildBoxRobot(p, { merge: false });
      const vis = new ManipulatorVisuals(p, group, true, { merge: false });
      vis.update(() => 0);
      const intake = p.mechanisms.find((m): m is IntakeSpec => m.kind === 'intake')!;
      const dest = p.mechanisms.find((m) => m.name === intake.into) as MechanismSpec | null;
      const curve = (vis as unknown as { pathOf: (a: unknown, b: unknown, v: () => number) => THREE.Curve<THREE.Vector3> }).pathOf(intake, dest, () => 0);
      const claws = (vis as unknown as { claws: Array<{ pivot: THREE.Group }> }).claws.map((c) => c.pivot);
      const boxes = boxesOf(group, claws, 0);
      const route = Array.from({ length: 81 }, (_, i) => curve.getPoint(i / 80));
      for (const [what, pieces] of [['a Cup over a Pin', STACK], ['a Pin', STACK.slice(0, 1)]] as Array<[string, Piece[]]>) {
        const hits = stackHits(boxes, route, (b) => b.intake || b.claw || HARDWARE.test(b.name), pieces);
        expect(JSON.stringify({ [what]: [...hits].sort((a, b) => b[1] - a[1]) })).toBe(`{"${what}":[]}`);
      }
    });

    it(`${id}: the claw waiting at the hand-off holds a stack clear of the robot, and clear of itself`, async () => {
      const p = await robot(id);
      const claw = p.mechanisms.find((m): m is ClawSpec => m.kind === 'claw')!;
      const { group } = buildBoxRobot(p, { merge: false });
      const vis = new ManipulatorVisuals(p, group, true, { merge: false });
      const grip = Math.min(Math.max(1, clawEffector(p, claw, () => 0).z), 5.5); // as the claw closes on what the intake hands it
      const state = { held: { [claw.name]: STACK }, grip: { [claw.name]: grip }, flipped: {}, transit: {}, toggles: [], lying: [], floor: [], goals: {}, loaders: {} };
      vis.setHeld(state as never);
      // every lift at its rest position, the claw closed on the stack
      const closed = claw.grip === 'piston' ? ((claw.closedWhen ?? 'extended') === 'extended' ? 1 : 0) : claw.grip === 'motor' ? (claw.closedAt ?? 60) : 100;
      const v = (m: MechanismSpec) => (m === claw ? closed : 0);
      vis.update(v);
      const pivot = (vis as unknown as { claws: Array<{ pivot: THREE.Group }> }).claws[0].pivot;
      const e = clawEffector(p, claw, v);
      // its stack: bottom `grip` below the grip point (three: x, z up, -y)
      const bottom = new THREE.Vector3(e.x, e.z - grip, -e.y);
      const boxes = boxesOf(group, [pivot], 0.04);
      // 1. the stack against everything but the jaws that hold it
      const stack = stackHits(boxes, [bottom], (b) => b.intake || HARDWARE.test(b.name) || /^claw (finger|pad)/.test(b.name) || (b.claw && !/^(plate|v5-motor|exp-motor|piston|flex)/.test(b.name)));
      // 2. the claw's own parts against the rest of the robot
      const clawBoxes = boxes.filter((b) => b.claw && !HARDWARE.test(b.name) && !/^claw (finger|pad)/.test(b.name));
      const rest = boxes.filter((b) => !b.claw && !b.intake && !HARDWARE.test(b.name));
      const crossings = new Map<string, number>();
      for (const a of clawBoxes) for (const b of rest) if (a.obb.intersectsOBB(b.obb)) { const key = `${a.name} x ${b.name}${process.env.DBG ? '@' + [b.obb.center.x, -b.obb.center.z, b.obb.center.y, b.obb.halfSize.x, b.obb.halfSize.z, b.obb.halfSize.y].map((n) => n.toFixed(1)) : ''}`; crossings.set(key, (crossings.get(key) ?? 0) + 1); }
      expect(JSON.stringify({ stack: [...stack], claw: [...crossings] })).toBe('{"stack":[],"claw":[]}');
    });
  }

  for (const id of readdirSync(path.join(repoRoot, 'data/robots')).map((f) => f.replace(/\.json$/, '')).filter((x) => x.startsWith('override-'))) {
    it(`${id}: a held stack clears the robot as the lifts move`, async () => {
      const p = await robot(id);
      const claw = p.mechanisms.find((m): m is ClawSpec => m.kind === 'claw');
      if (!claw) return;
      const lifts = p.mechanisms.filter((m): m is LiftSpec => m.kind === 'lift');
      const closed = claw.grip === 'piston' ? ((claw.closedWhen ?? 'extended') === 'extended' ? 1 : 0) : claw.grip === 'motor' ? (claw.closedAt ?? 60) : 100;
      const found = new Map<string, number>();
      for (const grip of [1, 2.5, 4]) {
        for (const f of [0, 0.25, 0.5, 0.75, 1]) {
          const { group } = buildBoxRobot(p, { merge: false });
          const vis = new ManipulatorVisuals(p, group, true, { merge: false });
          const state = { held: { [claw.name]: STACK }, grip: { [claw.name]: grip }, flipped: {}, transit: {}, toggles: [], lying: [], floor: [], goals: {}, loaders: {} };
          vis.setHeld(state as never);
          const v = (m: MechanismSpec) => (m === claw ? closed : 'range' in m && m.range ? m.range[0] + (m.range[1] - m.range[0]) * f : 0);
          vis.update(v);
          group.updateMatrixWorld(true);
          const pivot = (vis as unknown as { claws: Array<{ pivot: THREE.Group }> }).claws[0].pivot;
          const all = boxesOf(group, [pivot], 0.04).filter((b) => !b.intake && !HARDWARE.test(b.name));
          const boxes = all.filter((b) => !b.claw);
          // the claw itself against the rest of the robot
          for (const a of all.filter((b) => b.claw && !/^claw (finger|pad)/.test(b.name))) {
            for (const b of boxes) if (a.obb.intersectsOBB(b.obb)) found.set(`${a.name} x ${b.name} (${Math.round(f * 100)}%, grip ${grip})`, 1);
          }
          const inv = pivot.matrixWorld.clone().invert();
          const slots = layoutStack(STACK, 0, false);
          for (const b of boxes) {
            let n = 0;
            for (const w of pointsOf(b)) {
              const q = w.clone().applyMatrix4(inv); // the pivot's frame: its y is up the stack
              const h = q.y + grip;
              if (h < 0 || h > 10.1) continue;
              const d = Math.hypot(q.x, q.z);
              if (slots.some((s) => pieceRadiusAt(s.piece, h - s.bottom) - 0.12 > d)) n++;
            }
            if (n) found.set(`${b.name} (${lifts.map((l) => `${l.name} ${Math.round(f * 100)}%`).join(', ')}, grip ${grip})`, n);
          }
        }
      }
      expect(JSON.stringify([...found].slice(0, 12))).toBe('[]');
    });
  }
});
