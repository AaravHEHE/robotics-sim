// Driver for the llvm-wasm multicall binary (clang + wasm-ld), usable from Node and
// from a browser Worker. The binary's runtime exits after one callMain, so each tool
// invocation gets a fresh instance of the precompiled module (~20 ms).

export type FileData = Uint8Array | string;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  files: Record<string, Uint8Array>;
  memBytes: number;
  ms: { instantiate: number; mount: number; run: number; total: number };
}

interface EmscriptenFS {
  mkdirTree(path: string): void;
  createDataFile(parent: string, name: string, data: Uint8Array, canRead: boolean, canWrite: boolean, canOwn: boolean): void;
  readFile(path: string): Uint8Array;
}

interface EmscriptenModule {
  FS: EmscriptenFS;
  callMain(args: string[]): number;
}

export type LlvmFactory = (opts: Record<string, unknown>) => Promise<EmscriptenModule>;

export interface ToolchainParts {
  factory: LlvmFactory;
  module: WebAssembly.Module;
  /** Read-only files mounted into every instance (sysroot, shim headers, PCH). */
  readonly: Array<{ path: string; data: Uint8Array }>;
}

const enc = new TextEncoder();

export class Toolchain {
  private readonly parts: ToolchainParts;

  constructor(parts: ToolchainParts) {
    this.parts = parts;
  }

  /** Add read-only files (e.g. shim headers and the PCH) to every future instance. */
  addReadonly(files: Array<{ path: string; data: Uint8Array }>): void {
    this.parts.readonly.push(...files);
  }

  async run(args: string[], inputs: Record<string, FileData> = {}, outputs: string[] = []): Promise<RunResult> {
    let stdout = '';
    let stderr = '';
    let memory: WebAssembly.Memory | null = null;
    const t0 = performance.now();
    // Emscripten waits for done() forever: a failed instantiate (e.g. out of memory) must
    // reject this call instead of hanging the compiler
    let fail: (e: Error) => void = () => {};
    const failed = new Promise<never>((_, reject) => (fail = reject));
    const M = await Promise.race([
      this.parts.factory({
        noInitialRun: true,
        print: (s: string) => { stdout += s + '\n'; },
        printErr: (s: string) => { stderr += s + '\n'; },
        instantiateWasm: (imports: WebAssembly.Imports, done: (i: WebAssembly.Instance) => void) => {
          WebAssembly.instantiate(this.parts.module, imports).then(
            (inst) => {
              memory = (Object.values(inst.exports).find((e) => e instanceof WebAssembly.Memory) as WebAssembly.Memory) ?? null;
              done(inst);
            },
            (e: unknown) => {
              const msg = String((e as Error)?.message ?? e);
              fail(new Error(/memory/i.test(msg) ? `The compiler ran out of memory (${msg}). Reload the page and try again.` : `The compiler could not start: ${msg}`));
            },
          );
          return {};
        },
      }),
      failed,
    ]);
    const tInst = performance.now();
    const FS = M.FS;
    const made = new Set<string>();
    const ensureDir = (dir: string) => {
      if (made.has(dir)) return;
      FS.mkdirTree(dir);
      made.add(dir);
    };
    const put = (path: string, data: Uint8Array, readOnly: boolean) => {
      const slash = path.lastIndexOf('/');
      ensureDir(path.slice(0, slash) || '/');
      FS.createDataFile(path.slice(0, slash) || '/', path.slice(slash + 1), data, true, !readOnly, true);
    };
    for (const f of this.parts.readonly) put(f.path, f.data, true);
    for (const [p, d] of Object.entries(inputs)) put(p, typeof d === 'string' ? enc.encode(d) : d, false);
    for (const p of outputs) ensureDir(p.slice(0, p.lastIndexOf('/')) || '/');
    const tMount = performance.now();
    let code: number;
    try {
      code = M.callMain(args);
    } catch (e) {
      const status = (e as { status?: unknown })?.status;
      if (typeof status === 'number') code = status;
      else {
        stderr += String((e as Error)?.stack ?? e) + '\n';
        code = 1;
      }
    }
    const tRun = performance.now();
    const files: Record<string, Uint8Array> = {};
    for (const p of outputs) {
      try {
        files[p] = FS.readFile(p);
      } catch {
        // output not produced
      }
    }
    const mem = memory as WebAssembly.Memory | null;
    return {
      code, stdout, stderr, files,
      memBytes: mem ? mem.buffer.byteLength : 0,
      ms: { instantiate: tInst - t0, mount: tMount - tInst, run: tRun - tMount, total: tRun - t0 },
    };
  }
}
