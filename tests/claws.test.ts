import { readdirSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { pieceRadiusAt, stackRadiusAt } from '../src/app/claw-geometry.ts';
import { closedness } from '../src/app/claw-meshes.ts';
import { ManipulatorVisuals } from '../src/app/manipulator-meshes.ts';
import { buildBoxRobot } from '../src/app/robot-meshes.ts';
import { layoutStack, type Piece } from '../src/games/override/elements.ts';
import type { ClawSpec, MechanismSpec } from '../src/sim/profile.ts';
import { robot } from './helpers.ts';

const PIN: Piece = { kind: 'pin', id: 'p', colors: ['red', 'yellow'] };
const CUP: Piece = { kind: 'cup', id: 'c', up: 'gray' };
const STACKS: Array<[string, Piece[]]> = [['a Pin', [PIN]], ['a Cup', [CUP]], ['a Cup over a Pin', [PIN, CUP]]];

/** How far the stack is into a point at pivot-local (x, y, z): its radius there less the point's distance from its axis. */
function depth(pieces: Piece[], grip: number, p: THREE.Vector3): number {
  const h = p.y + grip; // height above the stack's bottom (the pivot's y is up)
  let r = 0;
  for (const s of layoutStack(pieces, 0, false)) r = Math.max(r, pieceRadiusAt(s.piece, h - s.bottom));
  return r - Math.hypot(p.x, p.z);
}

const ids = readdirSync(path.join(repoRoot, 'data/robots'))
  .map((f) => f.replace(/\.json$/, ''))
  .filter((id) => id.startsWith('override-'));

describe('claws hold what they close on', () => {
  for (const id of ids) {
    it(`${id}: nothing of the robot runs through a held stack, and the jaws touch it`, async () => {
      const p = await robot(id);
      const claw = p.mechanisms.find((m): m is ClawSpec => m.kind === 'claw');
      if (!claw) return;
      for (const [what, pieces] of STACKS) {
        for (const open of [false, true]) {
          const grip = 2.5;
          const { group } = buildBoxRobot(p, { merge: false });
          const vis = new ManipulatorVisuals(p, group, true, { merge: false });
          const state = { held: { [claw.name]: pieces }, grip: { [claw.name]: grip }, flipped: {}, transit: {}, toggles: [], lying: [], floor: [], goals: {}, loaders: {} };
          vis.setHeld(state as never);
          const on = claw.grip === 'piston' ? ((claw.closedWhen ?? 'extended') === 'extended' ? 1 : 0) : claw.grip === 'motor' ? (claw.closedAt ?? 60) : 100;
          const off = claw.grip === 'piston' ? 1 - on : claw.grip === 'motor' ? 0 : -100;
          vis.update((m: MechanismSpec) => (m === claw ? (open ? off : on) : m.kind === 'wrist' ? 0 : 'range' in m && m.range ? m.range[0] : 0), 0, { x: 0, y: 0, theta: 0 });
          group.updateMatrixWorld(true);
          const pivot = (vis as unknown as { claws: Array<{ pivot: THREE.Group }> }).claws[0].pivot;
          const inv = pivot.matrixWorld.clone().invert();
          let deepest = 0; // how far anything is into the stack
          let nearest = Infinity; // how close the jaws' pads get to its surface
          let worst = '';
          const walk = (o: THREE.Object3D) => {
            if (o.userData.piece || o.userData.intake) return; // the held stack itself; intake rollers (laid out separately)
            for (const c of o.children) walk(c);
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const part = String(o.userData.part ?? '');
            const pos = mesh.geometry.attributes.position;
            const m = mesh.matrixWorld.clone().premultiply(inv);
            const v = new THREE.Vector3();
            const isPad = part === 'claw pad';
            for (let i = 0; i < pos.count; i += isPad ? 1 : 3) {
              v.fromBufferAttribute(pos, i).applyMatrix4(m);
              const d = depth(pieces, grip, v);
              if (d > deepest && !isPad) {
                deepest = d;
                worst = part || mesh.geometry.type;
              }
              // (only the pad's inner face: its vertices on the side facing the stack)
              if (isPad && v.y + grip > 0.3 && v.y + grip < 6) nearest = Math.min(nearest, -d);
            }
          };
          walk(group);
          // nothing may cut into the stack (a hair for the pads and the hexagons' corners)
          expect(deepest, `${id} holding ${what}, ${open ? 'open' : 'closed'}: ${worst}`).toBeLessThan(0.12);
          if (claw.grip !== 'roller' && !open) expect(nearest, `${id} holding ${what}: the pads are far from it`).toBeLessThan(0.4);
          if (open && claw.grip !== 'roller') expect(nearest, `${id} open: the pads are in the way`).toBeGreaterThan(0.25);
        }
      }
    });
  }

  it('closing follows the actuator, from open to closed', () => {
    const piston = { kind: 'claw', name: 'C', grip: 'piston', adi: 'A' } as ClawSpec;
    expect([closedness(piston, 0), closedness(piston, 0.5), closedness(piston, 1)]).toEqual([0, 0.5, 1]);
    expect(closedness({ ...piston, closedWhen: 'retracted' }, 0)).toBe(1);
    const motor = { kind: 'claw', name: 'C', grip: 'motor', motors: [8], closedAt: 60 } as ClawSpec;
    expect([closedness(motor, 0), closedness(motor, 30), closedness(motor, 90)]).toEqual([0, 0.5, 1]);
  });

  it('a stack is as wide as the piece at the height the jaws reach', () => {
    expect(stackRadiusAt([PIN], 6.5 - 0.1)).toBeLessThan(1); // the Pin's thin end
    expect(stackRadiusAt([PIN], 3.25)).toBeCloseTo(1.58, 1); // its collar
    expect(stackRadiusAt([CUP], 3.24, 0.1)).toBeCloseTo(1.16, 1); // a Cup's waist
    expect(stackRadiusAt([], 2)).toBeLessThan(0.7); // an empty claw closes right in
  });
});
