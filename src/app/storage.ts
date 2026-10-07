// Browser storage (IndexedDB) for the current project, custom robots and their GLB
// models, auton plans, plus file import/export. Everything stays on the visitor's machine.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { RobotProfile } from '../sim/profile.ts';
import type { MapPlan } from './mapping.ts';
import type { Assembly } from './parts/assembly.ts';

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
/** A tab renews its claim on its id this often, and a claim older than LEASE_MS has lapsed (ms). */
const LEASE_RENEW_MS = 2000;
const LEASE_MS = 6000;
const newTabId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/**
 * The tab's own key, and the key of the tab it was duplicated from (if any). "Duplicate tab"
 * copies sessionStorage, so a copy would share its original's id: a tab therefore holds a lease
 * on its id while it is open (released when it closes or reloads), and a copy that finds the
 * lease held by a live tab takes a new id, starting from the original's project.
 */
const { tabKey, fromKey } = (() => {
  try {
    let id = sessionStorage.getItem('vexsim-tab');
    let from: string | null = null;
    const lease = id ? Number(localStorage.getItem('vexsim-lease:' + id)) : 0;
    if (id && Date.now() - lease < LEASE_MS) {
      from = 'tab:' + id;
      id = null;
    }
    if (!id) sessionStorage.setItem('vexsim-tab', (id = newTabId()));
    const key = 'vexsim-lease:' + id;
    const renew = () => {
      try {
        localStorage.setItem(key, String(Date.now()));
      } catch {
        /* storage off: duplicates can't be told apart */
      }
    };
    renew();
    setInterval(renew, LEASE_RENEW_MS);
    addEventListener('pagehide', () => {
      try {
        localStorage.removeItem(key);
      } catch {
        /* see renew */
      }
    });
    addEventListener('pageshow', renew); // back from the back/forward cache
    return { tabKey: 'tab:' + id, fromKey: from };
  } catch {
    return { tabKey: 'current', fromKey: null };
  }
})();

export const saveProject = async (p: SavedProject) => {
  await safe(idb.put('projects', tabKey, p), undefined);
  await safe(idb.put('projects', 'current', p), undefined);
};
export const loadProject = async () =>
  (await safe(idb.get<SavedProject>('projects', tabKey), undefined)) ??
  (fromKey ? await safe(idb.get<SavedProject>('projects', fromKey), undefined) : undefined) ??
  (await safe(idb.get<SavedProject>('projects', 'current'), undefined));

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
// saves reject when the browser can't store them (private window, storage full): callers say so
export const saveCustomRobot = (r: RobotProfile) => idb.put('robots', r.id, r);
export const deleteCustomRobot = (id: string) => safe(idb.del('robots', id), undefined);
export const saveModel = (id: string, glb: ArrayBuffer) => idb.put('models', id, glb);
export const loadModel = (id: string) => safe(idb.get<ArrayBuffer>('models', id), undefined);

/** Export a robot as a .zip containing robot.json and, if present, model.glb. */
/** A robot's VEX parts build (the parts kit), kept with the model it made. */
export const saveAssembly = (assetId: string, asm: Assembly) => idb.put('models', `asm:${assetId}`, asm);

/** Delete the models (and their parts builds) that no saved robot uses any more. */
export async function pruneModels(): Promise<void> {
  const used = new Set((await listCustomRobots()).map((r) => r.model?.assetId).filter((x): x is string => !!x));
  for (const k of await safe(idb.keys('models'), [])) {
    const key = String(k);
    const asset = key.startsWith('asm:') ? key.slice(4) : key;
    if (!used.has(asset)) await safe(idb.del('models', key), undefined);
  }
}
export const loadAssembly = (assetId: string) => safe(idb.get<Assembly>('models', `asm:${assetId}`), undefined);

export async function robotToZip(r: RobotProfile): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = { 'robot.json': strToU8(JSON.stringify(r, null, 2)) };
  if (r.model) {
    const glb = await loadModel(r.model.assetId);
    if (glb) entries['model.glb'] = new Uint8Array(glb);
    const asm = await loadAssembly(r.model.assetId);
    if (asm) entries['parts-build.json'] = strToU8(JSON.stringify(asm));
  }
  return zipSync(entries);
}

export function robotFromZip(data: Uint8Array): { profile: unknown; glb?: Uint8Array; assembly?: unknown } {
  const e = unzipSync(data);
  const files = Object.entries(e);
  const json = files.find(([p]) => /(^|\/)robot\.json$/i.test(p)) ?? files.find(([p]) => p.endsWith('.json') && !/parts-build\.json$/i.test(p));
  if (!json) throw new Error('The zip has no robot .json file.');
  const glb = files.find(([p]) => /\.glb$/i.test(p))?.[1];
  const asm = files.find(([p]) => /parts-build\.json$/i.test(p))?.[1];
  return { profile: JSON.parse(strFromU8(json[1])), glb, assembly: asm ? JSON.parse(strFromU8(asm)) : undefined };
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
