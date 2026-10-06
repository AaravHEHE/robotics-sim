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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FieldDef } from '../sim/field.ts';
import { splitStep } from './step-split.ts';
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
/** Throws when the browser can't store it (e.g. storage full, or a private window). */
export const saveFieldAsset = async (fieldId: string, a: FieldAsset) => {
  await idb.put('models', key(fieldId), a);
};
export const clearFieldAsset = (fieldId: string) => safe(idb.del('models', key(fieldId)), undefined);

/**
 * Parts of the CAD that the simulation draws itself because they move (Pins, Cups,
 * Toggles) or aren't part of the field (robots): leaving them in the model would show
 * them twice, frozen in place. Hardware pins (hinge, dowel, ...) stay. The official VEX
 * CAD names parts by part number: 276-9250-80x are the Pins, 276-9250-81x the Cups and
 * 276-9250-120 the Toggles (V5RC Override field, 276-9250-000).
 */
export const MOVING_PART =
  /(^|[^a-z])((?<!(hinge|shoulder|dowel|clevis|cotter|roll|spring|pivot|hitch|lock|detent|ball|guide)[\s_-]?)pins?|cups?|toggles?(?!\s*zones?)|robots?|scoring objects?)(?![a-z])|276-9250-8[01]x|276-9250-120(?!\d)/i;
/** Parts smaller than this (in) are hardware (screws, nuts, standoffs): left out to keep the model light. */
export const HARDWARE_IN = 1;

const ext = (name: string) => name.toLowerCase().split('.').pop() ?? '';
// (.gltf only as a single self-contained file: a separate .bin can't be found)
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
/** Triangle sizes: within 3 mm of the true surface, and 0.8 rad between facets. */
const TESSELLATION = { linearDeflectionType: 'absolute_value', linearDeflection: 3, angularDeflection: 0.8 };

interface ChunkMesh {
  /** The top-level assembly part it belongs to (its index and name). */
  top: number;
  topName: string;
  name: string;
  /** Its triangles by color (CAD often colors faces, not whole parts), each with its own vertices. */
  parts: Array<{ color: [number, number, number] | null; position: Float32Array; index: Uint32Array }>;
}

/**
 * Reads one STEP chunk into triangles in a worker of its own (a fresh reader each time:
 * its memory can't shrink, and the page stays responsive during a multi-minute read).
 */
const WORKER = `
importScripts('${OCCT}occt-import-js.js');
onmessage = async (e) => {
  try {
    const occt = await occtimportjs({ locateFile: (f) => '${OCCT}' + f });
    const res = occt.ReadStepFile(new TextEncoder().encode(e.data.text), e.data.params);
    if (!res.success) throw new Error('This STEP file could not be read.');
    let top = res.root;
    if (top.meshes.length === 0 && top.children.length === 1) top = top.children[0];
    const out = [], transfer = [];
    const walk = (node, i, name) => {
      for (const mi of node.meshes) {
        const m = res.meshes[mi];
        if (!m.index.array.length) continue;
        const pos = m.attributes.position.array;
        const idx = m.index.array;
        // split the triangles by face color (the part's own color where a face has none)
        const byColor = new Map();
        const add = (color, from, to) => {
          const key = color ? color.join() : '';
          let e = byColor.get(key);
          if (!e) byColor.set(key, (e = { color, tris: [] }));
          e.tris.push([from, to]);
        };
        const faces = m.brep_faces || [];
        let covered = 0;
        for (const f of faces) if (f.last >= f.first) { add(f.color || m.color || null, f.first, f.last); covered += f.last - f.first + 1; }
        if (!covered) add(m.color || null, 0, idx.length / 3 - 1);
        const parts = [];
        for (const e of byColor.values()) {
          let n = 0;
          for (const [a, b] of e.tris) n += b - a + 1;
          // only the vertices these triangles use
          const index = new Uint32Array(n * 3);
          const remap = new Map();
          const verts = [];
          let o = 0;
          for (const [a, b] of e.tris) {
            for (let t = a * 3; t < (b + 1) * 3; t++) {
              const v = idx[t];
              let w = remap.get(v);
              if (w === undefined) {
                w = remap.size;
                remap.set(v, w);
                verts.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
              }
              index[o++] = w;
            }
          }
          const position = new Float32Array(verts);
          parts.push({ color: e.color, position, index });
          transfer.push(index.buffer, position.buffer);
        }
        out.push({ top: i, topName: name, name: m.name || '', parts });
      }
      for (const c of node.children) walk(c, i, name);
    };
    top.children.forEach((c, i) => walk(c, i, c.name || ''));
    if (top.meshes.length) walk({ meshes: top.meshes, children: [] }, -1, top.name || '');
    postMessage({ ok: true, meshes: out }, transfer);
  } catch (err) {
    postMessage({ ok: false, message: String(err && err.message || err) });
  }
};`;

function readChunk(text: string): Promise<ChunkMesh[]> {
  const url = URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }));
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  return new Promise((resolve, reject) => {
    w.onmessage = (e: MessageEvent<{ ok: boolean; meshes?: ChunkMesh[]; message?: string }>) => {
      w.terminate();
      if (e.data.ok) resolve(e.data.meshes!);
      else reject(new Error(e.data.message));
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || 'Could not download the STEP reader (occt-import-js). Check the connection, or export the model as GLB.'));
    };
    w.postMessage({ text, params: TESSELLATION });
  });
}

/**
 * A material for a CAD color: clear parts (light, unsaturated colors on polycarbonate) are
 * see-through, and nothing is mirror-like.
 */
function cadMaterial(c: number[]): THREE.MeshStandardMaterial {
  const color = new THREE.Color(c[0], c[1], c[2]);
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
}

async function readStep(data: Uint8Array, progress: (msg: string) => void): Promise<THREE.Group> {
  progress('Splitting the STEP file into parts the reader can hold…');
  await new Promise((r) => setTimeout(r, 30)); // let the message paint
  // a whole field is too big for the reader's memory at once: it goes in chunks
  const chunks = splitStep(new TextDecoder('latin1').decode(data));
  const group = new THREE.Group();
  const tops = new Map<number, THREE.Group>();
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  for (const [i, chunk] of chunks.entries()) {
    progress(`Converting STEP to triangles: part ${i + 1} of ${chunks.length} (a whole field takes a few minutes)…`);
    for (const m of await readChunk(chunk)) {
      let top = tops.get(m.top);
      if (!top) {
        top = new THREE.Group();
        top.name = m.topName;
        tops.set(m.top, top);
        group.add(top);
      }
      for (const part of m.parts) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(part.position, 3));
        geo.setIndex(new THREE.BufferAttribute(part.index, 1));
        const c = part.color ?? [0.7, 0.72, 0.75];
        const k = c.map((v) => v.toFixed(3)).join();
        if (!mats.has(k)) mats.set(k, cadMaterial(c));
        const mesh = new THREE.Mesh(geo, mats.get(k));
        mesh.name = m.name;
        top.add(mesh);
      }
    }
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
export function fitToField(model: THREE.Object3D, field: FieldDef): { unit: string; removed: number; hardware: number } {
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
  root.updateMatrixWorld(true);
  // the floor is the top of the tiles, not the bottom of the model
  root.position.y -= tileTop(root, field);
  applyCadLook(root, field);
  // hardware (screws, nuts) is invisible at field scale but a large share of the triangles
  root.updateMatrixWorld(true);
  const tiny: THREE.Object3D[] = [];
  const extent = new THREE.Vector3();
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && new THREE.Box3().setFromObject(o).getSize(extent).length() < HARDWARE_IN * Math.SQRT2) tiny.push(o);
  });
  for (const o of tiny) o.removeFromParent();
  mergeByMaterial(root);
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = false; // millions of triangles: drawing them again for shadows halves the frame rate
      m.receiveShadow = true;
    }
  });
  return { unit: unit[0], removed, hardware: tiny.length };
}

/**
 * Color the parts by the field's `cadLook` rules (official CAD often has no real colors).
 * Each part is matched by "<top-level assembly part>/<part>".
 */
function applyCadLook(root: THREE.Object3D, field: FieldDef): void {
  const rules = (field.cadLook ?? []).map((rule) => ({ rule, re: new RegExp(rule.match, 'i'), mat: null as THREE.MeshStandardMaterial | null }));
  if (!rules.length) return;
  // the assembly part it is in: its nearest named group
  const topOf = (o: THREE.Object3D) => {
    for (let t = o.parent; t && t !== root; t = t.parent) if (t.name) return t.name;
    return '';
  };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const key = `${topOf(m)}/${m.name}`;
    const hit = rules.find((x) => x.re.test(key));
    if (!hit) return;
    const { color, opacity = 1, roughness = 0.6, metalness = 0 } = hit.rule;
    hit.mat ??= new THREE.MeshStandardMaterial({ color, roughness, metalness, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    m.material = hit.mat;
  });
}

/**
 * Height of the tiles' top surface above the model's bottom: looking straight down at four
 * open spots of the field (between the Goals), the median of the first surface low enough
 * to be the floor (under 3 in). 0 when nothing is found.
 */
function tileTop(root: THREE.Object3D, field: FieldDef): number {
  const r = field.perimeter.inside / 4;
  const ray = new THREE.Raycaster();
  const heights: number[] = [];
  for (const [x, z] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
    ray.set(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(root, true).find((h) => h.point.y < 3);
    if (hit) heights.push(hit.point.y);
  }
  if (!heights.length) return 0;
  heights.sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)];
}

/** One mesh per material within each group: thousands of parts draw in a few calls. */
function mergeByMaterial(root: THREE.Object3D): void {
  const parents = new Set<THREE.Object3D>();
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.parent) parents.add(o.parent);
  });
  for (const parent of parents) {
    const byMat = new Map<THREE.Material, THREE.Mesh[]>();
    for (const c of parent.children) {
      const m = c as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material) || m.children.length) continue;
      byMat.set(m.material, [...(byMat.get(m.material) ?? []), m]);
    }
    for (const [mat, meshes] of byMat) {
      if (meshes.length < 2) continue;
      const geos = meshes.map((m) => {
        m.updateMatrix();
        const g = (m.geometry.index ? m.geometry : m.geometry.toNonIndexed()).clone().applyMatrix4(m.matrix);
        for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
        if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
        return g;
      });
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = meshes[0].name;
      for (const m of meshes) m.removeFromParent();
      parent.add(mesh);
    }
  }
}

/** The fitted model as GLB, to store. */
export async function toGlb(model: THREE.Object3D): Promise<ArrayBuffer> {
  // normals are recomputed when it is loaded: storing them would double the size
  model.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (g?.attributes.normal) g.deleteAttribute('normal');
  });
  return (await new GLTFExporter().parseAsync(model, { binary: true })) as ArrayBuffer;
}

/** A stored asset, ready to show: its turns and lift applied. */
export async function fieldModelFrom(a: FieldAsset): Promise<THREE.Object3D> {
  const scene = (await new GLTFLoader().parseAsync(a.glb.slice(0), '')).scene;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals();
      m.castShadow = false; // millions of triangles: drawing them again for shadows halves the frame rate
      m.receiveShadow = true;
    }
  });
  const holder = new THREE.Group();
  holder.add(scene);
  holder.rotation.y = (a.turns * Math.PI) / 2;
  holder.position.y = a.lift;
  return holder;
}
