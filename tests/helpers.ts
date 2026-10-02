// Shared helpers for end-to-end tests: compile projects with the real browser
// pipeline (running in Node) and simulate them.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadNodeBundle, readProjectDir } from '../scripts/node-bundle.ts';
import { loadNodeToolchain, repoRoot } from '../scripts/node-toolchain.ts';
import { ProjectBuilder, type BuildResult } from '../src/compiler/build.ts';
import { simulatedEnvNames } from '../src/sim/pros-api.ts';
import type { FieldDef } from '../src/sim/field.ts';
import type { RobotProfile } from '../src/sim/profile.ts';
import type { Recording } from '../src/sim/recording.ts';
import { runProgram, type RunOptions } from '../src/sim/runtime.ts';

let builderP: Promise<ProjectBuilder> | null = null;
export function builder(): Promise<ProjectBuilder> {
  builderP ??= (async () => new ProjectBuilder(await loadNodeToolchain(), await loadNodeBundle(), simulatedEnvNames()))();
  return builderP;
}

export async function fixture(name: string, edits: Record<string, (text: string) => string> = {}): Promise<Record<string, Uint8Array | string>> {
  const files: Record<string, Uint8Array | string> = await readProjectDir(path.join(repoRoot, 'tests/fixtures', name));
  for (const [p, edit] of Object.entries(edits)) {
    const before = new TextDecoder().decode(files[p] as Uint8Array);
    const after = edit(before);
    if (after === before) throw new Error(`edit to ${p} changed nothing`);
    files[p] = after;
  }
  return files;
}

export async function robot(id: string): Promise<RobotProfile> {
  return JSON.parse(await readFile(path.join(repoRoot, 'data/robots', id + '.json'), 'utf8'));
}

export async function field(): Promise<FieldDef> {
  return JSON.parse(await readFile(path.join(repoRoot, 'data/fields/generic-12ft.json'), 'utf8'));
}

export async function build(files: Record<string, Uint8Array | string>): Promise<BuildResult> {
  return (await builder()).build(files);
}

export async function simulate(files: Record<string, Uint8Array | string>, robotId: string, opts: Partial<RunOptions> = {}): Promise<Recording> {
  const b = await build(files);
  if (!b.ok || !b.wasm) {
    throw new Error('build failed:\n' + b.diagnostics.map((d) => `${d.file}:${d.line}: ${d.message}`).join('\n'));
  }
  return runProgram(await WebAssembly.compile(b.wasm), {
    profile: await robot(robotId),
    field: await field(),
    start: { x: 0, y: 0, theta: 0 },
    autonMs: 15000,
    ...opts,
  });
}

/** Pose at the last frame. */
export function finalPose(rec: Recording): { x: number; y: number; theta: number } {
  const i = rec.frames.length - rec.stride;
  return { x: rec.frames[i + 1], y: rec.frames[i + 2], theta: rec.frames[i + 3] };
}

/** A minimal PROS project with the given main.cpp body. */
export function prosProject(mainCpp: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'include/main.h': '#pragma once\n#include "api.h"\n#ifdef __cplusplus\nextern "C" {\n#endif\nvoid autonomous(void);\nvoid initialize(void);\n#ifdef __cplusplus\n}\n#endif\n',
    'src/main.cpp': mainCpp,
    ...extra,
  };
}
