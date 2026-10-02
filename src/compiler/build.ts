// Compile + link a user project against the shim bundle, with a per-translation-unit
// object cache so an edit only recompiles the files it affects.

import type { ShimBundle } from './bundle.ts';
import { parseDiagnostics, type Diagnostic } from './diagnostics.ts';
import { cFlags, cxxFlags, linkArgs, pchFlags, PROJECT_ROOT, SIM_INCLUDE, type PchVariant } from './flags.ts';
import { prepareProject, type ProjectFiles, type ProjectNote } from './project.ts';
import { classifyImports } from './symbols.ts';
import type { Toolchain } from './toolchain.ts';

export interface BuildStep {
  step: string;
  ms: number;
  cached?: boolean;
}

export interface BuildResult {
  ok: boolean;
  wasm?: Uint8Array<ArrayBuffer>;
  diagnostics: Diagnostic[];
  notes: ProjectNote[];
  steps: BuildStep[];
  pch: PchVariant;
  totalMs: number;
}

async function sha256(...parts: Array<string | Uint8Array>): Promise<string> {
  const enc = new TextEncoder();
  const chunks = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p));
  const len = chunks.reduce((n, c) => n + c.length + 1, 0);
  const buf = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length + 1; // separator byte keeps part boundaries unambiguous
  }
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface BuildOptions {
  /** Called before compiling when the needed PCH variant is not loaded yet. */
  ensurePch?: (v: PchVariant) => Promise<void>;
  onProgress?: (msg: string) => void;
}

export class ProjectBuilder {
  private readonly tc: Toolchain;
  private readonly bundle: ShimBundle;
  private readonly cache = new Map<string, Uint8Array>();
  private readonly mountedPch = new Set<PchVariant>();
  private readonly simulated: Set<string>;
  private readonly knownCApi: Set<string>;

  /**
   * @param simulated names of the PROS C functions the runtime implements; other
   *        unresolved functions are either known-unsupported library calls (allowed,
   *        warned about at runtime) or real undefined references (build error).
   */
  constructor(tc: Toolchain, bundle: ShimBundle, simulated: Iterable<string> = []) {
    this.tc = tc;
    this.bundle = bundle;
    this.simulated = new Set(simulated);
    this.knownCApi = new Set(bundle.manifest.knownCApi);
    const enc = new TextEncoder();
    tc.addReadonly(Object.entries(bundle.headers).map(([path, text]) => ({ path, data: enc.encode(text) })));
  }

  private mountPch(v: PchVariant): boolean {
    if (this.mountedPch.has(v)) return true;
    const data = this.bundle.pch[v];
    if (!data) return false;
    this.tc.addReadonly([{ path: `/sim/pch/${v}.pch`, data }]);
    this.mountedPch.add(v);
    return true;
  }

  async build(input: ProjectFiles, opts: BuildOptions = {}): Promise<BuildResult> {
    const t0 = performance.now();
    const project = prepareProject(input, this.bundle.manifest.libraries);
    const steps: BuildStep[] = [];
    const diagnostics: Diagnostic[] = [];
    const fail = () => ({ ok: false, diagnostics, notes: project.notes, steps, pch: project.pch, totalMs: performance.now() - t0 });
    if (project.notes.some((n) => n.level === 'error')) return fail();

    if (!this.mountedPch.has(project.pch)) {
      if (!this.bundle.pch[project.pch] && opts.ensurePch) {
        opts.onProgress?.(`Downloading ${project.pch === 'ez' ? 'EZ-Template' : 'PROS/LemLib'} headers...`);
        await opts.ensurePch(project.pch);
      }
      this.mountPch(project.pch);
    }
    const usePch = this.mountedPch.has(project.pch);

    // Header changes invalidate every TU (we don't track per-TU dependencies).
    const headerText = Object.entries(project.files)
      .filter(([p]) => !project.sources.includes(p))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([p, t]) => p + '\0' + t)
      .join('\0');
    const headerHash = await sha256(headerText);
    const inputs: Record<string, string> = {};
    for (const [p, t] of Object.entries(project.files)) inputs[`${PROJECT_ROOT}/${p}`] = t;

    const units = [...project.sources.map((s) => ({ path: s, text: project.files[s] }))];
    if (project.assetSource) units.push({ path: 'src/__sim_assets.c', text: project.assetSource });
    const incs = ['-I' + PROJECT_ROOT + '/include', '-I' + PROJECT_ROOT + '/src', '-isystem', SIM_INCLUDE];

    const objects: Record<string, Uint8Array> = {};
    for (const u of units) {
      const isC = u.path.endsWith('.c');
      const args = isC
        ? cFlags(incs)
        : cxxFlags([...incs, ...(usePch ? pchFlags(project.pch) : ['-include', 'sim/prelude.hpp'])]);
      const key = await sha256(this.bundle.manifest.version, args.join(' '), u.path, u.text, isC ? '' : headerHash);
      const objPath = '/obj/' + u.path.replace(/[^A-Za-z0-9]/g, '_') + '.o';
      const hit = this.cache.get(key);
      if (hit) {
        objects[objPath] = hit;
        steps.push({ step: `compile ${u.path}`, ms: 0, cached: true });
        continue;
      }
      opts.onProgress?.(`Compiling ${u.path}`);
      const src = `${PROJECT_ROOT}/${u.path}`;
      const r = await this.tc.run(['clang', ...args, '-c', src, '-o', objPath], { ...inputs, [src]: u.text }, [objPath]);
      steps.push({ step: `compile ${u.path}`, ms: r.ms.total });
      diagnostics.push(...parseDiagnostics(r.stderr));
      if (r.code !== 0 || !r.files[objPath]) return fail();
      this.cache.set(key, r.files[objPath]);
      objects[objPath] = r.files[objPath];
    }

    opts.onProgress?.('Linking');
    // Library objects are linked only when the project uses that library, so their
    // global constructors (e.g. EZ-Template's auton selector) don't run otherwise.
    const shimObjects: Record<string, Uint8Array> = {};
    for (const [name, data] of Object.entries(this.bundle.objects)) {
      if (/^(vendor_ez-template_|src_ez_)/.test(name) && !project.uses.ez) continue;
      if (/^(vendor_lemlib_|src_lemlib_)/.test(name) && !project.uses.lemlib) continue;
      shimObjects['/simobj/' + name] = data;
    }
    const out = '/out/program.wasm';
    const l = await this.tc.run(linkArgs([...Object.keys(objects), ...Object.keys(shimObjects)], out), { ...objects, ...shimObjects }, [out]);
    steps.push({ step: 'link', ms: l.ms.total });
    diagnostics.push(...parseDiagnostics(l.stderr));
    if (l.code !== 0 || !l.files[out]) return fail();
    const wasm = new Uint8Array(l.files[out]);
    const report = classifyImports(WebAssembly.Module.imports(await WebAssembly.compile(wasm)), this.simulated, this.knownCApi);
    for (const u of report.undefined) {
      diagnostics.push({
        severity: 'error', file: null, line: 0, column: 0,
        message: `undefined reference to '${u.name}'`,
        detail: `undefined reference to '${u.name}' (${u.symbol}). The function is declared but never defined in the project.`,
      });
    }
    if (report.undefined.length) return fail();
    return { ok: true, wasm, diagnostics, notes: project.notes, steps, pch: project.pch, totalMs: performance.now() - t0 };
  }
}
