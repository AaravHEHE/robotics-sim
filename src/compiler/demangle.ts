// Tiny Itanium C++ demangler: recovers the qualified name (no parameter list) of the
// symbols that typically end up unresolved, e.g.
//   _ZN6lemlib7Chassis10moveToPoseEffifNS_16MoveToPoseParamsEb -> lemlib::Chassis::moveToPose
// Falls back to the mangled name for anything it does not understand.

export function demangleName(sym: string): string {
  if (!sym.startsWith('_Z')) return sym;
  let i = 2;
  const parts: string[] = [];
  const sourceName = (): string | null => {
    let n = 0;
    const start = i;
    while (i < sym.length && sym[i] >= '0' && sym[i] <= '9') n = n * 10 + (sym.charCodeAt(i++) - 48);
    if (i === start || i + n > sym.length) return null;
    const s = sym.slice(i, i + n);
    i += n;
    return s;
  };
  const unqualified = (): string | null => {
    if (sym.startsWith('C1', i) || sym.startsWith('C2', i) || sym.startsWith('C3', i)) {
      i += 2;
      return parts[parts.length - 1] ?? 'ctor';
    }
    if (sym.startsWith('D0', i) || sym.startsWith('D1', i) || sym.startsWith('D2', i)) {
      i += 2;
      return '~' + (parts[parts.length - 1] ?? 'dtor');
    }
    if (sym.startsWith('St', i)) {
      i += 2;
      parts.push('std');
      return sourceName();
    }
    if (sym[i] === 'L') i++; // internal linkage
    return sourceName();
  };
  if (sym[i] === 'N') {
    i++;
    while (i < sym.length && 'KVrRO'.includes(sym[i])) i++; // cv / ref qualifiers
    while (i < sym.length && sym[i] !== 'E') {
      if (sym[i] === 'S' && sym[i + 1] === 't') {
        i += 2;
        parts.push('std');
        continue;
      }
      if (sym[i] === 'S' && sym[i + 1] === '_') {
        i += 2; // substitution of the first prefix, e.g. NS_ -> repeat first component
        if (parts.length) parts.push(parts[0]);
        continue;
      }
      if (sym[i] === 'I') break; // template args: stop here
      const name = unqualified();
      if (name === null) return sym;
      parts.push(name);
    }
    return parts.join('::');
  }
  const name = unqualified();
  if (name === null) return sym;
  parts.push(name);
  return parts.join('::');
}
