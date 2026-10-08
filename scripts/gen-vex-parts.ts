// Generate data/parts/vex-parts.json: the VEX V5 parts the parts kit offers (and robots are
// drawn from). Dimensions are inches, approximate: from VEX's product listings and the
// published VEX V5 CAD part library (sizes rounded; check against VEX's own CAD before
// relying on them). Lengths are in holes (0.5 in each).
//   node scripts/gen-vex-parts.ts
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './node-toolchain.ts';

type Part = Record<string, unknown> & { id: string; name: string; kind: string; group: string };
const parts: Part[] = [];
const add = (group: string, p: Omit<Part, 'group'>) => parts.push({ group, ...p } as Part);

// ---------------- structure ----------------
const LENGTHS = [5, 10, 15, 20, 25, 30, 35];
for (const [mat, label] of [['', 'aluminum'], ['steel', 'steel']] as const) {
  const sfx = mat ? '-steel' : '';
  const nm = (s: string) => `${s}${mat ? ' (steel)' : ''}`;
  const m = mat ? { material: 'steel' } : {};
  for (const [web, flange] of [[1, 1], [2, 1], [3, 1], [5, 1], [2, 2]]) {
    add(`Structure (${label})`, { id: `c-channel-${flange}x${web}x${flange}${sfx}`, name: nm(`C-channel ${flange}×${web}×${flange}`), kind: 'channel', web, flange, lengths: LENGTHS, length: 25, ...m });
  }
  for (const [web, flange] of [[1, 1], [2, 2], [2, 3], [3, 3], [1, 2]]) {
    add(`Structure (${label})`, { id: `angle-${web}x${flange}${sfx}`, name: nm(`Angle ${web}×${flange}`), kind: 'angle', web, flange, lengths: LENGTHS, length: 25, ...m });
  }
  for (const w of [1, 2, 3, 5, 15]) {
    add(`Structure (${label})`, { id: w === 1 ? `bar${sfx}` : `plate-${w}${sfx}`, name: nm(w === 1 ? 'Flat bar' : `Flat plate ${w} wide`), kind: 'plate', web: w, lengths: w === 15 ? [5, 10, 15, 25] : LENGTHS, length: w === 15 ? 15 : 15, ...m });
  }
}
add('Structure (aluminum)', { id: 'slide-rail', name: 'Linear slide rail', kind: 'channel', web: 1, flange: 1, lengths: [8, 12, 16, 24, 32], length: 24, finish: 'black' });
add('Structure (aluminum)', { id: 'slide-truck', name: 'Linear slide truck', kind: 'box', size: [2, 1.3, 0.6], color: '#2a2d31' });
add('Structure (aluminum)', { id: 'gusset-angle', name: 'Angle gusset (bent 90°)', kind: 'gusset', web: 2, flange: 2, lengths: [3], length: 3 });
add('Structure (aluminum)', { id: 'l-bracket', name: 'L-bracket', kind: 'gusset', web: 1, flange: 2, lengths: [2], length: 2 });
add('Structure (aluminum)', { id: 'gusset-pivot', name: 'Pivot gusset', kind: 'plate', web: 2, lengths: [5], length: 5 });
add('Structure (aluminum)', { id: 'gusset-3way', name: '3-way gusset', kind: 'plate', web: 3, lengths: [5], length: 5 });
add('Structure (aluminum)', { id: 'turntable', name: 'Turntable bearing', kind: 'pulley', diameter: 6.6, width: 0.6, color: '#2a2d31' });
add('Structure (aluminum)', { id: 'bearing-flat', name: 'Bearing flat', kind: 'bearing', web: 1, lengths: [3], length: 3, color: '#2a2d31' });

// ---------------- hardware ----------------
// 8-32 hardware: a #8 screw is 0.164 in across its threads; VEX's star-drive button heads are
// 0.32 in across and 0.09 in tall; keps and nylock nuts are 11/32 (0.344) in across the flats
add('Hardware', { id: 'standoff', name: 'Standoff 8-32', kind: 'standoff', lengths: [1, 2, 3, 4, 5, 6, 8, 12], length: 4 });
add('Hardware', { id: 'standoff-nylon', name: 'Nylon standoff', kind: 'standoff', lengths: [1, 2, 4], length: 2, color: '#e8e4d8' });
add('Hardware', { id: 'standoff-coupler', name: 'Standoff coupler', kind: 'standoff', lengths: [1], length: 1 });
for (const [len, label] of [[0.125, '⅛″'], [0.25, '¼″'], [0.375, '⅜″'], [0.5, '½″']] as const) {
  add('Hardware', { id: `spacer-${len}`, name: `Nylon spacer ${label}`, kind: 'spacer', diameter: 0.38, width: len, color: '#e8e4d8' });
}
for (const [len, label] of [[0.032, '0.032″'], [0.064, '0.064″']] as const) {
  add('Hardware', { id: `spacer-thin-${String(len).replace('0.', '')}`, name: `Thin nylon spacer ${label}`, kind: 'spacer', diameter: 0.5, width: len, color: '#e8e4d8' });
}
add('Hardware', { id: 'spacer-8mm', name: 'Plastic spacer 8 mm', kind: 'spacer', diameter: 0.5, width: 0.315, color: '#3a3d42' });
add('Hardware', { id: 'collar', name: 'Shaft collar (set screw)', kind: 'collar', diameter: 0.5, width: 0.3, color: '#9aa0a6' });
add('Hardware', { id: 'collar-clamp', name: 'Clamping shaft collar', kind: 'collar', diameter: 0.75, width: 0.3, color: '#4b4f56', style: 'clamp' });
add('Hardware', { id: 'collar-rubber', name: 'Rubber shaft collar', kind: 'collar', diameter: 0.45, width: 0.3, color: '#1f2125', style: 'rubber' });
for (const [len, label] of [[0.25, '¼″'], [0.375, '⅜″'], [0.5, '½″'], [0.625, '⅝″'], [0.75, '¾″'], [1, '1″'], [1.25, '1¼″'], [1.5, '1½″'], [2, '2″']] as const) {
  add('Hardware', { id: len === 0.5 ? 'screw' : `screw-${String(len).replace('.', '_')}`, name: `Screw 8-32 × ${label} (star drive)`, kind: 'screw', shank: len, diameter: 0.32, color: '#2a2d31' });
}
add('Hardware', { id: 'nut', name: 'Keps nut 8-32', kind: 'nut', diameter: 0.344, width: 0.14, color: '#9aa0a6', style: 'keps' });
add('Hardware', { id: 'nut-nylock', name: 'Nylock nut 8-32', kind: 'nut', diameter: 0.344, width: 0.19, color: '#9aa0a6', style: 'nylock' });
add('Hardware', { id: 'washer', name: 'Steel washer #8', kind: 'washer', diameter: 0.375, width: 0.032, color: '#b9bec5' });
add('Hardware', { id: 'washer-teflon', name: 'Teflon washer', kind: 'washer', diameter: 0.5, width: 0.04, color: '#f2f2ee' });
add('Hardware', { id: 'rubber-band', name: 'Rubber band #32', kind: 'band', diameter: 1.0 });
add('Hardware', { id: 'rubber-band-64', name: 'Rubber band #64', kind: 'band', diameter: 1.6 });
add('Hardware', { id: 'zip-tie', name: 'Zip tie', kind: 'box', size: [4, 0.15, 0.05], color: '#1f2125' });
add('Hardware', { id: 'pillow-block', name: 'Pillow block bearing', kind: 'bearing', web: 1, lengths: [2], length: 2, color: '#2a2d31', style: 'block' });

// ---------------- motion: shafts, gears, sprockets, pulleys ----------------
add('Shafts & bearings', { id: 'shaft', name: 'Square shaft ⅛″', kind: 'shaft', lengths: [4, 6, 8, 12, 16, 24], length: 8 });
add('Shafts & bearings', { id: 'shaft-hs', name: 'High-strength shaft ¼″', kind: 'shaft', lengths: [4, 6, 8, 12, 16, 24], length: 8, thickness: 0.25 });
add('Shafts & bearings', { id: 'shaft-hex', name: 'Hex shaft (insert)', kind: 'shaft', lengths: [4, 8, 12], length: 8, thickness: 0.25, color: '#b9bec5' });
for (const t of [12, 36, 48, 60, 72, 84]) add('Gears', { id: `gear-${t}`, name: `Gear ${t}T`, kind: 'gear', teeth: t });
for (const t of [12, 36, 60, 84]) add('Gears', { id: `gear-hs-${t}`, name: `High-strength gear ${t}T`, kind: 'gear', teeth: t, width: 0.375, color: '#2a2d31' });
add('Gears', { id: 'crown-gear', name: 'Crown gear 60T', kind: 'gear', teeth: 60, width: 0.4, color: '#4b4f56' });
add('Gears', { id: 'worm', name: 'Worm gear', kind: 'cylinder', diameter: 0.75, length: 1.25, color: '#4b4f56' });
add('Gears', { id: 'rack', name: 'Rack gear', kind: 'rack', lengths: [10, 19], length: 19 });
add('Gears', { id: 'gear-differential', name: 'Differential gear set', kind: 'box', size: [1.6, 2, 2], color: '#4b4f56' });
// #25 chain (¼″ pitch) and high-strength #35 chain (⅜″ pitch)
for (const t of [6, 10, 12, 15, 18, 24, 30, 36, 40, 48]) add('Sprockets & chain', { id: `sprocket-${t}`, name: `Sprocket ${t}T (#25 chain)`, kind: 'sprocket', teeth: t, pitch: 0.25 });
for (const t of [12, 18, 24, 30]) add('Sprockets & chain', { id: `sprocket-hs-${t}`, name: `High-strength sprocket ${t}T (#35)`, kind: 'sprocket', teeth: t, pitch: 0.375, width: 0.2 });
add('Sprockets & chain', { id: 'chain-25', name: 'Chain #25 (¼″ pitch)', kind: 'chain', pitch: 0.25, lengths: [8, 16, 24, 32, 48], length: 24 });
add('Sprockets & chain', { id: 'chain-35', name: 'High-strength chain #35', kind: 'chain', pitch: 0.375, lengths: [8, 16, 24, 32, 48], length: 24 });
// pulleys and string: what cascades and continuous lifts run on
for (const [d, label] of [[0.75, '¾″'], [1, '1″'], [1.375, '1⅜″'], [2, '2″']] as const) {
  add('Pulleys & string', { id: `pulley-${String(d).replace('.', '_')}`, name: `Pulley ${label}`, kind: 'pulley', diameter: d, width: 0.4 });
}
add('Pulleys & string', { id: 'spool', name: 'Winch spool 1⅜″', kind: 'pulley', diameter: 1.375, width: 1.0, style: 'spool' });
add('Pulleys & string', { id: 'string', name: 'Braided string', kind: 'rope', lengths: [8, 16, 24, 48, 72], length: 24 });
add('Pulleys & string', { id: 'surgical-tubing', name: 'Surgical tubing', kind: 'rope', lengths: [8, 16, 24], length: 16, thickness: 0.25, color: '#d6b98c' });

// ---------------- wheels ----------------
add('Wheels', { id: 'omni-2.75', name: 'Omni wheel 2.75″', kind: 'wheel', diameter: 2.75, width: 1.06, style: 'omni' });
add('Wheels', { id: 'omni-3.25', name: 'Omni wheel 3.25″', kind: 'wheel', diameter: 3.25, width: 1.06, style: 'omni' });
add('Wheels', { id: 'omni-4', name: 'Omni wheel 4″', kind: 'wheel', diameter: 4.125, width: 1.13, style: 'omni' });
add('Wheels', { id: 'traction-2.75', name: 'Traction wheel 2.75″', kind: 'wheel', diameter: 2.75, width: 1.06, style: 'traction' });
add('Wheels', { id: 'traction-3.25', name: 'Traction wheel 3.25″', kind: 'wheel', diameter: 3.25, width: 1.06, style: 'traction' });
add('Wheels', { id: 'traction-4', name: 'Traction wheel 4″', kind: 'wheel', diameter: 4.0, width: 1.13, style: 'traction' });
add('Wheels', { id: 'antistatic-3.25', name: 'Anti-static wheel 3.25″', kind: 'wheel', diameter: 3.25, width: 1.06, style: 'traction', color: '#4b4f56' });
add('Wheels', { id: 'mecanum-4', name: 'Mecanum wheel 4″', kind: 'wheel', diameter: 4.0, width: 1.5, style: 'mecanum' });
for (const d of [1.625, 2, 2.5, 3, 4, 5]) {
  add('Wheels', { id: `flex-${String(d).replace('.', '_')}`, name: `Flex wheel ${d}″`, kind: 'wheel', diameter: d, width: 0.6, style: 'flex' });
}

// ---------------- motors and electronics ----------------
add('Motors & electronics', { id: 'v5-motor', name: 'V5 Smart Motor (11 W)', kind: 'motor', size: [2.5, 2.25, 1.25], cartridges: ['red', 'green', 'blue'], cartridge: 'green' });
add('Motors & electronics', { id: 'exp-motor', name: 'V5 Smart Motor (5.5 W)', kind: 'motor', size: [1.9, 1.75, 1.0], cartridges: ['red', 'green', 'blue'], cartridge: 'green' });
add('Motors & electronics', { id: 'v5-brain', name: 'V5 Robot Brain', kind: 'box', size: [5.5, 4.2, 1.3], color: '#1f2125', accent: '#3a6fd8' });
add('Motors & electronics', { id: 'v5-battery', name: 'V5 Robot Battery', kind: 'box', size: [4.9, 2.5, 1.6], color: '#1f2125', accent: '#d8343a' });
add('Motors & electronics', { id: 'v5-radio', name: 'V5 Robot Radio', kind: 'box', size: [2.4, 1.25, 0.6], color: '#1f2125', accent: '#3fb950' });
add('Motors & electronics', { id: 'imu', name: 'V5 Inertial Sensor', kind: 'box', size: [1.25, 1.25, 0.6], color: '#1f2125', accent: '#d8343a' });
add('Motors & electronics', { id: 'rotation-sensor', name: 'V5 Rotation Sensor', kind: 'box', size: [1.6, 1.6, 0.7], color: '#1f2125', accent: '#d8343a' });
add('Motors & electronics', { id: 'distance-sensor', name: 'V5 Distance Sensor', kind: 'box', size: [1.6, 1.2, 0.7], color: '#1f2125', accent: '#8a94a6' });
add('Motors & electronics', { id: 'optical-sensor', name: 'V5 Optical Sensor', kind: 'box', size: [1.25, 1.25, 0.7], color: '#1f2125', accent: '#e8e4d8' });
add('Motors & electronics', { id: 'vision-sensor', name: 'V5 Vision Sensor', kind: 'box', size: [2.6, 1.8, 1.0], color: '#1f2125', accent: '#8a94a6' });
add('Motors & electronics', { id: 'ai-vision', name: 'AI Vision Sensor', kind: 'box', size: [2.4, 1.6, 1.1], color: '#1f2125', accent: '#a371f7' });
add('Motors & electronics', { id: 'gps-sensor', name: 'V5 GPS Sensor', kind: 'box', size: [2.3, 1.9, 1.2], color: '#1f2125', accent: '#8a94a6' });
add('Motors & electronics', { id: 'bumper-switch', name: 'Bumper switch v2', kind: 'box', size: [1.0, 0.8, 0.9], color: '#d8343a' });
add('Motors & electronics', { id: 'limit-switch', name: 'Limit switch', kind: 'box', size: [1.0, 0.5, 0.75], color: '#d8343a' });
add('Motors & electronics', { id: 'potentiometer', name: 'Potentiometer v2', kind: 'box', size: [1.0, 1.0, 0.45], color: '#d8343a' });
add('Motors & electronics', { id: 'adi-expander', name: '3-wire expander', kind: 'box', size: [2.5, 1.3, 0.6], color: '#1f2125', accent: '#d8343a' });
add('Motors & electronics', { id: 'controller', name: 'V5 Controller', kind: 'box', size: [7, 4, 1.5], color: '#1f2125', accent: '#3a6fd8' });

// ---------------- pneumatics ----------------
add('Pneumatics', { id: 'air-tank', name: 'Air tank (200 mL)', kind: 'cylinder', diameter: 1.6, length: 4.6, color: '#d8dde3' });
add('Pneumatics', { id: 'piston', name: 'Pneumatic cylinder (50 mm)', kind: 'cylinder', diameter: 0.75, length: 3.5, color: '#c9cdd2' });
add('Pneumatics', { id: 'piston-25', name: 'Pneumatic cylinder (25 mm)', kind: 'cylinder', diameter: 0.75, length: 2.5, color: '#c9cdd2' });
add('Pneumatics', { id: 'piston-75', name: 'Pneumatic cylinder (75 mm)', kind: 'cylinder', diameter: 0.75, length: 4.5, color: '#c9cdd2' });
add('Pneumatics', { id: 'solenoid', name: 'Solenoid valve', kind: 'box', size: [1.6, 0.8, 0.9], color: '#1f2125', accent: '#2f81f7' });
add('Pneumatics', { id: 'pneumatic-manifold', name: 'Manifold', kind: 'box', size: [1.8, 0.6, 0.6], color: '#9aa0a6' });
add('Pneumatics', { id: 'regulator', name: 'Pressure regulator', kind: 'cylinder', diameter: 0.9, length: 1.4, color: '#c9cdd2' });
add('Pneumatics', { id: 'tubing', name: 'Pneumatic tubing', kind: 'rope', lengths: [8, 16, 24], length: 16, thickness: 0.16, color: '#2f81f7' });

// ---------------- game-specific / misc ----------------
add('Other', { id: 'license-plate', name: 'License plate', kind: 'box', size: [8, 0.08, 1.6], color: '#d8343a' });
add('Other', { id: 'polycarbonate', name: 'Polycarbonate sheet', kind: 'plate', web: 10, lengths: [10, 20, 30], length: 20, color: '#dfe8f0' });

const ids = new Set<string>();
for (const p of parts) {
  if (ids.has(p.id)) throw new Error(`duplicate part id ${p.id}`);
  ids.add(p.id);
}
const out = {
  schema: 1,
  note: "VEX V5 parts for the parts kit (and the robots drawn from their profiles). Inches; approximate dimensions from VEX's product listings and V5 CAD part library, rounded: check against VEX's own CAD before relying on them. Holes are on a 0.5 in grid; lengths are in holes (0.5 in each), chain lengths in links. Each part's box is its outer size before rotation: x along its length, y across, z up. Generated by scripts/gen-vex-parts.ts.",
  pitch: 0.5,
  parts,
};
await writeFile(path.join(repoRoot, 'data/parts/vex-parts.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${parts.length} parts`);
