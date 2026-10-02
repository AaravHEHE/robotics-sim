// Minimal ustar writer (used to pack shim objects into one download).

export function writeTar(files: Array<{ path: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const f of files) {
    const name = f.path.replace(/^\//, '');
    if (name.length > 99) throw new Error(`tar path too long: ${name}`);
    const h = new Uint8Array(512);
    const put = (s: string, off: number, len: number) => h.set(enc.encode(s).subarray(0, len), off);
    put(name, 0, 100);
    put('0000644\0', 100, 8);
    put('0000000\0', 108, 8);
    put('0000000\0', 116, 8);
    put(f.data.length.toString(8).padStart(11, '0') + '\0', 124, 12);
    put('00000000000\0', 136, 12);
    put('        ', 148, 8); // checksum placeholder (spaces)
    h[156] = 48; // '0' regular file
    put('ustar\0', 257, 6);
    put('00', 263, 2);
    let sum = 0;
    for (const b of h) sum += b;
    put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    blocks.push(h);
    blocks.push(f.data);
    const pad = (512 - (f.data.length % 512)) % 512;
    if (pad) blocks.push(new Uint8Array(pad));
  }
  blocks.push(new Uint8Array(1024));
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}
