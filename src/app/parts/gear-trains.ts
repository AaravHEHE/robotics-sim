// Which gears in a build actually mesh, and whether each train can turn. Pure (no three.js).
//
// A VEX gear's pitch diameter is its teeth / 24 in, so two gears mesh when their axes are
// parallel, they sit in the same plane (their axial gap is under a gear's width) and their
// centers are (teeth1 + teeth2) / 48 apart. Each mesh turns the driven gear the other way, so
// a train is only free to turn when its gears can be two-colored (an odd loop locks it).
import { rotationOf, type Assembly, type Catalog } from './assembly.ts';

export interface GearInfo {
  index: number;
  part: string;
  teeth: number;
  center: [number, number, number];
  axis: [number, number, number];
}

export interface GearTrain {
  /** Indices (into the build's parts) of the gears, in the order they were reached. */
  members: number[];
  /** True when the train can turn: no odd loop of meshing gears. */
  free: boolean;
}

export interface GearReport {
  gears: GearInfo[];
  /** Pairs of gear indices that mesh. */
  meshes: [number, number][];
  /** Connected groups of two or more gears. */
  trains: GearTrain[];
  /** Gears that mesh with nothing. */
  isolated: number[];
}

const TOOTH_PITCH = 24; // teeth per inch of pitch diameter
/** How close the centers must be to the ideal distance to count as meshing (in). */
const CENTER_TOLERANCE = 0.12;
/** How far apart along the axle two gears may be and still touch (in). */
const AXIAL_OVERLAP = 0.3;

export function gearReport(asm: Assembly, cat: Catalog): GearReport {
  const gears: GearInfo[] = [];
  asm.parts.forEach((p, index) => {
    const def = cat.parts.find((d) => d.id === p.part);
    if (def?.kind !== 'gear' || !def.teeth) return;
    const R = rotationOf(p);
    const c = p.xf?.c ?? ([p.pos[0] * 0.5, p.pos[1] * 0.5, p.pos[2] * 0.5] as [number, number, number]);
    gears.push({ index, part: p.part, teeth: def.teeth, center: c, axis: [R[0], R[3], R[6]] });
  });

  const meshes: [number, number][] = [];
  for (let a = 0; a < gears.length; a++) {
    for (let b = a + 1; b < gears.length; b++) {
      const g = gears[a];
      const h = gears[b];
      const dot = g.axis[0] * h.axis[0] + g.axis[1] * h.axis[1] + g.axis[2] * h.axis[2];
      if (Math.abs(Math.abs(dot) - 1) > 0.02) continue; // axles not parallel
      const d = [h.center[0] - g.center[0], h.center[1] - g.center[1], h.center[2] - g.center[2]];
      const along = d[0] * g.axis[0] + d[1] * g.axis[1] + d[2] * g.axis[2];
      const radial = Math.hypot(d[0] - along * g.axis[0], d[1] - along * g.axis[1], d[2] - along * g.axis[2]);
      if (Math.abs(along) < AXIAL_OVERLAP && Math.abs(radial - (g.teeth + h.teeth) / (2 * TOOTH_PITCH)) < CENTER_TOLERANCE) meshes.push([g.index, h.index]);
    }
  }

  const adj = new Map<number, number[]>();
  for (const [a, b] of meshes) {
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  const color = new Map<number, 0 | 1>();
  const trains: GearTrain[] = [];
  for (const g of gears) {
    if (color.has(g.index) || !adj.has(g.index)) continue;
    const members: number[] = [];
    let free = true;
    color.set(g.index, 0);
    const stack = [g.index];
    while (stack.length) {
      const x = stack.pop()!;
      members.push(x);
      for (const y of adj.get(x) ?? []) {
        if (!color.has(y)) {
          color.set(y, color.get(x) === 0 ? 1 : 0);
          stack.push(y);
        } else if (color.get(y) === color.get(x)) free = false;
      }
    }
    trains.push({ members, free });
  }
  return { gears, meshes, trains, isolated: gears.filter((g) => !adj.has(g.index)).map((g) => g.index) };
}
