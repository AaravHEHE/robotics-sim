// Loading an official field model: format, units, orientation and the parts left out.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { fitToField, MOVING_PART, readFieldModel } from '../src/app/field-assets.ts';
import type { FieldDef } from '../src/sim/field.ts';
import { repoRoot } from '../scripts/node-toolchain.ts';

const field = async () => JSON.parse(await readFile(path.join(repoRoot, 'data/fields/override.json'), 'utf8')) as FieldDef;
const box = (name: string, w: number, d: number, h: number, at: [number, number, number]) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h));
  m.name = name;
  m.position.set(...at);
  return m;
};

describe('field models', () => {
  it('a Z-up CAD model in millimeters ends up in inches, +y up, centered, its tile tops on the floor', async () => {
    const f = await field();
    const model = new THREE.Group();
    // a 12 ft field 3658 mm across with 300 mm walls, Z up, its corner at the origin
    model.add(box('Field Tiles', 3658, 3658, 15, [1829, 1829, 7.5]));
    model.add(box('Perimeter', 3658, 50, 300, [1829, 0, 150]));
    model.add(box('Pin - Red', 40, 40, 165, [500, 500, 100]));
    const { unit, removed } = fitToField(model, f);
    expect(unit).toBe('mm');
    expect(removed).toBe(1);
    const b = new THREE.Box3().setFromObject(model);
    const size = b.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(3658 / 25.4, 1);
    expect(size.z).toBeCloseTo(3658 / 25.4 + 25 / 25.4, 0); // the wall sticks out by half its thickness
    expect(size.y).toBeCloseTo(300 / 25.4, 1); // the walls are now the height
    expect(b.min.y).toBeCloseTo(-15 / 25.4, 4); // the 15 mm tiles' top is the floor
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(0, 6);
  });

  it('leaves out moving parts by name, not parts whose names merely contain the letters', () => {
    for (const n of ['Pin', 'Red Pin', 'Pin - Blue', 'cups', 'Toggle Assembly', 'V5RC Robot']) expect(MOVING_PART.test(n), n).toBe(true);
    for (const n of ['Spinner', 'Pinion Gear', 'Hinge Pin2x', 'Cupboard', 'Goal Base', 'Loader', 'Tape- Toggle Zones_Diamond Center']) expect(MOVING_PART.test(n), n).toBe(false);
    // the official Override CAD names its parts by number: Pins 276-9250-80x, Cups -81x, Toggles -120
    for (const n of ['276-9250-80x_Red-Blue', '276-9250-81x', '276-9250-120_Red Alliance Side']) expect(MOVING_PART.test(n), n).toBe(true);
    for (const n of ['276-9250-840_Red 2', '276-9250-830_276-9250-831', '276-9250-1201']) expect(MOVING_PART.test(n), n).toBe(false);
  });

  it('reads an OBJ out of a ZIP', async () => {
    const obj = 'o Goal Base\nv 0 0 0\nv 100 0 0\nv 0 100 0\nf 1 2 3\n';
    const zip = zipSync({ 'field/goal.obj': strToU8(obj), 'readme.txt': strToU8('hi') });
    const msgs: string[] = [];
    const model = await readFieldModel('field.zip', zip.slice().buffer, (m) => msgs.push(m));
    let meshes = 0;
    model.traverse((o) => (meshes += (o as THREE.Mesh).isMesh ? 1 : 0));
    expect(meshes).toBe(1);
    expect(msgs[0]).toBe('Unzipping…');
  });

  it('says so when a ZIP has no model in it', async () => {
    const zip = zipSync({ 'readme.txt': strToU8('hi') });
    await expect(readFieldModel('x.zip', zip.slice().buffer, () => {})).rejects.toThrow(/no \.glb/);
  });
});
