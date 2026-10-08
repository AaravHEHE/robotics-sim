import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { OverrideGame } from '../src/games/override/game.ts';
import { loaderMouth, startingState } from '../src/games/override/manipulators.ts';
import type { FieldDef } from '../src/sim/field.ts';
import { clawEffector, clawTilt, heldBottom, liftEffector, toRobot } from '../src/sim/lift.ts';
import { validateProfile, type ClawSpec, type DeviceSpec, type LiftSpec, type MechanismSpec, type RobotProfile } from '../src/sim/profile.ts';
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
    // robot facing +x; lifted 20°, the Pin's bottom (3.9" up) clears the Goal top and the claw
    // (11.4" ahead) is over Goal R1
    const { game, run, world, lift } = await setup(r, { x: R1.x - 11.73, y: R1.y, theta: 90 }, 'h2h', (w) => w.adiOut.set('B', true));
    expect(game.state.held.Claw.map((p) => p.kind === 'pin' && p.colors)).toEqual([['red', 'yellow']]);
    lift(20);
    run(250);
    world.adiOut.set('B', false); // open
    run(250);
    expect(game.state.held.Claw).toEqual([]);
    expect(game.state.goals.R1.map((p) => p.id)).toEqual(['preload']);
    // it fell the 3.6" from where it was let go into the socket
    expect(game.state.transit.preload.from.z).toBeCloseTo(3.92, 1);
    expect(game.state.transit.preload.to!.z).toBeCloseTo(0.315, 2);
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
    world.pose = { x: R1.x - 11.73, y: R1.y, theta: 90 };
    game.robotTeleported();
    lift(20); // the Cup's bottom ~4" up, above the Goal top
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

  it('a jammer wedged against a Toggle stops it turning, and a Toggle still jammed at the end is neutral', async () => {
    const roller: MechanismSpec = { kind: 'toggleTool', name: 'Roller', tool: 'roller', motors: [8], ratio: 1, box: { x: 0, y: 8.5, width: 10, length: 2 }, bottom: 10.5, top: 14 };
    const jammer: MechanismSpec = { kind: 'toggleTool', name: 'Jammer', tool: 'jammer', adi: 'C', box: { x: -3.5, y: 9, width: 1, length: 2 }, bottom: 11, top: 13 };
    const r = await testRobot([roller, jammer]);
    const { game, run, world, drive } = await setup(r, { x: -55, y: 0, theta: 270 });
    const angle = () => game.state.toggles.find((x) => x.id === 'T_red1')!.angle;
    drive(30);
    run(800);
    world.adiOut.set('C', true); // wedge it
    run(300);
    world.motor(8).cmd = 127;
    run(800);
    expect(angle()).toBe(0); // the roller can't turn it
    expect(game.score().score.toggles.find((x) => x.id === 'T_red1')!.color).toBe('yellow'); // touched: neutral (SC4)
    world.adiOut.set('C', false); // let go: now the roller turns it
    run(800);
    expect(angle()).toBeLessThan(-30);
  });

  it('a pneumatic plate only touches the Toggle while extended', async () => {
    const plate: MechanismSpec = { kind: 'toggleTool', name: 'Plate', tool: 'plate', adi: 'C', box: { x: 0, y: 8.5, width: 10, length: 2 }, bottom: 11, top: 14 };
    const r = await testRobot([plate]);
    const { game, run, world, drive } = await setup(r, { x: -55, y: 0, theta: 270 });
    drive(30);
    run(1000);
    expect(game.state.toggles.find((x) => x.id === 'T_red1')!.angle).toBe(0);
    world.adiOut.set('C', true);
    run(900); // a face takes about half a second to roll and settle
    expect(game.state.toggles.find((x) => x.id === 'T_red1')!.angle).toBe(120);
  });
});

describe('manipulators behave like the real mechanisms', () => {
  const N_R1 = { x: -47.091, y: 23.547 }; // neutral Goal, 5.77" tall, holding a yellow Pin
  const intake: MechanismSpec = { kind: 'intake', name: 'Intake', motors: [10], ratio: 1, zone: { x: 0, y: 8, width: 8, length: 2 } };

  it('a claw that only ever opens lets go of the Preload', async () => {
    const r = await testRobot([LIFT, claw]);
    const { game, run } = await setup(r, { x: -30, y: -50, theta: 90 }); // solenoid never set
    run(400);
    expect(game.state.held.Claw).toEqual([]);
    const motorClaw: MechanismSpec = { kind: 'claw', name: 'Claw', lift: 'Lift', grip: 'motor', motors: [8], ratio: 1, closedAt: 60, preload: 'alliance-down' };
    // a motor claw starts closed on the Preload (loaded by hand) and lets go once it opens
    const m = await setup(await testRobot([LIFT, motorClaw]), { x: -30, y: -50, theta: 90 });
    expect(m.world.mechanismState(motorClaw)).toBe(60);
    m.run(100);
    expect(m.game.state.held.Claw.length).toBe(1);
    m.world.motor(8).angle = 0;
    m.run(100);
    expect(m.game.state.held.Claw).toEqual([]);
  });

  it('closing beside a Goal does not take its Pin: only what is between the jaws', async () => {
    const r = await testRobot([LIFT, { ...claw, preload: undefined }]);
    // claw at the Pin's height, its grip point 1.3" past and 1.5" to the side of the Goal's center:
    // within the old 2" capture circle, but the Pin isn't between the jaws
    const { game, run, world, lift } = await setup(r, { x: N_R1.x - 10.3, y: N_R1.y + 1.5, theta: 90 });
    lift(25);
    run(250);
    world.adiOut.set('B', true);
    run(250);
    expect(game.state.goals.N_R1.length).toBe(1);
    expect(game.state.held.Claw).toEqual([]);
    expect(game.rules.violations).toEqual([]);
  });

  it('a Pin released onto a Pin does not nest: it falls off', async () => {
    const r = await testRobot([LIFT, claw]);
    const { game, run, world } = await setup(r, { x: R1.x - 10.3, y: R1.y, theta: 90 }, 'h2h', (w) => w.adiOut.set('B', true));
    game.state.goals.R1.push({ kind: 'pin', id: 'p0', colors: ['red', 'yellow'] });
    run(250);
    world.adiOut.set('B', false);
    run(250);
    expect(game.state.goals.R1.map((p) => p.id)).toEqual(['p0']);
    expect(game.state.lying.some((l) => l.id.startsWith('d') || l.colors.join() === 'red,yellow')).toBe(true);
  });

  it('a dropped piece lands outside the robot, not inside its frame', async () => {
    const deckClaw: MechanismSpec = { kind: 'claw', name: 'Claw', at: { y: 0, z: 8 }, grip: 'piston', adi: 'B', preload: 'alliance-down' };
    const r = await testRobot([deckClaw]);
    const { game, run, world } = await setup(r, { x: -30, y: -50, theta: 90 }, 'h2h', (w) => w.adiOut.set('B', true));
    run(100);
    world.adiOut.set('B', false);
    run(400);
    const d = game.state.lying.find((l) => l.id === 'preload' || l.colors.join() === 'red,yellow' && Math.hypot(l.x + 30, l.y + 50) < 15)!;
    expect(d).toBeDefined();
    const [lx, ly] = toRobot(world.pose, d.x, d.y);
    const { width, length } = r.size;
    expect(Math.abs(lx) >= width / 2 || Math.abs(ly) >= length / 2).toBe(true);
  });

  it('an intake at the bumper takes a stack the robot pushes against', async () => {
    const r = await testRobot([{ ...intake, zone: { x: 0, y: 7.5, width: 8, length: 1.5 }, capacity: { pins: 1, cups: 1 } }]);
    // the Midfield-corner stack (a Cup holding a Pin) at (-23.548, -23.548), approached from the south
    const { game, run, world, drive } = await setup(r, { x: -23.548, y: -40, theta: 0 });
    world.motor(10).cmd = 127;
    drive(40);
    run(1500);
    expect(game.state.held.Intake.map((p) => p.kind)).toEqual(['cup', 'pin']);
  });

  it('an intake waits for its claw to open before handing over', async () => {
    const r = await testRobot([LIFT, { ...claw, preload: undefined }, { ...intake, into: 'Claw' }]);
    const { game, run, world, drive } = await setup(r, { x: -23.548, y: -40, theta: 0 }, 'h2h', (w) => w.adiOut.set('B', true));
    world.motor(10).cmd = 127;
    drive(40);
    run(1500, (t) => t === 1200 && drive(0));
    expect(game.state.held.Claw).toEqual([]); // closed: nothing gets in
    expect(game.state.held.Intake.length).toBe(2);
    world.adiOut.set('B', false); // open: the stack slides into the claw...
    run(600);
    expect(game.state.held.Claw.map((p) => p.kind)).toEqual(['cup', 'pin']); // ...and rests there
    world.adiOut.set('B', true);
    run(300);
    expect(game.state.held.Claw.length).toBe(2);
  });

  it('a Loader gives out one loaded stack (Pin + nested Cup) at a time, ~0.2 s apart', async () => {
    const r = await testRobot([{ ...intake, capacity: { pins: 5, cups: 5 } }]);
    const f = await field();
    const L = f.loaders!.find((l) => l.id === 'L_red_s')!;
    const [mx, my] = loaderMouth(f, L);
    const { game, run, world } = await setup(r, { x: mx + 9, y: my, theta: 270 }, 'skills');
    run(1100); // the drive team stocks the chute with loaded stacks
    expect(game.state.loaders.L_red_s.map((p) => p.kind)).toEqual(['pin', 'cup']);
    const got: Array<{ t: number; n: number; kinds: string }> = [];
    world.motor(10).cmd = 127;
    run(1500, (t) => {
      const n = game.state.held.Intake.length;
      if (n > (got.at(-1)?.n ?? 0)) got.push({ t, n, kinds: game.state.held.Intake.map((p) => p.kind).join() });
    });
    expect(got[0]).toMatchObject({ n: 2, kinds: 'pin,cup' }); // the Pin and its Cup come out together
    for (let i = 1; i < got.length; i++) expect(got[i].t - got[i - 1].t).toBeGreaterThanOrEqual(200);
  });

  it('a motor wrist flips once past 90 degrees, without chattering around it', async () => {
    const wrist: MechanismSpec = { kind: 'wrist', name: 'Wrist', claw: 'Claw', motors: [8], ratio: 1 };
    const r = await testRobot([LIFT, claw, wrist]);
    const { game, run, world } = await setup(r, { x: -30, y: -50, theta: 90 }, 'h2h', (w) => w.adiOut.set('B', true));
    const flips: string[] = [];
    const colors = () => (game.state.held.Claw[0] as { colors: string[] }).colors.join('/');
    for (const a of [80, 92, 88, 93, 87, 96, 120, 95, 84, 60]) {
      world.motor(8).angle = a;
      world.motor(8).brakeMode = 2;
      run(20);
      flips.push(colors());
    }
    // flips past 95, flips back below 85
    expect(flips).toEqual(['red/yellow', 'red/yellow', 'red/yellow', 'red/yellow', 'red/yellow', 'yellow/red', 'yellow/red', 'yellow/red', 'red/yellow', 'red/yellow']);
  });
});

describe('each robot type works like its real counterpart', () => {
  it('a claw holds pieces where it closes on them: a Preload stands on the tiles, gripped above its tip', async () => {
    const f = await field();
    for (const id of readdirSync(path.join(repoRoot, 'data/robots')).filter((n) => n.startsWith('override-')).map((n) => n.replace(/.json$/, ''))) {
      const r = await robot(id);
      const c = r.mechanisms.find((m): m is ClawSpec => m.kind === 'claw' && !!m.preload);
      if (!c) continue;
      const world = new World(r, f, { x: -30, y: -50, theta: 90 });
      const game = await OverrideGame.create(f, 'h2h', world);
      for (let t = 0; t < 5; t++) game.step(1); // manipulators update every physics step (5 ms)
      const z = clawEffector(r, c, (m) => world.mechanismState(m)).z;
      expect(game.state.grip[c.name], id).toBeGreaterThanOrEqual(1);
      // its bottom on the tiles (or just above them, held near its top by a high claw)
      expect(z - game.state.grip[c.name], id).toBeGreaterThanOrEqual(-1e-9);
      expect(z - game.state.grip[c.name], id).toBeLessThanOrEqual(1);
    }
  });

  it('a chain bar riding a cascade: the carriage sets the height, the bar swings the level claw front to back', async () => {
    const r = await robot('tank-6m-450');
    const cascade: LiftSpec = { kind: 'lift', name: 'Cascade', lift: 'cascade', motors: [7], ratio: 1, home: { y: 0, z: 6 }, spoolDiameter: 1.5, stages: 2 };
    const bar: LiftSpec = { kind: 'lift', name: 'Chain bar', lift: 'chainbar', base: 'Cascade', motors: [8], ratio: 1, home: { y: 11, z: 6 }, length: 11, startAngle: 0 };
    const c: ClawSpec = { kind: 'claw', name: 'Claw', lift: 'Chain bar', grip: 'piston', adi: 'B' };
    r.mechanisms = [cascade, bar, c];
    const at = (spool: number, swing: number) => clawEffector(r, c, (m) => (m.name === 'Cascade' ? spool : m.name === 'Chain bar' ? swing : 0));
    expect(at(0, 0)).toMatchObject({ y: 11, z: 6 }); // out front, low
    const up = at(360, 0);
    expect(up.z).toBeCloseTo(6 + Math.PI * 1.5 * 2, 6); // the carriage carried it up
    const over = at(360, 180);
    expect(over.y).toBeCloseTo(-11, 6); // swung over the top to the back
    expect(over.z).toBeCloseTo(up.z, 6);
    expect(clawTilt(r, c, () => 90)).toBe(0); // chained level all the way round
  });

  it('a Toggle pressed at speed turns two faces; a gentle press, one', async () => {
    const bumper: MechanismSpec = { kind: 'toggleTool', name: 'Bumper', tool: 'bumper', box: { x: 0, y: 7.75, width: 12, length: 0.5 }, bottom: 11, top: 13.5 };
    const run = async (power: number) => {
      const r = await testRobot([bumper]);
      const { game, run: go, drive } = await setup(r, { x: -55, y: 0, theta: 270 });
      drive(power);
      go(900);
      drive(-60);
      go(400);
      return game.state.toggles.find((x) => x.id === 'T_red1')!.angle;
    };
    expect(await run(30)).toBe(120);
    expect(await run(127)).toBe(240);
  });

  it('a Toggle hit at speed carries on to the second face even when the robot backs straight off', async () => {
    const bumper: MechanismSpec = { kind: 'toggleTool', name: 'Bumper', tool: 'bumper', box: { x: 0, y: 7.75, width: 12, length: 0.5 }, bottom: 11, top: 13.5 };
    const r = await testRobot([bumper]);
    const { game, run, drive } = await setup(r, { x: -45, y: 0, theta: 270 });
    const toggle = () => game.state.toggles.find((x) => x.id === 'T_red1')!;
    drive(127);
    run(2000, (t) => {
      if (toggle().touched) drive(-60); // pull away the moment it touches
    });
    expect(toggle().angle).toBe(240);
    expect(game.score().score.toggles.find((x) => x.id === 'T_red1')!.color).toBe('red');
  });

  it('a rear-facing bar lift swings its claw out behind the robot as it rises', () => {
    const rear: LiftSpec = { ...LIFT, facing: 'rear', home: { y: -10, z: 3 } };
    const up = liftEffector(rear, 30); // -30° -> 0°: the bar is horizontal, at full reach
    expect(up.y).toBeLessThan(-10);
    expect(up.y).toBeCloseTo(-10 - 12 * (1 - Math.cos(Math.PI / 6)), 6);
    expect(liftEffector(LIFT, 30).y).toBeCloseTo(10 + 12 * (1 - Math.cos(Math.PI / 6)), 6);
  });

  it('an arm claw tilts with the arm: raised, it can neither grab a standing stack nor set one down', async () => {
    const ARM: LiftSpec = { kind: 'lift', name: 'Lift', lift: 'arm', motors: [7], ratio: 0.2, range: [0, 95], home: { y: 10, z: 3 }, length: 9, startAngle: -15 };
    const r = await testRobot([ARM, claw]);
    // held Preload over R1 with the arm raised 40°: the Pin hangs at an angle and won't go on
    const a = await setup(r, { x: R1.x - 10 - 9 * (Math.cos((25 * Math.PI) / 180) - Math.cos((15 * Math.PI) / 180)), y: R1.y, theta: 90 }, 'h2h', (w) => w.adiOut.set('B', true));
    a.lift(40);
    a.run(250);
    a.world.adiOut.set('B', false);
    a.run(250);
    expect(a.game.state.goals.R1).toEqual([]);
    // a longer arm raised only 17° holds it nearly upright, over the Goal top: it places
    const ARM2: LiftSpec = { ...ARM, length: 12, home: { y: 10, z: 5 } };
    const r2 = await testRobot([ARM2, claw]);
    const grip = clawEffector(r2, claw as ClawSpec, () => 0).z; // the Preload starts on the tiles
    const at = heldBottom(r2, claw as ClawSpec, () => 17, grip);
    expect(at.z).toBeGreaterThan(3.248);
    const b = await setup(r2, { x: R1.x - at.y, y: R1.y, theta: 90 }, 'h2h', (w) => {
      w.adiOut.set('B', true);
      w.motor(7).angle = 17 / 0.2;
      w.motor(7).brakeMode = 2;
    });
    b.run(250);
    b.world.adiOut.set('B', false);
    b.run(250);
    expect(b.game.state.goals.R1.map((p) => p.id)).toEqual(['preload']);
  });

  it('a roller claw spits pieces out one at a time, bottom first', async () => {
    const rollerClaw: MechanismSpec = { kind: 'claw', name: 'Claw', lift: 'Lift', grip: 'roller', motors: [8], ratio: 1 };
    const r = await testRobot([LIFT, rollerClaw]);
    // the rollers on the Pin's collar, just under the Cup's rim, the Pin's bottom 6" up
    const { game, run, world } = await setup(r, { x: R1.x - 11.6, y: R1.y, theta: 90 }, 'h2h', (w) => {
      w.motor(7).angle = 30 / 0.2;
      w.motor(7).brakeMode = 2;
    });
    game.state.held.Claw = [{ kind: 'pin', id: 'p', colors: ['red', 'yellow'] }, { kind: 'cup', id: 'c', up: 'clear' }];
    (game.manipulators as unknown as { claws: Array<{ grip: number }> }).claws[0].grip = 3;
    world.motor(8).cmd = -127; // spin out
    const placed: number[] = [];
    run(1000, (t) => {
      if (game.state.goals.R1.length > placed.length) placed.push(t);
    });
    expect(game.state.goals.R1.map((p) => p.id)).toEqual(['p', 'c']); // the Pin into the Goal, then the Cup over it
    expect(placed[1] - placed[0]).toBeGreaterThan(30);
  });

  it('a wrist halfway through its turn cannot set the stack down: it falls', async () => {
    const wrist: MechanismSpec = { kind: 'wrist', name: 'Wrist', claw: 'Claw', motors: [8], ratio: 1 };
    const r = await testRobot([LIFT, claw, wrist]);
    const { game, run, world } = await setup(r, { x: R1.x - 10.3, y: R1.y, theta: 90 }, 'h2h', (w) => w.adiOut.set('B', true));
    world.motor(8).angle = 60;
    world.motor(8).brakeMode = 2;
    run(250);
    world.adiOut.set('B', false);
    run(250);
    expect(game.state.goals.R1).toEqual([]);
  });
});

describe('the field shown before a run', () => {
  it('is the starting layout with the Preload in the robot, in the starting alliance color', async () => {
    const f = await field();
    const r = await robot('override-banshee');
    const red = startingState(f, 'h2h', r, { x: -60.705, y: -37 });
    expect(red.held['Roller claw']).toEqual([{ kind: 'pin', id: 'preload', colors: ['red', 'yellow'] }]);
    expect(Object.values(red.goals).every((g) => g.length <= 1)).toBe(true); // nothing scored yet
    const blue = startingState(f, 'h2h', r, { x: 60.705, y: 37 });
    expect(blue.held['Roller claw'][0]).toMatchObject({ colors: ['blue', 'yellow'] });
    // and it is exactly what the simulator starts from
    const world = new World(r, f, { x: -60.705, y: -37, theta: 90 });
    const game = await OverrideGame.create(f, 'h2h', world);
    expect(game.state.held).toEqual(red.held);
    expect(game.state.floor.map((x) => x.id)).toEqual(red.floor.map((x) => x.id));
  });
});

describe('Override manipulators from compiled code', () => {
  it('a PROS program backs its rear claw up to its Goal and drops the Preload in: +5 for red', async () => {
    const rec = await simulate(
      prosProject(`#include "main.h"
pros::MotorGroup left({-1, -2, -3}, pros::MotorGears::blue);
pros::MotorGroup right({4, 5, 6}, pros::MotorGears::blue);
pros::Motor lift(7, pros::MotorGears::green, pros::MotorUnits::degrees); // 4-bar, 1:5, out the back
pros::adi::Pneumatics claw('A', true); // closed on the Preload
void initialize() {}
void autonomous() {
  lift.move_absolute(18 * 5, 200); pros::delay(300); // lift the Preload clear of the 3.25" Goal
  left.move_relative(-195, 200); right.move_relative(-195, 200); pros::delay(800); // back ~4" over Goal R1
  claw.retract(); pros::delay(300);                  // let go
  lift.move_absolute(40 * 5, 200);
  left.move(50); right.move(50); pros::delay(300);
  left.brake(); right.brake();
}
`),
      'override-fourbar-claw',
      { field: await field(), start: { x: R1.x, y: R1.y + 16.5, theta: 0 } }, // north of R1, claw toward it
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
