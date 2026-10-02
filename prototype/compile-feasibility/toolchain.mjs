// Environment-neutral driver for the llvm-wasm multicall binary (clang + wasm-ld).
// Works in Node and in a browser Worker. The binary's runtime exits after one
// callMain, so every tool invocation gets a fresh instance of the precompiled module.

/** Minimal ustar reader: returns [{path, data}] for regular files. */
export function parseTar(buf) {
  const u8 = new Uint8Array(buf);
  const files = [];
  const dec = new TextDecoder();
  const str = (o, n) => {
    let end = o;
    while (end < o + n && u8[end] !== 0) end++;
    return dec.decode(u8.subarray(o, end));
  };
  let off = 0;
  let longName = null;
  while (off + 512 <= u8.length) {
    if (u8[off] === 0) break;
    let name = str(off, 100);
    const prefix = str(off + 345, 155);
    if (prefix) name = prefix + '/' + name;
    const size = parseInt(str(off + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(u8[off + 156] || 48);
    const dataOff = off + 512;
    if (type === 'L') {
      longName = str(dataOff, size);
    } else {
      if (longName) { name = longName; longName = null; }
      if (type === '0' || type === '\0') files.push({ path: '/' + name.replace(/^\.?\//, ''), data: u8.subarray(dataOff, dataOff + size) });
    }
    off = dataOff + Math.ceil(size / 512) * 512;
  }
  return files;
}

export class Toolchain {
  /**
   * @param {object} o
   * @param {Function} o.factory   default export of llvm.js
   * @param {WebAssembly.Module} o.module  compiled llvm.wasm
   * @param {{path:string,data:Uint8Array}[]} o.sysroot  read-only files mounted in every instance
   */
  constructor({ factory, module, sysroot }) {
    this.factory = factory;
    this.module = module;
    this.sysroot = sysroot;
  }

  /**
   * Run one tool invocation.
   * @param {string[]} args  e.g. ['clang', '-c', ...] or ['wasm-ld', ...]
   * @param {Record<string, Uint8Array|string>} inputs  extra files to write
   * @param {string[]} outputs  paths to read back afterwards
   */
  async run(args, inputs = {}, outputs = []) {
    let stdout = '';
    let stderr = '';
    let memory = null;
    const t0 = performance.now();
    const M = await this.factory({
      noInitialRun: true,
      print: (s) => { stdout += s + '\n'; },
      printErr: (s) => { stderr += s + '\n'; },
      instantiateWasm: (imports, done) => {
        WebAssembly.instantiate(this.module, imports).then((inst) => {
          memory = Object.values(inst.exports).find((e) => e instanceof WebAssembly.Memory) ?? null;
          done(inst);
        });
        return {};
      },
    });
    const tInst = performance.now();
    const FS = M.FS;
    const made = new Set();
    const ensureDir = (dir) => {
      if (made.has(dir)) return;
      FS.mkdirTree(dir);
      made.add(dir);
    };
    const put = (path, data, readOnly) => {
      const slash = path.lastIndexOf('/');
      const dir = path.slice(0, slash) || '/';
      ensureDir(dir);
      FS.createDataFile(dir, path.slice(slash + 1), data, true, !readOnly, true);
    };
    for (const f of this.sysroot) put(f.path, f.data, true);
    for (const [p, d] of Object.entries(inputs)) put(p, typeof d === 'string' ? new TextEncoder().encode(d) : d, false);
    for (const p of outputs) ensureDir(p.slice(0, p.lastIndexOf('/')) || '/');
    const tMount = performance.now();
    let code;
    try {
      code = M.callMain(args);
    } catch (e) {
      code = typeof e?.status === 'number' ? e.status : (stderr += String(e?.stack || e) + '\n', 1);
    }
    const tRun = performance.now();
    const out = {};
    for (const p of outputs) {
      try { out[p] = FS.readFile(p); } catch { /* missing output */ }
    }
    return {
      code, stdout, stderr, files: out,
      memBytes: memory ? memory.buffer.byteLength : 0,
      ms: { instantiate: tInst - t0, mount: tMount - tInst, run: tRun - tMount, total: tRun - t0 },
    };
  }
}
