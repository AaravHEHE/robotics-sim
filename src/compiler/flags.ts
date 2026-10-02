// Virtual filesystem layout and compiler flags shared by the shim build (Node) and
// user-project builds (browser). Changing anything here requires rebuilding the shim.

/** Public headers users compile against: PROS, LemLib, EZ-Template, okapi units, sim. */
export const SIM_INCLUDE = '/sim/include';
/** Kernel-internal stand-ins, only used while compiling the shim itself. */
export const SIM_PRIVATE = '/sim/private';
/** Precompiled header variants; a project uses the one matching its libraries. */
export type PchVariant = 'lemlib' | 'ez';
export const PCH_VARIANTS: PchVariant[] = ['lemlib', 'ez'];
export const pchPath = (v: PchVariant) => `/sim/pch/${v}.pch`;
export const PROJECT_ROOT = '/project';
export const SYSROOT_LIB = '/lib/wasm32-wasip1';

export const CXX_STD = '-std=gnu++20';
export const C_STD = '-std=gnu11';

/** Macros the stock PROS template defines before including api.h; baked into the PCH. */
export const PROS_DEFINES = [
  '-DPROS_USE_SIMPLE_NAMES', '-DPROS_USE_LITERALS', '-D_PROS_SIM_=1',
  // The simulator provides LLEMU (pros::lcd) itself, as liblvgl would.
  '-D_PROS_KERNEL_SUPPRESS_LLEMU_WARNING',
  // fmt 10.1 (bundled with LemLib) trips clang 17+'s stricter consteval rules;
  // fall back to runtime format-string checking.
  '-DFMT_CONSTEVAL=',
];

export const COMMON_FLAGS = [
  '--target=wasm32-wasip1',
  '-fwasm-exceptions', '-mllvm', '-wasm-use-legacy-eh=false',
  '-fno-color-diagnostics', '-fdiagnostics-absolute-paths',
  '-Wno-unused-command-line-argument',
  ...PROS_DEFINES,
];

export const OPT = '-O1';

export function cxxFlags(extra: string[] = []): string[] {
  return [...COMMON_FLAGS, CXX_STD, OPT, ...extra];
}

export function cFlags(extra: string[] = []): string[] {
  return [...COMMON_FLAGS, C_STD, OPT, ...extra];
}

/** Flags that make a user TU use a prebuilt PCH. */
export const pchFlags = (v: PchVariant) => ['-include-pch', pchPath(v), '-Xclang', '-fno-validate-pch'];

/** Exported entry points every linked program must provide (see shim/src/sim_entry.cpp). */
export const ENTRY_EXPORTS = ['_initialize', '__stack_pointer', 'malloc', 'free', 'sim_task_entry', 'sim_competition_entry'];

export function linkArgs(objects: string[], output: string): string[] {
  return [
    'wasm-ld', '-m', 'wasm32', '--threads=1', '-L' + SYSROOT_LIB, SYSROOT_LIB + '/crt1-reactor.o',
    ...objects,
    '-lc++', '-lc++abi', '-lunwind', '-lc', SYSROOT_LIB + '/libclang_rt.builtins.a',
    '--no-entry', '--gc-sections',
    // Unresolved functions become imports; the runtime classifies them as simulated,
    // unsupported-but-harmless, or real user errors (see symbols.ts).
    '--allow-undefined',
    ...ENTRY_EXPORTS.map((e) => '--export=' + e),
    '-z', 'stack-size=262144',
    '-o', output,
  ];
}
