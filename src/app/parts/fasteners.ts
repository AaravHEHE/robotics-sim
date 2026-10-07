// Putting VEX parts together the way a team builds: every part sits against what holds it,
// screws go through what they clamp into a nut, shafts run through bearings with spacers
// filling every gap and a collar at each end. Works in whatever frame `parent` is in (a
// robot frame: x right, y forward, z up). Each part is tagged `userData.part` (its id) so
// tests can check that nothing floats.

import * as THREE from 'three';
import { partSize, SCREW_HEAD, type PartDef } from './assembly.ts';
import { partDef } from './catalog.ts';
import { centeredPart } from './geometry.ts';
import { shared } from '../override-meshes.ts';

type V = THREE.Vector3;
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Aluminum wall thickness (in). */
export const WALL = 0.063;
/** Screw lengths VEX sells (in under the head). */
const SCREWS: Array<[number, string]> = [
  [0.25, 'screw-0_25'],
  [0.375, 'screw-0_375'],
  [0.5, 'screw'],
  [0.625, 'screw-0_625'],
  [0.75, 'screw-0_75'],
  [1, 'screw-1'],
  [1.25, 'screw-1_25'],
  [1.5, 'screw-1_5'],
  [2, 'screw-2'],
];
/** Spacers to fill a gap on a shaft with, thickest first (in, part id). */
const SPACERS: Array<[number, string]> = [
  [0.5, 'spacer-0.5'],
  [0.375, 'spacer-0.375'],
  [0.25, 'spacer-0.25'],
  [0.125, 'spacer-0.125'],
  [0.064, 'spacer-thin-064'],
  [0.032, 'spacer-thin-032'],
];

/** Any direction at right angles to `d`. */
function perpendicular(d: V): V {
  const a = Math.abs(d.x) < 0.9 ? V3(1, 0, 0) : V3(0, 1, 0);
  return a.sub(d.clone().multiplyScalar(a.dot(d))).normalize();
}

const cableMat = new Map<number, THREE.Material>();
function flexMat(color: number): THREE.Material {
  let m = cableMat.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05 });
    shared.add(m);
    cableMat.set(color, m);
  }
  return m;
}

export class Kit {
  readonly parent: THREE.Object3D;
  constructor(parent: THREE.Object3D) {
    this.parent = parent;
  }

  /** A catalog part, centred at `center`, its length along `xDir` and width along `yDir`. */
  part(id: string, center: V, xDir: V, yDir: V, opts: { length?: number; cartridge?: string } = {}, label = id): THREE.Object3D {
    const o = centeredPart(partDef(id), opts, center, xDir, yDir);
    o.userData.part = label;
    this.parent.add(o);
    return o;
  }

  /** A part's box size (in) for its options. */
  size(id: string, opts: { length?: number } = {}): [number, number, number] {
    return partSize(partDef(id), opts);
  }

  /**
   * A screw whose head sits on a surface at `face`, its shank going along `dir` through
   * `grip` inches of material; with a nut on the far side (`nut` null: into a tapped part,
   * such as a motor or standoff, `bite` deep).
   */
  screw(face: V, dir: V, grip: number, nut: 'nut' | 'nut-nylock' | null = 'nut', bite = 0.25): void {
    const d = dir.clone().normalize();
    const nutDef = nut ? partDef(nut) : null;
    const need = grip + (nutDef ? (nutDef.width ?? 0.14) + 0.03 : bite);
    const [shank, id] = SCREWS.find(([len]) => len >= need - 1e-6) ?? SCREWS[SCREWS.length - 1];
    const across = perpendicular(d);
    const total = SCREW_HEAD + shank;
    this.part(id, face.clone().add(d.clone().multiplyScalar(total / 2 - SCREW_HEAD)), d, across);
    if (nutDef) {
      const w = nutDef.width ?? 0.14;
      this.part(nut!, face.clone().add(d.clone().multiplyScalar(grip + w / 2)), d, across);
    }
  }

  /** A hex standoff from a to b (fractional lengths: cut to fit), screwed at each end. */
  standoff(a: V, b: V, screws = true, nylon = false): void {
    const d = b.clone().sub(a);
    const len = d.length();
    if (len < 0.05) return;
    d.normalize();
    const x = perpendicular(d);
    const y = d.clone().cross(x); // x × y = d: the standoff's length (its z) along d
    this.part(nylon ? 'standoff-nylon' : 'standoff', a.clone().add(b).multiplyScalar(0.5), x, y, { length: len / 0.5 });
    if (!screws) return;
    // a screw into each end, from the far side of what the standoff is fastened to
    this.screw(a.clone().sub(d.clone().multiplyScalar(WALL)), d, WALL, null, 0.2);
    this.screw(b.clone().add(d.clone().multiplyScalar(WALL)), d.clone().negate(), WALL, null, 0.2);
  }

  /** Spacers filling `gap` along a shaft from `from` going `dir`; returns where they end. */
  spacers(from: V, dir: V, gap: number): V {
    const d = dir.clone().normalize();
    const across = perpendicular(d);
    const at = from.clone();
    let left = gap;
    for (const [w, id] of SPACERS) {
      while (left >= w - 0.008) {
        this.part(id, at.clone().add(d.clone().multiplyScalar(w / 2)), d, across);
        at.add(d.clone().multiplyScalar(w));
        left -= w;
      }
    }
    return at;
  }

  /** A shaft collar against a face at `face`, on the side `dir` points to. */
  collar(face: V, dir: V, id = 'collar'): void {
    const d = dir.clone().normalize();
    const w = partDef(id).width ?? 0.3;
    this.part(id, face.clone().add(d.clone().multiplyScalar(w / 2)), d, perpendicular(d));
  }

  /** A bearing flat flat on a face at `face` (boss toward `out`), its length along `along`. */
  bearing(face: V, out: V, along: V): void {
    const o = out.clone().normalize();
    const [, , t] = partSize(partDef('bearing-flat'), { length: 3 });
    // its local z is its thickness: x along, y across, z = x × y = out
    const y = o.clone().cross(along).normalize();
    this.part('bearing-flat', face.clone().add(o.clone().multiplyScalar(t / 2)), along, y, { length: 3 });
    // held by two screws through its end holes (the rivets show on the boss side)
  }

  /**
   * A shaft from `a` to `b` through supports, each support a plane (point, outward normal
   * along the shaft): hubs (wheels, gears, sprockets) at given points along it, spacers filling
   * every gap between what is on the shaft, and a collar at each free end.
   */
  shaft(a: V, b: V, opts: { hs?: boolean } = {}): void {
    const d = b.clone().sub(a);
    const len = d.length();
    d.normalize();
    this.part(opts.hs ? 'shaft-hs' : 'shaft', a.clone().add(b).multiplyScalar(0.5), d, perpendicular(d), { length: len / 0.5 });
  }

  /** A bent gusset joining two faces at a right angle. */
  gusset(corner: V, legA: V, legB: V, id = 'gusset-angle'): void {
    const def: PartDef = partDef(id);
    const [len, a, b] = partSize(def, { length: def.length });
    const A = legA.clone().normalize();
    const B = legB.clone().normalize();
    const along = A.clone().cross(B).normalize();
    // its corner (local y = 0, z = 0) at `corner`, leg y along A, leg z along B
    const center = corner.clone().add(A.clone().multiplyScalar(a / 2)).add(B.clone().multiplyScalar(b / 2));
    this.part(id, center, along, A, { length: def.length });
    void len;
  }

  /**
   * A flexible run (a V5 Smart Cable, or pneumatic tubing) through points, with a zip tie
   * every ~4 in. Tagged so it counts as touching what it plugs into.
   */
  cable(points: V[], kind: 'cable' | 'tubing' = 'cable'): void {
    if (points.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
    const r = kind === 'cable' ? 0.07 : 0.08;
    const len = curve.getLength();
    const geo = new THREE.TubeGeometry(curve, Math.max(8, Math.round(len * 3)), r, 6, false);
    const mesh = new THREE.Mesh(geo, flexMat(kind === 'cable' ? 0x26282c : 0x2f81f7));
    mesh.castShadow = true;
    mesh.userData.part = kind;
    this.parent.add(mesh);
    // the plug at each end of a Smart Cable
    if (kind === 'cable') {
      for (const [p, t] of [[points[0], curve.getTangent(0)], [points[points.length - 1], curve.getTangent(1)]] as const) {
        const plug = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.22), flexMat(0x18191c));
        plug.position.copy(p);
        plug.quaternion.setFromUnitVectors(V3(0, 1, 0), t.clone().normalize());
        plug.userData.part = 'plug';
        this.parent.add(plug);
      }
    }
    for (let s = 4; s < len - 2; s += 4) {
      const t = s / len;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const tie = new THREE.Mesh(new THREE.TorusGeometry(r + 0.03, 0.025, 4, 10), flexMat(0x111214));
      tie.position.copy(p);
      tie.quaternion.setFromUnitVectors(V3(0, 0, 1), tan);
      tie.userData.part = 'zip-tie';
      this.parent.add(tie);
    }
  }

  /** A zip tie strapped around a box (center, its half sizes along two axes) on the `axis` plane. */
  strap(center: V, u: V, halfU: number, w: V, halfW: number): void {
    const n = u.clone().cross(w).normalize();
    const t = 0.05;
    const k = 0.15;
    const sides: Array<[V, V, number, number]> = [
      [center.clone().add(w.clone().multiplyScalar(halfW + t / 2)), u, 2 * halfU + 2 * t, t],
      [center.clone().sub(w.clone().multiplyScalar(halfW + t / 2)), u, 2 * halfU + 2 * t, t],
      [center.clone().add(u.clone().multiplyScalar(halfU + t / 2)), w, 2 * halfW + 2 * t, t],
      [center.clone().sub(u.clone().multiplyScalar(halfU + t / 2)), w, 2 * halfW + 2 * t, t],
    ];
    for (const [c, along, len] of sides) {
      const across = along === u ? w : u;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(len, t, k), flexMat(0x141517));
      strip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(along.clone().normalize(), across.clone().normalize(), n));
      strip.position.copy(c);
      strip.userData.part = 'zip-tie';
      this.parent.add(strip);
    }
  }
}
