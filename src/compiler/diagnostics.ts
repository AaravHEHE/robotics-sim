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

export function displayPath(p: string): string {
  if (p.startsWith(PROJECT_ROOT + '/')) return p.slice(PROJECT_ROOT.length + 1);
  if (p.startsWith(SIM_INCLUDE + '/')) return '<library> ' + p.slice(SIM_INCLUDE.length + 1);
  return p;
}

export function parseDiagnostics(text: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  let current: Diagnostic | null = null;
  for (const line of text.split('\n')) {
    const m = DIAG_RE.exec(line);
    const l = m ? null : LINK_RE.exec(line);
    if (m) {
      const sev = m[4] === 'fatal error' ? 'error' : (m[4] as Diagnostic['severity']);
      if (sev === 'note' && current) {
        current.detail += '\n' + line.replace(m[1], displayPath(m[1]));
        continue;
      }
      current = { severity: sev, file: displayPath(m[1]), line: +m[2], column: +m[3], message: m[5], detail: line.replace(m[1], displayPath(m[1])) };
      out.push(current);
    } else if (l) {
      current = { severity: l[1] as 'error' | 'warning', file: null, line: 0, column: 0, message: l[2], detail: line };
      out.push(current);
    } else if (current && line.trim() && !/^\d+ (errors?|warnings?)( and \d+ warnings?)? generated\.$/.test(line.trim())) {
      current.detail += '\n' + line;
    }
  }
  return out;
}
