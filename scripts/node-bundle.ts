// Load the built shim bundle (public/sim) and project folders from disk, for Node
// scripts and tests.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { ShimBundle, ShimManifest } from '../src/compiler/bundle.ts';
import { PCH_VARIANTS } from '../src/compiler/flags.ts';
import { parseTar } from '../src/compiler/tar.ts';
import { repoRoot } from './node-toolchain.ts';

export async function loadNodeBundle(): Promise<ShimBundle> {
  const dir = path.join(repoRoot, 'public/sim');
  const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')) as ShimManifest;
  const gz = async (f: string) => new Uint8Array(gunzipSync(await readFile(path.join(dir, f))));
  const headers = JSON.parse(new TextDecoder().decode(await gz(manifest.headers))) as Record<string, string>;
  const objects: Record<string, Uint8Array> = {};
  for (const f of parseTar(await gz(manifest.objects))) objects[f.path.replace(/^\//, '')] = f.data;
  const pch: ShimBundle['pch'] = {};
  for (const v of PCH_VARIANTS) pch[v] = await gz(manifest.pch[v]);
  return { manifest, headers, objects, pch };
}

export async function readProjectDir(dir: string): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out[path.relative(dir, p).replaceAll('\\', '/')] = new Uint8Array(await readFile(p));
    }
  };
  await walk(dir);
  return out;
}
