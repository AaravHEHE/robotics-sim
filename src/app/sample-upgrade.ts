// Recognising a saved project that is an unedited copy of an older version of a shipped
// sample (its routine was written for older physics), so the app can open the current one.

import { textHash } from './text-hash.ts';

/** Earlier versions of each sample's files: sample id -> file path -> text hashes. */
export type SampleHistory = Record<string, Record<string, string[]>>;

/**
 * Is `saved` an older copy of a sample whose files are now `current`? Every saved file is
 * either the current one or one the sample shipped before, and at least one is old. Any file
 * the user changed (or added) makes it theirs: never replaced.
 */
export function isOlderCopy(saved: Record<string, string>, current: Record<string, string>, history: Record<string, string[]> | undefined): boolean {
  if (!history) return false;
  let old = false;
  for (const [p, text] of Object.entries(saved)) {
    if (current[p] === text) continue;
    if (!history[p]?.includes(textHash(text))) return false;
    old = true;
  }
  return old;
}
