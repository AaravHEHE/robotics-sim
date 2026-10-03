// V5RC Override scoring objects: geometry (manual v2.0 Appendix A, see
// docs/override-field-spec.md) and the stack model shared by the simulator, the
// scoring engine and the 3D viewer. Units: inches.

const MM = 1 / 25.4;

export const PIN = {
  length: 165 * MM,
  /** From an end to the collar. */
  half: 74.5 * MM,
  collar: 16 * MM,
  collarDiameter: 80.3 * MM,
  endDiameter: 35.6 * MM,
  coneDiameter: 59.6 * MM,
  endStraight: 16.187 * MM,
};

export const CUP = {
  height: 164.5 * MM,
  rimDiameter: 80.2 * MM,
  waistDiameter: 59 * MM,
};

export type PinColor = 'red' | 'blue' | 'yellow';
export type CupHalf = 'gray' | 'clear';

/** A pin standing in a stack: halves listed bottom then top. */
export interface PinPiece {
  kind: 'pin';
  id: string;
  colors: [PinColor, PinColor];
}

/** A cup standing in a stack: which half is on top. */
export interface CupPiece {
  kind: 'cup';
  id: string;
  up: CupHalf;
}

export type Piece = PinPiece | CupPiece;

export const otherHalf = (h: CupHalf): CupHalf => (h === 'gray' ? 'clear' : 'gray');

/** Vertical extent of each piece in a stack (bottom-first), given its base height. */
export interface StackSlot {
  piece: Piece;
  bottom: number;
  top: number;
}

/**
 * Lay out a stack. `onGoal`: the base is a goal top (the first pin's lower half drops
 * into the socket and its collar rests on the goal). Otherwise the base is the floor.
 * Nesting: a pin half slides into a cup half until the pin's collar meets the rim.
 */
export function layoutStack(pieces: Piece[], baseHeight: number, onGoal: boolean): StackSlot[] {
  const out: StackSlot[] = [];
  let surface = baseHeight; // where the next piece rests
  let prev: Piece | null = null;
  for (const p of pieces) {
    let bottom: number;
    if (p.kind === 'pin') {
      // a pin inserted into a goal socket or a cup: its lower half is below the surface
      const nested = (prev === null && onGoal) || prev?.kind === 'cup';
      bottom = nested ? surface - PIN.half : surface;
      const top = bottom + PIN.length;
      out.push({ piece: p, bottom, top });
      surface = bottom + PIN.half + PIN.collar; // collar top: next cup's rim rests here
    } else {
      // a cup over a pin rests its rim on the collar; on the floor it stands on its rim
      bottom = surface;
      const top = bottom + CUP.height;
      out.push({ piece: p, bottom, top });
      surface = top;
    }
    prev = p;
  }
  return out;
}

/** Height of the top of a stack (0 if empty). */
export function stackTop(pieces: Piece[], baseHeight: number, onGoal: boolean): number {
  const s = layoutStack(pieces, baseHeight, onGoal);
  return s.length ? s[s.length - 1].top : baseHeight;
}
