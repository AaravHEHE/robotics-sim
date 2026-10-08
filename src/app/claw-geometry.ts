// How wide a held stack is at a given height, for drawing jaws that close on it. Radii are
// from the same profiles the pieces are drawn with (override-meshes.ts): a Pin is a thin end,
// a cone widening to the collar, then the mirror image; a Cup is an hourglass, its rims wide
// and its waist narrow.

import { CUP, layoutStack, PIN, type Piece } from '../games/override/elements.ts';

/** Radius (in) of a piece `h` in above its bottom, or 0 outside it. */
export function pieceRadiusAt(p: Piece, h: number): number {
  if (p.kind === 'pin') {
    if (h < 0 || h > PIN.length) return 0;
    const x = h > PIN.length / 2 ? PIN.length - h : h; // the two halves are mirror images
    const end = PIN.endDiameter / 2;
    const cone = PIN.coneDiameter / 2;
    if (x <= PIN.endStraight) return end;
    if (x < PIN.half) return end + ((cone - end) * (x - PIN.endStraight)) / (PIN.half - PIN.endStraight);
    return PIN.collarDiameter / 2;
  }
  if (h < 0 || h > CUP.height) return 0;
  const x = h > CUP.height / 2 ? CUP.height - h : h;
  const rim = CUP.rimDiameter / 2;
  const waist = CUP.waistDiameter / 2;
  return rim + ((waist - rim) * x) / (CUP.height / 2);
}

/** Radius of a claw with nothing in it can close to (in). */
export const EMPTY_CLOSE = 0.55;

/**
 * The widest the stack is within `half` in of the height `z` above its bottom (a jaw has
 * some height: it touches the widest part it spans), or `EMPTY_CLOSE` when there is none.
 */
export function stackRadiusAt(pieces: Piece[], z: number, half = 0.8): number {
  if (!pieces.length) return EMPTY_CLOSE;
  let r = 0;
  const slots = layoutStack(pieces, 0, false);
  for (const s of slots) {
    for (let k = 0; k <= 8; k++) {
      const zz = z - half + (2 * half * k) / 8;
      r = Math.max(r, pieceRadiusAt(s.piece, zz - s.bottom));
    }
  }
  return Math.max(EMPTY_CLOSE, r);
}

type V2 = [number, number];

/** Rotate a point counterclockwise by `a` radians. */
export const rot2 = ([x, y]: V2, a: number): V2 => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

/**
 * A jaw swings about a vertical hinge. Drawn open (angle 0), its pad (the centre of a concave
 * rubber arc, or of a roller) is at `pad`; it closes by turning counterclockwise (the right
 * jaw; the left is its mirror image). Everything is in the claw's frame: x to the right, y
 * ahead, the held stack's axis at the origin.
 */
export interface JawDef {
  hinge: V2;
  pad: V2;
  /** Radius of the arc the piece sits inside (`outer` false) or of the roller that presses it. */
  padR: number;
  outer: boolean;
  /** Angles (rad) when open and when closed on nothing. */
  open: number;
  maxClose: number;
}

/** Where the pad is when the jaw is turned `a` rad from open. */
export function padAt(j: JawDef, a: number): V2 {
  const [dx, dy] = rot2([j.pad[0] - j.hinge[0], j.pad[1] - j.hinge[1]], a);
  return [j.hinge[0] + dx, j.hinge[1] + dy];
}

/** The angle at which the jaw first touches a piece of radius `r` standing at the origin. */
export function jawContact(j: JawDef, r: number): number {
  const target = j.outer ? j.padR + r : j.padR - r;
  for (let a = j.open; a <= j.maxClose; a += 0.005) {
    const [x, y] = padAt(j, a);
    if (Math.hypot(x, y) <= target) return a;
  }
  return j.maxClose;
}
