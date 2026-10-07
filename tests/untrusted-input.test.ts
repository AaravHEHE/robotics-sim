// Robot profiles and auton plans come from files, links and browser storage: anything in
// them must render as text, and malformed values must be reported, not crash or poison a run.
import { describe, expect, it } from 'vitest';
import { esc } from '../src/app/html.ts';
import { cleanPoints, validatePlan } from '../src/app/mapping.ts';
import { validateProfile } from '../src/sim/profile.ts';
import { robot } from './helpers.ts';

const XSS = '<img src=x onerror=alert(1)>';

describe('untrusted input', () => {
  it('esc makes any value inert text', () => {
    expect(esc(XSS)).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(esc(`" onmouseover='x'`)).toBe('&quot; onmouseover=&#39;x&#39;');
    expect(esc(5)).toBe('5');
    expect(esc(undefined)).toBe('');
  });

  it('robot profiles with unknown device types, inherited cartridge names or junk entries are rejected', async () => {
    const base = await robot('tank-6m-450');
    const withDevice = (d: unknown) => ({ ...base, devices: [...base.devices, d] });
    expect(validateProfile(withDevice({ type: XSS, port: 5 })).join()).toMatch(/unknown type/);
    expect(validateProfile(withDevice({ type: 'motor', port: 9, cartridge: 'toString' })).join()).toMatch(/cartridge/);
    expect(validateProfile(withDevice(null)).join()).toMatch(/must be an object/);
    expect(validateProfile(withDevice({ type: 'motor', port: 9, cartridge: 'green', name: 5 })).join()).toMatch(/name must be text/);
    expect(validateProfile({ ...base, drivetrain: { ...base.drivetrain, cartridge: 'constructor' } }).join()).toMatch(/cartridge/);
    expect(validateProfile({ ...base, mechanisms: [{ kind: 'roller', name: 'R', motors: 5 }] }).join()).toMatch(/motors must be a list/);
    expect(validateProfile(base)).toEqual([]);
  });

  it('plan points keep only valid values and get fresh ids', () => {
    expect(validatePlan({ v: 1, name: 'p', field: 'f', layout: 'h2h', points: [{ x: 1, y: 2, label: 7 }] }).join()).toMatch(/invalid name/);
    const pts = cleanPoints([{ id: `"><script>`, x: 1, y: 2, label: XSS, heading: 'x' }, { x: 'a', y: 1 }, null, { id: 'q', x: 3, y: 4, heading: 90 }]);
    expect(pts).toEqual([
      { id: 'p1', x: 1, y: 2, label: XSS },
      { id: 'p2', x: 3, y: 4, heading: 90 },
    ]);
    expect(cleanPoints('nope')).toEqual([]);
  });
});
