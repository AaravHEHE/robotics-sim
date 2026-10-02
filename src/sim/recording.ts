// What a simulation run produces: a timeline the viewer replays.

export interface SimEvent {
  t: number;
  level: 'info' | 'warning' | 'error';
  message: string;
}

export interface MotionMarker {
  t0: number;
  t1: number | null;
  label: string;
  /** Field-frame target, if the motion has one. */
  target: { x: number; y: number; theta?: number } | null;
  /** Field-frame path for follow(). */
  path?: Array<{ x: number; y: number }>;
}

export interface Recording {
  frameEveryMs: number;
  /** Per frame: t, x, y, theta, vL, vR, then one value per mechanism. */
  stride: number;
  frames: Float64Array;
  mechanisms: string[];
  /** Simulated time (ms since program start) when autonomous() began. */
  autonStart: number | null;
  /** When autonomous() returned, if it did before the stop time. */
  autonEnd: number | null;
  /** When the run ended (auto-stop, error, or everything finished). */
  stop: number;
  console: Array<{ t: number; text: string }>;
  lcd: Array<{ t: number; line: number; text: string }>;
  events: SimEvent[];
  motions: MotionMarker[];
  error: string | null;
  wallMs: number;
}

export function frameAt(rec: Recording, t: number): number {
  // frames are evenly spaced from t=0
  const i = Math.round(t / rec.frameEveryMs);
  const n = rec.frames.length / rec.stride;
  return Math.max(0, Math.min(n - 1, i));
}
