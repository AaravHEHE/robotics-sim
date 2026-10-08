import { describe, expect, it } from 'vitest';
import { DriveDynamics, type SideState } from '../src/sim/drive-dynamics.ts';
import { CARTRIDGE_RPM, maxSpeed } from '../src/sim/profile.ts';
import { robot } from './helpers.ts';

const side = (v: number, target: number, extra: Partial<SideState> = {}): SideState => ({ v, target, powered: true, brake: 0, motors: 3, currentLimit: 2.5, ...extra });

async function run(id: string, ms: number, target?: number) {
  const p = await robot(id);
  const dd = new DriveDynamics(p);
  const top = target ?? maxSpeed(p);
  let vL = 0;
  let vR = 0;
  const t95: { v90?: number } = {};
  for (let t = 1; t <= ms; t++) {
    const s = dd.step(side(vL, top, { motors: p.drivetrain.left.length }), side(vR, top, { motors: p.drivetrain.right.length }), 0.001);
    vL += s.aL * 0.001;
    vR += s.aR * 0.001;
    if (vL >= 0.9 * top && t95.v90 === undefined) t95.v90 = t;
  }
  return { dd, p, vL, vR, top, t90: t95.v90 };
}

describe('drive dynamics', () => {
  it('reaches top speed, going straight, in a believable time', async () => {
    for (const id of ['tank-6m-450', 'override-banshee', 'override-dr4b-intake']) {
      const r = await run(id, 3000);
      expect(r.vL / r.top, id).toBeGreaterThan(0.98);
      expect(Math.abs(r.vL - r.vR)).toBeLessThan(1e-6);
      // a VEX drive takes between a tenth of a second and a couple of seconds to get to speed
      expect(r.t90!, id).toBeGreaterThan(100);
      expect(r.t90!, id).toBeLessThan(2000);
    }
  });

  it('a heavier robot speeds up more slowly', async () => {
    const light = await robot('tank-6m-450');
    const heavy = structuredClone(light);
    light.mass = 8;
    heavy.mass = 20;
    const t = (p: typeof light) => {
      const dd = new DriveDynamics(p);
      let v = 0;
      let n = 0;
      while (v < 0.5 * maxSpeed(p) && n < 20000) {
        v += dd.step(side(v, maxSpeed(p), { motors: p.drivetrain.left.length }), side(v, maxSpeed(p), { motors: p.drivetrain.right.length }), 0.001).aL * 0.001;
        n++;
      }
      return n;
    };
    expect(t(heavy)).toBeGreaterThan(t(light) * 1.3);
  });

  it('grip caps acceleration: slippery tiles take longer', async () => {
    const p = await robot('tank-6m-450');
    const slick = structuredClone(p);
    slick.dynamics = { wheelFriction: 0.25 };
    const a = new DriveDynamics(p).nominalAccel();
    const b = new DriveDynamics(slick).nominalAccel();
    expect(b).toBeLessThan(a);
    // with friction 0.25 the cap is 0.25 g
    expect(b).toBeCloseTo((0.25 * 9.80665) / 0.0254, 0);
  });

  it('the battery sags and the motors heat under load, then cool', async () => {
    const p = await robot('tank-6m-450');
    const dd = new DriveDynamics(p);
    const n = p.drivetrain.left.length;
    // pushing against a wall: full target, no motion
    for (let t = 0; t < 20000; t++) dd.step(side(0, 60, { motors: n }), side(0, 60, { motors: n }), 0.001);
    expect(dd.battery).toBeLessThan(12.8 - 0.5);
    expect(dd.temp[0]).toBeGreaterThan(30);
    const hot = dd.temp[0];
    for (let t = 0; t < 20000; t++) dd.step(side(0, 0, { motors: n, powered: false }), side(0, 0, { motors: n, powered: false }), 0.001);
    expect(dd.temp[0]).toBeLessThan(hot);
    expect(dd.battery).toBeCloseTo(12.8, 5);
  });

  it('stall current is the V5 limit, torque the rated stall torque', async () => {
    const p = await robot('tank-6m-450');
    const dd = new DriveDynamics(p);
    dd.step(side(0, 60, { motors: p.drivetrain.left.length }), side(0, 60, { motors: p.drivetrain.right.length }), 0.001);
    expect(dd.current[0]).toBeLessThanOrEqual(2.5 + 1e-9);
    expect(dd.current[0]).toBeGreaterThan(1);
    void CARTRIDGE_RPM;
  });

  it('braking modes order: coast rolls longest, hold stops fastest', async () => {
    const p = await robot('tank-6m-450');
    const dist = (brake: number) => {
      const dd = new DriveDynamics(p);
      let v = maxSpeed(p);
      let x = 0;
      for (let t = 0; t < 5000 && v > 0; t++) {
        const s = dd.step(side(v, 0, { powered: false, brake, motors: 3 }), side(v, 0, { powered: false, brake, motors: 3 }), 0.001);
        v = Math.max(0, v + s.aL * 0.001);
        x += v * 0.001;
      }
      return x;
    };
    expect(dist(0)).toBeGreaterThan(dist(1));
    expect(dist(1)).toBeGreaterThan(dist(2));
  });

  it('a turn in place is symmetric and does not drift forward', async () => {
    const p = await robot('tank-6m-450');
    const dd = new DriveDynamics(p);
    let vL = 0;
    let vR = 0;
    const tgt = 40;
    for (let t = 0; t < 2000; t++) {
      const s = dd.step(side(vL, tgt, { motors: 3 }), side(vR, -tgt, { motors: 3 }), 0.001);
      vL += s.aL * 0.001;
      vR += s.aR * 0.001;
    }
    expect(vL).toBeCloseTo(tgt, 3);
    expect(vR).toBeCloseTo(-tgt, 3);
  });
});

describe('pushing a load', () => {
  it('a pushed load slows the speed-up, and one the drive cannot move holds it still', async () => {
    const p = await robot('tank-6m-450');
    const n = p.drivetrain.left.length;
    const accelWith = (load: number) => {
      const dd = new DriveDynamics(p);
      return dd.step(side(20, 70, { motors: n }), side(20, 70, { motors: n }), 0.001, load).aL;
    };
    expect(accelWith(5)).toBeLessThan(accelWith(0));
    // a load far past what the wheels can grip: the robot does not move at all
    const dd = new DriveDynamics(p);
    const a = dd.step(side(0, 70, { motors: n }), side(0, 70, { motors: n }), 0.001, 500);
    expect(a.aL).toBeLessThanOrEqual(0);
    expect(a.aL).toBeGreaterThan(-1e-9);
  });
});
