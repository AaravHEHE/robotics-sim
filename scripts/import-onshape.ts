// Turn an Onshape assembly (exported as glTF, then reduced by scripts/onshape/gltf-extract.py)
// into a parts-kit build: every instance becomes a catalog part placed exactly where the CAD
// has it (free placement, see FreeXf in src/app/parts/assembly.ts).
//
//   python scripts/onshape/gltf-extract.py <assembly.gltf> <extract.json>
//   node scripts/import-onshape.ts <extract.json> <out.build.json> [--forward=+y|-y] [--yaw=<deg>] [--exclude=Goal]
//
// The CAD frame is taken as x right, y forward, z up (Onshape's own, with the export left at
// its default). The robot's origin goes to the middle of the drive wheels, the floor to the
// bottom of the wheels. Parts the catalog has no match for become boxes of their size ("custom-box")
// and are listed in the report so they can be modelled properly.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { partSize, placement, type Placed, type Rot3 } from '../src/app/parts/assembly.ts';
import { repoRoot } from './node-toolchain.ts';

interface Inst { name: string; m: number[]; lo: number[]; hi: number[]; cen: number[]; mesh: number }
interface Def { id: string; kind: string; length?: number; lengths?: number[]; shank?: number; diameter?: number; teeth?: number; style?: string; [k: string]: unknown }
type V3 = [number, number, number];

const IN = 1 / 0.0254;
const args = process.argv.slice(2);
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const [inFile, outFile] = args.filter((a) => !a.startsWith('--'));
if (!inFile || !outFile) throw new Error('usage: node scripts/import-onshape.ts <extract.json> <out.build.json> [--forward=+y|-y] [--exclude=Goal]');
const forward = flag('forward') ?? '+y';
const exclude = new RegExp(flag('exclude') ?? '^Goal$');

const catalog = JSON.parse(await readFile(path.join(repoRoot, 'data/parts/vex-parts.json'), 'utf8')) as { parts: Def[] };
const defs = new Map(catalog.parts.map((d) => [d.id, d]));
const get = (id: string): Def => {
  const d = defs.get(id);
  if (!d) throw new Error(`catalog has no part "${id}"`);
  return d;
};

interface Spec { id: string; length?: number; cartridge?: string; size?: V3 }
const near = (v: number, xs: number[]) => xs.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
const holes = (inches: number) => Math.max(1, Math.round(inches / 0.5));

/** The catalog part for a CAD instance (D = its box in the CAD's own axes, inches), or null. */
function mapPart(name: string, D: V3): Spec | null {
  const sorted = [...D].sort((a, b) => b - a);
  const long = sorted[0];
  const n = (re: RegExp) => name.match(re);
  let m: RegExpMatchArray | null;
  if (/C-Channel/i.test(name)) {
    const web = sorted[1]; // the width across the web (the flange height is the smallest)
    const id = web < 0.8 ? 'c-channel-1x1x1' : web < 1.25 ? 'c-channel-1x2x1' : web < 2 ? 'c-channel-1x3x1' : web < 3 ? 'c-channel-1x5x1' : 'c-channel-2x2x2';
    const standard = (get(id).web as number) * 0.5;
    // a channel cut or modelled to another width keeps the size it has in the CAD
    return Math.abs(web - standard) > 0.1 ? { id, length: holes(long), size: [long, web, sorted[2]] } : { id, length: holes(long) };
  }
  if (/Aluminum Angle/i.test(name)) {
    const w = sorted[1];
    return { id: w < 0.75 ? 'angle-1x1' : w < 1.25 ? 'angle-2x2' : 'angle-3x3', length: holes(long) };
  }
  if (/Standoff/i.test(name)) return { id: 'standoff', length: holes(long) };
  if (/Star Drive Screw|Flat Head Screw/i.test(name)) {
    const shank = long - 0.09;
    const screws = catalog.parts.filter((d) => d.kind === 'screw');
    const best = screws.reduce((a, b) => (Math.abs((b.shank ?? 0) - shank) < Math.abs((a.shank ?? 0) - shank) ? b : a));
    return { id: best.id };
  }
  if (/Nylock Nut/i.test(name)) return { id: 'nut-nylock' };
  if (/Keps/i.test(name)) return { id: 'nut' };
  if (/Shaft Collar/i.test(name)) return { id: 'collar' };
  if (/Gear Shaft Insert|Gear Insert/i.test(name)) return { id: 'collar', size: [Math.min(...D), long, long] };
  if (/Washer/i.test(name)) return { id: 'washer', size: [Math.min(...D), long, long] };
  if (/^Pulley/i.test(name)) return { id: 'pulley-1', size: [Math.min(...D), long, long] };
  if (/Flat Bearing/i.test(name)) return { id: 'bearing-flat', length: holes(long) };
  if (/Pillow Block/i.test(name)) return { id: 'pillow-block', length: holes(long) };
  if (/VersaHex/i.test(name)) return { id: 'versahex-adapter' };
  if (/Spacer/i.test(name)) {
    // a spacer is a short cylinder: its axle is its shortest side
    const t = Math.min(...D);
    const od = [...D].sort((a, b) => a - b)[2];
    return { id: 'spacer-0.25', size: [t, od, od] };
  }
  if ((m = n(/V5 Smart Motor \((\d+):1\)/i))) return { id: 'v5-motor', cartridge: m[1] === '36' ? 'red' : m[1] === '6' ? 'blue' : 'green' };
  if (/V5 Smart Motor \(5\.5W\)/i.test(name)) return { id: 'exp-motor' };
  if ((m = n(/(\d+)T High Strength Sprocket/i))) return defs.has(`sprocket-hs-${m[1]}`) ? { id: `sprocket-hs-${m[1]}` } : null;
  if ((m = n(/(\d+)T Sprocket/i))) return defs.has(`sprocket-${m[1]}`) ? { id: `sprocket-${m[1]}` } : null;
  if ((m = n(/(\d+)T High Strength Gear/i))) return defs.has(`gear-hs-${m[1]}`) ? { id: `gear-hs-${m[1]}` } : null;
  if ((m = n(/(\d+)T Gear/i)) ?? (m = n(/GEAR-(\d+)TOOTH/i))) return defs.has(`gear-${m[1]}`) ? { id: `gear-${m[1]}` } : null;
  if (/Anti-Static/i.test(name)) return { id: 'antistatic-3.25' };
  if (/Omni/i.test(name)) return { id: near(long, [2.75, 3.25, 4]) === 3.25 ? 'omni-3.25' : near(long, [2.75, 3.25, 4]) === 4 ? 'omni-4' : 'omni-2.75' };
  if ((m = n(/(\d+(?:\.\d+)?)"[^"]*Flex Wheel/i))) {
    const id = `flex-${m[1].replace('.', '_')}`;
    return defs.has(id) ? { id } : null;
  }
  if (/276-7771/i.test(name)) return { id: long < 3.1 ? 'flex-3' : 'omni-3.25', size: [Math.min(...D), long, long] };
  if (/High Strength Shaft/i.test(name)) return { id: 'shaft-hs', length: holes(long) };
  if (/Standard Shaft/i.test(name)) return { id: 'shaft', length: holes(long) };
  return null;
}

// which way a part's off-center weight lies in the catalog's own frame (the sign of its centroid on that axis)
const CENTROID: Record<string, [number, number, number]> = {
  channel: [0, 0, -1], // web at z = 0, flanges up
  angle: [0, -1, -1],
  screw: [-1, 0, 0], // head at x = 0
  bearing: [0, 0, -1],
};

const det3 = (c: V3[]) => c[0][0] * (c[1][1] * c[2][2] - c[2][1] * c[1][2]) - c[1][0] * (c[0][1] * c[2][2] - c[2][1] * c[0][2]) + c[2][0] * (c[0][1] * c[1][2] - c[1][1] * c[0][2]);
const PERMS: V3[] = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

const insts = JSON.parse(await readFile(inFile, 'utf8')) as Inst[];
const placed: { p: Placed; world: V3; name: string; id: string }[] = [];
const unmapped = new Map<string, number>();
const excluded: string[] = [];

for (const i of insts) {
  if (exclude.test(i.name)) {
    excluded.push(i.name);
    continue;
  }
  const lo = i.lo.map((v) => v * IN) as V3;
  const hi = i.hi.map((v) => v * IN) as V3;
  const D = hi.map((v, k) => v - lo[k]) as V3;
  const cLocal = lo.map((v, k) => (v + hi[k]) / 2) as V3;
  const e = i.cen.map((v, k) => v * IN - cLocal[k]) as V3; // the centroid's offset from the box center, CAD axes
  let spec = mapPart(i.name, D);
  if (!spec) {
    spec = { id: 'custom-box', size: D };
    unmapped.set(i.name, (unmapped.get(i.name) ?? 0) + 1);
  }
  const def = get(spec.id);
  const part: Placed = { part: spec.id, pos: [0, 0, 0], rot: [0, 0, 0] };
  if (spec.length) part.length = spec.length;
  if (spec.cartridge) part.cartridge = spec.cartridge;
  if (spec.size) part.size = spec.size.map((v) => Math.round(v * 1000) / 1000) as V3;
  const S = partSize(def as never, part);

  // match the catalog box to the CAD box: which CAD axis each catalog axis lies along
  let best = PERMS[0];
  let cost = Infinity;
  for (const pm of PERMS) {
    const c = Math.abs(S[0] - D[pm[0]]) + Math.abs(S[1] - D[pm[1]]) + Math.abs(S[2] - D[pm[2]]);
    if (c < cost - 1e-9) ((cost = c), (best = pm));
  }
  const sign: V3 = [1, 1, 1];
  const want = CENTROID[def.kind] ?? [0, 0, 0];
  const evidence: number[] = [0, 0, 0];
  // the catalog's heavy side (want < 0) must face the CAD's centroid offset: centroid in catalog axes = sign * offset
  for (let k = 0; k < 3; k++) {
    const off = e[best[k]];
    evidence[k] = want[k] !== 0 ? Math.abs(off) : 0;
    if (want[k] !== 0 && Math.abs(off) > 0.015) sign[k] = want[k] * Math.sign(off);
  }
  // catalog axis k, expressed in CAD axes: sign[k] * e_{best[k]}
  const cols: V3[] = [0, 1, 2].map((k) => {
    const v: V3 = [0, 0, 0];
    v[best[k]] = sign[k];
    return v;
  });
  if (det3(cols) < 0) {
    // a mirror image: flip the axis with the least evidence for its direction
    const k = [0, 1, 2].sort((a, b) => evidence[a] - evidence[b])[0];
    cols[k] = cols[k].map((v) => -v) as V3;
  }
  // world: the instance matrix (column-major, meters) turns CAD axes into the world
  const m = i.m;
  const Rm = (a: number, b: number) => m[b * 4 + a]; // row a, column b
  const world = (v: V3): V3 => [0, 1, 2].map((r) => Rm(r, 0) * v[0] + Rm(r, 1) * v[1] + Rm(r, 2) * v[2]) as V3;
  const axes = cols.map(world); // the catalog's x, y, z in the world
  const R = [axes[0][0], axes[1][0], axes[2][0], axes[0][1], axes[1][1], axes[2][1], axes[0][2], axes[1][2], axes[2][2]] as Rot3;
  const cw = world(cLocal);
  const c: V3 = [cw[0] + m[12] * IN, cw[1] + m[13] * IN, cw[2] + m[14] * IN];
  part.xf = { c, r: R };
  placed.push({ p: part, world: c, name: i.name, id: spec.id });
}

// the robot's frame: origin at the middle of the drive wheels, floor at the wheels' bottoms
const drive = placed.filter((q) => /omni|antistatic|traction/.test(q.id));
const wheelCenters = drive.length ? drive.map((q) => q.world) : placed.map((q) => q.world);
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const x0 = mean(wheelCenters.map((v) => v[0]));
const y0 = mean(wheelCenters.map((v) => v[1]));
const floor = drive.length ? Math.min(...drive.map((q) => q.world[2] - ((q.p.size?.[1] ?? (defs.get(q.id)?.diameter as number) ?? 3.25) / 2))) : Math.min(...placed.map((q) => placement(get(q.id) as never, q.p).min[2])); // no wheels: the lowest part edge
// turn the whole robot about z when the CAD's front is not +y (--forward=-y, or --yaw=<degrees>)
const yaw = flag('yaw') !== undefined ? Number(flag('yaw')) : forward === '-y' ? 180 : 0;
const cy = Math.cos((yaw * Math.PI) / 180);
const sy = Math.sin((yaw * Math.PI) / 180);
const turnZ = (v: number[]) => [cy * v[0] - sy * v[1], sy * v[0] + cy * v[1], v[2]];
for (const q of placed) {
  const xf = q.p.xf!;
  let c: V3 = [xf.c[0] - x0, xf.c[1] - y0, xf.c[2] - floor];
  let r = xf.r.slice() as number[];
  if (yaw !== 0) {
    c = turnZ(c) as V3;
    // R' = Rz * R: each column of R turned about z
    const col = (j: number) => turnZ([r[j], r[3 + j], r[6 + j]]);
    const [a, b, d] = [col(0), col(1), col(2)];
    r = [a[0], b[0], d[0], a[1], b[1], d[1], a[2], b[2], d[2]];
  }
  xf.c = c.map((v) => Math.round(v * 10000) / 10000) as V3;
  xf.r = r.map((v) => Math.round(v * 1e6) / 1e6 || 0) as Rot3;
}

const out = {
  v: 1 as const,
  source: { importer: 'scripts/import-onshape.ts', input: path.basename(inFile), forward, yaw, origin: [x0, y0, floor], instances: insts.length, excluded: excluded.length },
  parts: placed.map((q) => q.p),
};
await writeFile(outFile, JSON.stringify(out));

const byId = new Map<string, number>();
for (const q of placed) byId.set(q.id, (byId.get(q.id) ?? 0) + 1);
console.log(`${placed.length} parts from ${insts.length} instances (${excluded.length} excluded: ${[...new Set(excluded)].join(', ') || 'none'})`);
console.log(`origin: x ${x0.toFixed(2)}, y ${y0.toFixed(2)}, floor z ${floor.toFixed(2)} (CAD inches); forward ${forward}`);
console.log([...byId].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} x ${k}`).join(', '));
if (unmapped.size) {
  console.log(`\n${[...unmapped.values()].reduce((a, b) => a + b, 0)} parts have no catalog match and became custom boxes:`);
  for (const [k, v] of unmapped) console.log(`  ${v} x ${k}`);
}
