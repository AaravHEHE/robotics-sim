// A robot built from VEX parts (cosmetic: the simulation still uses the robot profile).
// Parts sit on VEX's 0.5 in hole grid: positions are whole holes, rotations quarter turns,
// so placing and moving them is exact. Robot frame: x right, y forward, z up (inches).
// Pure: no three.js, no DOM.

export type PartKind =
  | 'channel'
  | 'angle'
  | 'plate'
  | 'wheel'
  | 'motor'
  | 'gear'
  | 'sprocket'
  | 'chain'
  | 'pulley'
  | 'rope'
  | 'rack'
  | 'band'
  | 'standoff'
  | 'shaft'
  | 'box'
  | 'cylinder'
  | 'screw'
  | 'nut'
  | 'washer'
  | 'collar'
  | 'spacer'
  | 'bearing'
  | 'gusset';

export interface PartDef {
  id: string;
  name: string;
  kind: PartKind;
  /** The palette group it is listed under. */
  group?: string;
  /** Steel parts are darker (structure); `finish` black for slide rails. */
  material?: 'steel';
  finish?: 'black';
  /** A screw's length under its head (in). */
  shank?: number;
  /** Thickness of a shaft, rope or tubing (in). */
  thickness?: number;
  /** Chain pitch (in): #25 = 0.25, #35 = 0.375. */
  pitch?: number;
  /** Holes across the web (channels, angles, plates) and up the flanges. */
  web?: number;
  flange?: number;
  /** Lengths offered (holes) and the default. */
  lengths?: number[];
  length?: number;
  diameter?: number;
  width?: number;
  style?: 'omni' | 'traction' | 'flex' | 'mecanum' | 'spool' | 'keps' | 'nylock' | 'clamp' | 'rubber' | 'block';
  size?: [number, number, number];
  cartridges?: string[];
  cartridge?: string;
  teeth?: number;
  color?: string;
  accent?: string;
}

export interface Catalog {
  schema: 1;
  pitch: number;
  parts: PartDef[];
}

export interface Placed {
  part: string;
  /** Length in holes, for parts that come in lengths. */
  length?: number;
  /** Motor cartridge color. */
  cartridge?: string;
  /** The rotated part's lowest corner, in holes (0.5 in). */
  pos: [number, number, number];
  /** Quarter turns about x, y, z (applied in that order). */
  rot: [number, number, number];
}

export interface Assembly {
  v: 1;
  parts: Placed[];
}

export const PITCH = 0.5;
/** A button-head screw's head height (in). */
export const SCREW_HEAD = 0.09;
/** How far a bearing flat's round boss stands off its plate (in). */
export const BEARING_BOSS = 0.09;
export const MAX_PARTS = 500;

/** A part's outer size before rotation (in): x along its length, y across, z up. */
export function partSize(def: PartDef, p: Pick<Placed, 'length'>): [number, number, number] {
  const len = (p.length ?? def.length ?? 1) * PITCH;
  switch (def.kind) {
    case 'channel':
      return [len, (def.web ?? 2) * PITCH, (def.flange ?? 1) * PITCH];
    case 'angle':
      return [len, (def.web ?? 1) * PITCH, (def.flange ?? 1) * PITCH];
    case 'plate':
      return [len, (def.web ?? 5) * PITCH, def.web && def.web >= 10 ? 0.093 : 0.063];
    case 'wheel':
      return [def.width ?? 1, def.diameter ?? 4, def.diameter ?? 4];
    case 'gear': {
      const od = (def.teeth ?? 36) / 24 + 2 / 24;
      return [def.width ?? 0.2, od, od];
    }
    case 'sprocket': {
      const od = sprocketPitchDiameter(def) + (def.pitch ?? 0.25) * 0.6;
      return [def.width ?? 0.13, od, od];
    }
    case 'chain': {
      const pitch = def.pitch ?? 0.25;
      return [(p.length ?? def.length ?? 24) * pitch, pitch * 0.55, pitch * 0.9];
    }
    case 'pulley':
      return [def.width ?? 0.4, def.diameter ?? 1, def.diameter ?? 1];
    case 'rope':
      return [len, def.thickness ?? 0.06, def.thickness ?? 0.06];
    case 'rack':
      return [len, 0.5, 0.375];
    case 'band':
      return [0.1, def.diameter ?? 1, (def.diameter ?? 1) * 0.55];
    case 'standoff':
      return [0.25, 0.25, len];
    case 'shaft':
      return [len, def.thickness ?? 0.125, def.thickness ?? 0.125];
    case 'cylinder':
      return [def.length ?? 3, def.diameter ?? 1, def.diameter ?? 1];
    case 'screw':
      // the head (x 0 to 0.09) then the shank
      return [SCREW_HEAD + (def.shank ?? 0.5), def.diameter ?? 0.32, def.diameter ?? 0.32];
    case 'nut': {
      // across the corners of the hex
      const ac = (def.diameter ?? 0.344) / Math.cos(Math.PI / 6);
      return [def.width ?? 0.14, ac, ac];
    }
    case 'washer':
    case 'collar':
    case 'spacer':
      return [def.width ?? 0.125, def.diameter ?? 0.5, def.diameter ?? 0.5];
    case 'bearing':
      return [len, (def.web ?? 1) * PITCH, def.style === 'block' ? 0.5 : 0.063 + BEARING_BOSS];
    case 'gusset':
      return [len, (def.web ?? 2) * PITCH, (def.flange ?? 2) * PITCH];
    default:
      return def.size ?? [1, 1, 1];
  }
}

/** A sprocket's pitch diameter: where the chain's pins ride (in). */
export function sprocketPitchDiameter(def: PartDef): number {
  return (def.pitch ?? 0.25) / Math.sin(Math.PI / (def.teeth ?? 12));
}

type Mat3 = [number, number, number, number, number, number, number, number, number];
const mul = (a: Mat3, b: Mat3): Mat3 => {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
};
const quarter = (axis: 0 | 1 | 2, n: number): Mat3 => {
  const t = (((n % 4) + 4) % 4) * (Math.PI / 2);
  const c = Math.round(Math.cos(t));
  const s = Math.round(Math.sin(t));
  if (axis === 0) return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 1) return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};

/** The part's rotation as a 3×3 matrix (row-major): x turns first, then y, then z. */
export function rotation(rot: [number, number, number]): Mat3 {
  return mul(quarter(2, rot[2]), mul(quarter(1, rot[1]), quarter(0, rot[0])));
}

/** Where a placed part is: its box corners in the robot frame, and the offset its own corner moves by. */
export function placement(def: PartDef, p: Placed): { min: [number, number, number]; max: [number, number, number]; offset: [number, number, number] } {
  const size = partSize(def, p);
  const R = rotation(p.rot);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let c = 0; c < 8; c++) {
    const v = [c & 1 ? size[0] : 0, c & 2 ? size[1] : 0, c & 4 ? size[2] : 0];
    for (let i = 0; i < 3; i++) {
      const w = R[i * 3] * v[0] + R[i * 3 + 1] * v[1] + R[i * 3 + 2] * v[2];
      lo[i] = Math.min(lo[i], w);
      hi[i] = Math.max(hi[i], w);
    }
  }
  // the rotated box's lowest corner goes to pos
  const offset = [0, 1, 2].map((i) => p.pos[i] * PITCH - lo[i]) as [number, number, number];
  return {
    min: [0, 1, 2].map((i) => lo[i] + offset[i]) as [number, number, number],
    max: [0, 1, 2].map((i) => hi[i] + offset[i]) as [number, number, number],
    offset,
  };
}

const defOf = (cat: Catalog, id: string) => cat.parts.find((d) => d.id === id);

/** The box around all parts (in), or null when there are none. */
export function bounds(asm: Assembly, cat: Catalog): { min: [number, number, number]; max: [number, number, number] } | null {
  let out: { min: [number, number, number]; max: [number, number, number] } | null = null;
  for (const p of asm.parts) {
    const def = defOf(cat, p.part);
    if (!def) continue;
    const b = placement(def, p);
    if (!out) out = { min: [...b.min], max: [...b.max] };
    else for (let i = 0; i < 3; i++) {
      out.min[i] = Math.min(out.min[i], b.min[i]);
      out.max[i] = Math.max(out.max[i], b.max[i]);
    }
  }
  return out;
}

/**
 * What the robot profile could take from the build: its size, and (from wheels with their
 * axles across the robot) the track width and wheel diameter.
 */
export function suggestProfile(asm: Assembly, cat: Catalog): { size?: { width: number; length: number; height: number }; trackWidth?: number; wheelDiameter?: number } {
  const b = bounds(asm, cat);
  if (!b) return {};
  const q = (v: number) => Math.round(v * 4) / 4;
  const out: ReturnType<typeof suggestProfile> = { size: { width: q(b.max[0] - b.min[0]), length: q(b.max[1] - b.min[1]), height: q(b.max[2] - b.min[2]) } };
  const cx = (b.min[0] + b.max[0]) / 2;
  const left: number[] = [];
  const right: number[] = [];
  let diameter: number | undefined;
  for (const p of asm.parts) {
    const def = defOf(cat, p.part);
    if (def?.kind !== 'wheel') continue;
    const R = rotation(p.rot);
    if (Math.abs(R[0]) !== 1) continue; // its axle isn't across the robot
    const pl = placement(def, p);
    const x = (pl.min[0] + pl.max[0]) / 2;
    (x < cx ? left : right).push(x);
    diameter ??= def.diameter;
  }
  if (left.length && right.length) {
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    out.trackWidth = q(mean(right) - mean(left));
    out.wheelDiameter = diameter;
  }
  return out;
}

/** Problems with an assembly read from storage or a file (empty = fine). */
export function validateAssembly(a: unknown, cat: Catalog): string[] {
  const asm = a as Partial<Assembly>;
  if (!asm || asm.v !== 1 || !Array.isArray(asm.parts)) return ['Not a parts build.'];
  const e: string[] = [];
  if (asm.parts.length > MAX_PARTS) e.push(`Too many parts (${asm.parts.length}; at most ${MAX_PARTS}).`);
  asm.parts.forEach((p, i) => {
    if (!defOf(cat, p?.part)) e.push(`Part ${i + 1}: unknown part "${String(p?.part)}".`);
    else if (!Array.isArray(p.pos) || p.pos.length !== 3 || !p.pos.every(Number.isInteger)) e.push(`Part ${i + 1}: position must be three whole hole counts.`);
    else if (!Array.isArray(p.rot) || p.rot.length !== 3 || !p.rot.every(Number.isInteger)) e.push(`Part ${i + 1}: rotation must be three whole quarter turns.`);
  });
  return e;
}
