import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import type { CupPiece, Piece, PinColor, PinPiece } from '../src/games/override/elements.ts';
import { OverrideGame, scoreState } from '../src/games/override/game.ts';
import { pastAutonLine, startsOnAutonLine } from '../src/games/override/rules.ts';
import { autonomousBonus, awp, placedPrefix, score, type Mode } from '../src/games/override/scoring.ts';
import { initialState, type OverrideState } from '../src/games/override/state.ts';
import { contactDepth, setColor, ToggleSim } from '../src/games/override/toggle.ts';
import type { FieldDef, Vec2 } from '../src/sim/field.ts';
import { World } from '../src/sim/world.ts';
import { robot } from './helpers.ts';

const field = async () => JSON.parse(await readFile(path.join(repoRoot, 'data/fields/override.json'), 'utf8')) as FieldDef;

let n = 0;
const pin = (a: PinColor, b: PinColor): PinPiece => ({ kind: 'pin', id: `p${++n}`, colors: [a, b] });
const cup = (up: 'gray' | 'clear'): CupPiece => ({ kind: 'cup', id: `c${++n}`, up });

/** An empty field state with the given goal contents and toggle angles. */
function stateWith(f: FieldDef, goals: Record<string, Piece[]>, toggles: Record<string, number> = {}): OverrideState {
  const s = initialState(f, 'skills');
  s.floor = [];
  s.lying = [];
  Object.assign(s.goals, goals);
  for (const t of s.toggles) t.angle = toggles[t.id] ?? 0;
  return s;
}

const run = (f: FieldDef, state: OverrideState, mode: Mode = 'h2h', mid = { red: 0, blue: 0 }, autonomous = false) =>
  score({ field: f, state, mode, robotsInMidfield: mid, autonomous });

/** Box footprint centered at (x, y), axis-aligned. */
const boxAt = (x: number, y: number, w = 15, l = 15): Vec2[] => [
  [x - w / 2, y - l / 2],
  [x + w / 2, y - l / 2],
  [x + w / 2, y + l / 2],
  [x - w / 2, y + l / 2],
];

describe('Override scoring (SC2–SC8)', () => {
  // the manual's worked example (page 17): 3 visible red, 1 visible blue and 3 visible
  // yellow halves in one Quadrant (here split over Red 1's two Goals)
  const example = () => ({
    R1: [pin('red', 'yellow'), cup('gray'), pin('yellow', 'red'), cup('gray'), pin('yellow', 'red')],
    N_R1: [pin('blue', 'yellow'), cup('gray'), pin('red', 'yellow')],
  });

  it('matches the manual worked example for each Toggle color', async () => {
    const f = await field();
    // red-side Toggle: 0 = yellow in, +120 = blue (down face) in, -120 = red (out face) in
    for (const [angle, red, blue] of [
      [0, 15, 5],
      [120, 15, 35],
      [-120, 45, 5],
    ]) {
      const s = run(f, stateWith(f, example(), { T_red1: angle }));
      expect([s.red, s.blue], `toggle at ${angle}°`).toEqual([red, blue]);
    }
  });

  it('opaque Cup halves hide Pin halves; clear halves do not', async () => {
    const f = await field();
    // gray half down over the pin's top (clear side up) hides the yellow top
    const covered = run(f, stateWith(f, { R1: [pin('red', 'yellow'), cup('clear')] }, { T_red1: -120 }));
    expect(covered.red).toBe(5);
    // clear half down: the yellow top stays visible
    const shown = run(f, stateWith(f, { R1: [pin('red', 'yellow'), cup('gray')] }, { T_red1: -120 }));
    expect(shown.red).toBe(15);
  });

  it('only correctly nested Pins are Placed (SC2)', () => {
    const a = pin('red', 'yellow');
    const b = pin('red', 'yellow');
    const c = cup('gray');
    expect(placedPrefix([a, c, b])).toEqual([a, c, b]);
    expect(placedPrefix([a, b])).toEqual([a]); // two Pin halves in one place
    expect(placedPrefix([c, a])).toEqual([]); // a Cup can't sit directly in a Goal
  });

  it('a touched or unseated Toggle is neutral (SC4)', async () => {
    const f = await field();
    const t = f.toggles!.find((x) => x.id === 'T_red1')!;
    expect(setColor(t, -120, false)).toBe('red');
    expect(setColor(t, -120, true)).toBe('yellow');
    expect(setColor(t, -100, false)).toBe('yellow');
    expect(setColor(t, 240, false)).toBe('red'); // two outward rolls
    const st = stateWith(f, { R1: [pin('yellow', 'yellow')] }, { T_red1: -120 });
    expect(run(f, st).red).toBe(20);
    st.toggles.find((x) => x.id === 'T_red1')!.touched = true;
    expect(run(f, st).red).toBe(0);
  });

  it('Midfield yellow Pins go to the alliance with more Robots there, but not in autonomous (SC5b, SC7a)', async () => {
    const f = await field();
    const st = stateWith(f, { C: [pin('yellow', 'yellow'), cup('gray'), pin('blue', 'yellow')] });
    // visible: both bottom-pin halves, the blue/yellow pin's yellow top
    expect(run(f, st, 'h2h', { red: 1, blue: 0 })).toMatchObject({ red: 30 + 8, blue: 0 });
    expect(run(f, st, 'h2h', { red: 1, blue: 1 })).toMatchObject({ red: 8, blue: 8 });
    expect(run(f, st, 'h2h', { red: 0, blue: 2 })).toMatchObject({ red: 0, blue: 30 + 16 });
    expect(run(f, st, 'h2h', { red: 1, blue: 0 }, true)).toMatchObject({ red: 0, blue: 0 });
  });

  it('Autonomous Bonus: higher score, tie 6/6, violations (SC7)', async () => {
    const f = await field();
    const tie = run(f, stateWith(f, {}), 'h2h', { red: 0, blue: 0 }, true);
    expect(autonomousBonus(tie, { red: false, blue: false })).toEqual({ red: 6, blue: 6 });
    const red = run(f, stateWith(f, { R1: [pin('red', 'yellow')] }), 'h2h', { red: 0, blue: 0 }, true);
    expect(autonomousBonus(red, { red: false, blue: false })).toEqual({ red: 12, blue: 0 });
    expect(autonomousBonus(red, { red: true, blue: false })).toEqual({ red: 0, blue: 12 });
    expect(autonomousBonus(red, { red: true, blue: true })).toEqual({ red: 0, blue: 0 });
  });

  it('AWP: 6 Pins / 2 Goals standard, 7 / 3 Worlds; opposing side excluded (SC8)', async () => {
    const f = await field();
    // per Goal: red bottom, yellow top (unowned), hidden yellow, red top -> 2 red Scored Pins
    const three = () => [pin('red', 'yellow'), cup('gray'), pin('yellow', 'red')];
    const st = stateWith(f, { R1: three(), R2: three(), N_R2: three() });
    const s = run(f, st, 'h2h', { red: 0, blue: 0 }, true);
    const redHalves = s.goals.flatMap((g) => g.halves.filter((h) => h.owner === 'red').map(() => g.goal));
    const check = awp(f, s, 'red', false, false);
    expect(check.scoredPins).toBe(redHalves.length);
    expect(check.scoredPins).toBe(6);
    expect(check.goalsWithTwo).toBe(3);
    expect(check.standard).toBe(true);
    expect(check.worlds).toBe(false);
    expect(awp(f, s, 'red', true, false).standard).toBe(false); // touching the perimeter
    expect(awp(f, s, 'red', false, true).standard).toBe(false); // violation
    // red Pins in a blue Quadrant don't count for red's AWP
    const opp = run(f, stateWith(f, { B1: three(), N_B1: three(), B2: three() }), 'h2h', { red: 0, blue: 0 }, true);
    expect(opp.red).toBe(30);
    expect(awp(f, opp, 'red', false, false).scoredPins).toBe(0);
  });
});

describe('Override Skills scoring (RSC3)', () => {
  it('alliance halves score only in their own color Quadrants or the Midfield', async () => {
    const f = await field();
    const s = run(f, stateWith(f, { R1: [pin('red', 'blue')], B1: [pin('red', 'blue')], C: [pin('red', 'blue')] }), 'skills');
    // R1: red 5; B1: blue 5; C: red + blue 10
    expect(s.red).toBe(20);
    expect(s.blue).toBe(0);
  });

  it('yellow halves score only with a Toggle matching its Quadrant color', async () => {
    const f = await field();
    const yy = () => [pin('yellow', 'yellow')];
    expect(run(f, stateWith(f, { R1: yy() }, { T_red1: -120 }), 'skills').red).toBe(20); // red toggle, red quadrant
    expect(run(f, stateWith(f, { R1: yy() }, { T_red1: 120 }), 'skills').red).toBe(0); // blue toggle, red quadrant
    expect(run(f, stateWith(f, { B1: yy() }, { T_blue1: -120 }), 'skills').red).toBe(20); // blue toggle, blue quadrant
    expect(run(f, stateWith(f, { C: yy() }), 'skills', { red: 0, blue: 0 }).red).toBe(0);
    expect(run(f, stateWith(f, { C: yy() }), 'skills', { red: 1, blue: 0 }).red).toBe(20 + 8);
  });
});

describe('Override Toggles', () => {
  it('contact needs a robot tall enough and within the Toggle length', async () => {
    const f = await field();
    const t = f.toggles!.find((x) => x.id === 'T_red1')!; // left wall, x = -70.205
    const half = f.perimeter.inside / 2;
    expect(contactDepth(t, boxAt(-half + 7.5, 0), 14)).toBeGreaterThan(1);
    expect(contactDepth(t, boxAt(-half + 7.5, 0), 10)).toBe(0); // under it
    expect(contactDepth(t, boxAt(-half + 7.5, 25), 14)).toBe(0); // beyond its end
    expect(contactDepth(t, boxAt(-half + 12, 0), 14)).toBe(0); // not reaching it
  });

  it('each press rolls one face outward; releasing between faces settles back', async () => {
    const f = await field();
    const sim = new ToggleSim(f);
    const s = initialState(f, 'h2h').toggles;
    const tg = s.find((x) => x.id === 'T_red1')!;
    const def = f.toggles!.find((x) => x.id === 'T_red1')!;
    const half = f.perimeter.inside / 2;
    const press = (ms: number) => { for (let i = 0; i < ms; i++) sim.step(1, s, boxAt(-half + 7.5, 0), 14); };
    const release = (ms: number) => { for (let i = 0; i < ms; i++) sim.step(1, s, boxAt(0, 0), 14); };
    press(100);
    expect(tg.angle).toBeGreaterThan(30);
    expect(tg.touched).toBe(true);
    expect(setColor(def, tg.angle, tg.touched)).toBe('yellow');
    release(500); // let go before the face turned over: falls back
    expect(tg.angle).toBe(0);
    press(1000); // held: one face only
    expect(tg.angle).toBe(120);
    release(10);
    expect(tg.touched).toBe(false);
    expect(setColor(def, tg.angle, tg.touched)).toBe('blue');
    press(1000);
    release(10);
    expect(setColor(def, tg.angle, tg.touched)).toBe('red');
  });

  it('a tall robot driving into the wall flips the Toggle in a simulation', async () => {
    const f = await field();
    const r = await robot('tank-6m-450');
    r.size.height = 14;
    const world = new World(r, f, { x: -50, y: 0, theta: 270 });
    const game = await OverrideGame.create(f, 'h2h', world);
    for (const p of [...r.drivetrain.left, ...r.drivetrain.right]) world.motor(p).cmd = 60 * Math.sign(p);
    for (let t = 1; t <= 1500; t++) {
      world.step(1);
      game.step(1);
    }
    for (const p of [...r.drivetrain.left, ...r.drivetrain.right]) world.motor(p).cmd = -60 * Math.sign(p);
    for (let t = 1; t <= 600; t++) {
      world.step(1);
      game.step(1);
    }
    const rec = game.finish();
    const tg = rec.result!.score.toggles.find((x) => x.id === 'T_red1')!;
    expect(tg.color).toBe('blue');
  });
});

describe('Override rule monitors', () => {
  it('the Autonomous Line and shared objects', () => {
    expect(pastAutonLine('red', [10, 10])).toBeGreaterThan(0);
    expect(pastAutonLine('red', [0.5, 0.5])).toBeLessThan(0); // on the tape
    expect(pastAutonLine('blue', [-10, -10])).toBeGreaterThan(0);
    expect(startsOnAutonLine([-23.548, 23.548])).toBe(true);
    expect(startsOnAutonLine([0, -23.548])).toBe(true); // Midfield corner
    expect(startsOnAutonLine([23.548, 23.548])).toBe(false);
  });

  it('crossing the line voids the Autonomous Bonus and AWP', async () => {
    const f = await field();
    const r = await robot('tank-6m-450');
    const world = new World(r, f, { x: -40, y: -14, theta: 90 });
    const game = await OverrideGame.create(f, 'h2h', world);
    expect(game.alliance).toBe('red');
    for (const p of [...r.drivetrain.left, ...r.drivetrain.right]) world.motor(p).cmd = 127 * Math.sign(p);
    for (let t = 1; t <= 1200; t++) {
      world.step(1);
      game.step(1);
    }
    const rec = game.finish();
    expect(rec.violations.some((v) => v.rule === 'SG7')).toBe(true);
    expect(rec.result!.autonomousBonus).toEqual({ red: 0, blue: 12 });
    expect(rec.result!.awp!.standard).toBe(false);
  });

  it('scoreState: Midfield parking counts in Skills, not in head-to-head autonomous', async () => {
    const f = await field();
    const st = stateWith(f, {});
    expect(scoreState(f, 'skills', 'red', st, boxAt(0, 0), false, 0).score.red).toBe(8);
    expect(scoreState(f, 'h2h', 'red', st, boxAt(0, 0), false, 0).score.red).toBe(0);
    expect(scoreState(f, 'h2h', 'red', st, boxAt(-62.7, 0), false, 0).touchingPerimeter).toBe(true);
  });
});
