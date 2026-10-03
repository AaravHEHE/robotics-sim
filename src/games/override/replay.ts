// Rebuild the game state at any time of a recording (for the live score while scrubbing).

import type { OverrideRecording } from './game.ts';
import type { OverrideState } from './state.ts';

/** Index of the last sample at or before t in a flat [t, a, b, c, ...] track, or -1. */
export function sampleAt(track: number[], t: number): number {
  let lo = 0;
  let hi = track.length / 4 - 1;
  if (hi < 0 || track[0] > t) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track[mid * 4] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo * 4;
}

export function stateAt(rec: OverrideRecording, t: number): OverrideState {
  let idx = 0;
  for (let i = 0; i < rec.snapshots.length; i++) if (rec.snapshots[i].t <= t) idx = i;
  const s = JSON.parse(JSON.stringify(rec.snapshots[idx].state)) as OverrideState;
  const apply = (id: string, fn: (k: number, tr: number[]) => void) => {
    const tr = rec.tracks[id];
    if (!tr) return;
    const k = sampleAt(tr, t);
    if (k >= 0) fn(k, tr);
  };
  for (const o of s.floor) apply(o.id, (k, tr) => { o.x = tr[k + 1]; o.y = tr[k + 2]; });
  for (const o of s.lying) apply(o.id, (k, tr) => { o.x = tr[k + 1]; o.y = tr[k + 2]; o.heading = tr[k + 3]; });
  for (const o of s.toggles) apply(o.id, (k, tr) => { o.angle = tr[k + 1]; o.touched = tr[k + 2] === 1; });
  return s;
}
