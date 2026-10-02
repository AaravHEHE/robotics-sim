// Header preprocessing for the shim header bundle.
//
// Headers that go into the precompiled header must use #ifndef guards: every tool
// invocation mounts a fresh virtual filesystem, so clang's file identity (used by
// #pragma once) differs between the PCH build and the compile that consumes it.

export function guardName(path: string): string {
  return '_SIMGUARD_' + path.replace(/[^A-Za-z0-9]/g, '_').toUpperCase() + '_';
}

/** Replace a leading-style `#pragma once` with an equivalent include guard. */
export function pragmaOnceToGuard(path: string, text: string): string {
  const re = /^[ \t]*#[ \t]*pragma[ \t]+once[ \t]*$/m;
  if (!re.test(text)) return text;
  const g = guardName(path);
  return text.replace(re, `#ifndef ${g}\n#define ${g}`) + `\n#endif // ${g}\n`;
}
