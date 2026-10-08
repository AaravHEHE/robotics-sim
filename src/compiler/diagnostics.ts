// Parse clang / wasm-ld output into structured diagnostics for the editor.

import { PROJECT_ROOT, SIM_INCLUDE } from './flags.ts';

export interface Diagnostic {
  severity: 'error' | 'warning' | 'note';
  /** Project-relative path, or a library label such as "<PROS> pros/motors.hpp". */
  file: string | null;
  line: number;
  column: number;
  message: string;
  /** Full text of this diagnostic including notes/snippets that follow it. */
  detail: string;
}

const DIAG_RE = /^(.*?):(\d+):(\d+): (fatal error|error|warning|note): (.*)$/;
const LINK_RE = /^wasm-ld: (error|warning): (.*)$/;
/** "In file included from a.cpp:3:" and its "                 from b.h:5:" lines precede the diagnostic they explain. */
const INCLUDED_RE = /^(In file included from|\s+from) (.*?):(\d+):$/;
/** clang's closing count: "1 error generated.", "2 warnings and 1 error generated." */
const SUMMARY_RE = /^\d+ (errors?|warnings?)( and \d+ (errors?|warnings?))? generated\.$/;

export function displayPath(p: string): string {
  if (p.startsWith(PROJECT_ROOT + '/')) return p.slice(PROJECT_ROOT.length + 1);
  if (p.startsWith(SIM_INCLUDE + '/')) return '<library> ' + p.slice(SIM_INCLUDE.length + 1);
  return p;
}

export function parseDiagnostics(text: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  let current: Diagnostic | null = null;
  let included: string[] = [];
  for (const line of text.split('\n')) {
    const inc = INCLUDED_RE.exec(line);
    if (inc) {
      included.push(line.replace(inc[2], displayPath(inc[2])));
      continue;
    }
    const m = DIAG_RE.exec(line);
    const l = m ? null : LINK_RE.exec(line);
    if (m) {
      const sev = m[4] === 'fatal error' ? 'error' : (m[4] as Diagnostic['severity']);
      const shown = line.replace(m[1], displayPath(m[1]));
      if (sev === 'note' && current) {
        current.detail += '\n' + [...included, shown].join('\n');
        included = [];
        continue;
      }
      current = { severity: sev, file: displayPath(m[1]), line: +m[2], column: +m[3], message: m[5], detail: [...included, shown].join('\n') };
      included = [];
      out.push(current);
    } else if (l) {
      current = { severity: l[1] as 'error' | 'warning', file: null, line: 0, column: 0, message: l[2], detail: line };
      out.push(current);
    } else if (current && line.trim() && !SUMMARY_RE.test(line.trim())) {
      current.detail += '\n' + line;
    }
  }
  return out;
}
