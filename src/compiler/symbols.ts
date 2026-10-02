// Classify a linked program's unresolved imports. The program is linked with
// --allow-undefined, so missing functions become "env" imports; this decides which
// are simulated, which are known-but-unsupported library calls (warning, call is a
// no-op), and which are genuine user errors (reported like a linker error).

import { demangleName } from './demangle.ts';

export interface ImportReport {
  simulated: string[];
  unsupported: Array<{ symbol: string; name: string }>;
  undefined: Array<{ symbol: string; name: string }>;
}

const LIBRARY_NS = /^(pros|lemlib|ez|okapi)::/;

export function classifyImports(
  imports: Array<{ module: string; name: string; kind: string }>,
  simulated: Set<string>,
  knownCApi: Set<string>,
): ImportReport {
  const report: ImportReport = { simulated: [], unsupported: [], undefined: [] };
  for (const imp of imports) {
    if (imp.module !== 'env') continue;
    if (simulated.has(imp.name)) {
      report.simulated.push(imp.name);
      continue;
    }
    const name = demangleName(imp.name);
    if (knownCApi.has(imp.name) || LIBRARY_NS.test(name)) report.unsupported.push({ symbol: imp.name, name });
    else report.undefined.push({ symbol: imp.name, name });
  }
  return report;
}
