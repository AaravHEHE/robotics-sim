// Tiny Itanium C++ demangler: recovers the qualified name (no parameter list) of the
// symbols that typically end up unresolved, e.g.
//   _ZN6lemlib7Chassis10moveToPoseEffifNS_16MoveToPoseParamsEb -> lemlib::Chassis::moveToPose
// Falls back to the mangled name for anything it does not understand.

export function demangleName(sym: string): string {
  if (!sym.startsWith('_Z')) return sym;
  let i = 2;
  let parts: string[] = [];
  /** Prefixes seen so far, which S_, S0_, S1_... refer back to. */
  const candidates: string[] = [];
  const sourceName = (): string | null => {
    let n = 0;
    const start = i;
    while (i < sym.length && sym[i] >= '0' && sym[i] <= '9') n = n * 10 + (sym.charCodeAt(i++) - 48);
    if (i === start || i + n > sym.length) return null;
    const s = sym.slice(i, i + n);
    i += n;
    // ABI tags (e.g. B5cxx11) belong to the name; they are not part of it
    while (sym[i] === 'B') {
      i++;
      let m = 0;
      const t = i;
      while (i < sym.length && sym[i] >= '0' && sym[i] <= '9') m = m * 10 + (sym.charCodeAt(i++) - 48);
      if (i === t) return null;
      i += m;
    }
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
  /** Skip a template argument list I...E (names in it are skipped by their length). */
  const skipTemplateArgs = (): boolean => {
    let depth = 0;
    do {
      const c = sym[i];
      if (c === undefined) return false;
      if (c >= '0' && c <= '9') {
        if (sourceName() === null) return false;
        continue;
      }
      if (c === 'L') {
        // a literal L<type><value>E (or an L_Z...E external name): skip to its end
        const end = sym.indexOf('E', i);
        if (end < 0) return false;
        i = end + 1;
        continue;
      }
      if (c === 'I' || c === 'N') depth++;
      else if (c === 'E') depth--;
      i++;
    } while (depth > 0);
    return true;
  };
  if (sym[i] === 'N') {
    i++;
    while (i < sym.length && 'KVrRO'.includes(sym[i])) i++; // cv / ref qualifiers
    while (i < sym.length && sym[i] !== 'E') {
      if (sym[i] === 'S' && sym[i + 1] === 't') {
        i += 2;
        parts.push('std');
        candidates.push(parts.join('::'));
        continue;
      }
      if (sym[i] === 'S') {
        // substitution S_ (the first prefix seen), S0_ (the second), ..., in base 36
        i++;
        let seq = 0;
        if (sym[i] === '_') i++;
        else {
          let n = 0;
          while (i < sym.length && /[0-9A-Z]/.test(sym[i])) n = n * 36 + parseInt(sym[i++], 36);
          if (sym[i++] !== '_') return sym;
          seq = n + 1;
        }
        const c = candidates[seq];
        if (c === undefined) return sym;
        parts = c.split('::');
        continue;
      }
      if (sym[i] === 'I') {
        // template arguments: not part of the name we report; the name may continue after them
        if (!skipTemplateArgs()) return parts.length ? parts.join('::') : sym;
        candidates.push(parts.join('::'));
        continue;
      }
      const name = unqualified();
      if (name === null) return parts.length ? parts.join('::') : sym;
      parts.push(name);
      candidates.push(parts.join('::'));
    }
    return parts.join('::');
  }
  const name = unqualified();
  if (name === null) return sym;
  parts.push(name);
  return parts.join('::');
}
