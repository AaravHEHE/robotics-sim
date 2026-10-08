import { readdirSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { ManipulatorVisuals } from '../src/app/manipulator-meshes.ts';
import { buildBoxRobot } from '../src/app/robot-meshes.ts';
import { clawEffector, liftEffector } from '../src/sim/lift.ts';
import type { ClawSpec, LiftSpec, MechanismSpec } from '../src/sim/profile.ts';
import { robot } from './helpers.ts';

const ids = readdirSync(path.join(repoRoot, 'data/robots'))
  .map((f) => f.replace(/\.json$/, ''))
  .filter((id) => id.startsWith('override-'));

/** Where a lift's end effector is at `frac` of its range. */
const at = (m: LiftSpec, frac: number) => {
  const [a, b] = m.range ?? [0, 90];
  return a + (b - a) * frac;
};

describe('lifts move the way their type does', () => {
  for (const id of ids) {
    it(`${id}: cascades and double reverse 4-bars go straight up and down, in the simulator and as drawn`, async () => {
      const p = await robot(id);
      for (const m of p.mechanisms.filter((x): x is LiftSpec => x.kind === 'lift' && !x.base)) {
        const straight = m.lift === 'cascade' || m.lift === 'dr4b' || m.lift === 'piston';
        // the simulator: the end effector's y (and x) never change
        const e0 = liftEffector(m, at(m, 0));
        let rise = 0;
        for (const f of [0.25, 0.5, 0.75, 1]) {
          const e = liftEffector(m, at(m, f));
          if (straight) {
            expect(e.y, `${id} ${m.name} y at ${f}`).toBeCloseTo(e0.y, 9);
            expect(e.x ?? 0, `${id} ${m.name} x at ${f}`).toBeCloseTo(e0.x ?? 0, 9);
          }
          rise = Math.max(rise, e.z - e0.z);
        }
        expect(rise, `${id} ${m.name} should rise`).toBeGreaterThan(1);

        // as drawn: whatever the model marks as "straight" only moves up and down
        const { group } = buildBoxRobot(p, { merge: false });
        const vis = new ManipulatorVisuals(p, group, true, { merge: false });
        const marked: THREE.Object3D[] = [];
        group.traverse((o) => {
          if (o.userData.straight === m.name) marked.push(o);
        });
        if (m.lift === 'cascade' || m.lift === 'dr4b') expect(marked.length, `${id} ${m.name} has parts marked straight`).toBeGreaterThan(0);
        const centre = (o: THREE.Object3D) => {
          o.updateMatrixWorld(true);
          return new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
        };
        const first = new Map<THREE.Object3D, THREE.Vector3>();
        for (const f of [0, 0.25, 0.5, 0.75, 1]) {
          vis.update((x: MechanismSpec) => (x === m ? at(m, f) : x.kind === 'lift' ? at(x, 0) : 0));
          for (const o of marked) {
            const c = centre(o);
            const c0 = first.get(o) ?? c;
            first.set(o, c0);
            // three: x across, z along the robot (y is up): neither may move
            expect(Math.abs(c.x - c0.x), `${id} ${m.name}: a part drifted sideways at ${f}`).toBeLessThan(0.02);
            expect(Math.abs(c.z - c0.z), `${id} ${m.name}: a part drifted forward at ${f}`).toBeLessThan(0.02);
          }
        }
      }
    });

    it(`${id}: the claw stays where the simulator puts it, whatever the lift does`, async () => {
      const p = await robot(id);
      const claw = p.mechanisms.find((m): m is ClawSpec => m.kind === 'claw');
      if (!claw) return;
      const { group } = buildBoxRobot(p, { merge: false });
      const vis = new ManipulatorVisuals(p, group, true, { merge: false });
      const pivot = (vis as unknown as { claws: Array<{ pivot: THREE.Group }> }).claws[0].pivot;
      for (const f of [0, 0.5, 1]) {
        const v = (x: MechanismSpec) => (x.kind === 'lift' ? at(x, f) : 0);
        vis.update(v);
        const e = clawEffector(p, claw, v);
        // three: (x, z up, -y)
        expect(pivot.position.x).toBeCloseTo(e.x, 6);
        expect(pivot.position.y).toBeCloseTo(e.z, 6);
        expect(pivot.position.z).toBeCloseTo(-e.y, 6);
      }
    });
  }
});
