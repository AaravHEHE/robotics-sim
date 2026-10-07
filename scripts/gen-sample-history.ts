// Generate src/app/sample-history.json: hashes of every earlier version of each shipped
// sample's files (from git history). The app uses it to recognise a saved project that is an
// unedited older copy of a sample, and replaces it with the current one: the simulator's
// physics changed, and old sample routines may no longer work.
//   node scripts/gen-sample-history.ts   (after committing a change to a sample)
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from './node-toolchain.ts';
import { textHash } from '../src/app/text-hash.ts';

const git = (...args: string[]) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 << 20 });
const out: Record<string, Record<string, string[]>> = {};
for (const id of readdirSync(path.join(repoRoot, 'samples')).sort()) {
  const dir = `samples/${id}`;
  const files: Record<string, Set<string>> = {};
  for (const commit of git('log', '--format=%H', '--', dir).split('\n').filter(Boolean)) {
    for (const file of git('ls-tree', '-r', '--name-only', commit, '--', dir).split('\n').filter(Boolean)) {
      const rel = file.slice(dir.length + 1);
      if (!/^(src|include)\//.test(rel) && rel !== 'project.pros') continue;
      (files[rel] ??= new Set()).add(textHash(git('show', `${commit}:${file}`)));
    }
  }
  const entry: Record<string, string[]> = {};
  for (const [rel, hashes] of Object.entries(files)) {
    // the current version is the sample itself, not an old one
    let current = '';
    try {
      current = textHash(readFileSync(path.join(repoRoot, dir, rel), 'utf8'));
    } catch {
      /* the file was removed since */
    }
    const old = [...hashes].filter((h) => h !== current).sort();
    if (old.length) entry[rel] = old;
  }
  if (Object.keys(entry).length) out[id] = entry;
}
writeFileSync(path.join(repoRoot, 'src/app/sample-history.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`wrote earlier versions of ${Object.keys(out).length} samples`);
