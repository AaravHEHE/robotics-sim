import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { CUP, layoutStack, PIN, type Piece } from '../src/games/override/elements.ts';
import { initialState, inventory } from '../src/games/override/state.ts';
import { validateField, zoneAt, type FieldDef } from '../src/sim/field.ts';
import { goalWidthAt, World } from '../src/sim/world.ts';
import { robot } from './helpers.ts';

const field = async () => JSON.parse(await readFile(path.join(repoRoot, 'data/fields/override.json'), 'utf8')) as FieldDef;
const mm = (v: number) => v / 25.4;

describe('Override field data (manual v2.0 Appendix A)', () => {
  it('validates', async () => {
    expect(validateField(await field())).toEqual([]);
  });

  it('has the manual inventory: 56 cups and 63 pins by color (head-to-head, incl. match loads + preloads)', async () => {
    const f = await field();
    const inv = inventory(initialState(f, 'h2h'));
    // preloads are 1 alliance/yellow pin per robot, 2 per alliance
    inv.pins['red/yellow'] += 2;
    inv.pins['blue/yellow'] += 2;
    expect(inv.cups).toBe(56);
    expect(inv.pins).toEqual({ 'red/yellow': 20, 'blue/yellow': 20, 'yellow/yellow': 19, 'blue/red': 4 });
  });

  it('on-field counts: 36 cups, 17 yellow, 8+8 alliance pins, 4 red/blue, 28 on the Autonomous Line', async () => {
    const f = await field();
    const s = initialState(f, 'h2h');
    s.matchLoads = {};
    const inv = inventory(s);
    expect(inv.cups).toBe(36);
    expect(inv.pins).toEqual({ 'red/yellow': 8, 'blue/yellow': 8, 'yellow/yellow': 17, 'blue/red': 4 });
    // objects on the Autonomous Line (y = -x, including the Midfield corners)
    const onLine = [...s.floor.map((x) => [x.x, x.y, x.pieces.length] as const), ...s.lying.map((x) => [x.x, x.y, 1] as const)]
      .filter(([x, y]) => Math.abs(x + y) < 8 || (Math.abs(x) + Math.abs(y) < mm(600) && Math.abs(Math.abs(x) + Math.abs(y) - mm(598.1)) < 1))
      .reduce((n, [, , k]) => n + k, 0);
    expect(onLine).toBe(28);
  });

  it('skills layout: empty goals and the RSC4 match loads', async () => {
    const s = initialState(await field(), 'skills');
    expect(Object.values(s.goals).every((g) => g.length === 0)).toBe(true);
    const loads = s.matchLoads.red!;
    expect(loads.filter((p) => p.kind === 'cup').length).toBe(7);
    expect(loads.filter((p) => p.kind === 'pin' && p.colors.includes('red')).length).toBe(3);
    expect(loads.filter((p) => p.kind === 'pin' && p.colors.includes('blue')).length).toBe(4);
  });

  it('goal positions and heights match Appendix A', async () => {
    const f = await field();
    const g = Object.fromEntries(f.goals!.map((x) => [x.id, x]));
    expect(g.C.x).toBe(0);
    expect(g.R1.x).toBeCloseTo(mm(-1196.1), 2);
    expect(g.R1.y).toBeCloseTo(mm(-598.1), 2);
    expect(g.B2.x).toBeCloseTo(mm(598.1), 2);
    expect(g.R1.height).toBeCloseTo(3.25, 2);
    expect(g.N_R1.height).toBeCloseTo(5.77, 2);
    expect(g.C.height).toBeCloseTo(8.77, 2);
    expect(f.perimeter.inside).toBeCloseTo(140.41, 2);
    // every quadrant goal lies in its quadrant; the center goal in the Midfield
    for (const goal of f.goals!) {
      const kind = goal.zone === 'midfield' ? 'midfield' : 'quadrant';
      expect(zoneAt(f, goal.x, goal.y, kind)?.id).toBe(goal.zone);
    }
  });

  it('every start position is legal: inside its own quadrant and clear of goals', async () => {
    const f = await field();
    const r = await robot('tank-6m-450');
    for (const sp of f.startPositions!) {
      expect(zoneAt(f, sp.x, sp.y, 'quadrant')?.id).toBe(sp.zone);
      expect(sp.alliance === 'red' ? sp.x + sp.y < 0 : sp.x + sp.y > 0).toBe(true);
      const w = new World(r, f, { x: sp.x, y: sp.y, theta: sp.theta });
      w.step(1);
      expect(Math.hypot(w.pose.x - sp.x, w.pose.y - sp.y)).toBeLessThan(1e-9); // nothing pushed it
      // not touching any Scoring Object (SG1 / SG5), even at 15 x 15
      const st = initialState(f, 'h2h');
      const hits = (x: number, y: number, r0: number) => Math.abs(x - sp.x) < 7.5 + r0 && Math.abs(y - sp.y) < 7.5 + r0;
      for (const o of st.floor) expect(hits(o.x, o.y, CUP.rimDiameter / 2), `${sp.id} touches ${o.id}`).toBe(false);
      for (const o of st.lying) {
        // sample along the pin's axis
        for (let k = -3; k <= 3; k++) {
          const d = (k / 3) * (PIN.length / 2 - PIN.endDiameter / 2);
          const h = (o.heading * Math.PI) / 180;
          expect(hits(o.x + d * Math.sin(h), o.y + d * Math.cos(h), PIN.collarDiameter / 2), `${sp.id} touches ${o.id}`).toBe(false);
        }
      }
    }
  });
});

describe('Override stack geometry', () => {
  it('one pin on a goal: collar rests on the goal top', () => {
    const pin: Piece = { kind: 'pin', id: 'p', colors: ['yellow', 'yellow'] };
    const [s] = layoutStack([pin], 3.25, true);
    expect(s.bottom).toBeCloseTo(3.25 - PIN.half, 9);
    expect(s.top).toBeCloseTo(3.25 + PIN.collar + PIN.half, 9);
  });

  it('each pin + cup layer adds ~180.5 mm', () => {
    const pieces: Piece[] = [];
    for (let i = 0; i < 3; i++) {
      pieces.push({ kind: 'pin', id: `p${i}`, colors: ['red', 'yellow'] });
      if (i < 2) pieces.push({ kind: 'cup', id: `c${i}`, up: 'clear' });
    }
    const s = layoutStack(pieces, 0, true);
    expect((s[4].top - s[0].top) * 25.4).toBeCloseTo(2 * (CUP.height + PIN.collar) * 25.4, 6);
    expect((s[0].top * 25.4 + 2 * 180.5) - s[4].top * 25.4).toBeCloseTo(0, 0);
  });
});

describe('robot vs field elements', () => {
  it('a goal blocks the robot', async () => {
    const f = await field();
    const r = await robot('tank-6m-450');
    // drive straight at red goal R1 from the left wall
    const w = new World(r, f, { x: -61, y: mm(-598.1), theta: 90 });
    for (const p of [...r.drivetrain.left, ...r.drivetrain.right]) w.motor(p).cmd = 127 * Math.sign(p);
    for (let i = 0; i < 2000; i++) w.step(1);
    const goal = f.goals!.find((g) => g.id === 'R1')!;
    // front of the robot stops at the goal's flat
    expect(w.pose.x + r.size.length / 2).toBeCloseTo(goal.x - goal.baseWidth / 2, 1); // (a hair off: the last bounce settles under 0.05 in)
    expect(w.collisions.some((c) => c.wall === 'goal R1')).toBe(true);
  });

  it('distance sensors see goals', async () => {
    const f = await field();
    const r = await robot('tank-6m-450');
    const w = new World(r, f, { x: -61, y: mm(-598.1), theta: 90 });
    const goal = f.goals!.find((g) => g.id === 'R1')!;
    // low, the base plate; higher, the narrower tapered column; above the top, nothing
    expect(w.raycast({ x: 0, y: 0, heading: 0, z: 0.2 })).toBeCloseTo(goal.x - goal.baseWidth / 2 - -61, 6);
    expect(w.raycast({ x: 0, y: 0, heading: 0, z: 3 })).toBeCloseTo(goal.x - goalWidthAt(goal, 3) / 2 - -61, 6);
    expect(w.raycast({ x: 0, y: 0, heading: 0, z: 4 })).toBeGreaterThan(goal.x + goal.baseWidth / 2 - -61);
  });
});
