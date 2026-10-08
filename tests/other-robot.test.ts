import { describe, expect, it } from 'vitest';
import { validateField, type FieldDef } from '../src/sim/field.ts';
import { World } from '../src/sim/world.ts';
import { field, robot } from './helpers.ts';

/** The generic field with a second robot added at `x, y` (a 15 x 15 in box) of `lb` pounds. */
async function withOther(opts: { x: number; y: number; lb?: number; heading?: number; path?: Array<[number, number]>; speed?: number }): Promise<FieldDef> {
  const f = structuredClone(await field());
  f.objects.push({ id: 'partner', shape: { type: 'box', x: opts.x, y: opts.y, width: 15, length: 15, heading: opts.heading ?? 0 }, height: 14, color: '#3fb950', robot: { mass: opts.lb ?? 12, path: opts.path, speed: opts.speed } });
  return f;
}

const KG = 0.45359237;
const momentumY = (w: World) => {
  const m1 = w.drive!.dyn.mass;
  return m1 * ((w.vL + w.vR) / 2) * 0.0254 + w.others[0].mass * w.others[0].vy * 0.0254;
};
const energy = (w: World) => {
  const d = w.drive!.dyn;
  const o = w.others[0];
  const sp = (w.vL + w.vR) / 2;
  const wz = (w.vL - w.vR) / w.trackWidth;
  return 0.5 * d.mass * (sp * 0.0254) ** 2 + 0.5 * d.inertia * wz * wz + 0.5 * o.mass * ((o.vx * 0.0254) ** 2 + (o.vy * 0.0254) ** 2) + 0.5 * o.inertia * (o.omega * (Math.PI / 180)) ** 2;
};

describe('a second robot', () => {
  it('is checked: a robot needs a box, a sane mass and speed, and a path of points', async () => {
    const f = await withOther({ x: 0, y: 30 });
    expect(validateField(f)).toEqual([]);
    f.objects[0].robot!.mass = 500;
    expect(validateField(f).join()).toMatch(/mass must be/);
    f.objects[0].robot!.mass = 12;
    f.objects[0].shape = { type: 'circle', x: 0, y: 30, radius: 5 };
    expect(validateField(f).join()).toMatch(/needs a box/);
  });

  it('is not a wall: it is not among the static obstacles', async () => {
    const w = new World(await robot('tank-6m-450'), await withOther({ x: 0, y: 30 }), { x: 0, y: 0, theta: 0 });
    expect(w.others.length).toBe(1);
    expect(w.obstacles.some((o) => o.id === 'partner')).toBe(false);
  });

  it('is pushed by a hit, conserving momentum (the robot gives up what it gets) and never gaining energy', async () => {
    const w = new World(await robot('tank-6m-450'), await withOther({ x: 0, y: 30 }), { x: 0, y: 14, theta: 0 });
    w.vL = 40;
    w.vR = 40; // coasting in unpowered
    const o = w.others[0];
    let hit = false;
    for (let i = 0; i < 700 && !hit; i++) {
      const p0 = momentumY(w);
      const e0 = energy(w);
      const n = w.contacts.length;
      w.step(1);
      if (w.contacts.length > n) {
        hit = true;
        // the step's own coasting friction takes a little; the hit itself neither makes nor loses momentum
        expect(Math.abs(momentumY(w) - p0) / Math.abs(p0)).toBeLessThan(0.03);
        expect(energy(w)).toBeLessThanOrEqual(e0 * 1.0001);
      }
    }
    expect(hit).toBe(true);
    expect(o.vy).toBeGreaterThan(5);
    expect(w.contacts[0].what).toBe('partner');
  });

  it('a heavier robot moves off slower than a lighter one', async () => {
    const speedAfter = async (lb: number) => {
      const w = new World(await robot('tank-6m-450'), await withOther({ x: 0, y: 30, lb }), { x: 0, y: 14, theta: 0 });
      w.vL = 40;
      w.vR = 40;
      for (let i = 0; i < 700 && !w.contacts.length; i++) w.step(1);
      return w.others[0].vy;
    };
    expect(await speedAfter(30)).toBeLessThan(await speedAfter(8));
  });

  it('a hit off its center spins it, and it slides to a stop on the tiles', async () => {
    const w = new World(await robot('tank-6m-450'), await withOther({ x: 6, y: 30 }), { x: 0, y: 14, theta: 0 });
    w.vL = 40;
    w.vR = 40;
    for (let i = 0; i < 700 && !w.contacts.length; i++) w.step(1);
    expect(Math.abs(w.others[0].omega)).toBeGreaterThan(5);
    for (let i = 0; i < 4000; i++) w.step(1);
    const o = w.others[0];
    expect(Math.hypot(o.vx, o.vy)).toBe(0);
    expect(o.omega).toBe(0);
    // it never left the field
    const half = w.field.perimeter.inside / 2;
    expect(Math.max(...o.footprint().map((p) => Math.abs(p[0])), ...o.footprint().map((p) => Math.abs(p[1])))).toBeLessThanOrEqual(half + 1e-6);
  });

  it('pressing against it: the robot is held back and does not drive through', async () => {
    const r = await robot('tank-6m-450');
    const w = new World(r, await withOther({ x: 0, y: 25 }), { x: 0, y: 0, theta: 0 });
    for (const p of [...r.drivetrain.left, ...r.drivetrain.right]) w.motor(p).cmd = 127 * Math.sign(p);
    for (let i = 0; i < 3000; i++) w.step(1);
    // they never overlap
    const o = w.others[0];
    expect(w.pose.y + r.size.length / 2).toBeLessThanOrEqual(o.y - 7.5 + 0.3);
  });

  it('follows a path at its speed, and stops at the end of it', async () => {
    const w = new World(await robot('tank-6m-450'), await withOther({ x: -40, y: -40, path: [[-40, 0], [0, 0]], speed: 30 }), { x: 50, y: 50, theta: 0 });
    let top = 0;
    for (let i = 0; i < 6000; i++) {
      w.step(1);
      top = Math.max(top, Math.hypot(w.others[0].vx, w.others[0].vy));
    }
    expect(top).toBeGreaterThan(20);
    expect(top).toBeLessThanOrEqual(30.5);
    expect(Math.hypot(w.others[0].x - 0, w.others[0].y - 0)).toBeLessThan(3);
  });

  it('a robot with no second robot in its field is unchanged', async () => {
    const w = new World(await robot('tank-6m-450'), await field(), { x: 0, y: 0, theta: 0 });
    expect(w.others).toEqual([]);
    void KG;
  });
});

describe('the Override field with a second robot', () => {
  it('is a valid field with one passive robot', async () => {
    const { readFile } = await import('node:fs/promises');
    const f = JSON.parse(await readFile('data/fields/override-partner.json', 'utf8')) as FieldDef;
    expect(validateField(f)).toEqual([]);
    expect(f.objects.filter((o) => o.robot).map((o) => o.id)).toEqual(['partner']);
    // the same Goals, Toggles and layouts as the plain field
    const plain = JSON.parse(await readFile('data/fields/override.json', 'utf8')) as FieldDef;
    expect(f.goals).toEqual(plain.goals);
    expect(f.layouts).toEqual(plain.layouts);
  });

  it('a run on it records where the robot went, and the recording carries its frames', async () => {
    const { readFile } = await import('node:fs/promises');
    const { SAMPLES } = await import('../src/app/samples-meta.ts');
    const { readProjectDir } = await import('../scripts/node-bundle.ts');
    const { repoRoot } = await import('../scripts/node-toolchain.ts');
    const { build } = await import('./helpers.ts');
    const { runProgram } = await import('../src/sim/runtime.ts');
    const path = await import('node:path');
    const f = JSON.parse(await readFile('data/fields/override-partner.json', 'utf8')) as FieldDef;
    const meta = SAMPLES.find((s) => s.id === 'override-midfield-pusher')!;
    const b = await build(await readProjectDir(path.join(repoRoot, 'samples', meta.id)));
    expect(b.ok).toBe(true);
    const profile = await robot(meta.robot);
    const rec = await runProgram(await WebAssembly.compile(b.wasm!), { profile, field: f, start: { x: meta.start?.x ?? 0, y: meta.start?.y ?? 0, theta: meta.start?.theta ?? 0 }, autonMs: 3000 } as never);
    expect(rec.error).toBeNull();
    expect(rec.others?.map((o) => o.id)).toEqual(['partner']);
    expect(rec.otherFrames!.length).toBe((rec.frames.length / rec.stride) * 3);
  });
});
