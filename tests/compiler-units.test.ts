// The compiler's helpers: tar reading, clang diagnostics, the demangler and import
// classification, and the object cache (which must notice header edits in C files).
import { describe, expect, it } from 'vitest';
import { demangleName } from '../src/compiler/demangle.ts';
import { parseDiagnostics } from '../src/compiler/diagnostics.ts';
import { PROJECT_ROOT } from '../src/compiler/flags.ts';
import { prepareProject } from '../src/compiler/project.ts';
import { classifyImports } from '../src/compiler/symbols.ts';
import { parseTar } from '../src/compiler/tar.ts';
import { writeTar } from '../src/compiler/tarwrite.ts';
import { prosProject, simulate } from './helpers.ts';

const enc = new TextEncoder();

describe('tar', () => {
  it('reads what it writes, and refuses cut-off or malformed archives', () => {
    const tar = writeTar([{ path: '/a/b.txt', data: enc.encode('hello') }, { path: '/c', data: new Uint8Array(600) }]);
    expect(parseTar(tar).map((f) => [f.path, f.data.length])).toEqual([['/a/b.txt', 5], ['/c', 600]]);
    expect(() => parseTar(tar.subarray(0, 512 + 512 + 100))).toThrow(/cut off/);
    const bad = tar.slice();
    bad.set(enc.encode('zz'), 124);
    expect(() => parseTar(bad)).toThrow(/Bad tar entry size/);
  });

  it('uses the long path from a pax header', () => {
    const long = 'd/'.repeat(70) + 'f.txt';
    const rec = `${long.length + 12} path=${long}\n`;
    const pax = writeTar([{ path: '/PaxHeader', data: enc.encode(rec) }, { path: '/short', data: enc.encode('x') }]);
    pax[156] = 'x'.charCodeAt(0); // the first entry is a pax header
    // fix its checksum
    pax.set(enc.encode('        '), 148);
    let sum = 0;
    for (const b of pax.subarray(0, 512)) sum += b;
    pax.set(enc.encode(sum.toString(8).padStart(6, '0') + '\0 '), 148);
    expect(parseTar(pax).map((f) => f.path)).toEqual(['/' + long]);
  });
});

describe('diagnostics', () => {
  it('attaches "In file included from" to the error it explains, and drops clang\'s summary', () => {
    const text = [
      `In file included from ${PROJECT_ROOT}/src/main.cpp:3:`,
      `${PROJECT_ROOT}/include/robot.h:5:1: error: unknown type name 'foo'`,
      'foo x;',
      '^',
      '1 warning and 1 error generated.',
    ].join('\n');
    const d = parseDiagnostics(text);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ severity: 'error', file: 'include/robot.h', line: 5 });
    expect(d[0].detail.split('\n')[0]).toBe('In file included from src/main.cpp:3:');
    expect(d[0].detail).not.toMatch(/generated/);
  });
});

describe('demangler', () => {
  it.each([
    ['_ZN6lemlib7Chassis10moveToPoseEffifNS_16MoveToPoseParamsEb', 'lemlib::Chassis::moveToPose'],
    ['_ZNSt6vectorIiSaIiEE9push_backERKi', 'std::vector::push_back'],
    ['_ZN4pros10MotorGroup3getINS_5MotorEEEvv', 'pros::MotorGroup::get'],
    ['_ZN6lemlib7Chassis4nameB5cxx11Ev', 'lemlib::Chassis::name'],
    ['_ZN6lemlib3PIDD2Ev', 'lemlib::PID::~PID'],
    ['_Z3fooi', 'foo'],
  ])('%s -> %s', (sym, name) => expect(demangleName(sym)).toBe(name));

  it('a library call the demangler cannot read is still a library call (a warning, not a link error)', () => {
    const r = classifyImports([{ module: 'env', name: '_ZN6lemlib7Chassis3fooEv?', kind: 'function' }], new Set(), new Set());
    expect(r.unsupported.map((x) => x.symbol)).toEqual(['_ZN6lemlib7Chassis3fooEv?']);
  });
});

describe('project', () => {
  it('two static/ files with the same asset name are an error', () => {
    const p = prepareProject({ 'src/main.cpp': 'int x;', 'static/a-b.txt': 'one', 'static/a_b.txt': 'two' }, {});
    expect(p.notes.some((n) => n.level === 'error' && /same asset name/.test(n.message))).toBe(true);
  });
});

describe('object cache', () => {
  it('a C file is rebuilt when a header it includes changes', async () => {
    const files = (value: number) =>
      prosProject(
        `#include "main.h"
extern "C" int config_value(void);
void autonomous() { printf("value=%d\\n", config_value()); }
`,
        { 'include/config.h': `#define CONFIG_VALUE ${value}\n`, 'src/config.c': '#include "config.h"\nint config_value(void) { return CONFIG_VALUE; }\n' },
      );
    const a = await simulate(files(1), 'tank-6m-450');
    const b = await simulate(files(2), 'tank-6m-450');
    expect(a.console.map((c) => c.text)).toEqual(['value=1']);
    expect(b.console.map((c) => c.text)).toEqual(['value=2']);
  });
});
