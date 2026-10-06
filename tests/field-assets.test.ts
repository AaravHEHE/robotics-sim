// Loading an official field model: format, units, orientation and the parts left out.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { fitToField, MOVING_PART, pickBestEntry, readFieldModel, statusText } from '../src/app/field-assets.ts';
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
    const { model, source } = await readFieldModel('field.zip', zip.slice().buffer, (m) => msgs.push(m));
    expect(source).toBe('mesh');
    let meshes = 0;
    model.traverse((o) => (meshes += (o as THREE.Mesh).isMesh ? 1 : 0));
    expect(meshes).toBe(1);
    expect(msgs[0]).toBe('Unzipping…');
  });

  it('says so when a ZIP has no model in it', async () => {
    const zip = zipSync({ 'readme.txt': strToU8('hi') });
    await expect(readFieldModel('x.zip', zip.slice().buffer, () => {})).rejects.toThrow(/no \.step, \.glb/);
  });

  it('from a ZIP: the best format, and of those the largest file (the whole field, not one element)', () => {
    const f = (name: string, size: number, text = '') => ({ name, data: text ? strToU8(text) : new Uint8Array(size) });
    expect(pickBestEntry([f('a.obj', 9), f('goal.step', 10), f('field.step', 99), f('x.glb', 500)])!.name).toBe('field.step');
    expect(pickBestEntry([f('a.obj', 9), f('x.glb', 5)])!.name).toBe('x.glb');
    // a .gltf whose data is in a separate .bin can't be read: the OBJ is used instead
    expect(pickBestEntry([f('a.obj', 9), f('m.gltf', 0, JSON.stringify({ buffers: [{ uri: 'm.bin' }] }))])!.name).toBe('a.obj');
    expect(pickBestEntry([f('m.gltf', 0, JSON.stringify({ buffers: [{ uri: 'data:application/octet-stream;base64,AA==' }] }))])!.name).toBe('m.gltf');
    expect(pickBestEntry([f('__MACOSX/field.step', 9), f('readme.txt', 9)])).toBeNull();
  });

  it('says what it left out in plain words', () => {
    expect(statusText({ unit: 'mm', removed: 0, hardware: 0 })).toBe('read as mm');
    expect(statusText({ unit: 'mm', removed: 0, hardware: 412 })).toBe('read as mm; left out 412 pieces of hardware');
    expect(statusText({ unit: 'in', removed: 1, hardware: 1 })).toBe('read as in; left out 1 moving part and 1 piece of hardware');
  });

  it('only a converted STEP is recolored: a GLB or OBJ keeps its own colors', async () => {
    const f = await field();
    const make = () => {
      const g = new THREE.Group();
      const red = new THREE.MeshStandardMaterial({ color: 0xff0000 });
      g.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(3658, 3658, 15), red), { name: 'Tiles' }));
      g.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(100, 100, 300), red), { name: 'Post' }));
      return g;
    };
    const colors = (m: THREE.Object3D) => {
      const out = new Set<string>();
      m.traverse((o) => (o as THREE.Mesh).isMesh && out.add(((o as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString()));
      return [...out];
    };
    const glb = make();
    fitToField(glb, f, 'mesh');
    expect(colors(glb)).toEqual(['ff0000']);
    const step = make();
    fitToField(step, f, 'step');
    expect(colors(step)).not.toContain('ff0000');
  });

  it('hardware is judged by the whole part: a small colored face of a big part stays', async () => {
    const f = await field();
    const g = new THREE.Group();
    const big = Object.assign(new THREE.Mesh(new THREE.BoxGeometry(3658, 3658, 15)), { name: 'Tiles' });
    big.userData.part = 1;
    const label = Object.assign(new THREE.Mesh(new THREE.BoxGeometry(5, 5, 1), new THREE.MeshStandardMaterial({ color: 0x00ff00 })), { name: 'Tiles' });
    label.userData.part = 1;
    label.position.set(100, 100, 16);
    const screw = Object.assign(new THREE.Mesh(new THREE.BoxGeometry(4, 4, 10)), { name: 'Screw' });
    screw.userData.part = 2;
    g.add(big, label, screw);
    expect(fitToField(g, f, 'mesh').hardware).toBe(1);
    let meshes = 0;
    g.traverse((o) => (meshes += (o as THREE.Mesh).isMesh ? 1 : 0));
    expect(meshes).toBe(2);
  });
});
