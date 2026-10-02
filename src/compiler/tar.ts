// Minimal ustar reader for the sysroot tarballs.

export interface TarFile {
  path: string;
  data: Uint8Array;
}

export function parseTar(buf: ArrayBuffer | Uint8Array): TarFile[] {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const files: TarFile[] = [];
  const dec = new TextDecoder();
  const str = (o: number, n: number): string => {
    let end = o;
    while (end < o + n && u8[end] !== 0) end++;
    return dec.decode(u8.subarray(o, end));
  };
  let off = 0;
  let longName: string | null = null;
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
      if (longName) {
        name = longName;
        longName = null;
      }
      if (type === '0' || type === '\0') {
        files.push({ path: '/' + name.replace(/^\.?\//, ''), data: u8.subarray(dataOff, dataOff + size) });
      }
    }
    off = dataOff + Math.ceil(size / 512) * 512;
  }
  return files;
}
