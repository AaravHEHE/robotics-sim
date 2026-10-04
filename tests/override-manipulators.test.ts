import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { OverrideGame } from '../src/games/override/game.ts';
import { loaderMouth } from '../src/games/override/manipulators.ts';
import type { FieldDef } from '../src/sim/field.ts';
import { liftEffector } from '../src/sim/lift.ts';
import { validateProfile, type DeviceSpec, type LiftSpec, type MechanismSpec, type RobotProfile } from '../src/sim/profile.ts';
import { World } from '../src/sim/world.ts';
import { prosProject, robot, simulate } from './helpers.ts';

const field = async () => JSON.parse(await readFile(path.join(repoRoot, 'data/fields/override.json'), 'utf8')) as FieldDef;

const LIFT: LiftSpec = { kind: 'lift', name: 'Lift', lift: 'fourbar', motors: [7], ratio: 0.2, range: [0, 110], home: { y: 10, z: 3 }, length: 12, startAngle: -30 };

/** The 6-motor tank with extra devices and mechanisms. */
async function testRobot(mechanisms: MechanismSpec[], devices: DeviceSpec[] = []): Promise<RobotProfile> {
  const r = await robot('tank-6m-450');
  r.devices = [
    { type: 'imu', port: 11 },
    { type: 'motor', port: 7, cartridge: 'green', name: 'Lift' },
    { type: 'motor', port: 10, cartridge: 'blue', name: 'Intake' },
    { type: 'motor', port: 8, cartridge: 'green', name: 'Roller' },
    { type: 'adi_digital_out', port: 'B', name: 'Claw' },
    { type: 'adi_digital_out', port: 'C', name: 'Wrist' },
    ...devices,
  ];
  r.mechanisms = mechanisms;
  expect(validateProfile(r)).toEqual([]);
  return r;
}

async function setup(r: RobotProfile, start: { x: number; y: number; theta: number }, layout = 'h2h', before?: (w: World) => void) {
  const f = await field();
  const world = new World(r, f, start);
  before?.(world);
  const game = await OverrideGame.create(f, layout, world);
  const run = (ms: number, each?: (t: number) => void) => {
    for (let t = 1; t <= ms; t++) {
      each?.(t);
      world.step(1);
      game.step(1);
    }
  };
  const drive = (power: number) => {
    for (const p of [...r.drivetrain.left, ...r.drivetrain.right]) world.motor(p).cmd = power * Math.sign(p);
  };
  /** Put a lift at an output angle (degrees). */
  const lift = (out: number) => {
    world.motor(7).angle = out / 0.2;
    world.motor(7).brakeMode = 2; // hold: an unpowered lift would sag under its weight
  };
  return { f, world, game, run, drive, lift };
}

const R1 = { x: -47.091, y: -23.547 }; // red alliance Goal, 3.25" tall
const claw: MechanismSpec = { kind: 'claw', name: 'Claw', lift: 'Lift', grip: 'piston', adi: 'B', preload: 'alliance-down' };

describe('lift kinematics', () => {
  it('each lift type moves its end effector along the expected path', () => {
    const base = { home: { y: 10, z: 3 }, motors: [7], ratio: 1, name: 'L', kind: 'lift' as const };
    const four = liftEffector({ ...base, lift: 'fourbar', length: 12, startAngle: -30 }, 60);
    expect(four.z).toBeCloseTo(3 + 12 * (Math.sin(Math.PI / 6) + Math.sin(Math.PI / 6)), 6);
    expect(four.y).toBeCloseTo(10, 6); // -30° -> +30°: same reach
    const dr4b = liftEffector({ ...base, lift: 'dr4b', length: 12, startAngle: -30 }, 60);
    expect(dr4b.z).toBeCloseTo(3 + 24, 6);
    expect(dr4b.y).toBe(10);
    const six = liftEffector({ ...base, lift: 'sixbar', length: 12, startAngle: -30 }, 60);
    expect(six.z).toBeCloseTo(3 + 24, 6);
    const cascade = liftEffector({ ...base, lift: 'cascade', spoolDiameter: 1.5, stages: 2 }, 360 * 3);
    expect(cascade.z).toBeCloseTo(3 + 3 * Math.PI * 1.5 * 2, 6);
    const piston = liftEffector({ ...base, lift: 'piston', travel: 8, motors: undefined, adi: 'C' }, 1);
    expect(piston.z).toBe(11);
  });

  it('rejects incomplete manipulator profiles', async () => {
    const r = await robot('tank-6m-450');
    r.mechanisms = [
      { kind: 'lift', name: 'L', lift: 'dr4b', motors: [7], ratio: 1, home: { y: 8, z: 4 } },
      { kind: 'claw', name: 'C', lift: 'Nope', grip: 'motor', motors: [8], ratio: 1 },
      { kind: 'intake', name: 'I', motors: [9], ratio: 1, zone: { x: 0, y: 9, width: 6, length: 3 }, into: 'L' },
    ];
    const e = validateProfile(r).join('\n');
    expect(e).toMatch(/Lift L: length/);
    expect(e).toMatch(/Claw C: closedAt/);
    expect(e).toMatch(/lift "Nope"/);
    expect(e).toMatch(/into "L" must name a claw or staging/);
  });
});

describe('Override claws', () => {
  it('starts with the Preload and places it on the alliance Goal', async () => {
    const r = await testRobot([LIFT, claw]);
    // robot facing +x, its claw (10" ahead) over Goal R1
    const { game, run, world } = await setup(r, { x: R1.x - 10.3, y: R1.y, theta: 90 }, 'h2h', (w) => w.adiOut.set('B', true));
    expect(game.state.held.Claw.map((p) => p.kind === 'pin' && p.colors)).toEqual([['red', 'yellow']]);
    run(250);
    world.adiOut.set('B', false); // open
    run(250);
    expect(game.state.held.Claw).toEqual([]);
    expect(game.state.goals.R1.map((p) => p.id)).toEqual(['preload']);
    expect(game.score().score.red).toBe(5); // red half visible; yellow half unowned (neutral Toggle)
  });

  it('opening away from a Goal, or too high over it, drops the piece', async () => {
    const r = await testRobot([LIFT, claw]);
    const a = await setup(r, { x: -30, y: -50, theta: 90 }, 'h2h', (w) => w.adiOut.set('B', true));
    const lying = a.game.state.lying.length;
    a.world.adiOut.set('B', false);
    a.run(250);
    expect(a.game.state.lying.length).toBe(lying + 1);
    const b = await setup(r, { x: R1.x - 10.3, y: R1.y, theta: 90 }, 'h2h', (w) => w.adiOut.set('B', true));
    b.lift(100); // claw ~ 20" up, far above the Goal
    b.run(250);
    b.world.adiOut.set('B', false);
    b.run(250);
    expect(b.game.state.goals.R1).toEqual([]);
    const d = b.game.state.lying.at(-1)!;
    expect(Math.hypot(d.x - R1.x, d.y - R1.y)).toBeGreaterThan(2.8); // dropped beside it, not Placed
  });

  it('closes on a floor stack, carries it, and stacks it on a Goal', async () => {
    const r = await testRobot([LIFT, { ...claw, preload: undefined }]);
    // the clear-up Cup holding a yellow Pin at (-23.548, -23.548), approached from the south
    const { game, run, world, lift } = await setup(r, { x: -23.548, y: -23.548 - 10, theta: 0 });
    const n = game.state.floor.length;
    world.adiOut.set('B', true);
    run(250);
    expect(game.state.floor.length).toBe(n - 1);
    expect(game.state.held.Claw.map((p) => p.kind)).toEqual(['cup', 'pin']); // taken whole, in order
    // carry it over R1 and lower it in: a Cup can't be Placed directly in a Goal (SC2)
    world.pose = { x: R1.x - 10.3, y: R1.y, theta: 90 };
    game.robotTeleported();
    lift(10); // cup bottom ~2" up, just above the Goal top
    run(250);
    world.adiOut.set('B', false);
    run(250);
    expect(game.state.goals.R1.map((p) => p.kind)).toEqual(['cup', 'pin']);
    expect(game.score().score.goals.find((g) => g.goal === 'R1')!.placedPins).toBe(0);
  });

  it('a wrist turns the held stack end over end', async () => {
    const r = await testRobot([LIFT, claw, { kind: 'wrist', name: 'Wrist', claw: 'Claw', adi: 'C' }]);
    const { game, run, world } = await setup(r, { x: -30, y: -50, theta: 90 }, 'h2h', (w) => w.adiOut.set('B', true));
    world.adiOut.set('C', true);
    run(250);
    expect(game.state.held.Claw.map((p) => p.kind === 'pin' && p.colors)).toEqual([['yellow', 'red']]);
  });

  it('taking from a neutral Goal in head-to-head is an SG10 violation', async () => {
    const r = await testRobot([LIFT, { ...claw, preload: undefined }]);
    // neutral Goal N_R1 at (-47.091, 23.547), 5.77" tall, holding a yellow Pin
    const { game, run, world, lift } = await setup(r, { x: -47.091 - 10.3, y: 23.547, theta: 90 });
    lift(25); // grip height ~ 8": inside the Placed Pin
    run(250);
    world.adiOut.set('B', true);
    run(250);
    expect(game.state.goals.N_R1).toEqual([]);
    expect(game.rules.violations.map((v) => v.rule)).toContain('SG10');
  });
});

describe('Override intakes', () => {
  const intake: MechanismSpec = { kind: 'intake', name: 'Intake', motors: [10], ratio: 1, zone: { x: 0, y: 9, width: 8, length: 4 }, into: 'Stage' };
  const stage: MechanismSpec = { kind: 'staging', name: 'Stage', at: { y: 0, z: 6 } };

  it('pulls in a lying Pin and passes it to staging, end nearest the robot down', async () => {
    const r = await testRobot([intake, stage]);
    // cross cluster at (-47.091, 47.091): a red/yellow Pin lies to its left (west)
    const { game, run, world, drive } = await setup(r, { x: -62, y: 47.091, theta: 90 });
    const pinsBefore = game.state.lying.length;
    world.motor(10).cmd = 127;
    drive(40);
    let got = -1;
    run(2500, (t) => {
      if (got < 0 && game.state.lying.length < pinsBefore) {
        got = t;
        world.motor(10).cmd = 0; // one is enough
      }
      if (got > 0 && t > got + 30) drive(0);
    });
    expect(got).toBeGreaterThan(0);
    expect(game.state.held.Intake).toEqual([]);
    const staged = game.state.held.Stage;
    expect(staged[0]).toMatchObject({ kind: 'pin', colors: ['red', 'yellow'] }); // red end pointed at the robot
  });

  it('possessing two Pins is an SG6 violation', async () => {
    const r = await testRobot([LIFT, claw, { ...intake, into: undefined }]);
    const { game, run, world, drive } = await setup(r, { x: -23.548, y: 23.548 - 30, theta: 0 }, 'h2h', (w) => w.adiOut.set('B', true));
    world.motor(10).cmd = 127;
    drive(40);
    run(2500);
    expect(game.rules.violations.map((v) => v.rule)).toContain('SG6');
  });

  it('Skills: takes Match Loads from a red Loader, which the drive team keeps stocked', async () => {
    const r = await testRobot([{ ...intake, into: undefined, capacity: { pins: 5, cups: 5 } }]);
    const f = await field();
    const L = f.loaders!.find((l) => l.id === 'L_red_s')!;
    const [mx, my] = loaderMouth(f, L);
    const { game, run, world } = await setup(r, { x: mx + 9, y: my, theta: 270 }, 'skills');
    expect(game.state.matchLoads.red!.slice(0, 4).map((p) => p.kind)).toEqual(['pin', 'cup', 'pin', 'cup']);
    world.motor(10).cmd = 127;
    run(4000);
    const got = game.state.held.Intake;
    expect(got.length).toBeGreaterThanOrEqual(3);
    expect(game.state.matchLoads.red!.length + got.length + Object.values(game.state.loaders).flat().length).toBe(14);
  });
});

describe('Override Toggle tools', () => {
  it('a side roller spins a Toggle inward to the alliance color', async () => {
    const roller: MechanismSpec = { kind: 'toggleTool', name: 'Roller', tool: 'roller', motors: [8], ratio: 1, box: { x: 0, y: 8.5, width: 10, length: 2 }, bottom: 10.5, top: 14 };
    const r = await testRobot([roller]);
    const { game, run, world, drive } = await setup(r, { x: -55, y: 0, theta: 270 });
    drive(30);
    run(800);
    world.motor(8).cmd = 127; // + output, inward = 1: top rolls into the field
    let spun = 0;
    run(2000, (t) => {
      const a = game.state.toggles.find((x) => x.id === 'T_red1')!.angle;
      if (!spun && a <= -100) spun = t;
      if (spun && t === spun + 1) world.motor(8).cmd = 0;
    });
    drive(-60);
    run(500);
    const r1 = game.score().score.toggles.find((x) => x.id === 'T_red1')!;
    expect(r1.color).toBe('red');
  });

  it('a pneumatic plate only touches the Toggle while extended', async () => {
    const plate: MechanismSpec = { kind: 'toggleTool', name: 'Plate', tool: 'plate', adi: 'C', box: { x: 0, y: 8.5, width: 10, length: 2 }, bottom: 11, top: 14 };
    const r = await testRobot([plate]);
    const { game, run, world, drive } = await setup(r, { x: -55, y: 0, theta: 270 });
    drive(30);
    run(1000);
    expect(game.state.toggles.find((x) => x.id === 'T_red1')!.angle).toBe(0);
    world.adiOut.set('C', true);
    run(500);
    expect(game.state.toggles.find((x) => x.id === 'T_red1')!.angle).toBe(120);
  });
});

describe('Override manipulators from compiled code', () => {
  it('a PROS program drives to its Goal and drops the Preload in: +5 for red', async () => {
    const rec = await simulate(
      prosProject(`#include "main.h"
pros::MotorGroup left({-1, -2, -3}, pros::MotorGears::blue);
pros::MotorGroup right({4, 5, 6}, pros::MotorGears::blue);
pros::adi::Pneumatics claw('A', true); // closed on the Preload
void initialize() {}
void autonomous() {
  left.move(50); right.move(50); pros::delay(1000); // into Goal R1
  left.brake(); right.brake(); pros::delay(200);
  claw.retract(); pros::delay(200);                 // let go
  left.move(-50); right.move(-50); pros::delay(400);
  left.brake(); right.brake();
}
`),
      'override-fourbar-claw',
      { field: await field(), start: { x: -62.5, y: R1.y, theta: 90 } },
    );
    expect(rec.error).toBeNull();
    const g = rec.game!;
    expect(g.snapshots[0].state.held.Claw.map((p) => p.id)).toEqual(['preload']);
    expect(g.snapshots.at(-1)!.state.goals.R1.map((p) => p.id)).toEqual(['preload']);
    expect(g.result!.score.red).toBe(5);
    expect(g.result!.score.blue).toBe(0);
    expect(g.violations).toEqual([]);
  });
});

describe('robustness', () => {
  it('an internal simulator error ends the run with a message and keeps what was recorded', async () => {
    // a profile that skipped validation: a Toggle tool without its box
    const r = await robot('tank-6m-450');
    r.devices.push({ type: 'motor', port: 10, cartridge: 'blue' });
    r.mechanisms = [{ kind: 'toggleTool', name: 'Bumper', tool: 'bumper', bottom: 11, top: 13 } as unknown as MechanismSpec];
    const rec = await simulate(
      prosProject(`#include "main.h"
pros::Motor intake(10);
void initialize() {}
void autonomous() { intake.move(127); pros::delay(2000); }
`),
      'tank-6m-450',
      { field: await field(), profile: r, start: { x: -60.705, y: -37, theta: 90 } },
    );
    expect(rec.error).toMatch(/internal error/);
    expect(rec.frames.length).toBeGreaterThan(0);
  });
});
