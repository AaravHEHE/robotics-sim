import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { ManipulatorVisuals } from '../src/app/manipulator-meshes.ts';
import { OverrideGame } from '../src/games/override/game.ts';
import { initialState, type OverrideState } from '../src/games/override/state.ts';
import type { FieldDef } from '../src/sim/field.ts';
import type { IntakeSpec } from '../src/sim/profile.ts';
import { World } from '../src/sim/world.ts';
import { robot } from './helpers.ts';

const field = async () => JSON.parse(await readFile(path.join(repoRoot, 'data/fields/override.json'), 'utf8')) as FieldDef;

function emptyState(): OverrideState {
  return initialState({ perimeter: { inside: 140.5 }, objects: [] } as unknown as FieldDef, 'none');
}

describe('animated transit (viewer)', () => {
  const pose = { x: -55.5, y: -58.6, theta: 270 };

  it('a piece rides through the intake: up from the floor, over the deck, into the chamber on the rear DR4B', async () => {
    const r = await robot('override-dr4b-intake');
    const vis = new ManipulatorVisuals(r, new THREE.Group(), true);
    const st = emptyState();
    st.held = { Intake: [{ kind: 'cup', id: 'c1', up: 'clear' }], Chamber: [] };
    st.transit = { c1: { from: { x: -65, y: -58.8, z: 0 }, t0: 1000, t1: 1500 } };
    vis.setHeld(st);
    const at = (t: number) => {
      vis.update(() => 0, t, pose);
      const mesh = (vis as unknown as { intakes: { riding: THREE.Group }[] }).intakes[0].riding.children[0];
      // robot frame: forward = -three z, up = three y
      return { forward: -mesh.position.z, up: mesh.position.y };
    };
    const ys = [1000, 1100, 1200, 1300, 1400, 1500].map(at);
    expect(ys[0].forward).toBeCloseTo(9.5, 0); // where it was on the floor (the Loader's opening)
    for (let k = 1; k < ys.length; k++) expect(ys[k].forward).toBeLessThan(ys[k - 1].forward + 1e-9); // only ever rearward
    expect(ys[3].up).toBeGreaterThan(r.drivetrain.wheelDiameter / 2 + 2.5); // over the deck and the Brain
    expect(ys[5].forward).toBeCloseTo(-11, 6); // at the chamber
    expect(at(2000).forward).toBeCloseTo(-11, 6); // waits there
  });

  it('a lying Pin is turned upright as the intake takes it', async () => {
    const r = await robot('override-claw-gate');
    const vis = new ManipulatorVisuals(r, new THREE.Group(), true);
    const st = emptyState();
    st.held = { Intake: [{ kind: 'pin', id: 'p1', colors: ['red', 'yellow'] }], Claw: [] };
    st.transit = { p1: { from: { x: 0, y: 12, z: 0 }, lying: 90, t0: 0, t1: 300 } };
    vis.setHeld(st);
    const mesh = () => (vis as unknown as { intakes: { riding: THREE.Group }[] }).intakes[0].riding.children[0];
    const up = () => new THREE.Vector3(0, 1, 0).applyQuaternion(mesh().quaternion).y;
    vis.update(() => 0, 0, { x: 0, y: 0, theta: 0 });
    expect(up()).toBeCloseTo(0, 6); // lying flat
    vis.update(() => 0, 200, { x: 0, y: 0, theta: 0 });
    expect(up()).toBeCloseTo(1, 6); // standing
  });

  it('a claw draws in what it closes on', async () => {
    const r = await robot('override-fourbar-claw');
    const vis = new ManipulatorVisuals(r, new THREE.Group(), true);
    const st = emptyState();
    st.held = { Claw: [{ kind: 'cup', id: 'c', up: 'clear' }] };
    st.transit = { 'claw:Claw': { from: { x: 0, y: 14, z: 0 }, t0: 0, t1: 180 } };
    vis.setHeld(st);
    const claw = (vis as unknown as { claws: { stack: THREE.Group }[] }).claws[0];
    vis.update(() => 0, 0, { x: 0, y: 0, theta: 0 });
    const start = claw.stack.position.length();
    vis.update(() => 0, 180, { x: 0, y: 0, theta: 0 });
    expect(start).toBeGreaterThan(2);
    expect(claw.stack.position.length()).toBeLessThan(1e-9);
  });
});

describe('transit records (simulator)', () => {
  it('intake pickups record their ride; drops record their fall', async () => {
    const f = await field();
    const r = await robot('override-claw-gate');
    const world = new World(r, f, { x: -23.548, y: -40, theta: 0 });
    const game = await OverrideGame.create(f, 'h2h', world);
    for (const p of [...r.drivetrain.left, ...r.drivetrain.right]) world.motor(p).cmd = 40 * Math.sign(p);
    world.motor(10).cmd = 127;
    let picked: { t0: number; t1: number } | null = null;
    for (let t = 1; t <= 2000 && !picked; t++) {
      world.step(1);
      game.step(1);
      const id = game.state.held.Intake[0]?.id;
      if (id) picked = game.state.transit[id];
    }
    expect(picked).not.toBeNull();
    const intake = r.mechanisms.find((m): m is IntakeSpec => m.kind === 'intake')!;
    expect(picked!.t1 - picked!.t0).toBe(intake.transferMs ?? 300);
    // the Preload, let go 5" up away from any Goal, falls for sqrt(2 * 5 / 386) s
    const drop = await robot('override-fourbar-claw');
    const w2 = new World(drop, f, { x: -30, y: -50, theta: 90 });
    w2.adiOut.set('A', true);
    const g2 = await OverrideGame.create(f, 'h2h', w2);
    w2.motor(7).angle = 20 / 0.2;
    w2.motor(7).brakeMode = 2;
    for (let t = 1; t <= 300; t++) { w2.step(1); g2.step(1); }
    w2.adiOut.set('A', false);
    for (let t = 1; t <= 300; t++) { w2.step(1); g2.step(1); }
    const fell = Object.entries(g2.state.transit).find(([k]) => g2.state.lying.some((l) => l.id === k))?.[1];
    expect(fell).toBeDefined();
    expect(fell!.from.z).toBeGreaterThan(3);
    expect(fell!.t1 - fell!.t0).toBeCloseTo(1000 * Math.sqrt((2 * fell!.from.z) / 386), 6);
  });
});
