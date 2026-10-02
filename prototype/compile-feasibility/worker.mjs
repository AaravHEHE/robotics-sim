// Browser feasibility harness worker: download (cached) toolchain, compile + link the
// test project twice (cold, warm), run the simulation twice, report timings.
import { Toolchain, parseTar } from './toolchain.mjs';
import { compileProject } from './pipeline.mjs';
import { runProgram } from './runtime.mjs';

const CACHE = 'vexsim-proto-v1';
const base = new URL('../../', import.meta.url); // repo root
const post = (type, data) => self.postMessage({ type, ...data });
const log = (msg) => post('log', { msg });

async function cachedFetch(url) {
  const t0 = performance.now();
  let cache = null;
  try { cache = await caches.open(CACHE); } catch { /* Cache API unavailable */ }
  let res = cache && (await cache.match(url));
  const hit = !!res;
  if (!res) {
    res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    if (cache) await cache.put(url, res.clone());
  }
  const gz = await res.arrayBuffer();
  const tFetch = performance.now();
  const raw = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return { raw: new Uint8Array(raw), gzBytes: gz.byteLength, hit, fetchMs: tFetch - t0, inflateMs: performance.now() - tFetch };
}

async function sha(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

self.onmessage = async ({ data }) => {
  if (data.cmd === 'clear-cache') {
    await caches.delete(CACHE);
    post('done', { results: { cacheCleared: true } });
    return;
  }
  const R = { jspi: typeof WebAssembly.Suspending === 'function', ua: navigator.userAgent, downloads: {} };
  try {
    const tAll = performance.now();
    const assets = {};
    for (const f of ['llvm.wasm', 'include.tar', 'lib.tar', 'sim.pch']) {
      const r = await cachedFetch(new URL(`prototype/compile-feasibility/out/${f}.gz`, base).href);
      assets[f] = r.raw;
      R.downloads[f] = { gzMB: +(r.gzBytes / 1e6).toFixed(2), cacheHit: r.hit, fetchMs: Math.round(r.fetchMs), inflateMs: Math.round(r.inflateMs) };
      log(`${f}: ${(r.gzBytes / 1e6).toFixed(1)} MB gz, ${r.hit ? 'cache hit' : 'network'}, ${r.fetchMs.toFixed(0)} ms + inflate ${r.inflateMs.toFixed(0)} ms`);
    }
    R.loadAssetsMs = Math.round(performance.now() - tAll);

    let t = performance.now();
    const module = await WebAssembly.compile(assets['llvm.wasm']);
    R.compileLlvmWasmMs = Math.round(performance.now() - t);
    const factory = (await import(new URL('tools/llvm-wasm/llvm.js', base).href)).default;
    const sysroot = [...parseTar(assets['include.tar']), ...parseTar(assets['lib.tar'])];
    const manifest = await (await fetch(new URL('prototype/compile-feasibility/out/manifest.json', base))).json();
    const objects = {};
    for (const name of manifest.objects) {
      objects['/shimobj/' + name] = new Uint8Array(await (await fetch(new URL(`prototype/compile-feasibility/out/${name}`, base))).arrayBuffer());
    }
    const tc = new Toolchain({ factory, module, sysroot });
    R.toolchainReadyMs = Math.round(performance.now() - tAll);
    log(`toolchain ready after ${R.toolchainReadyMs} ms`);

    const shim = { pch: assets['sim.pch'], objects, headers: manifest.headers };
    R.builds = [];
    let wasm;
    for (const label of ['cold', 'warm', 'warm2']) {
      t = performance.now();
      const b = await compileProject(tc, shim, manifest.project, { opt: '-O1', usePch: true });
      const ms = Math.round(performance.now() - t);
      if (!b.ok) throw new Error('build failed:\n' + b.diagnostics);
      wasm = b.wasm;
      const peak = Math.max(...b.steps.map((s) => s.memBytes || 0));
      R.builds.push({ label, totalMs: ms, peakMemMB: +(peak / 1e6).toFixed(0), steps: b.steps.map((s) => `${s.step}: ${Math.round(s.ms.total)} ms`) });
      log(`${label} build: ${ms} ms (${b.steps.map((s) => `${s.step} ${Math.round(s.ms.total)}`).join(', ')})`);
    }
    R.appWasmKB = Math.round(wasm.length / 1024);

    const appModule = await WebAssembly.compile(wasm);
    R.runs = [];
    for (let i = 0; i < 2; i++) {
      const run = await runProgram(appModule, { stopMs: 15000 });
      const hash = await sha(run.log.join('\n') + JSON.stringify(run.frames));
      R.runs.push({ simMs: 15000, wallMs: Math.round(run.ms), events: run.log.length, hash, error: run.error ?? null });
      if (i === 0) R.stdout = run.stdout;
      log(`run ${i + 1}: 15 s simulated in ${run.ms.toFixed(0)} ms, hash ${hash}`);
    }
    R.deterministic = R.runs[0].hash === R.runs[1].hash;
    post('done', { results: R });
  } catch (e) {
    post('error', { msg: String(e?.stack || e), results: R });
  }
};
