// An unpowered drive spinning in place must slow down, not flip a wheel's direction every step.
import { describe, expect, it } from 'vitest';
import { DriveDynamics, type SideState } from '../src/sim/drive-dynamics.ts';
import { robot } from './helpers.ts';

describe('an unpowered drive spinning in place', () => {
  it('settles without chattering', async () => {
    const p = await robot('tank-6m-450');
    const dd = new DriveDynamics(p);
    const side = (v: number): SideState => ({ v, target: 0, powered: false, brake: 0, motors: p.drivetrain.left.length, currentLimit: 2.5 });
    const L = side(10);
    const R = side(-10);
    const dt = 0.001;
    let flips = 0;
    for (let i = 0; i < 3000; i++) {
      const before = [Math.sign(L.v), Math.sign(R.v)];
      const s = dd.step(L, R, dt);
      L.v += s.aL * dt;
      R.v += s.aR * dt;
      if (Math.sign(L.v) !== before[0] && L.v !== 0) flips++;
      if (Math.sign(R.v) !== before[1] && R.v !== 0) flips++;
    }
    expect(flips).toBeLessThan(5);
  });
});
