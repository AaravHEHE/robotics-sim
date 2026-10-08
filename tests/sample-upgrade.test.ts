import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import history from '../src/app/sample-history.json';
import { isOlderCopy, type SampleHistory } from '../src/app/sample-upgrade.ts';

const file = 'samples/override-ace/src/main.cpp';
const current = { 'src/main.cpp': readFileSync(path.join(repoRoot, file), 'utf8') };
const h = (history as SampleHistory)['override-ace'];
// the versions of the sample in git history (a shallow checkout, as in CI, has only the last)
const commits = execFileSync('git', ['log', '--format=%H', '--', file], { cwd: repoRoot, encoding: 'utf8' }).trim().split('\n');

describe('saved copies of older samples', () => {
  it('lists every earlier version of the samples that changed', () => {
    expect(h['src/main.cpp'].length).toBeGreaterThan(0);
  });

  it.skipIf(commits.length < 2)('recognises an unedited older copy, and leaves current or edited ones alone', () => {
    // the version before the physics changes (the commit before the sample's last change)
    const old = execFileSync('git', ['show', `${commits[1]}:${file}`], { cwd: repoRoot, encoding: 'utf8' });
    expect(isOlderCopy({ 'src/main.cpp': old }, current, h)).toBe(true);
    expect(isOlderCopy({ 'src/main.cpp': old.replace(/\n/g, '\r\n') }, current, h)).toBe(true); // line endings don't count
    expect(isOlderCopy(current, current, h)).toBe(false);
    expect(isOlderCopy({ 'src/main.cpp': old + '\n// my change\n' }, current, h)).toBe(false);
    expect(isOlderCopy({ 'src/main.cpp': old, 'src/mine.cpp': 'int x;' }, current, h)).toBe(false);
    expect(isOlderCopy({ 'src/main.cpp': old }, current, undefined)).toBe(false);
  });
});
