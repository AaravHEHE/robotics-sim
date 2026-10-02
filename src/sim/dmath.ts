// Deterministic trigonometry for the simulator.
//
// JS engines may implement Math.sin/cos/atan2 differently (we measured last-bit
// differences between V8 versions), which would make the same route replay slightly
// differently on different machines. These are ports of FreeBSD/fdlibm algorithms
// using only + - * / and Math.sqrt / Math.round / Math.abs, which IEEE 754 and
// ECMAScript specify exactly, so results are bit-identical everywhere.
// All simulation code must use these instead of Math.sin / cos / tan / atan / atan2 / hypot.

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

function kSin(x: number, y: number, iy: number): number {
  const z = x * x;
  const w = z * z;
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
  const v = z * x;
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

function kCos(x: number, y: number): number {
  const z = x * x;
  const w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z;
  const ww = 1 - hz;
  return ww + (((1 - ww) - hz) + (z * r - x * y));
}

const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const TWO_PI = 6.283185307179586;

/** Reduce x to y0 + y1 in [-pi/4, pi/4] and return the quadrant n. */
function reduce(x: number, out: [number, number]): number {
  if (Math.abs(x) <= 0.7853981633974483) {
    out[0] = x;
    out[1] = 0;
    return 0;
  }
  if (Math.abs(x) > 1e6) x = x % TWO_PI; // exact in IEEE; huge angles are never physical anyway
  const fn = Math.round(x * INV_PIO2);
  let r = x - fn * PIO2_1;
  let w = fn * PIO2_1T;
  let y0 = r - w;
  // second Cody-Waite step for extra precision near multiples of pi/2
  const t = r;
  w = fn * PIO2_2;
  r = t - w;
  w = fn * PIO2_2T - ((t - r) - w);
  y0 = r - w;
  out[0] = y0;
  out[1] = (r - y0) - w;
  return fn & 3;
}

const tmp: [number, number] = [0, 0];

export function dsin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const n = reduce(x, tmp);
  switch (n) {
    case 0: return kSin(tmp[0], tmp[1], 1);
    case 1: return kCos(tmp[0], tmp[1]);
    case 2: return -kSin(tmp[0], tmp[1], 1);
    default: return -kCos(tmp[0], tmp[1]);
  }
}

export function dcos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const n = reduce(x, tmp);
  switch (n) {
    case 0: return kCos(tmp[0], tmp[1]);
    case 1: return -kSin(tmp[0], tmp[1], 1);
    case 2: return -kCos(tmp[0], tmp[1]);
    default: return kSin(tmp[0], tmp[1], 1);
  }
}

const ATANHI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.11111104054623557880e-1,
  9.09088713343650656196e-2, -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2,
  4.97687799461593236017e-2, -3.65315727442169155270e-2, 1.62858201153657823623e-2,
];

export function datan(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const sign = x < 0 ? -1 : 1;
  let ax = Math.abs(x);
  if (ax >= 7.378697629483821e19) return sign * (ATANHI[3] + ATANLO[3]);
  let id: number;
  if (ax < 0.4375) {
    if (ax < 7.450580596923828e-9) return x;
    id = -1;
  } else if (ax < 1.1875) {
    if (ax < 0.6875) {
      id = 0;
      ax = (2 * ax - 1) / (2 + ax);
    } else {
      id = 1;
      ax = (ax - 1) / (ax + 1);
    }
  } else if (ax < 2.4375) {
    id = 2;
    ax = (ax - 1.5) / (1 + 1.5 * ax);
  } else {
    id = 3;
    ax = -1 / ax;
  }
  const z = ax * ax;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return sign * (ax - ax * (s1 + s2));
  const r = ATANHI[id] - ((ax * (s1 + s2) - ATANLO[id]) - ax);
  return sign * r;
}

const PI = 3.1415926535897931160;
const PI_LO = 1.2246467991473531772e-16;

export function datan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 1) return datan(y);
  if (y === 0) return x >= 0 ? y : (Object.is(y, -0) ? -PI : PI);
  if (x === 0) return y > 0 ? PI / 2 : -PI / 2;
  const z = datan(Math.abs(y / x));
  if (x > 0) return y > 0 ? z : -z;
  return y > 0 ? PI - (z - PI_LO) : (z - PI_LO) - PI;
}

export const dhypot = (x: number, y: number): number => Math.sqrt(x * x + y * y);

export const DEG = 180 / PI;
export const RAD = PI / 180;
export const dsinDeg = (d: number) => dsin(d * RAD);
export const dcosDeg = (d: number) => dcos(d * RAD);

/** Wrap an angle in degrees to (-180, 180]. */
export function wrap180(a: number): number {
  let r = a % 360;
  if (r > 180) r -= 360;
  else if (r <= -180) r += 360;
  return r;
}
