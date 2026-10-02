// One-off: measure PCH size per library tier (decides how the PCH is split).
import { gunzipSync, gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cxxFlags, SIM_INCLUDE } from '../src/compiler/flags.ts';
import { loadNodeToolchain, repoRoot } from './node-toolchain.ts';

const manifest = JSON.parse(await readFile(path.join(repoRoot, 'public/sim/manifest.json'), 'utf8'));
const headers = JSON.parse(gunzipSync(await readFile(path.join(repoRoot, 'public/sim', manifest.headers))).toString());
const tc = await loadNodeToolchain();
tc.addReadonly(Object.entries(headers).map(([p, t]) => ({ path: p, data: new TextEncoder().encode(t as string) })));

const tiers: Record<string, string> = {
  std: '#include "sim/prelude.hpp"\n#include <algorithm>\n#include <functional>\n#include <iostream>\n#include <map>\n#include <memory>\n#include <optional>\n#include <string>\n#include <vector>\n',
  pros: '#include "api.h"\n',
  lemlib: '#include "api.h"\n#include "lemlib/api.hpp"\n',
  ez: '#include "api.h"\n#include "EZ-Template/api.hpp"\n',
  bits: '#include <bits/stdc++.h>\n',
};
for (const [name, body] of Object.entries(tiers)) {
  const src = '/m/' + name + '.hpp';
  const text = (name === 'std' || name === 'bits' ? '' : tiers.std) + body;
  const r = await tc.run(['clang', ...cxxFlags(['-isystem', SIM_INCLUDE]), '-x', 'c++-header', src, '-o', '/m/out.pch'], { [src]: text }, ['/m/out.pch']);
  const pch = r.files['/m/out.pch'];
  console.log(name.padEnd(8), r.code, pch ? `${(pch.length / 1e6).toFixed(1)} MB raw, ${(gzipSync(pch).length / 1e6).toFixed(1)} MB gz` : r.stderr.slice(0, 300));
}
