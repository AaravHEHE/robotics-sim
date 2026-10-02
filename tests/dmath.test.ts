import { describe, expect, it } from 'vitest';
import { datan, datan2, dcos, dsin, wrap180 } from '../src/sim/dmath.ts';

describe('deterministic math', () => {
  const xs = [0, 1e-9, 0.1, 0.5, 0.785, 1, 1.5707963, 2, 3, 3.14159, 4, 6.28, 10, 100, -0.3, -2.5, -50, 1234.5];

  it('sin/cos match Math within 1 ulp-ish', () => {
    for (const x of xs) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(2e-15 * Math.max(1, Math.abs(x)));
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(2e-15 * Math.max(1, Math.abs(x)));
    }
  });

  it('atan/atan2 match Math', () => {
    for (const x of xs) expect(Math.abs(datan(x) - Math.atan(x))).toBeLessThan(1e-15);
    for (const y of [-3, -1, -0.2, 0, 0.7, 2]) {
      for (const x of [-4, -1, -0.5, 0.3, 1, 5]) {
        expect(Math.abs(datan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-15);
      }
    }
  });

  it('is bit-exact for known values (cross-engine reference)', () => {
    // Values computed once with this implementation; any engine must reproduce them exactly.
    expect(dsin(1.2345)).toBe(0.9439833239445111);
    expect(dcos(0.987)).toBe(0.5511954656527531);
    expect(datan2(3, 7)).toBe(0.4048917862850834);
  });

  it('wrap180', () => {
    expect(wrap180(190)).toBe(-170);
    expect(wrap180(-190)).toBe(170);
    expect(wrap180(180)).toBe(180);
    expect(wrap180(720 + 45)).toBe(45);
  });
});
