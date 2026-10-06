// Field definitions (data-driven; see data/fields/ and schemas/field.schema.json).
// Coordinates: inches, origin at the field center, +x to the audience's right, +y toward
// the far (top) wall, headings in degrees (0 = +y, clockwise positive) — the same
// convention LemLib uses, and for game fields the same axes as the VEX GPS strip.

export type Vec2 = [number, number];
export type Alliance = 'red' | 'blue';

export interface FieldObject {
  id: string;
  /** Shape used for collisions (top-down). */
  shape: { type: 'box'; x: number; y: number; width: number; length: number; heading?: number } | { type: 'circle'; x: number; y: number; radius: number };
  height: number;
  color?: string;
  movable?: boolean;
}

/** A goal post that scoring objects stack on (Override: octagonal Goals). */
export interface GoalDef {
  id: string;
  kind: 'alliance' | 'neutral' | 'center';
  color: Alliance | 'neutral';
  x: number;
  y: number;
  /** Height of the goal top above the tiles. */
  height: number;
  /** Octagon across flats at the base / top. */
  baseWidth: number;
  topWidth: number;
  /** Height of the box-shaped lower body (0 = tapered all the way). */
  bodyHeight: number;
  /** Socket diameter in the top. */
  socket: number;
  zone: string;
  aprilTag?: number;
}

/** A Toggle-like rotating prism mounted on the perimeter. */
export interface ToggleDef {
  id: string;
  wall: 'left' | 'right' | 'top' | 'bottom';
  x: number;
  y: number;
  length: number;
  /** Equilateral cross-section height (apex to opposite face). */
  sectionHeight: number;
  /** Height of the prism's top above the tiles. */
  topHeight: number;
  zone: string;
  /** Face colors at the start: facing into the field, out of the field, and down on the mounts. */
  start: { in: string; out: string; down: string };
}

export interface LoaderDef {
  id: string;
  alliance: Alliance;
  x: number;
  y: number;
  wall: 'left' | 'right';
  width: number;
  depth: number;
  height: number;
  /** Height of the bottom opening robots take objects from. */
  opening: number;
}

export interface ZoneDef {
  id: string;
  kind: 'quadrant' | 'midfield' | 'loadZone';
  name: string;
  color: Alliance | 'neutral';
  /** Polygon, counter-clockwise, inches. */
  polygon: Vec2[];
}

export interface TapeDef {
  from: Vec2;
  to: Vec2;
  width: number;
  color: string;
}

/** A scoring object in a layout. Stacks are listed bottom to top. */
export type LayoutPiece =
  | { kind: 'pin'; colors: [string, string] }
  | { kind: 'cup'; up: 'gray' | 'clear' };

export type LayoutItem =
  /** Standing stack on the floor (bottom piece first). */
  | { type: 'stack'; x: number; y: number; pieces: LayoutPiece[] }
  /** A pin lying on its side; `heading` points from colors[0]'s end to colors[1]'s end. */
  | { type: 'lying'; x: number; y: number; heading: number; colors: [string, string] }
  /** Pieces stacked on a goal (bottom first). */
  | { type: 'goal'; goal: string; pieces: LayoutPiece[] };

export interface LayoutDef {
  name: string;
  items: LayoutItem[];
  /** Off-field Match Loads available through the loaders. */
  matchLoads?: Partial<Record<Alliance, LayoutPiece[]>>;
  /** Preload per robot alliance. */
  preload?: Partial<Record<Alliance, LayoutPiece>>;
}

export interface StartPosition {
  id: string;
  name: string;
  alliance: Alliance;
  zone: string;
  x: number;
  y: number;
  theta: number;
  /** Which layouts this start applies to (e.g. ["h2h"], ["skills"]). */
  layouts: string[];
}

export interface FieldDef {
  schema: 1;
  id: string;
  name: string;
  perimeter: {
    /** Inside wall-to-wall distance (square field). */
    inside: number;
    wallHeight: number;
    wallThickness: number;
  };
  tiles: { count: number; color: string; lineColor: string };
  objects: FieldObject[];
  goals?: GoalDef[];
  toggles?: ToggleDef[];
  loaders?: LoaderDef[];
  zones?: ZoneDef[];
  tape?: TapeDef[];
  /** Starting layouts by mode id (e.g. "h2h" = Head-to-Head, "skills" = Robot Skills). */
  layouts?: Record<string, LayoutDef>;
  startPositions?: StartPosition[];
  /** Game module providing scoring rules (null for an empty practice field). */
  game: null | { id: string };
  /**
   * How to color an official field CAD model loaded for this field, part by part: the first
   * rule whose `match` (a case-insensitive regex) finds "<assembly part>/<part>" in the
   * part's name wins. Cosmetic only.
   */
  cadLook?: CadLookRule[];
  sources?: string[];
}

export interface CadLookRule {
  match: string;
  /** CSS hex color. */
  color: string;
  /** 0-1: below 1 the part is see-through (polycarbonate). */
  opacity?: number;
  roughness?: number;
  metalness?: number;
}

export function validateField(f: unknown): string[] {
  const d = f as FieldDef;
  const e: string[] = [];
  if (!d || typeof d !== 'object') return ['Field must be a JSON object.'];
  if (d.schema !== 1) e.push('schema must be 1.');
  if (!d.perimeter || !(d.perimeter.inside > 24) || !(d.perimeter.wallHeight > 0) || !(d.perimeter.wallThickness > 0)) {
    e.push('perimeter.inside / wallHeight / wallThickness must be positive inches.');
  }
  if (!d.tiles || !(d.tiles.count >= 1)) e.push('tiles.count must be >= 1.');
  if (!Array.isArray(d.objects)) e.push('objects must be a list.');
  const half = (d.perimeter?.inside ?? 0) / 2;
  const inField = (x: number, y: number) => Math.abs(x) <= half && Math.abs(y) <= half;
  const goalIds = new Set<string>();
  for (const g of d.goals ?? []) {
    if (!inField(g.x, g.y)) e.push(`goal ${g.id} is outside the field.`);
    if (!(g.height > 0)) e.push(`goal ${g.id} needs a positive height.`);
    goalIds.add(g.id);
  }
  const zoneIds = new Set((d.zones ?? []).map((z) => z.id));
  for (const g of d.goals ?? []) if (zoneIds.size && !zoneIds.has(g.zone)) e.push(`goal ${g.id} refers to unknown zone ${g.zone}.`);
  for (const [id, layout] of Object.entries(d.layouts ?? {})) {
    for (const it of layout.items) {
      if (it.type === 'goal' && !goalIds.has(it.goal)) e.push(`layout ${id}: unknown goal ${it.goal}.`);
      if (it.type !== 'goal' && !inField(it.x, it.y)) e.push(`layout ${id}: object at (${it.x}, ${it.y}) is outside the field.`);
    }
  }
  return e;
}

/** Point-in-polygon (even-odd). */
export function inPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The zone of a given kind containing a point, if any. */
export function zoneAt(field: FieldDef, x: number, y: number, kind: ZoneDef['kind']): ZoneDef | undefined {
  return (field.zones ?? []).find((z) => z.kind === kind && inPolygon([x, y], z.polygon));
}
