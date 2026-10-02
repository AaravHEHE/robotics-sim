/// <reference lib="webworker" />
// Simulation sandbox: untrusted user code only ever runs here, as WebAssembly in a
// dedicated worker with no DOM or network imports. The main thread terminates this
// worker if a run takes too long (e.g. an arithmetic loop that never yields).

import type { Recording } from './recording.ts';
import { runProgram, type RunOptions } from './runtime.ts';

export type SimRequest = { wasm: Uint8Array<ArrayBuffer>; options: RunOptions };
export type SimResponse = { type: 'result'; recording: Recording } | { type: 'error'; message: string };

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (ev: MessageEvent<SimRequest>) => {
  try {
    const module = await WebAssembly.compile(ev.data.wasm);
    const recording = await runProgram(module, ev.data.options);
    self.postMessage({ type: 'result', recording } satisfies SimResponse, [recording.frames.buffer]);
  } catch (e) {
    self.postMessage({ type: 'error', message: String((e as Error)?.message ?? e) } satisfies SimResponse);
  }
};
