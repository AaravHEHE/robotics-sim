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
const CACHE = 'vexsim-assets-v1';
let base = new URL('/', self.location.origin);

let currentId = 0;
const progress = (message: string, loaded?: number, total?: number) =>
  self.postMessage({ id: currentId, type: 'progress', message, loaded, total } satisfies CompilerResponse);

/** Fetch with the Cache API (immutable, versioned file names) and report bytes. */
async function fetchCached(path: string, label: string): Promise<ArrayBuffer> {
  const url = new URL(path, base).href;
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return hit.arrayBuffer();
  } catch {
    cache = null; // e.g. Cache API unavailable in this context
  }
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`Could not download ${path}: ${(e as Error).message}. Check your connection and try again.`);
  }
  if (!res.ok || !res.body) throw new Error(`Could not download ${path} (HTTP ${res.status})`);
  // with Content-Encoding the length header is the compressed size; don't show a bogus total
  const total = res.headers.get('content-encoding') ? 0 : Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    progress(`Downloading ${label}`, loaded, total);
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  if (cache) await cache.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {});
  return buf.buffer;
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
  const mres = await fetch(manifestUrl, { cache: 'no-cache' }).catch((e) => {
    throw new Error(`Could not load ${manifestUrl}: ${(e as Error).message}`);
  });
  if (!mres.ok) throw new Error(`Simulator files are missing (${manifestUrl} returned ${mres.status}). Run npm run setup.`);
  const manifest = (await mres.json()) as ShimManifest;
  const [llvmGz, incGz, libGz, headersGz, objectsGz] = await Promise.all([
    fetchCached('toolchain/llvm.wasm.gz', 'compiler (17 MB)'),
    fetchCached('toolchain/include.tar.gz', 'C++ headers'),
    fetchCached('toolchain/lib.tar.gz', 'C++ libraries'),
    fetchCached('sim/' + manifest.headers, 'PROS headers'),
    fetchCached('sim/' + manifest.objects, 'simulator library'),
  ]);
  progress('Preparing compiler');
  const module = await WebAssembly.compile((await gunzip(llvmGz)) as Uint8Array<ArrayBuffer>);
  const factory = (await import(/* @vite-ignore */ new URL('toolchain/llvm.js', base).href)).default as LlvmFactory;
  const readonly = [...parseTar(await gunzip(incGz)), ...parseTar(await gunzip(libGz))];
  const headers = JSON.parse(new TextDecoder().decode(await gunzip(headersGz))) as Record<string, string>;
  const objects: Record<string, Uint8Array> = {};
  for (const f of parseTar(await gunzip(objectsGz))) objects[f.path.replace(/^\//, '')] = f.data;
  const bundle: ShimBundle = { manifest, headers, objects, pch: {} };
  const builder = new ProjectBuilder(new Toolchain({ factory, module, readonly }), bundle, simulatedNames);
  return { builder, bundle };
}

async function ensurePch(bundle: ShimBundle, v: PchVariant) {
  if (bundle.pch[v]) return;
  const label = v === 'ez' ? 'EZ-Template headers (20 MB)' : 'PROS/LemLib headers (14 MB)';
  bundle.pch[v] = await gunzip(await fetchCached('sim/' + bundle.manifest.pch[v], label));
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
