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
import { idb, safe } from './storage.ts';

/** A converted field model as stored: GLB in field inches with +y up (fast to load next time). */
export interface FieldModel {
  /** File it came from (for display). */
  name: string;
  glb: ArrayBuffer;
}

/** How the visitor placed the model; stored apart from the (large) model, so changing it is instant. */
export interface FieldModelSettings {
  /** Quarter turns about the vertical axis, to put the red side where it belongs. */
  turns: number;
  /** Raise (+) or lower (-) the model (inches), to line its tile tops up with the floor. */
  lift: number;
  /** Hide the built-in floor and perimeter, and/or the built-in Goals and Loaders. */
  hideBase: boolean;
  hideStatics: boolean;
}

export const DEFAULT_FIELD_SETTINGS: FieldModelSettings = { turns: 0, lift: 0, hideBase: true, hideStatics: true };

const modelKey = (fieldId: string) => `field:${fieldId}`;
const settingsKey = (fieldId: string) => `fieldModel:${fieldId}`;

export const loadFieldModel = async (fieldId: string): Promise<FieldModel | undefined> => {
  const r = await safe(idb.get<FieldModel>('models', modelKey(fieldId)), undefined);
  return r?.glb ? { name: r.name, glb: r.glb } : undefined;
};
/** Throws when the browser can't store it (e.g. storage full, or a private window). */
export const saveFieldModel = async (fieldId: string, m: FieldModel): Promise<void> => {
  await idb.put('models', modelKey(fieldId), m);
};
export const loadFieldSettings = async (fieldId: string): Promise<FieldModelSettings> => {
  const s = await safe(idb.get<FieldModelSettings>('settings', settingsKey(fieldId)), undefined);
  // (models saved before settings were kept apart carry them in the model record)
  const old = s ? undefined : await safe(idb.get<Partial<FieldModelSettings>>('models', modelKey(fieldId)), undefined);
  const src = s ?? old ?? {};
  return {
    turns: Number.isInteger(src.turns) ? src.turns! : 0,
    lift: Number.isFinite(src.lift) ? src.lift! : 0,
    hideBase: src.hideBase ?? true,
    hideStatics: src.hideStatics ?? true,
  };
};
export const saveFieldSettings = (fieldId: string, s: FieldModelSettings) => safe(idb.put('settings', settingsKey(fieldId), s), undefined);
export const clearFieldModel = async (fieldId: string): Promise<void> => {
  await safe(idb.del('models', modelKey(fieldId)), undefined);
  await safe(idb.del('settings', settingsKey(fieldId)), undefined);
};

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
export const FIELD_ASSET_TYPES = '.glb,.gltf,.obj,.step,.stp,.zip';

/** Where a model came from: STEP is converted here (and colored by the field's rules); others keep their look. */
export type ModelSource = 'step' | 'mesh';

const cancelled = () => new DOMException('Cancelled', 'AbortError');

/**
 * The one model file of a ZIP to read: the best format there (STEP, then GLB, then a glTF
 * with its data inside it, then OBJ), and of those the largest (the whole field, not a
 * single element). Null when there is none.
 */
export function pickBestEntry(files: Array<{ name: string; data: Uint8Array }>): { name: string; data: Uint8Array } | null {
  const rank = (f: { name: string; data: Uint8Array }): number => {
    const e = ext(f.name);
    if (e === 'step' || e === 'stp') return 4;
    if (e === 'glb') return 3;
    if (e === 'gltf') return selfContainedGltf(f.data) ? 2 : 0;
    if (e === 'obj') return 1;
    return 0;
  };
  let best: { name: string; data: Uint8Array } | null = null;
  for (const f of files) {
    if (f.name.startsWith('__MACOSX') || !rank(f)) continue;
    if (!best || rank(f) > rank(best) || (rank(f) === rank(best) && f.data.length > best.data.length)) best = f;
  }
  return best;
}

/** A .gltf whose buffers and images are all inside it (no separate .bin or textures to find). */
function selfContainedGltf(data: Uint8Array): boolean {
  try {
    const j = JSON.parse(new TextDecoder().decode(data)) as { buffers?: Array<{ uri?: string }>; images?: Array<{ uri?: string }> };
    return [...(j.buffers ?? []), ...(j.images ?? [])].every((b) => !b.uri || b.uri.startsWith('data:'));
  } catch {
    return false;
  }
}

/** Read a file the visitor picked into a model (any supported format, or a ZIP of them). */
export async function readFieldModel(
  name: string,
  data: ArrayBuffer,
  progress: (msg: string) => void,
  signal?: AbortSignal,
): Promise<{ model: THREE.Group; source: ModelSource }> {
  let file: { name: string; data: Uint8Array } = { name, data: new Uint8Array(data) };
  if (ext(name) === 'zip') {
    progress('Unzipping…');
    const all = unzipSync(new Uint8Array(data));
    const best = pickBestEntry(Object.entries(all).map(([n, d]) => ({ name: n, data: d })));
    if (!best) throw new Error('The ZIP has no .step, .glb, self-contained .gltf or .obj file in it.');
    file = best;
  }
  if (signal?.aborted) throw cancelled();
  progress(`Reading ${file.name}…`);
  const e = ext(file.name);
  const model = new THREE.Group();
  if (e === 'glb' || e === 'gltf') model.add((await new GLTFLoader().parseAsync(file.data.slice().buffer, '')).scene);
  else if (e === 'obj') model.add(new OBJLoader().parse(new TextDecoder().decode(file.data)));
  else if (e === 'step' || e === 'stp') {
    model.add(await readStep(file.data, progress, signal));
    return { model, source: 'step' };
  } else throw new Error(`Can't read .${e} files: use .zip, .step, .glb, .gltf or .obj.`);
  return { model, source: 'mesh' };
}

// ---------------- STEP ----------------

const OCCT = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/';
const NO_READER = 'Could not download the STEP reader (occt-import-js from cdn.jsdelivr.net). Check the connection, or export the model as GLB.';
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
try { importScripts('${OCCT}occt-import-js.js'); } catch (err) { postMessage({ ok: false, noReader: true, message: String(err && err.message || err) }); }
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

/** Run a worker for one request: resolves with its reply, rejects on an error or when cancelled. */
function runWorker<T>(w: Worker, request: unknown, transfer: Transferable[], signal: AbortSignal | undefined, onSettle: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const done = (fn: () => void) => {
      w.terminate();
      signal?.removeEventListener('abort', abort);
      onSettle();
      fn();
    };
    const abort = () => done(() => reject(cancelled()));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort);
    w.onmessage = (e: MessageEvent<{ ok: boolean; noReader?: boolean; message?: string } & T>) => {
      if (e.data.ok) done(() => resolve(e.data));
      else done(() => reject(new Error(e.data.noReader ? `${NO_READER} (${e.data.message})` : e.data.message)));
    };
    w.onerror = (e) => {
      e.preventDefault();
      done(() => reject(new Error(e.message ? `${NO_READER} (${e.message})` : NO_READER)));
    };
    w.postMessage(request, transfer);
  });
}

function readChunk(text: string, signal?: AbortSignal): Promise<ChunkMesh[]> {
  const url = URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }));
  // (the URL is revoked once the worker is done with it: some browsers still need it while it starts)
  return runWorker<{ meshes: ChunkMesh[] }>(new Worker(url), { text, params: TESSELLATION }, [], signal, () => URL.revokeObjectURL(url)).then((r) => r.meshes);
}

/** Split the STEP into chunks the reader can hold, in a worker (parsing 100+ MB of text takes seconds). */
function splitInWorker(data: Uint8Array, signal?: AbortSignal): Promise<string[]> {
  const w = new Worker(new URL('./step-split.worker.ts', import.meta.url), { type: 'module' });
  const copy = data.slice();
  return runWorker<{ chunks: string[] }>(w, { data: copy }, [copy.buffer], signal, () => {}).then((r) => r.chunks);
}

function cadMaterial(c: number[]): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(c[0], c[1], c[2]), roughness: 0.55, metalness: 0.05 });
}

async function readStep(data: Uint8Array, progress: (msg: string) => void, signal?: AbortSignal): Promise<THREE.Group> {
  progress('Splitting the STEP file into parts the reader can hold…');
  // a whole field is too big for the reader's memory at once: it goes in chunks
  const chunks = await splitInWorker(data, signal);
  const group = new THREE.Group();
  const tops = new Map<number, THREE.Group>();
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  let part = 0;
  for (const [i, chunk] of chunks.entries()) {
    progress(`Converting STEP to triangles: part ${i + 1} of ${chunks.length} (a whole field takes a few minutes)…`);
    for (const m of await readChunk(chunk, signal)) {
      let top = tops.get(m.top);
      if (!top) {
        top = new THREE.Group();
        top.name = m.topName;
        tops.set(m.top, top);
        group.add(top);
      }
      part++;
      for (const p of m.parts) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
        geo.setIndex(new THREE.BufferAttribute(p.index, 1));
        const c = p.color ?? [0.7, 0.72, 0.75];
        const k = c.map((v) => v.toFixed(3)).join();
        if (!mats.has(k)) mats.set(k, cadMaterial(c));
        const mesh = new THREE.Mesh(geo, mats.get(k));
        mesh.name = m.name;
        // the color pieces of one part stay one part (for the hardware size check)
        mesh.userData.part = part;
        top.add(mesh);
      }
    }
  }
  return group;
}

// ---------------- fitting it to the field ----------------

/** Unit factors to inches: mm, cm, m, in, ft. */
const UNITS: Array<[string, number]> = [['mm', 1 / 25.4], ['cm', 1 / 2.54], ['m', 39.3701], ['in', 1], ['ft', 12]];

export interface FitReport {
  unit: string;
  /** Moving parts left out (Pins, Cups, Toggles, robots). */
  removed: number;
  /** Small hardware left out. */
  hardware: number;
}

/**
 * Put a raw model into field inches with +y up: CAD is usually Z-up and in millimeters.
 * The flattest axis is taken as up, and the unit is the one that makes the model about the
 * size of the field (perimeter included). Removes the moving parts (see MOVING_PART) and
 * hardware. A converted STEP is colored by the field's `cadLook` rules; other models keep
 * their own look. Returns what it did, for the dialog.
 */
export function fitToField(model: THREE.Object3D, field: FieldDef, source: ModelSource = 'mesh'): FitReport {
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
  if (source === 'step') applyCadLook(root, field);
  root.updateMatrixWorld(true);
  const hardware = dropHardware(root);
  mergeByMaterial(root);
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = false; // millions of triangles: drawing them again for shadows halves the frame rate
      m.receiveShadow = true;
    }
  });
  return { unit: unit[0], removed, hardware };
}

/**
 * Leave out hardware (screws, nuts): invisible at field scale but a large share of the
 * triangles. A part's size is that of all its pieces (a big part with a small colored
 * face keeps the face). Returns how many parts were left out.
 */
function dropHardware(root: THREE.Object3D): number {
  const parts = new Map<unknown, { box: THREE.Box3; meshes: THREE.Object3D[] }>();
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const key = o.userData.part ?? o;
    let p = parts.get(key);
    if (!p) parts.set(key, (p = { box: new THREE.Box3(), meshes: [] }));
    p.box.union(new THREE.Box3().setFromObject(o));
    p.meshes.push(o);
  });
  const extent = new THREE.Vector3();
  let n = 0;
  for (const p of parts.values()) {
    if (p.box.getSize(extent).length() >= HARDWARE_IN * Math.SQRT2) continue;
    for (const m of p.meshes) m.removeFromParent();
    n++;
  }
  return n;
}

/** What a fit did, in words: "read as mm; left out 123 moving parts and 776 pieces of hardware". */
export function statusText(r: FitReport): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const left = [
    r.removed ? plural(r.removed, 'moving part', 'moving parts') : '',
    r.hardware ? plural(r.hardware, 'piece of hardware', 'pieces of hardware') : '',
  ].filter(Boolean);
  return `read as ${r.unit}${left.length ? `; left out ${left.join(' and ')}` : ''}`;
}

/**
 * Color the parts by the field's `cadLook` rules (official CAD often has no real colors).
 * Each part is matched by "<assembly part>/<part>".
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

/**
 * One mesh per material within each group: thousands of parts draw in a few calls. Meshes
 * merge only with meshes that have the same attributes (UVs, vertex colors), which they
 * keep; normals are recomputed later.
 */
function mergeByMaterial(root: THREE.Object3D): void {
  const parents = new Set<THREE.Object3D>();
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.parent) parents.add(o.parent);
  });
  const attrs = (g: THREE.BufferGeometry) => Object.keys(g.attributes).filter((a) => a !== 'normal').sort().join();
  for (const parent of parents) {
    const groups = new Map<string, { mat: THREE.Material; meshes: THREE.Mesh[] }>();
    for (const c of parent.children) {
      const m = c as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material) || m.children.length || m.geometry.morphAttributes.position) continue;
      const key = `${m.material.uuid}|${attrs(m.geometry)}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { mat: m.material, meshes: [] }));
      g.meshes.push(m);
    }
    for (const { mat, meshes } of groups.values()) {
      if (meshes.length < 2) continue;
      const geos = meshes.map((m) => {
        m.updateMatrix();
        const g = (m.geometry.index ? m.geometry : m.geometry.toNonIndexed()).clone().applyMatrix4(m.matrix);
        if (g.attributes.normal) g.deleteAttribute('normal');
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

/** A stored model, ready to show (place it with applyFieldSettings). */
export async function fieldModelFrom(glb: ArrayBuffer): Promise<THREE.Object3D> {
  const scene = (await new GLTFLoader().parseAsync(glb.slice(0), '')).scene;
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
  return holder;
}

/** Turn and raise a shown model (instant: the model itself isn't touched). */
export function applyFieldSettings(holder: THREE.Object3D, s: FieldModelSettings): void {
  holder.rotation.y = (s.turns * Math.PI) / 2;
  holder.position.y = s.lift;
  holder.updateMatrixWorld(true);
}
