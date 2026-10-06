// Generate data/fields/override.json from the V5RC Override manual v2.0, Appendix A
// (see docs/override-field-spec.md). All source numbers are millimetres from the
// manual; the field file is in inches with the origin at the field center.
//   node scripts/gen-override-field.ts
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FieldDef, GoalDef, LayoutItem, LayoutPiece, LoaderDef, StartPosition, TapeDef, ToggleDef, Vec2, ZoneDef } from '../src/sim/field.ts';
import { repoRoot } from './node-toolchain.ts';

const IN = (mm: number) => Math.round((mm / 25.4) * 1000) / 1000;
const P = (x: number, y: number): Vec2 => [IN(x), IN(y)];

// Appendix A (mm)
const HALF = 1783.2; // half of 3566.4 inside wall-to-wall (portable perimeter, A13)
const G1 = 598.1; // tile seam offsets (A10): 1783.2 - 1185.1
const G2 = 1196.1; // 1783.2 - 587.1
const WALL_ROW = 1743.1; // wall groups (A12): 1783.2 - 40.1
const CUP_STEP = 80.2; // cup spacing in wall groups (A12)
const MID_INNER = G1 - 12.7 * Math.SQRT2; // Midfield inner tape edge (1" tape, A11)
const LOAD_ZONE_DEPTH = 299.05; // to the center of the first tile (A11 detail C)

const goal = (id: string, kind: GoalDef['kind'], color: GoalDef['color'], x: number, y: number, zone: string, aprilTag: number): GoalDef => {
  const spec = { alliance: { h: 82.5, body: 10 }, neutral: { h: 146.5, body: 64 }, center: { h: 222.7, body: 140.2 } }[kind];
  return { id, kind, color, x: IN(x), y: IN(y), height: IN(spec.h), baseWidth: IN(142.5), topWidth: IN(88.8), bodyHeight: IN(spec.body), socket: IN(60.1), zone, aprilTag };
};

const goals: GoalDef[] = [
  goal('C', 'center', 'neutral', 0, 0, 'midfield', 0),
  goal('R1', 'alliance', 'red', -G2, -G1, 'red1', 2),
  goal('N_R1', 'neutral', 'neutral', -G2, G1, 'red1', 1),
  goal('R2', 'alliance', 'red', -G1, -G2, 'red2', 3),
  goal('N_R2', 'neutral', 'neutral', G1, -G2, 'red2', 4),
  goal('B1', 'alliance', 'blue', G2, G1, 'blue1', 2),
  goal('N_B1', 'neutral', 'neutral', G2, -G1, 'blue1', 1),
  goal('B2', 'alliance', 'blue', G1, G2, 'blue2', 3),
  goal('N_B2', 'neutral', 'neutral', -G1, G2, 'blue2', 4),
];

// Toggles (A8, A15): yellow faces in; the wall's alliance color faces out.
const redSide = { in: 'yellow', out: 'red', down: 'blue' };
const blueSide = { in: 'yellow', out: 'blue', down: 'red' };
const toggle = (id: string, wall: ToggleDef['wall'], x: number, y: number, zone: string, start: ToggleDef['start']): ToggleDef => ({
  id, wall, x: IN(x), y: IN(y), length: IN(660.2), sectionHeight: IN(51.6), topHeight: IN(335.3), zone, start,
});
const toggles: ToggleDef[] = [
  toggle('T_red1', 'left', -HALF, 0, 'red1', redSide),
  toggle('T_red2', 'bottom', 0, -HALF, 'red2', redSide),
  toggle('T_blue1', 'right', HALF, 0, 'blue1', blueSide),
  toggle('T_blue2', 'top', 0, HALF, 'blue2', blueSide),
];

// Loaders (A9, A10)
const loader = (id: string, alliance: 'red' | 'blue', y: number): LoaderDef => ({
  id, alliance, wall: alliance === 'red' ? 'left' : 'right', x: IN(alliance === 'red' ? -HALF : HALF), y: IN(y),
  width: IN(102.1), depth: IN(95), height: IN(365), opening: IN(82.5),
});
const loaders: LoaderDef[] = [loader('L_red_n', 'red', 1492.6), loader('L_red_s', 'red', -1492.6), loader('L_blue_n', 'blue', 1492.6), loader('L_blue_s', 'blue', -1492.6)];

// Zones. Quadrants are bounded by the diagonals, the perimeter and the Midfield.
const d = G1 / 2; // where the diagonals meet the Midfield tape
const zones: ZoneDef[] = [
  { id: 'red1', kind: 'quadrant', name: 'Red 1', color: 'red', polygon: [P(-HALF, HALF), P(-HALF, -HALF), P(-d, -d), P(-G1, 0), P(-d, d)] },
  { id: 'red2', kind: 'quadrant', name: 'Red 2', color: 'red', polygon: [P(-HALF, -HALF), P(HALF, -HALF), P(d, -d), P(0, -G1), P(-d, -d)] },
  { id: 'blue1', kind: 'quadrant', name: 'Blue 1', color: 'blue', polygon: [P(HALF, -HALF), P(HALF, HALF), P(d, d), P(G1, 0), P(d, -d)] },
  { id: 'blue2', kind: 'quadrant', name: 'Blue 2', color: 'blue', polygon: [P(HALF, HALF), P(-HALF, HALF), P(-d, d), P(0, G1), P(d, d)] },
  { id: 'midfield', kind: 'midfield', name: 'Midfield', color: 'neutral', polygon: [P(MID_INNER, 0), P(0, MID_INNER), P(-MID_INNER, 0), P(0, -MID_INNER)] },
  ...(['red', 'blue'] as const).flatMap((c) =>
    [1, -1].map((s): ZoneDef => {
      const wx = c === 'red' ? -HALF : HALF;
      const ix = c === 'red' ? -HALF + LOAD_ZONE_DEPTH : HALF - LOAD_ZONE_DEPTH;
      const y0 = s * (HALF - G1); // tile seam at 1185.1
      return { id: `load_${c}_${s > 0 ? 'n' : 's'}`, kind: 'loadZone', name: `${c} Load Zone`, color: c, polygon: [P(wx, y0), P(ix, y0), P(ix, s * HALF), P(wx, s * HALF)] };
    }),
  ),
];

// Tape (A11): white diagonals (double Autonomous Line on y = -x), Midfield square, colored Load Zone L's.
const W1 = IN(25.4);
const tape: TapeDef[] = [];
const white = (a: Vec2, b: Vec2, width = W1) => tape.push({ from: a, to: b, width, color: '#f2f2f2' });
// Autonomous Line: two 1" strips with a 0.5" gap (63.5 mm overall), offset perpendicular to y = -x
const off = (25.4 + 12.7) / 2 / Math.SQRT2;
for (const s of [1, -1]) {
  white(P(-HALF + s * off, HALF + s * off), P(-d + s * off, d + s * off));
  white(P(d + s * off, -d + s * off), P(HALF + s * off, -HALF + s * off));
}
white(P(-HALF, -HALF), P(-d, -d));
white(P(d, d), P(HALF, HALF));
const mv: Vec2[] = [P(G1, 0), P(0, G1), P(-G1, 0), P(0, -G1)];
for (let i = 0; i < 4; i++) white(mv[i], mv[(i + 1) % 4]);
for (const z of zones.filter((z) => z.kind === 'loadZone')) {
  const color = z.color === 'red' ? '#d8343a' : '#2f6fde';
  const [w0, i0, i1] = z.polygon;
  tape.push({ from: w0, to: i0, width: W1, color }, { from: i0, to: i1, width: W1, color });
}

// Starting layout (A12)
const yellow: [string, string] = ['yellow', 'yellow'];
const cupGray: LayoutPiece = { kind: 'cup', up: 'gray' };
const cupClear: LayoutPiece = { kind: 'cup', up: 'clear' };
const pin = (lower: string, upper: string): LayoutPiece => ({ kind: 'pin', colors: [lower, upper] });
const items: LayoutItem[] = [];
// 8 wall groups: three gray-up cups along the wall, a yellow pin in the middle one
for (const [x, y, along] of [
  [-G1, WALL_ROW, 'x'], [G1, WALL_ROW, 'x'], [-G1, -WALL_ROW, 'x'], [G1, -WALL_ROW, 'x'],
  [-WALL_ROW, G1, 'y'], [-WALL_ROW, -G1, 'y'], [WALL_ROW, G1, 'y'], [WALL_ROW, -G1, 'y'],
] as Array<[number, number, 'x' | 'y']>) {
  for (const k of [-1, 0, 1]) {
    const px = along === 'x' ? x + k * CUP_STEP : x;
    const py = along === 'y' ? y + k * CUP_STEP : y;
    items.push({ type: 'stack', x: IN(px), y: IN(py), pieces: k === 0 ? [cupGray, pin('yellow', 'yellow')] : [cupGray] });
  }
}
// 4 cross clusters on the Autonomous Line: clear-up cup + 4 pins lying radially (colored end outward)
const R = 40.1 + 82.5 + 2;
for (const [x, y] of [[-G2, G2], [-G1, G1], [G1, -G1], [G2, -G2]]) {
  items.push({ type: 'stack', x: IN(x), y: IN(y), pieces: [cupClear] });
  items.push({ type: 'lying', x: IN(x - R), y: IN(y), heading: 270, colors: ['yellow', 'red'] });
  items.push({ type: 'lying', x: IN(x), y: IN(y - R), heading: 180, colors: ['yellow', 'red'] });
  items.push({ type: 'lying', x: IN(x), y: IN(y + R), heading: 0, colors: ['yellow', 'blue'] });
  items.push({ type: 'lying', x: IN(x + R), y: IN(y), heading: 90, colors: ['yellow', 'blue'] });
}
// 4 Midfield corners: clear-up cup holding a red/blue pin (red up on the red side)
items.push({ type: 'stack', x: IN(-G1), y: 0, pieces: [cupClear, pin('blue', 'red')] });
items.push({ type: 'stack', x: 0, y: IN(-G1), pieces: [cupClear, pin('blue', 'red')] });
items.push({ type: 'stack', x: IN(G1), y: 0, pieces: [cupClear, pin('red', 'blue')] });
items.push({ type: 'stack', x: 0, y: IN(G1), pieces: [cupClear, pin('red', 'blue')] });
// 4 on the y = x diagonal: clear-up cup holding a yellow pin
for (const v of [-G2, -G1, G1, G2]) items.push({ type: 'stack', x: IN(v), y: IN(v), pieces: [cupClear, pin(...yellow)] });

const neutralGoalPins: LayoutItem[] = goals.filter((g) => g.color === 'neutral').map((g) => ({ type: 'goal', goal: g.id, pieces: [pin(...yellow)] }));
const many = (n: number, p: LayoutPiece) => Array.from({ length: n }, () => p);

// Legal SG1 starts: against the own wall, clear of the Toggle (wall center), Goals, Load Zones
// and the wall-group Cups (whose outer Cup reaches 28.3" from the wall center), for robots up
// to 15" wide.
const S = IN(HALF) - 9.5;
const start = (id: string, name: string, alliance: 'red' | 'blue', zone: string, x: number, y: number, theta: number, layouts: string[]): StartPosition => ({ id, name, alliance, zone, x, y, theta, layouts });
const startPositions: StartPosition[] = [
  start('red1_n', 'Red 1 (left wall, north)', 'red', 'red1', -S, 37, 90, ['h2h', 'skills']),
  start('red1_s', 'Red 1 (left wall, south)', 'red', 'red1', -S, -37, 90, ['h2h', 'skills']),
  start('red2_w', 'Red 2 (bottom wall, west)', 'red', 'red2', -37, -S, 0, ['h2h']),
  start('red2_e', 'Red 2 (bottom wall, east)', 'red', 'red2', 37, -S, 0, ['h2h']),
  start('blue1_n', 'Blue 1 (right wall, north)', 'blue', 'blue1', S, 37, 270, ['h2h']),
  start('blue1_s', 'Blue 1 (right wall, south)', 'blue', 'blue1', S, -37, 270, ['h2h']),
  start('blue2_w', 'Blue 2 (top wall, west)', 'blue', 'blue2', -37, S, 180, ['h2h']),
  start('blue2_e', 'Blue 2 (top wall, east)', 'blue', 'blue2', 37, S, 180, ['h2h']),
];

const field: FieldDef = {
  schema: 1,
  id: 'override',
  name: 'V5RC Override (2026-27)',
  perimeter: { inside: IN(2 * HALF), wallHeight: IN(293), wallThickness: IN(50.8) },
  tiles: { count: 6, color: '#5b5e63', lineColor: '#e8e8e8' },
  objects: [],
  goals,
  toggles,
  loaders,
  zones,
  tape,
  layouts: {
    h2h: {
      name: 'Head-to-Head',
      items: [...items, ...neutralGoalPins],
      preload: { red: pin('red', 'yellow'), blue: pin('blue', 'yellow') },
      matchLoads: {
        red: [...many(10, cupClear), ...many(10, pin('red', 'yellow')), pin(...yellow)],
        blue: [...many(10, cupClear), ...many(10, pin('blue', 'yellow')), pin(...yellow)],
      },
    },
    skills: {
      name: 'Robot Skills',
      items,
      preload: { red: pin('red', 'yellow') },
      matchLoads: { red: [...many(3, pin('red', 'yellow')), ...many(4, pin('blue', 'yellow')), ...many(7, cupClear)] },
    },
  },
  startPositions,
  game: { id: 'override' },
  // The official field CAD (276-9250-000, loaded by the visitor) carries no colors (every
  // part is SolidWorks' default): its parts are colored by part number here.
  cadLook: [
    { match: '^Tape.*Red', color: '#d0312d', roughness: 0.6 },
    { match: '^Tape.*Blue', color: '#2c6fd6', roughness: 0.6 },
    { match: '^Tape', color: '#f2f2f0', roughness: 0.6 },
    { match: 'Alliance Stations.*199c', color: '#c8102e', roughness: 0.8 },
    { match: 'Alliance Stations.*299c', color: '#0072ce', roughness: 0.8 },
    { match: '276-6904-001', color: '#6d7175', roughness: 1 }, // foam field tiles
    { match: '276-7596-01[45]', color: '#e6eef4', opacity: 0.2, roughness: 0.05 }, // polycarbonate perimeter panels
    { match: 'Red \\d/276-9250-003', color: '#c8282e', roughness: 0.55 }, // Goal bodies
    { match: 'Blue \\d/276-9250-003', color: '#2a66d0', roughness: 0.55 },
    { match: '276-9250-003', color: '#202226', roughness: 0.55 },
    { match: '276-4847-011', color: '#3a3d42', roughness: 0.5, metalness: 0.3 }, // Goal base plates
    { match: 'Red Loader', color: '#d8343a', roughness: 0.55 },
    { match: 'Blue Loader', color: '#2f6fde', roughness: 0.55 },
    { match: '276-9250-03[2-6]', color: '#eef4f8', opacity: 0.3, roughness: 0.05 }, // Loader chutes
    { match: '^276-7596-000', color: '#c9cdd2', roughness: 0.35, metalness: 0.8 }, // perimeter extrusions
    { match: '', color: '#2a2d31', roughness: 0.7 }, // everything else: black plastic
  ],
  sources: [
    'VEX V5RC Override Game Manual v2.0 (2026-09-03), Appendix A drawings A5-A16, rules SC1-SC8, SG1-SG13, RSC1-RSC4',
    'https://content.vexrobotics.com/docs/2026-2027/override/files/override-2.0.pdf',
    'Derivations: docs/override-field-spec.md',
  ],
};

await writeFile(path.join(repoRoot, 'data/fields/override.json'), JSON.stringify(field, null, 1) + '\n');
console.log(`wrote data/fields/override.json: ${goals.length} goals, ${items.length} layout items (+${neutralGoalPins.length} goal pins)`);
