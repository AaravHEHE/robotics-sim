// Browser storage (IndexedDB) for the current project, custom robots and their GLB
// models, auton plans, plus file import/export. Everything stays on the visitor's machine.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { RobotProfile } from '../sim/profile.ts';
import type { MapPlan } from './mapping.ts';

const DB_NAME = 'vexsim';
// 2: plans (auton mapping)
const DB_VERSION = 2;
type Store = 'projects' | 'robots' | 'models' | 'settings' | 'plans';

let dbP: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbP ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const s of ['projects', 'robots', 'models', 'settings', 'plans']) {
        if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      }
    };
    req.onsuccess = () => {
      // another tab opening a newer version: let it upgrade (this tab reopens on next use)
      req.result.onversionchange = () => {
        req.result.close();
        dbP = null;
      };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return dbP;
}

async function tx<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onerror = () => reject(r.error);
    if (mode === 'readonly') r.onsuccess = () => resolve(r.result);
    else {
      // a write is only done once its transaction commits (e.g. storage full aborts it)
      t.oncomplete = () => resolve(r.result);
      t.onabort = () => reject(t.error ?? new Error('The browser did not save it.'));
    }
  });
}

export const idb = {
  get: <T>(store: Store, key: string) => tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>),
  put: (store: Store, key: string, value: unknown) => tx(store, 'readwrite', (s) => s.put(value, key)),
  del: (store: Store, key: string) => tx(store, 'readwrite', (s) => s.delete(key)),
  keys: (store: Store) => tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()),
};

/** Storage may be unavailable (private windows, blocked site data); never let that break the app. */
export async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

// ---------------- projects ----------------

export type ProjectFileMap = Record<string, string>;
export interface SavedProject {
  name: string;
  files: ProjectFileMap;
  /** Binary files (static/ assets) as base64. */
  binary?: Record<string, string>;
  robotId: string;
}

/**
 * Each browser tab keeps its own project (two open tabs must not overwrite each other's
 * code); a new tab starts from the project saved last in any tab.
 */
const tabKey = (() => {
  try {
    let id = sessionStorage.getItem('vexsim-tab');
    if (!id) sessionStorage.setItem('vexsim-tab', (id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)));
    return 'tab:' + id;
  } catch {
    return 'current';
  }
})();

export const saveProject = async (p: SavedProject) => {
  await safe(idb.put('projects', tabKey, p), undefined);
  await safe(idb.put('projects', 'current', p), undefined);
};
export const loadProject = async () =>
  (await safe(idb.get<SavedProject>('projects', tabKey), undefined)) ?? (await safe(idb.get<SavedProject>('projects', 'current'), undefined));

const TEXT_EXT = /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|inc|ipp|txt|md|json|pros|mk|csv)$|Makefile$/i;

/** Read a PROS project from a zip (as exported by VS Code / the PROS CLI folder). */
export function projectFromZip(data: Uint8Array): { files: ProjectFileMap; binary: Record<string, Uint8Array> } {
  const entries = unzipSync(data);
  const files: ProjectFileMap = {};
  const binary: Record<string, Uint8Array> = {};
  for (const [p, bytes] of Object.entries(entries)) {
    if (p.endsWith('/') || /(^|\/)(__MACOSX|\.git|bin|firmware|\.d)\//.test(p)) continue;
    if (TEXT_EXT.test(p)) files[p] = strFromU8(bytes);
    else binary[p] = bytes;
  }
  return { files, binary };
}

export function projectToZip(files: ProjectFileMap, binary: Record<string, Uint8Array> = {}): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [p, t] of Object.entries(files)) entries[p] = strToU8(t);
  for (const [p, b] of Object.entries(binary)) entries[p] = b;
  return zipSync(entries, { level: 6 });
}

// ---------------- robots and models ----------------

export const listCustomRobots = async (): Promise<RobotProfile[]> => {
  const keys = await safe(idb.keys('robots'), []);
  const out: RobotProfile[] = [];
  for (const k of keys) {
    const r = await safe(idb.get<RobotProfile>('robots', String(k)), undefined);
    if (r) out.push(r);
  }
  return out;
};
export const saveCustomRobot = (r: RobotProfile) => safe(idb.put('robots', r.id, r), undefined);
export const deleteCustomRobot = (id: string) => safe(idb.del('robots', id), undefined);
export const saveModel = (id: string, glb: ArrayBuffer) => safe(idb.put('models', id, glb), undefined);
export const loadModel = (id: string) => safe(idb.get<ArrayBuffer>('models', id), undefined);

/** Export a robot as a .zip containing robot.json and, if present, model.glb. */
export async function robotToZip(r: RobotProfile): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = { 'robot.json': strToU8(JSON.stringify(r, null, 2)) };
  if (r.model) {
    const glb = await loadModel(r.model.assetId);
    if (glb) entries['model.glb'] = new Uint8Array(glb);
  }
  return zipSync(entries);
}

export function robotFromZip(data: Uint8Array): { profile: unknown; glb?: Uint8Array } {
  const e = unzipSync(data);
  const json = Object.entries(e).find(([p]) => p.endsWith('.json'));
  if (!json) throw new Error('The zip has no robot .json file.');
  const glb = Object.entries(e).find(([p]) => /\.glb$/i.test(p))?.[1];
  return { profile: JSON.parse(strFromU8(json[1])), glb };
}

// ---------------- downloads ----------------

export function download(name: string, data: Uint8Array | string, type = 'application/octet-stream'): void {
  const blob = new Blob([typeof data === 'string' ? data : (data as Uint8Array<ArrayBuffer>)], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export const toBase64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ---------------- auton mapping plans ----------------


export interface SavedPlan extends MapPlan {
  /** Storage key. */
  id: string;
}
export const listPlans = async (): Promise<SavedPlan[]> => {
  const keys = (await safe(idb.keys('plans'), [])) as string[];
  const plans = await Promise.all(keys.map((k) => safe(idb.get<SavedPlan>('plans', k), undefined)));
  return plans.filter((x): x is SavedPlan => !!x).sort((a, b) => a.name.localeCompare(b.name));
};
/** Throws when the browser can't store it. */
export const savePlan = async (p: SavedPlan): Promise<void> => {
  await idb.put('plans', p.id, p);
};
export const deletePlan = (id: string) => safe(idb.del('plans', id), undefined);
