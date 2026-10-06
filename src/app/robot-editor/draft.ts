// The robot layout editor's model: draggable shapes on a top view (robot frame x right,
// y forward) and a side view (y forward, z up), each tied to the profile fields it edits.
// Pure: no DOM. Everything is in inches and degrees, as in the profile.

import type { DeviceSpec, LiftSpec, MechanismSpec, RobotProfile } from '../../sim/profile.ts';

export type View = 'top' | 'side';

/** A shape in a view: u across (top: x, side: y), v up the view (top: y, side: z). */
export interface Shape {
  u: number;
  v: number;
  /** Rect size (rect handles only). */
  w?: number;
  h?: number;
}

export interface Handle {
  id: string;
  /** What the properties panel opens when it's picked: 'robot', 'mech:<name>' or 'dev:<index>'. */
  owner: string;
  label: string;
  view: View;
  kind: 'rect' | 'point';
  /** A rect that stays centered on the robot (it resizes symmetrically and can't move). */
  centered?: boolean;
  /** A point that only moves along u (e.g. the wheel track). */
  uOnly?: boolean;
  color: string;
  get(p: RobotProfile): Shape;
  /** Write a moved or resized shape back into the profile. */
  set(p: RobotProfile, s: Shape): void;
}

const BAR_LIFTS = new Set(['arm', 'fourbar', 'sixbar', 'chainbar']);
const COLORS = { chassis: '#8a94a6', drive: '#6b7280', lift: '#d8343a', claw: '#ffb020', intake: '#3fb950', staging: '#a371f7', tool: '#2f81f7', sensor: '#db61a2' };
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Where a bar lift's bars pivot (side view), from its tip at output 0 (`home`), length and start angle. */
export function barPivot(l: LiftSpec): { y: number; z: number } {
  const a = ((l.startAngle ?? 0) * Math.PI) / 180;
  const s = l.facing === 'rear' ? -1 : 1;
  const k = l.lift === 'sixbar' ? 2 : 1;
  const L = l.length ?? 0;
  return { y: l.home.y - s * L * Math.cos(a), z: l.home.z - k * L * Math.sin(a) };
}

/** Move a bar lift's tip, keeping its pivot: its length and start angle follow. */
export function setBarTip(l: LiftSpec, tip: { y: number; z: number }): void {
  const pivot = barPivot(l);
  const s = l.facing === 'rear' ? -1 : 1;
  const k = l.lift === 'sixbar' ? 2 : 1;
  const dy = (tip.y - pivot.y) * s;
  const dz = (tip.z - pivot.z) / k;
  l.length = r2(Math.max(0.5, Math.hypot(dy, dz)));
  l.startAngle = r2((Math.atan2(dz, dy) * 180) / Math.PI);
  // the tip lands where the (rounded) length and angle put it
  const a = (l.startAngle * Math.PI) / 180;
  l.home = { ...l.home, y: r2(pivot.y + s * l.length * Math.cos(a)), z: r2(pivot.z + k * l.length * Math.sin(a)) };
}

const isLift = (m: MechanismSpec): m is LiftSpec => m.kind === 'lift';

/** Every draggable shape of a profile. */
export function handlesFor(p: RobotProfile): Handle[] {
  const out: Handle[] = [];
  // ---- chassis and drive ----
  out.push({
    id: 'chassis-top', owner: 'robot', label: 'Chassis', view: 'top', kind: 'rect', centered: true, color: COLORS.chassis,
    get: (q) => ({ u: 0, v: 0, w: q.size.width, h: q.size.length }),
    set: (q, s) => {
      q.size.width = r2(s.w!);
      q.size.length = r2(s.h!);
    },
  });
  out.push({
    id: 'chassis-side', owner: 'robot', label: 'Chassis (height)', view: 'side', kind: 'rect', centered: true, color: COLORS.chassis,
    get: (q) => ({ u: 0, v: q.size.height / 2, w: q.size.length, h: q.size.height }),
    set: (q, s) => {
      q.size.length = r2(s.w!);
      q.size.height = r2(s.h!);
    },
  });
  out.push({
    id: 'track', owner: 'robot', label: 'Wheel track', view: 'top', kind: 'point', uOnly: true, color: COLORS.drive,
    get: (q) => ({ u: q.drivetrain.trackWidth / 2, v: 0 }),
    set: (q, s) => {
      q.drivetrain.trackWidth = r2(Math.max(2, Math.abs(s.u) * 2));
    },
  });
  // ---- mechanisms ----
  for (const m of p.mechanisms) {
    const owner = `mech:${m.name}`;
    const find = (q: RobotProfile) => q.mechanisms.find((x) => x.name === m.name)!;
    if (isLift(m)) {
      out.push({
        id: `${owner}:home`, owner, label: `${m.name}: ${BAR_LIFTS.has(m.lift) ? 'tip' : 'carriage'} at rest`, view: 'side', kind: 'point', color: COLORS.lift,
        get: (q) => {
          const l = find(q) as LiftSpec;
          return { u: l.home.y, v: l.home.z };
        },
        set: (q, s) => {
          const l = find(q) as LiftSpec;
          if (BAR_LIFTS.has(l.lift) && l.length) setBarTip(l, { y: s.u, z: s.v });
          else l.home = { ...l.home, y: r2(s.u), z: r2(s.v) };
        },
      });
      if (BAR_LIFTS.has(m.lift) && m.length) {
        out.push({
          id: `${owner}:pivot`, owner, label: `${m.name}: pivot`, view: 'side', kind: 'point', color: COLORS.lift,
          get: (q) => {
            const piv = barPivot(find(q) as LiftSpec);
            return { u: piv.y, v: piv.z };
          },
          set: (q, s) => {
            // moving the pivot carries the whole lift
            const l = find(q) as LiftSpec;
            const piv = barPivot(l);
            l.home = { ...l.home, y: r2(l.home.y + s.u - piv.y), z: r2(l.home.z + s.v - piv.z) };
          },
        });
      }
    } else if (m.kind === 'claw' && !m.lift && m.at) {
      out.push(pointYZ(owner, `${m.name}`, COLORS.claw, (q) => (find(q) as typeof m).at!, (q, at) => ((find(q) as typeof m).at = at)));
    } else if (m.kind === 'staging') {
      out.push(pointYZ(owner, `${m.name}`, COLORS.staging, (q) => (find(q) as typeof m).at, (q, at) => ((find(q) as typeof m).at = at)));
    } else if (m.kind === 'intake') {
      out.push(rectTop(owner, `${m.name}: pickup zone`, COLORS.intake, (q) => (find(q) as typeof m).zone));
      if (m.handoff) out.push(pointYZ(`${owner}`, `${m.name}: hand-off`, COLORS.intake, (q) => (find(q) as typeof m).handoff!, (q, at) => ((find(q) as typeof m).handoff = at), ':handoff'));
    } else if (m.kind === 'toggleTool') {
      out.push(rectTop(owner, `${m.name}`, COLORS.tool, (q) => (find(q) as typeof m).box));
      out.push({
        id: `${owner}:height`, owner, label: `${m.name}: height`, view: 'side', kind: 'rect', color: COLORS.tool,
        get: (q) => {
          const t = find(q) as typeof m;
          return { u: t.box.y, v: (t.bottom + t.top) / 2, w: t.box.length, h: t.top - t.bottom };
        },
        set: (q, s) => {
          const t = find(q) as typeof m;
          t.box = { ...t.box, y: r2(s.u), length: r2(Math.max(0.1, s.w!)) };
          t.bottom = r2(Math.max(0, s.v - s.h! / 2));
          t.top = r2(Math.max(t.bottom + 0.1, s.v + s.h! / 2));
        },
      });
    }
  }
  // ---- sensors with a place on the robot ----
  p.devices.forEach((d, i) => {
    const mount = (d as { mount?: { x: number; y: number } }).mount;
    if (!mount || !['distance', 'optical', 'gps'].includes(d.type)) return;
    out.push({
      id: `dev:${i}`, owner: `dev:${i}`, label: `${d.name ?? d.type} (port ${d.port})`, view: 'top', kind: 'point', color: COLORS.sensor,
      get: (q) => {
        const m2 = (q.devices[i] as { mount: { x: number; y: number } }).mount;
        return { u: m2.x, v: m2.y };
      },
      set: (q, s) => {
        const dv = q.devices[i] as DeviceSpec & { mount: { x: number; y: number } };
        dv.mount = { ...dv.mount, x: r2(s.u), y: r2(s.v) };
      },
    });
  });
  return out;
}

function rectTop(owner: string, label: string, color: string, rect: (q: RobotProfile) => { x: number; y: number; width: number; length: number }): Handle {
  return {
    id: `${owner}:rect`, owner, label, view: 'top', kind: 'rect', color,
    get: (q) => {
      const r = rect(q);
      return { u: r.x, v: r.y, w: r.width, h: r.length };
    },
    set: (q, s) => {
      Object.assign(rect(q), { x: r2(s.u), y: r2(s.v), width: r2(Math.max(0.1, s.w!)), length: r2(Math.max(0.1, s.h!)) });
    },
  };
}

function pointYZ(
  owner: string,
  label: string,
  color: string,
  get: (q: RobotProfile) => { x?: number; y: number; z: number },
  put: (q: RobotProfile, at: { x?: number; y: number; z: number }) => void,
  suffix = ':at',
): Handle {
  return {
    id: owner + suffix, owner, label, view: 'side', kind: 'point', color,
    get: (q) => {
      const a = get(q);
      return { u: a.y, v: a.z };
    },
    set: (q, s) => put(q, { ...get(q), y: r2(s.u), z: r2(s.v) }),
  };
}

/** Snap a value to the editor's grid (0.25 in; 0.5 in with Shift). */
export function snapIn(v: number, coarse: boolean): number {
  const step = coarse ? 0.5 : 0.25;
  return Math.round(v / step) * step;
}
