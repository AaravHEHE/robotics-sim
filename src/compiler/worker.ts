/// <reference lib="webworker" />
// Compiler worker: downloads (and caches) the in-browser toolchain and the simulator
// library once, then compiles projects on request. Long-lived, so the toolchain stays
// compiled in memory and unchanged files hit the object cache.

import { ProjectBuilder, type BuildResult } from './build.ts';
import type { ShimBundle, ShimManifest } from './bundle.ts';
import type { PchVariant } from './flags.ts';
import type { ProjectFiles } from './project.ts';
import { parseTar } from './tar.ts';
import { Toolchain, type LlvmFactory } from './toolchain.ts';

/** base: the site's root URL (where toolchain/ and sim/ are published). */
export type CompilerRequest = { id: number; type: 'build'; files: ProjectFiles; simulated: string[]; base: string };
export type CompilerResponse =
  | { id: number; type: 'progress'; message: string; loaded?: number; total?: number }
  | { id: number; type: 'result'; result: BuildResult }
  | { id: number; type: 'error'; message: string };

declare const self: DedicatedWorkerGlobalScope;
const CACHE = 'vexsim-assets-v2';
let base = new URL('/', self.location.origin);
/** Toolchain files have fixed names: their cache entries are keyed by toolchain/versions.json. */
let toolchainVersion = '';
/** A download that receives nothing for this long is abandoned (ms). */
const STALL_MS = 60_000;

let currentId = 0;
const progress = (message: string, loaded?: number, total?: number) =>
  self.postMessage({ id: currentId, type: 'progress', message, loaded, total } satisfies CompilerResponse);

/** Old asset caches (from earlier versions of the app) are dropped once. */
let cleaned = false;
async function openCache(): Promise<Cache | null> {
  try {
    if (!cleaned) {
      cleaned = true;
      for (const name of await caches.keys()) if (name.startsWith('vexsim-assets') && name !== CACHE) await caches.delete(name);
    }
    return await caches.open(CACHE);
  } catch {
    return null; // e.g. Cache API unavailable (plain http on a LAN address)
  }
}

const assetUrl = (path: string) => new URL(path.startsWith('toolchain/') ? `${path}?v=${toolchainVersion}` : path, base).href;

/** Fetch with the Cache API (immutable, versioned file names) and report bytes. */
async function fetchCached(path: string, label: string): Promise<ArrayBuffer> {
  const url = assetUrl(path);
  const cache = await openCache();
  const hit = await cache?.match(url).catch(() => undefined);
  if (hit) return hit.arrayBuffer();
  const ctrl = new AbortController();
  let stall = setTimeout(() => ctrl.abort(), STALL_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (e) {
    clearTimeout(stall);
    throw new Error(`Could not download ${path}: ${(e as Error).message}. Check your connection and try again.`);
  }
  if (!res.ok || !res.body) {
    clearTimeout(stall);
    throw new Error(`Could not download ${path} (HTTP ${res.status})`);
  }
  // with Content-Encoding the length header is the compressed size; don't show a bogus total
  const total = res.headers.get('content-encoding') ? 0 : Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(stall);
      stall = setTimeout(() => ctrl.abort(), STALL_MS);
      chunks.push(value);
      loaded += value.length;
      progress(`Downloading ${label}`, loaded, total);
    }
  } catch (e) {
    throw new Error(`The download of ${label} stopped (${(e as Error).message}). Check your connection and press Run again.`);
  } finally {
    clearTimeout(stall);
  }
  if (total && loaded !== total) throw new Error(`The download of ${label} was incomplete (${loaded} of ${total} bytes). Press Run again.`);
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  if (cache) await cache.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {});
  return buf.buffer;
}

/** A cached asset that can't be decoded is corrupt: drop it so the next run downloads it again. */
async function decoded<T>(path: string, label: string, decode: (buf: ArrayBuffer) => Promise<T> | T): Promise<T> {
  try {
    return await decode(await fetchCached(path, label));
  } catch (e) {
    await (await openCache())?.delete(assetUrl(path)).catch(() => false);
    throw new Error(`The ${label} download is damaged (${(e as Error).message}). Press Run again to download it again.`);
  }
}

/**
 * Assets are published gzip-compressed. Some servers (e.g. Vite's dev server) add
 * Content-Encoding: gzip so the browser already inflated them; detect by magic bytes.
 */
async function gunzip(buf: ArrayBuffer): Promise<Uint8Array> {
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) return new Uint8Array(buf);
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let ready: Promise<{ builder: ProjectBuilder; bundle: ShimBundle }> | null = null;
let simulatedNames: string[] = [];

async function load() {
  const manifestUrl = new URL('sim/manifest.json', base);
  const [mres, vres] = await Promise.all([
    fetch(manifestUrl, { cache: 'no-cache' }),
    fetch(new URL('toolchain/versions.json', base), { cache: 'no-cache' }),
  ]).catch((e) => {
    throw new Error(`Could not load ${manifestUrl}: ${(e as Error).message}. Check your connection.`);
  });
  if (!mres.ok) throw new Error(`Simulator files are missing (${manifestUrl} returned ${mres.status}). Run npm run setup.`);
  const manifest = (await mres.json()) as ShimManifest;
  toolchainVersion = vres.ok ? encodeURIComponent(Object.values((await vres.json()) as Record<string, string>).join('-')) : 'unknown';
  progress('Loading the compiler');
  const [module, readonlyInc, readonlyLib, headers, objects] = await Promise.all([
    decoded('toolchain/llvm.wasm.gz', 'compiler (17 MB)', async (b) => WebAssembly.compile((await gunzip(b)) as Uint8Array<ArrayBuffer>)),
    decoded('toolchain/include.tar.gz', 'C++ headers', async (b) => parseTar(await gunzip(b))),
    decoded('toolchain/lib.tar.gz', 'C++ libraries', async (b) => parseTar(await gunzip(b))),
    decoded('sim/' + manifest.headers, 'PROS headers', async (b) => JSON.parse(new TextDecoder().decode(await gunzip(b))) as Record<string, string>),
    decoded('sim/' + manifest.objects, 'simulator library', async (b) => {
      const out: Record<string, Uint8Array> = {};
      for (const f of parseTar(await gunzip(b))) out[f.path.replace(/^\//, '')] = f.data;
      return out;
    }),
  ]);
  progress('Preparing compiler');
  // llvm.js must match llvm.wasm: load it with the same version key
  const factory = (await import(/* @vite-ignore */ assetUrl('toolchain/llvm.js'))).default as LlvmFactory;
  const bundle: ShimBundle = { manifest, headers, objects, pch: {} };
  const builder = new ProjectBuilder(new Toolchain({ factory, module, readonly: [...readonlyInc, ...readonlyLib] }), bundle, simulatedNames);
  return { builder, bundle };
}

async function ensurePch(bundle: ShimBundle, v: PchVariant) {
  if (bundle.pch[v]) return;
  const label = v === 'ez' ? 'EZ-Template headers (20 MB)' : 'PROS/LemLib headers (14 MB)';
  bundle.pch[v] = await decoded('sim/' + bundle.manifest.pch[v], label, gunzip);
}

self.onmessage = async (ev: MessageEvent<CompilerRequest>) => {
  const req = ev.data;
  currentId = req.id;
  try {
    simulatedNames = req.simulated;
    base = new URL(req.base);
    ready ??= load();
    const { builder, bundle } = await ready;
    const result = await builder.build(req.files, {
      ensurePch: (v) => ensurePch(bundle, v),
      onProgress: (m) => progress(m),
    });
    const transfer = result.wasm ? [result.wasm.buffer] : [];
    self.postMessage({ id: req.id, type: 'result', result } satisfies CompilerResponse, transfer);
  } catch (e) {
    ready = null;
    self.postMessage({ id: req.id, type: 'error', message: String((e as Error)?.message ?? e) } satisfies CompilerResponse);
  }
};
