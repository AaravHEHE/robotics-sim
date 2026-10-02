// Build pipeline shared by the Node bench and the browser harness.
//   buildShim:      shim sources -> objects + PCH (done once, at site build time in M1)
//   compileProject: user project -> objects -> linked wasm (done in the visitor's browser)

export const CXXFLAGS = [
  '--target=wasm32-wasip1', '-std=gnu++20', '-fwasm-exceptions', '-mllvm', '-wasm-use-legacy-eh=false',
  '-Wno-unused-command-line-argument', '-fno-color-diagnostics',
];

const SHIM_INC = '/shim/include';
const PCH_PATH = '/pch/sim.pch';

const withPrefix = (prefix, files) => Object.fromEntries(Object.entries(files).map(([p, d]) => [prefix + p, d]));

/**
 * @param {import('./toolchain.mjs').Toolchain} tc
 * @param {Record<string,string>} shimFiles  paths relative to shim/ (include/..., src/...)
 * @param {{opt?: string}} o
 */
export async function buildShim(tc, shimFiles, { opt = '-O1' } = {}) {
  const inputs = withPrefix('/shim/', shimFiles);
  const timings = {};
  const pch = await tc.run(
    ['clang', ...CXXFLAGS, opt, '-I' + SHIM_INC, '-x', 'c++-header', SHIM_INC + '/sim/pch.hpp', '-o', PCH_PATH],
    inputs, [PCH_PATH]);
  if (pch.code !== 0) throw new Error('PCH build failed:\n' + pch.stderr);
  timings.pch = pch.ms.total;
  const objects = {};
  for (const src of Object.keys(shimFiles).filter((p) => p.startsWith('src/') && p.endsWith('.cpp'))) {
    const out = '/shimobj/' + src.slice(4).replace(/\.cpp$/, '.o');
    const r = await tc.run(['clang', ...CXXFLAGS, opt, '-I' + SHIM_INC, '-c', '/shim/' + src, '-o', out], inputs, [out]);
    if (r.code !== 0) throw new Error(`shim ${src} failed:\n${r.stderr}`);
    objects[out] = r.files[out];
    timings[src] = r.ms.total;
  }
  return { pch: pch.files[PCH_PATH], objects, timings };
}

/**
 * @param {import('./toolchain.mjs').Toolchain} tc
 * @param {{pch: Uint8Array, objects: Record<string,Uint8Array>, headers: Record<string,string>}} shim
 *        headers: shim/include files (paths relative to shim/), needed because the PCH references them
 * @param {Record<string,string>} project  paths relative to project root (src/..., include/...)
 * @param {{opt?: string, usePch?: boolean}} o
 */
export async function compileProject(tc, shim, project, { opt = '-O1', usePch = true } = {}) {
  const headerInputs = withPrefix('/shim/', shim.headers);
  const projInputs = withPrefix('/project/', project);
  const common = { ...headerInputs, ...projInputs, ...(usePch ? { [PCH_PATH]: shim.pch } : {}) };
  const steps = [];
  const objects = {};
  let diagnostics = '';
  // Shim include dir first so vendored copies of PROS/LemLib headers in the project are ignored.
  const incs = ['-I' + SHIM_INC, '-I/project/include'];
  const pchArgs = usePch ? ['-include-pch', PCH_PATH, '-Xclang', '-fno-validate-pch'] : [];
  for (const src of Object.keys(project).filter((p) => /\.(cpp|cc|cxx|c)$/.test(p))) {
    const out = '/obj/' + src.replace(/[/.]/g, '_') + '.o';
    const r = await tc.run(['clang', ...CXXFLAGS, opt, ...incs, ...pchArgs, '-c', '/project/' + src, '-o', out], common, [out]);
    diagnostics += r.stderr;
    steps.push({ step: 'compile ' + src, ms: r.ms, memBytes: r.memBytes });
    if (r.code !== 0) return { ok: false, diagnostics, steps };
    objects[out] = r.files[out];
  }
  const lib = '/lib/wasm32-wasip1';
  const linkArgs = [
    'wasm-ld', '-m', 'wasm32', '--threads=1', '-L' + lib, lib + '/crt1-reactor.o',
    ...Object.keys(objects), ...Object.keys(shim.objects),
    '-lc++', '-lc++abi', '-lunwind', '-lc', lib + '/libclang_rt.builtins.a',
    '--no-entry', '--export=_initialize', '--export=__stack_pointer', '-z', 'stack-size=262144',
    '-o', '/out/app.wasm',
  ];
  const l = await tc.run(linkArgs, { ...objects, ...shim.objects }, ['/out/app.wasm']);
  diagnostics += l.stderr;
  steps.push({ step: 'link', ms: l.ms, memBytes: l.memBytes });
  if (l.code !== 0) return { ok: false, diagnostics, steps };
  return { ok: true, wasm: l.files['/out/app.wasm'], diagnostics, steps };
}
