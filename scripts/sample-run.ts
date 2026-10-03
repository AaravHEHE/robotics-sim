// Run a shipped sample the way the app opens it: its robot preset, field, start
// position and auto-stop. Shared by tests and scripts/try-sample.ts.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SampleMeta } from '../src/app/samples-meta.ts';
import type { FieldDef } from '../src/sim/field.ts';
import type { RobotProfile } from '../src/sim/profile.ts';
import type { Recording } from '../src/sim/recording.ts';
import { runProgram } from '../src/sim/runtime.ts';
import { repoRoot } from './node-toolchain.ts';

export async function runSample(meta: SampleMeta, wasm: WebAssembly.Module): Promise<Recording> {
  const profile = JSON.parse(await readFile(path.join(repoRoot, 'data/robots', meta.robot + '.json'), 'utf8')) as RobotProfile;
  const field = JSON.parse(await readFile(path.join(repoRoot, 'data/fields', (meta.field ?? 'generic-12ft') + '.json'), 'utf8')) as FieldDef;
  const sp = meta.start ? field.startPositions?.find((p) => p.id === meta.start) : undefined;
  if (meta.start && !sp) throw new Error(`sample ${meta.id}: no start position ${meta.start} on ${field.id}`);
  return runProgram(wasm, {
    profile,
    field,
    start: sp ? { x: sp.x, y: sp.y, theta: sp.theta } : { x: 0, y: 0, theta: 0 },
    autonMs: meta.autonMs ?? 15000,
  });
}
