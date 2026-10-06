// Three.js meshes for VEX parts, built from their dimensions. Each part is built in its own
// frame (x along its length, y across, z up, corner at the origin) and placed with
// `placement()`; geometry and materials are shared between identical parts.

import * as THREE from 'three';
import { partSize, placement, rotation, type PartDef, type Placed } from './assembly.ts';

const cache = new Map<string, THREE.Object3D>();

let holeTex: THREE.Texture | null = null;
/** Aluminum with a square hole every 0.5 in (the texture repeats once per hole). */
function holes(): THREE.Texture {
  if (holeTex) return holeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c9cdd2';
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#2a2d31';
  g.fillRect(10, 10, 12, 12); // 0.182 in square hole in a 0.5 in pitch
  holeTex = new THREE.CanvasTexture(c);
  holeTex.colorSpace = THREE.SRGBColorSpace;
  holeTex.wrapS = holeTex.wrapT = THREE.RepeatWrapping;
  holeTex.magFilter = THREE.NearestFilter;
  return holeTex;
}

const mats = new Map<string, THREE.Material>();
const mat = (key: string, make: () => THREE.Material) => mats.get(key) ?? (mats.set(key, make()), mats.get(key)!);
const plain = (color: string, metal = 0, rough = 0.6) => mat(`${color}:${metal}:${rough}`, () => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough }));
const drilled = (along: number, across: number) =>
  mat(`holes:${along}:${across}`, () => {
    const t = holes().clone();
    t.needsUpdate = true;
    t.repeat.set(along, across);
    return new THREE.MeshStandardMaterial({ map: t, metalness: 0.6, roughness: 0.4 });
  });

/** A box from its corner (in), with the given material. */
function slab(w: number, d: number, h: number, m: THREE.Material, at: [number, number, number] = [0, 0, 0]): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, d, h);
  g.translate(at[0] + w / 2, at[1] + d / 2, at[2] + h / 2);
  return new THREE.Mesh(g, m);
}

/** A cylinder along x from 0 to `len`, centered on (y, z) = (r0, r0). */
function rod(radius: number, len: number, m: THREE.Material, segments = 24, center = radius): THREE.Mesh {
  const g = new THREE.CylinderGeometry(radius, radius, len, segments);
  g.rotateZ(Math.PI / 2);
  g.translate(len / 2, center, center);
  return new THREE.Mesh(g, m);
}

function build(def: PartDef, p: Placed): THREE.Object3D {
  const [sx, sy, sz] = partSize(def, p);
  const g = new THREE.Group();
  const t = 0.063; // aluminum wall
  const holesAlong = Math.round(sx / 0.5);
  switch (def.kind) {
    case 'channel':
      g.add(slab(sx, sy, t, drilled(holesAlong, def.web ?? 2)));
      g.add(slab(sx, t, sz, drilled(holesAlong, def.flange ?? 1)));
      g.add(slab(sx, t, sz, drilled(holesAlong, def.flange ?? 1), [0, sy - t, 0]));
      break;
    case 'angle':
      g.add(slab(sx, sy, t, drilled(holesAlong, def.web ?? 1)));
      g.add(slab(sx, t, sz, drilled(holesAlong, def.flange ?? 1)));
      break;
    case 'plate':
      g.add(slab(sx, sy, sz, drilled(holesAlong, def.web ?? 5)));
      break;
    case 'wheel': {
      const r = sy / 2;
      g.add(rod(r, sx, plain(def.style === 'traction' ? '#2a2d31' : '#3c4046', 0, 0.9), 40));
      g.add(rod(r * 0.55, sx + 0.04, plain('#d8343a', 0.1, 0.5), 24, r)).position.x = -0.02;
      if (def.style === 'omni') {
        // the rollers around the rim
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.45, 10), plain('#6b7280', 0, 0.7));
          roll.rotation.x = a;
          roll.position.set(sx / 2, r + Math.cos(a) * (r - 0.15), r + Math.sin(a) * (r - 0.15));
          g.add(roll);
        }
      }
      break;
    }
    case 'motor': {
      g.add(slab(sx, sy, sz, plain('#1f2125', 0.1, 0.6)));
      const cap = { red: '#d8343a', green: '#3fb950', blue: '#2f81f7' }[p.cartridge ?? def.cartridge ?? 'green'] ?? '#3fb950';
      g.add(rod(sz * 0.38, 0.12, plain(cap, 0.1, 0.5), 24, 0)).position.set(sx, sy / 2, sz / 2);
      break;
    }
    case 'gear': {
      const teeth = def.teeth ?? 36;
      const pitchR = teeth / 48;
      const shape = new THREE.Shape();
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2;
        const rr = i % 2 ? pitchR - 1 / 24 : pitchR + 1 / 24;
        if (i) shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      const geo = new THREE.ExtrudeGeometry(shape, { depth: sx, bevelEnabled: false, curveSegments: 1 });
      geo.rotateY(Math.PI / 2); // extrude along x
      geo.translate(0, sy / 2, sz / 2);
      g.add(new THREE.Mesh(geo, plain('#4b4f56', 0.2, 0.5)));
      break;
    }
    case 'standoff': {
      const geo = new THREE.CylinderGeometry(0.144, 0.144, sz, 6);
      geo.rotateX(Math.PI / 2);
      geo.translate(sx / 2, sy / 2, sz / 2);
      g.add(new THREE.Mesh(geo, plain('#c9cdd2', 0.7, 0.35)));
      break;
    }
    case 'shaft':
      g.add(slab(sx, sy, sz, plain('#9aa0a6', 0.8, 0.3)));
      break;
    case 'cylinder':
      g.add(rod(sy / 2, sx, plain(def.color ?? '#c9cdd2', 0.4, 0.4)));
      break;
    default: {
      g.add(slab(sx, sy, sz, plain(def.color ?? '#1f2125', 0.1, 0.6)));
      if (def.accent) g.add(slab(sx * 0.7, sy * 0.6, 0.02, plain(def.accent, 0, 0.3), [sx * 0.15, sy * 0.2, sz]));
    }
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

/** A placed part, positioned and rotated in the robot frame (x right, y forward, z up). */
export function partObject(def: PartDef, p: Placed): THREE.Object3D {
  const key = `${def.id}|${p.length ?? ''}|${p.cartridge ?? ''}`;
  let proto = cache.get(key);
  if (!proto) cache.set(key, (proto = build(def, p)));
  const o = proto.clone(); // shares geometry and materials
  const R = rotation(p.rot);
  const { offset } = placement(def, p);
  o.matrixAutoUpdate = false;
  o.matrix.set(R[0], R[1], R[2], offset[0], R[3], R[4], R[5], offset[1], R[6], R[7], R[8], offset[2], 0, 0, 0, 1);
  o.userData.part = p;
  return o;
}
