// Official field models, loaded by the visitor and kept only in their browser (never
// uploaded or published). A model replaces the look of the built-in field; the simulation
// never sees it. Accepts glTF/GLB, OBJ, STEP (read in the browser by occt-import-js,
// downloaded from a CDN only when a STEP file is loaded) and ZIPs of those, like the
// field CAD package VEX publishes.

import * as THREE from 'three';
import { unzipSync } from 'fflate';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { FieldDef } from '../sim/field.ts';
import { idb, safe } from './storage.ts';

/** What the visitor chose for a field, stored per field id. */
export interface FieldAsset {
  /** File it came from (for display). */
  name: string;
  /** The model, converted to GLB in field inches with +y up (fast to load next time). */
  glb: ArrayBuffer;
  /** Quarter turns about the vertical axis, to put the red side where it belongs. */
  turns: number;
  /** Raise (+) or lower (-) the model (inches), to line its tile tops up with the floor. */
  lift: number;
  /** Hide the built-in floor and perimeter, and/or the built-in Goals and Loaders. */
  hideBase: boolean;
  hideStatics: boolean;
}

const key = (fieldId: string) => `field:${fieldId}`;
export const loadFieldAsset = (fieldId: string) => safe(idb.get<FieldAsset>('models', key(fieldId)), undefined);
export const saveFieldAsset = (fieldId: string, a: FieldAsset) => safe(idb.put('models', key(fieldId), a), undefined);
export const clearFieldAsset = (fieldId: string) => safe(idb.del('models', key(fieldId)), undefined);

/**
 * Parts of the CAD that the simulation draws itself because they move (Pins, Cups,
 * Toggles) or aren't part of the field (robots): leaving them in the model would show
 * them twice, frozen in place. Hardware pins (hinge, dowel, ...) stay.
 */
export const MOVING_PART =
  /(^|[^a-z])((?<!(hinge|shoulder|dowel|clevis|cotter|roll|spring|pivot|hitch|lock|detent|ball|guide)[\s_-]?)pins?|cups?|toggles?|robots?|scoring objects?)(?![a-z])/i;

const ext = (name: string) => name.toLowerCase().split('.').pop() ?? '';
export const FIELD_ASSET_TYPES = '.glb,.gltf,.obj,.step,.stp,.zip';

/** Read a file the visitor picked into a model (any supported format, or a ZIP of them). */
export async function readFieldModel(name: string, data: ArrayBuffer, progress: (msg: string) => void): Promise<THREE.Group> {
  const group = new THREE.Group();
  const files: Array<{ name: string; data: Uint8Array }> = [];
  if (ext(name) === 'zip') {
    progress('Unzipping…');
    const all = unzipSync(new Uint8Array(data));
    for (const [n, d] of Object.entries(all)) if (['glb', 'gltf', 'obj', 'step', 'stp'].includes(ext(n)) && !n.startsWith('__MACOSX')) files.push({ name: n, data: d });
    // one format is enough: prefer a ready-made GLB, then STEP, then OBJ
    const best = ['glb', 'gltf', 'step', 'stp', 'obj'].find((e) => files.some((f) => ext(f.name) === e));
    const pick = files.filter((f) => ext(f.name) === best || (best === 'step' && ext(f.name) === 'stp'));
    files.splice(0, files.length, ...pick);
    if (!files.length) throw new Error('The ZIP has no .glb, .gltf, .step or .obj file in it.');
  } else files.push({ name, data: new Uint8Array(data) });

  for (const f of files) {
    progress(`Reading ${f.name}…`);
    const e = ext(f.name);
    if (e === 'glb' || e === 'gltf') group.add((await new GLTFLoader().parseAsync(f.data.slice().buffer, '')).scene);
    else if (e === 'obj') group.add(new OBJLoader().parse(new TextDecoder().decode(f.data)));
    else group.add(await readStep(f.data, progress));
  }
  return group;
}

// ---------------- STEP ----------------

const OCCT = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/';
interface OcctMesh {
  name?: string;
  color?: [number, number, number];
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index: { array: number[] };
}
interface Occt {
  ReadStepFile(data: Uint8Array, params: null): { success: boolean; meshes: OcctMesh[] };
}
let occt: Promise<Occt> | null = null;

function loadOcct(): Promise<Occt> {
  occt ??= new Promise<Occt>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = OCCT + 'occt-import-js.js';
    s.onload = () => {
      const init = (window as unknown as { occtimportjs?: (o: object) => Promise<Occt> }).occtimportjs;
      if (!init) return reject(new Error('The STEP reader did not load.'));
      init({ locateFile: (f: string) => OCCT + f }).then(resolve, reject);
    };
    s.onerror = () => reject(new Error('Could not download the STEP reader (occt-import-js). Check the connection, or export the model as GLB.'));
    document.head.appendChild(s);
  }).catch((e) => {
    occt = null;
    throw e;
  });
  return occt;
}

async function readStep(data: Uint8Array, progress: (msg: string) => void): Promise<THREE.Group> {
  progress('Loading the STEP reader (about 7 MB, first time only)…');
  const reader = await loadOcct();
  progress('Converting STEP to triangles (this can take a while for a whole field)…');
  await new Promise((r) => setTimeout(r, 30)); // let the message paint
  const res = reader.ReadStepFile(data, null);
  if (!res.success) throw new Error('This STEP file could not be read.');
  const group = new THREE.Group();
  const mats = new Map<string, THREE.Material>();
  for (const m of res.meshes) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
    if (m.attributes.normal) geo.setAttribute('normal', new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
    else geo.computeVertexNormals();
    geo.setIndex(m.index.array);
    const c = m.color ?? [0.7, 0.72, 0.75];
    const k = c.map((v) => v.toFixed(3)).join();
    if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color: new THREE.Color(c[0], c[1], c[2]), roughness: 0.6, metalness: 0.1 }));
    const mesh = new THREE.Mesh(geo, mats.get(k));
    mesh.name = m.name ?? '';
    group.add(mesh);
  }
  return group;
}

// ---------------- fitting it to the field ----------------

/** Unit factors to inches: mm, cm, m, in, ft. */
const UNITS: Array<[string, number]> = [['mm', 1 / 25.4], ['cm', 1 / 2.54], ['m', 39.3701], ['in', 1], ['ft', 12]];

/**
 * Put a raw model into field inches with +y up: CAD is usually Z-up and in millimeters.
 * The flattest axis is taken as up, and the unit is the one that makes the model about the
 * size of the field (perimeter included). Removes the moving parts (see MOVING_PART).
 * Returns what it did, for the dialog.
 */
export function fitToField(model: THREE.Object3D, field: FieldDef): { unit: string; removed: number } {
  let removed = 0;
  const drop: THREE.Object3D[] = [];
  model.traverse((o) => {
    if (o !== model && MOVING_PART.test(o.name)) drop.push(o);
  });
  for (const o of drop) {
    if (!o.parent) continue;
    o.removeFromParent();
    removed++;
  }
  const root = new THREE.Group();
  while (model.children.length) root.add(model.children[0]);
  model.add(root);
  let size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  if (size.z < size.y && size.z < size.x) root.rotation.x = -Math.PI / 2; // Z-up -> Y-up
  else if (size.x < size.y && size.x < size.z) root.rotation.z = Math.PI / 2;
  root.updateMatrixWorld(true);
  size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const want = field.perimeter.inside + 2 * field.perimeter.wallThickness;
  const across = Math.max(size.x, size.z, 1e-9);
  let unit = UNITS[0];
  for (const u of UNITS) if (Math.abs(Math.log((across * u[1]) / want)) < Math.abs(Math.log((across * unit[1]) / want))) unit = u;
  root.scale.setScalar(unit[1]);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  root.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return { unit: unit[0], removed };
}

/** The fitted model as GLB, to store. */
export async function toGlb(model: THREE.Object3D): Promise<ArrayBuffer> {
  return (await new GLTFExporter().parseAsync(model, { binary: true })) as ArrayBuffer;
}

/** A stored asset, ready to show: its turns and lift applied. */
export async function fieldModelFrom(a: FieldAsset): Promise<THREE.Object3D> {
  const scene = (await new GLTFLoader().parseAsync(a.glb.slice(0), '')).scene;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  const holder = new THREE.Group();
  holder.add(scene);
  holder.rotation.y = (a.turns * Math.PI) / 2;
  holder.position.y = a.lift;
  return holder;
}
