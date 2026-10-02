// Field definitions (data-driven; see data/fields/ and schemas/field.schema.json).
// Coordinates: inches, origin at the field center, +y away from the red driver
// station side of the generic field, headings in degrees (0 = +y, clockwise positive),
// the same convention LemLib uses.

export interface FieldObject {
  id: string;
  /** Shape used for collisions (top-down). */
  shape: { type: 'box'; x: number; y: number; width: number; length: number; heading?: number } | { type: 'circle'; x: number; y: number; radius: number };
  height: number;
  color?: string;
  movable?: boolean;
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
  /** Reserved for game modules (scoring, game objects, start tiles). */
  game: null | { id: string };
  sources?: string[];
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
  return e;
}
