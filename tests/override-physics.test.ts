import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CUP } from '../src/games/override/elements.ts';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { OverrideGame } from '../src/games/override/game.ts';
import type { FieldDef } from '../src/sim/field.ts';
import { World } from '../src/sim/world.ts';
import { prosProject, robot, simulate } from './helpers.ts';
import { phasing } from '../src/games/override/overlaps.ts';
import { toField } from '../src/sim/lift.ts';
import type { ClawSpec } from '../src/sim/profile.ts';

const field = async () => JSON.parse(await readFile(path.join(repoRoot, 'data/fields/override.json'), 'utf8')) as FieldDef;

/** Drive straight at full power for `ms`, stepping world + game like the runtime. */
async function plow(ms: number, start = { x: 0, y: -33, theta: 0 }) {
  const f = await field();
  const r = await robot('tank-6m-450');
  const world = new World(r, f, start);
  const game = await OverrideGame.create(f, 'h2h', world);
  for (const p of [...r.drivetrain.left, ...r.drivetrain.right]) world.motor(p).cmd = 127 * Math.sign(p);
  for (let t = 1; t <= ms; t++) {
    world.step(1);
    game.step(1);
    if (t % 10 === 0) game.recordFrame(t);
  }
  return { world, game, rec: game.finish(), f };
}

describe('Override floor physics', () => {
  it('the robot plows the Midfield-corner stack toward the center goal', async () => {
    const { game } = await plow(1500);
    const corner = game.state.floor.find((s) => Math.abs(s.x) < 6 && s.y > -30 && s.y < 0 && s.pieces.length === 2)!;
    expect(corner).toBeDefined();
    // it started at y = -23.55; the robot pushed it north
    expect(corner.y).toBeGreaterThan(-20);
  });

  it('a stack jammed against the center Goal stops the robot instead of being driven through', async () => {
    const { world, game } = await plow(1500);
    const stack = game.state.floor.find((s) => Math.abs(s.x) < 6 && s.y > -30 && s.y < 0 && s.pieces.length === 2)!;
    const front = world.pose.y + world.profile.size.length / 2;
    expect(world.speed).toBeCloseTo(0, 3);
    // the stack (radius = the Cup's rim) is still in front of the robot, not inside it
    expect(stack.y - front).toBeGreaterThan(CUP.rimDiameter / 2 - 0.5);
  });

  it('objects never leave the field', async () => {
    const { game, f } = await plow(3000, { x: -40, y: -40, theta: 45 });
    const half = f.perimeter.inside / 2;
    for (const s of game.state.floor) expect(Math.max(Math.abs(s.x), Math.abs(s.y))).toBeLessThan(half);
    for (const l of game.state.lying) expect(Math.max(Math.abs(l.x), Math.abs(l.y))).toBeLessThan(half);
  });

  it('untouched objects stay exactly where the manual puts them', async () => {
    const { game, rec } = await plow(1500);
    const far = game.state.floor.filter((s) => s.y > 30); // the robot never got there
    const start = rec.snapshots[0].state.floor;
    for (const s of far) {
      const s0 = start.find((x) => x.id === s.id)!;
      expect(s.x).toBeCloseTo(s0.x, 3);
      expect(s.y).toBeCloseTo(s0.y, 3);
    }
  });

  it('is deterministic: identical tracks on repeated runs', async () => {
    const a = await plow(2000, { x: -40, y: -40, theta: 45 });
    const b = await plow(2000, { x: -40, y: -40, theta: 45 });
    expect(JSON.stringify(a.rec.tracks)).toBe(JSON.stringify(b.rec.tracks));
    expect(Object.keys(a.rec.tracks).length).toBe(36 + 16 + 4); // every floor stack, lying pin and toggle
  });

  it('a compiled program on the Override field records game replay data', async () => {
    const rec = await simulate(
      prosProject(`#include "main.h"
pros::MotorGroup left({-1, -2, -3}, pros::MotorGears::blue);
pros::MotorGroup right({4, 5, 6}, pros::MotorGears::blue);
void autonomous() { left.move(127); right.move(127); pros::delay(800); left.brake(); right.brake(); }
`),
      'tank-6m-450',
      { field: await field(), start: { x: 12, y: -33, theta: 0 } },
    );
    expect(rec.error).toBeNull();
    expect(rec.game?.id).toBe('override');
    expect(rec.game?.layout).toBe('h2h');
    expect(rec.game?.snapshots[0].state.floor.length).toBe(36); // 24 wall-group cups + 4 cross + 4 corner + 4 diagonal
    // nothing scored, but driving north from (12, -33) crosses the Autonomous Line (SG7)
    expect(rec.game?.alliance).toBe('red');
    expect(rec.game?.result?.score).toMatchObject({ red: 0, blue: 0 });
    expect(rec.game?.violations.map((v) => v.rule)).toContain('SG7');
    expect(rec.game?.result?.autonomousBonus).toEqual({ red: 0, blue: 12 });
    expect(rec.events.some((e) => e.message.startsWith('<SG7>'))).toBe(true);
  });
});

/** A robot preset on the Override field, stepped like the runtime, checking for phasing every step. */
async function onField(robotId: string, start: { x: number; y: number; theta: number }, clearAround?: { x: number; y: number; r: number }) {
  const f = await field();
  // take the pieces near a spot off the field (an open lane to a Goal)
  if (clearAround) {
    const h2h = f.layouts!.h2h;
    h2h.items = h2h.items.filter((it) => it.type === 'goal' || Math.hypot(it.x - clearAround.x, it.y - clearAround.y) > clearAround.r);
  }
  const r = await robot(robotId);
  const world = new World(r, f, start);
  const game = await OverrideGame.create(f, 'h2h', world);
  const problems: string[] = [];
  const run = (ms: number) => {
    for (let t = 1; t <= ms; t++) {
      world.step(1);
      game.step(1);
      const held = world.attachments.map((a) => {
        const [x, y] = toField(world.pose, a);
        return { name: a.id, x, y, r: a.r, bottom: a.bottom, fixedOnly: a.fixedOnly };
      });
      for (const p of phasing(f, game.state, world.footprint(), held)) problems.push(`${p.what} by ${p.depth.toFixed(2)}`);
    }
  };
  const drive = (power: number) => {
    for (const p of [...r.drivetrain.left, ...r.drivetrain.right]) world.motor(p).cmd = power * Math.sign(p);
  };
  /** The 6-bar (port 7, 1:5) at an angle, held there. */
  const sixBar = (deg: number) => {
    world.motor(7).angle = deg / 0.2;
    world.motor(7).brakeMode = 2;
  };
  const clawAt = () => game.manipulators.effector(r.mechanisms.find((m): m is ClawSpec => m.kind === 'claw')!);
  return { f, r, world, game, run, drive, sixBar, clawAt, problems };
}

const R2 = { x: -23.547, y: -47.091 }; // red alliance Goal, 3.25" tall

describe('nothing phases through anything', () => {
  it('a Pin held out in front pushes a standing stack instead of passing through it', async () => {
    // the 6-bar's claw is 10" ahead (outside the 15" frame), holding the Preload on the tiles
    const s = await onField('override-sixbar-wrist', { x: -23.548, y: -40, theta: 0 });
    const stack = s.game.state.floor.find((st) => Math.hypot(st.x + 23.548, st.y + 23.548) < 0.1)!;
    s.world.adiOut.set('A', true);
    s.drive(60);
    s.run(900);
    expect(s.game.state.held.Claw.map((p) => p.id)).toEqual(['preload']);
    expect(s.problems).toEqual([]);
    expect(stack.y).toBeGreaterThan(-23.548 + 10); // shoved north by the Preload, ahead of the robot
  });

  it('a Pin carried below a Goal top runs into the Goal, and opening the claw there does not score it', async () => {
    const s = await onField('override-sixbar-wrist', { x: R2.x, y: -62, theta: 0 }, { x: R2.x, y: -62, r: 12 });
    s.world.adiOut.set('A', true);
    s.drive(60);
    s.run(900);
    const e = s.clawAt();
    expect(Math.hypot(e.x - R2.x, e.y - R2.y)).toBeGreaterThan(4); // stopped against the Goal's side
    s.world.adiOut.set('A', false);
    s.run(300);
    expect(s.game.state.goals.R2).toEqual([]);
    expect(s.problems).toEqual([]);
  });

  it('lifted over the Goal top, the same Pin goes over it and in', async () => {
    const s = await onField('override-sixbar-wrist', { x: R2.x, y: -62, theta: 0 }, { x: R2.x, y: -62, r: 12 });
    s.world.adiOut.set('A', true);
    s.sixBar(16); // the Pin's bottom 3.6" up, over the 3.25" Goal
    s.run(300);
    s.drive(60);
    s.run(900); // until the chassis meets the Goal's base, the claw just past its center
    s.world.adiOut.set('A', false);
    s.run(300);
    expect(s.game.state.goals.R2.map((p) => p.id)).toEqual(['preload']);
    expect(s.problems).toEqual([]);
  });

  it('pieces on a Goal are solid: a Pin carried below a Placed Pin runs into it', async () => {
    const s = await onField('override-sixbar-wrist', { x: R2.x, y: -62, theta: 0 }, { x: R2.x, y: -62, r: 12 });
    s.game.state.goals.R2.push({ kind: 'pin', id: 'placed', colors: ['red', 'yellow'] });
    s.game.changed();
    s.world.adiOut.set('A', true);
    s.sixBar(16); // over the Goal top, but not over the Placed Pin (6.8" up)
    s.run(300);
    s.drive(60);
    s.run(900);
    const e = s.clawAt();
    expect(Math.hypot(e.x - R2.x, e.y - R2.y)).toBeGreaterThan(2.9); // a Pin's width from the Placed one
    expect(s.problems).toEqual([]);
  });

  it('a lift lowering a held Pin onto a Goal from above stops on the Goal top', async () => {
    const s = await onField('override-sixbar-wrist', { x: R2.x, y: -62, theta: 0 }, { x: R2.x, y: -62, r: 12 });
    s.world.adiOut.set('A', true);
    s.sixBar(16); // carried over the Goal top
    s.run(300);
    s.drive(60);
    s.run(900); // the Pin is over the Goal, just off its center
    s.drive(0);
    s.world.motor(7).cmd = -127; // now drive the 6-bar down, all the way
    s.run(1000);
    const held = s.world.attachments.find((a) => a.id.startsWith('claw:'))!;
    expect(held.bottom).toBeGreaterThan(3.248 - 0.3); // resting on the Goal top, not sunk into it
    expect(s.problems).toEqual([]);
  });

  it('a robot corner grazing a stack at full speed shoves it aside without the stack ending up inside', async () => {
    // the 18" pusher's left edge passes right over the center of the stack at (-47, -47)
    const s = await onField('override-midfield-pusher', { x: -38, y: -60.705, theta: 0 });
    s.drive(127);
    s.run(1500);
    expect(s.problems).toEqual([]);
  });

  it('a robot whose rear claw would hold the Preload through the wall starts far enough in', async () => {
    const s = await onField('override-fourbar-claw', { x: -60.705, y: -37, theta: 90 });
    expect(s.world.pose.x).toBeCloseTo(-57.62, 1);
    expect(s.game.notes.some((n) => n.includes('through the perimeter wall'))).toBe(true);
    s.world.adiOut.set('A', true);
    s.drive(-60); // backing into the wall: the Preload stops the robot
    s.run(600);
    expect(s.problems).toEqual([]);
  });
});
