// Split a big STEP assembly into several smaller STEP files, each holding the full assembly
// structure but the solid geometry of only some of its parts. The in-browser STEP reader
// (occt-import-js) has a 2 GB memory ceiling: a whole competition field (130+ MB of STEP)
// doesn't fit, and it then silently returns parts without triangles. Read chunk by chunk,
// each in a fresh reader, the field fits.

/** Entity types that hold a part's solid or surface geometry. */
const SOLIDS = new Set(['MANIFOLD_SOLID_BREP', 'BREP_WITH_VOIDS', 'SHELL_BASED_SURFACE_MODEL', 'FACETED_BREP']);
/** Entities that only decorate geometry: dropped along with the geometry they point at. */
const DECORATIONS = new Set(['STYLED_ITEM', 'OVER_RIDING_STYLED_ITEM', 'PRESENTATION_LAYER_ASSIGNMENT', 'INVISIBILITY']);

interface Model {
  text: string;
  header: string;
  /** Per entity: [start, end) of its text (without the trailing ';'), id and type. */
  start: Int32Array;
  end: Int32Array;
  id: Int32Array;
  type: string[];
  /** Referenced entity indexes, flattened: refs of entity i are refs[refStart[i] .. refStart[i + 1]). */
  refStart: Int32Array;
  refs: Int32Array;
}

/** Parse the DATA section into entities and their references. */
function parse(text: string): Model {
  const data = text.indexOf('DATA;');
  const endData = text.lastIndexOf('ENDSEC;');
  if (data < 0 || endData < data) throw new Error('This is not a STEP file (no DATA section).');
  const header = text.slice(0, data + 5);
  const starts: number[] = [];
  const ends: number[] = [];
  let i = data + 5;
  let s = -1;
  let inStr = false;
  for (; i < endData; i++) {
    const c = text.charCodeAt(i);
    if (inStr) {
      if (c === 39) {
        if (text.charCodeAt(i + 1) === 39) i++; // '' inside a string
        else inStr = false;
      }
      continue;
    }
    if (c === 39) inStr = true;
    else if (c === 35 && s < 0) s = i; // '#' starts an entity
    else if (c === 59 && s >= 0) {
      starts.push(s);
      ends.push(i);
      s = -1;
    }
  }
  const n = starts.length;
  const id = new Int32Array(n);
  const type: string[] = new Array(n);
  const rawRefs: number[][] = new Array(n);
  for (let k = 0; k < n; k++) {
    const body = text.slice(starts[k], ends[k]);
    const m = /^#(\d+)\s*=\s*([A-Z0-9_]*)/.exec(body);
    id[k] = m ? Number(m[1]) : -1;
    type[k] = m && m[2] ? m[2] : 'COMPLEX';
    const eq = body.indexOf('=');
    const args = body.slice(eq + 1).replace(/'(?:[^']|'')*'/g, "''");
    const r: number[] = [];
    for (const mm of args.matchAll(/#(\d+)/g)) r.push(Number(mm[1]));
    rawRefs[k] = r;
  }
  const index = new Map<number, number>();
  for (let k = 0; k < n; k++) index.set(id[k], k);
  const refStart = new Int32Array(n + 1);
  let total = 0;
  for (let k = 0; k < n; k++) {
    refStart[k] = total;
    total += rawRefs[k].length;
  }
  refStart[n] = total;
  const refs = new Int32Array(total);
  for (let k = 0, p = 0; k < n; k++) for (const r of rawRefs[k]) refs[p++] = index.get(r) ?? -1;
  return { text, header, start: Int32Array.from(starts), end: Int32Array.from(ends), id, type, refStart, refs };
}

/** Mark everything reachable from `roots` (forward references) with `mark`, not entering `stop` entities. */
function closure(m: Model, roots: number[], marks: Uint8Array, mark: number, stop?: (k: number) => boolean): number {
  const stack = [...roots];
  let count = 0;
  while (stack.length) {
    const k = stack.pop()!;
    if (k < 0 || marks[k] & mark || (stop && stop(k))) continue;
    marks[k] |= mark;
    count++;
    for (let p = m.refStart[k]; p < m.refStart[k + 1]; p++) stack.push(m.refs[p]);
  }
  return count;
}

/** How many entities are reachable from `root`; marks them with generation `gen` in `stamp`. */
function countReachable(m: Model, root: number, stamp: Uint32Array, gen: number): number {
  const stack = [root];
  let count = 0;
  while (stack.length) {
    const k = stack.pop()!;
    if (k < 0 || stamp[k] === gen) continue;
    stamp[k] = gen;
    count++;
    for (let p = m.refStart[k]; p < m.refStart[k + 1]; p++) stack.push(m.refs[p]);
  }
  return count;
}

/**
 * Split into chunks of about `maxEntities` geometry entities each. A STEP small enough to
 * read in one go comes back whole.
 */
export function splitStep(text: string, maxEntities = 250_000): string[] {
  const m = parse(text);
  const n = m.id.length;
  const solids: Array<{ k: number; size: number }> = [];
  // each solid's size: a visit stamp per solid instead of clearing a mark array every time
  const stamp = new Uint32Array(n);
  let gen = 0;
  for (let k = 0; k < n; k++) {
    if (!SOLIDS.has(m.type[k])) continue;
    solids.push({ k, size: countReachable(m, k, stamp, ++gen) });
  }
  const geometry = solids.reduce((a, b) => a + b.size, 0);
  const count = Math.max(1, Math.ceil(geometry / maxEntities));
  if (count === 1) return [text];
  // balance: biggest parts first, each into the lightest chunk
  const groups = Array.from({ length: count }, () => ({ size: 0, solids: [] as number[] }));
  for (const s of [...solids].sort((a, b) => b.size - a.size)) {
    const g = groups.reduce((a, b) => (b.size < a.size ? b : a));
    g.solids.push(s.k);
    g.size += s.size;
  }
  const allGeometry = new Uint8Array(n);
  closure(m, solids.map((s) => s.k), allGeometry, 1);
  // geometry also used by the rest of the file (e.g. a point of a part that a placement in the
  // assembly uses too) stays in every chunk: reach it from everything else, without going
  // into the solids themselves
  const roots: number[] = [];
  for (let k = 0; k < n; k++) if (!allGeometry[k] && !DECORATIONS.has(m.type[k])) roots.push(k);
  const shared = new Uint8Array(n);
  closure(m, roots, shared, 1, (k) => SOLIDS.has(m.type[k]));
  for (let k = 0; k < n; k++) if (shared[k]) allGeometry[k] = 0;
  const inverse = inverseRefs(m);
  return groups.filter((g) => g.solids.length).map((g) => chunkText(m, g.solids, allGeometry, inverse));
}

function inverseRefs(m: Model): { start: Int32Array; refs: Int32Array } {
  const n = m.id.length;
  const counts = new Int32Array(n + 1);
  for (let p = 0; p < m.refs.length; p++) if (m.refs[p] >= 0) counts[m.refs[p] + 1]++;
  for (let k = 0; k < n; k++) counts[k + 1] += counts[k];
  const refs = new Int32Array(counts[n]);
  const fill = counts.slice();
  for (let k = 0; k < n; k++) for (let p = m.refStart[k]; p < m.refStart[k + 1]; p++) if (m.refs[p] >= 0) refs[fill[m.refs[p]]++] = k;
  return { start: counts, refs };
}

function chunkText(m: Model, keepSolids: number[], allGeometry: Uint8Array, inverse: { start: Int32Array; refs: Int32Array }): string {
  const n = m.id.length;
  const marks = new Uint8Array(n);
  closure(m, keepSolids, marks, 1);
  // deleted: geometry of the other parts (not shared with this chunk's parts)
  const deleted = new Uint8Array(n);
  const queue: number[] = [];
  for (let k = 0; k < n; k++) if (allGeometry[k] && !marks[k]) deleted[k] = 1;
  // whatever points at deleted geometry: decorations go too; lists drop the reference
  for (let k = 0; k < n; k++) if (deleted[k]) queue.push(k);
  const rewrite = new Set<number>();
  while (queue.length) {
    const d = queue.pop()!;
    for (let p = inverse.start[d]; p < inverse.start[d + 1]; p++) {
      const k = inverse.refs[p];
      if (deleted[k]) continue;
      if (DECORATIONS.has(m.type[k]) || !refInList(m, k, m.id[d])) {
        deleted[k] = 1;
        rewrite.delete(k);
        queue.push(k);
      } else rewrite.add(k);
    }
  }
  const out: string[] = [m.header, '\n'];
  for (let k = 0; k < n; k++) {
    if (deleted[k]) continue;
    let body = m.text.slice(m.start[k], m.end[k]);
    if (rewrite.has(k)) {
      body = dropRefs(body, m, k, deleted);
      // a presentation of nothing (all its styled geometry is in other chunks) goes too
      if (/PRESENTATION/.test(m.type[k]) && /\(\s*''\s*,\s*\(\s*\)/.test(body.replace(/'(?:[^']|'')*'/, "''"))) continue;
    }
    out.push(body, ';\n');
  }
  out.push('ENDSEC;\nEND-ISO-10303-21;\n');
  return out.join('');
}

/** Is reference #ref inside a list (nested parentheses) of entity k's arguments? */
function refInList(m: Model, k: number, ref: number): boolean {
  if (m.type[k] === 'COMPLEX') return false;
  const body = m.text.slice(m.start[k], m.end[k]).replace(/'(?:[^']|'')*'/g, "''");
  const re = new RegExp(`#${ref}(?!\\d)`, 'g');
  for (const mm of body.matchAll(re)) {
    let depth = 0;
    for (let i = 0; i < mm.index!; i++) {
      const c = body[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    if (depth < 2) return false; // a plain argument, not a list item
  }
  return true;
}

/** Remove references to deleted entities from entity k's lists. */
function dropRefs(body: string, m: Model, k: number, deleted: Uint8Array): string {
  for (let p = m.refStart[k]; p < m.refStart[k + 1]; p++) {
    const r = m.refs[p];
    if (r < 0 || !deleted[r]) continue;
    body = body.replace(new RegExp(`#${m.id[r]}(?!\\d)`, 'g'), '');
  }
  return body.replace(/\(\s*,/g, '(').replace(/,\s*(?=,)/g, '').replace(/,\s*\)/g, ')');
}
