// Build the simulator library ("shim bundle") with the in-browser toolchain running in
// Node, so the browser later links against bit-identical objects and a matching PCH.
//
//   node scripts/build-shim.ts   -> public/sim/{manifest.json, headers.*.json.gz, <variant>.*.pch.gz, objects.*.tar.gz}
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { LIBRARY_VERSIONS, type ShimManifest } from '../src/compiler/bundle.ts';
import { cxxFlags, PCH_VARIANTS, pchPath, SIM_INCLUDE, SIM_PRIVATE, type PchVariant } from '../src/compiler/flags.ts';
import { pragmaOnceToGuard } from '../src/compiler/headers.ts';
import { writeTar } from '../src/compiler/tarwrite.ts';
import { loadNodeToolchain, repoRoot } from './node-toolchain.ts';

const shim = path.join(repoRoot, 'shim');
const outDir = path.join(repoRoot, 'public/sim');

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}
const rel = (from: string, p: string) => path.relative(from, p).replaceAll('\\', '/');

// ---- 1. header bundle (later entries override earlier ones) ----
const headerRoots = [
  'vendor/pros/include',
  'vendor/lemlib/include',
  'vendor/ez-template/include',
  'vendor/okapi-units/include',
  'include', // simulator headers and overrides (e.g. lemlib/asset.hpp)
];
const headers: Record<string, string> = {};
for (const r of headerRoots) {
  const base = path.join(shim, r);
  for (const f of await walk(base)) {
    if (!/\.(h|hpp|hh|inc|ipp)$/.test(f)) continue;
    const vpath = `${SIM_INCLUDE}/${rel(base, f)}`;
    headers[vpath] = pragmaOnceToGuard(vpath, await readFile(f, 'utf8'));
  }
}
const privateHeaders: Record<string, string> = {};
for (const f of await walk(path.join(shim, 'private'))) {
  const vpath = `${SIM_PRIVATE}/${rel(path.join(shim, 'private'), f)}`;
  privateHeaders[vpath] = pragmaOnceToGuard(vpath, await readFile(f, 'utf8'));
}
console.log(`headers: ${Object.keys(headers).length} public, ${Object.keys(privateHeaders).length} private`);

// ---- 2. sources ----
// vendor: third-party code, compiled with warnings off. private: may see kernel-internal headers.
const sources: Array<{ file: string; private?: boolean; vendor?: boolean; extraInc?: string[] }> = [];
for (const f of await walk(path.join(shim, 'vendor/pros/src'))) sources.push({ file: f, private: true, vendor: true });
const lemlibKeep = [
  'pid.cpp', 'exitcondition.cpp', 'pose.cpp', 'util.cpp', 'timer.cpp', 'driveCurve.cpp',
  'chassis/chassis.cpp', 'chassis/opcontrol.cpp', 'chassis/trackingWheel.cpp',
  'logger/baseSink.cpp', 'logger/buffer.cpp', 'logger/infoSink.cpp', 'logger/logger.cpp', 'logger/message.cpp',
  'logger/stdout.cpp', 'logger/telemetrySink.cpp',
];
for (const f of lemlibKeep) {
  sources.push({ file: path.join(shim, 'vendor/lemlib/src/lemlib', f), vendor: true, extraInc: ['-I' + SIM_INCLUDE + '/lemlib'] });
}
// EZ-Template: everything except the PID motor-control loop, which shim/src/ez/pid_tasks.cpp replaces
for (const f of await walk(path.join(shim, 'vendor/ez-template/src'))) {
  if (!f.endsWith('.cpp') || /[\\/]drive[\\/]pid_tasks\.cpp$/.test(f)) continue;
  sources.push({ file: f, vendor: true, extraInc: ['-I' + SIM_INCLUDE + '/EZ-Template'] });
}
for (const f of await walk(path.join(shim, 'src'))) {
  if (/\.(c|cpp)$/.test(f)) sources.push({ file: f, private: /[\\/]kernel[\\/]/.test(f) });
}

// ---- 3. compile ----
const tc = await loadNodeToolchain();
tc.addReadonly(Object.entries({ ...headers, ...privateHeaders }).map(([p, t]) => ({ path: p, data: new TextEncoder().encode(t) })));

const t0 = performance.now();
const pchs = {} as Record<PchVariant, Uint8Array>;
for (const v of PCH_VARIANTS) {
  const out = pchPath(v);
  const r = await tc.run(['clang', ...cxxFlags(['-isystem', SIM_INCLUDE]), '-x', 'c++-header', `${SIM_INCLUDE}/sim/pch-${v}.hpp`, '-o', out], {}, [out]);
  if (r.code !== 0) {
    console.error(r.stderr);
    process.exit(1);
  }
  pchs[v] = r.files[out];
  console.log(`PCH ${v}: ${(pchs[v].length / 1e6).toFixed(1)} MB in ${r.ms.total.toFixed(0)} ms`);
}

const objects: Array<{ path: string; data: Uint8Array }> = [];
let failed = 0;
for (const s of sources) {
  const name = rel(shim, s.file);
  const vsrc = '/sim/src/' + name;
  const out = '/sim/obj/' + name.replace(/[/.]/g, '_') + '.o';
  const incs = [
    ...(s.private ? ['-I' + SIM_PRIVATE] : []), ...(s.extraInc ?? []), '-isystem', SIM_INCLUDE,
    '-include', 'sim/prelude.hpp', ...(s.vendor ? ['-w'] : []),
  ];
  const r = await tc.run(['clang', ...cxxFlags(incs), '-c', vsrc, '-o', out], { [vsrc]: await readFile(s.file) }, [out]);
  if (r.code !== 0 || !r.files[out]) {
    failed++;
    console.error(`FAILED ${name}\n${r.stderr.split('\n').slice(0, 40).join('\n')}`);
    continue;
  }
  if (r.stderr.trim()) console.warn(`warnings in ${name}:\n${r.stderr.split('\n').slice(0, 10).join('\n')}`);
  objects.push({ path: path.basename(out), data: r.files[out] });
  console.log(`  ${name}  ${r.ms.total.toFixed(0)} ms`);
}
if (failed) {
  console.error(`${failed} source(s) failed`);
  process.exit(1);
}
console.log(`compiled ${objects.length} objects in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

// ---- 4. known C API (for classifying unresolved imports at load time) ----
const knownCApi = new Set<string>();
const declRe = /\b([a-z_][a-z0-9_]*)\s*\([^;{}()]*(?:\([^()]*\)[^;{}()]*)*\)\s*(?:__attribute__\s*\(\([^)]*\)\))?\s*;/g;
for (const [p, text] of Object.entries(headers)) {
  if (!/\/pros\/[^/]+\.h$/.test(p)) continue;
  const noComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const m of noComments.matchAll(declRe)) knownCApi.add(m[1]);
}
for (const kw of ['if', 'while', 'for', 'switch', 'return', 'sizeof']) knownCApi.delete(kw);

// ---- 5. write bundle ----
await mkdir(outDir, { recursive: true });
const headersGz = gzipSync(JSON.stringify(headers), { level: 9 });
const pchGz = Object.fromEntries(PCH_VARIANTS.map((v) => [v, gzipSync(pchs[v], { level: 9 })])) as Record<PchVariant, Buffer>;
const objGz = gzipSync(writeTar(objects), { level: 9 });
const hash = createHash('sha256').update(headersGz).update(objGz);
for (const v of PCH_VARIANTS) hash.update(pchGz[v]);
const version = hash.digest('hex').slice(0, 16);
const manifest: ShimManifest = {
  version,
  headers: `headers.${version}.json.gz`,
  pch: Object.fromEntries(PCH_VARIANTS.map((v) => [v, `pch-${v}.${version}.pch.gz`])) as Record<PchVariant, string>,
  objects: `objects.${version}.tar.gz`,
  knownCApi: [...knownCApi].sort(),
  libraries: LIBRARY_VERSIONS,
};
await writeFile(path.join(outDir, manifest.headers), headersGz);
for (const v of PCH_VARIANTS) await writeFile(path.join(outDir, manifest.pch[v]), pchGz[v]);
await writeFile(path.join(outDir, manifest.objects), objGz);
await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
const mb = (n: number) => (n / 1e6).toFixed(2) + ' MB';
console.log(`bundle ${version}: headers ${mb(headersGz.length)}, pch ${PCH_VARIANTS.map((v) => v + ' ' + mb(pchGz[v].length)).join(', ')}, objects ${mb(objGz.length)}, ${knownCApi.size} C API names`);
