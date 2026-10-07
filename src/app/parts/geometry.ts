// Three.js meshes for VEX parts, built from their dimensions. Each part is built in its own
// frame (x along its length, y across, z up, corner at the origin) and placed with
// `placement()`; geometry and materials are shared between identical parts.

import * as THREE from 'three';
import { BEARING_BOSS, partSize, placement, rotation, SCREW_HEAD, sprocketPitchDiameter, type PartDef, type Placed } from './assembly.ts';
import { shared } from '../override-meshes.ts';

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
/** Cached materials are shared by every part that uses them: clearing a scene must not dispose them. */
const mat = (key: string, make: () => THREE.Material) => mats.get(key) ?? (mats.set(key, keep(make())), mats.get(key)!);
const keep = <T extends object>(o: T): T => (shared.add(o), o);
const plain = (color: string, metal = 0, rough = 0.6) => mat(`${color}:${metal}:${rough}`, () => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough }));
/** The tint over the aluminum hole texture: steel is darker, slide rails black. */
const TINT = { alu: '#ffffff', steel: '#a9aeb6', black: '#4a4d52' } as const;
type Tone = keyof typeof TINT;
const toneOf = (def: PartDef): Tone => (def.finish === 'black' ? 'black' : def.material === 'steel' ? 'steel' : 'alu');
const drilled = (along: number, across: number, tone: Tone = 'alu') =>
  // (no canvas outside a browser, e.g. in tests: plain metal)
  typeof document === 'undefined'
    ? plain(tone === 'alu' ? '#c9cdd2' : tone === 'steel' ? '#8d939b' : '#3a3d42', 0.6, 0.4)
    : mat(`holes:${along}:${across}:${tone}`, () => {
        const t = holes().clone();
        t.needsUpdate = true;
        t.repeat.set(along, across);
        return new THREE.MeshStandardMaterial({ map: t, color: TINT[tone], metalness: tone === 'steel' ? 0.75 : 0.6, roughness: tone === 'black' ? 0.6 : 0.4 });
      });
const clear = (color: string) => mat(`clear:${color}`, () => new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity: 0.35, roughness: 0.1, depthWrite: false }));

/** A flat toothed disc (gear or sprocket) in the y-z plane, `width` thick along x. */
function toothed(teeth: number, rootR: number, tipR: number, width: number, center: number, m: THREE.Material, sharp: boolean): THREE.Mesh {
  const shape = new THREE.Shape();
  const n = teeth * (sharp ? 2 : 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = i % 2 ? rootR : tipR;
    if (i) shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  // the square shaft hole
  const hole = new THREE.Path();
  const h = 0.09;
  hole.moveTo(-h, -h);
  hole.lineTo(-h, h);
  hole.lineTo(h, h);
  hole.lineTo(h, -h);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
  geo.rotateY(Math.PI / 2); // extrude along x
  geo.translate(0, center, center);
  return new THREE.Mesh(geo, m);
}

/** A ring (washer, spacer, collar) along x from 0 to `len`, centered on (y, z) = (r, r). */
function ring(outer: number, bore: number, len: number, m: THREE.Material, sides = 24, center = outer): THREE.Mesh {
  const shape = new THREE.Shape().absarc(0, 0, outer, 0, Math.PI * 2, false);
  shape.holes.push(new THREE.Path().absarc(0, 0, bore, 0, Math.PI * 2, true));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: sides });
  geo.rotateY(Math.PI / 2); // extrude along x
  geo.translate(0, center, center);
  return new THREE.Mesh(geo, m);
}

/** A hex prism along x (nut, standoff), `af` across the flats, centered on (y, z) = (c, c). */
function hex(af: number, len: number, m: THREE.Material, c: number, bore = 0): THREE.Mesh {
  const r = af / 2 / Math.cos(Math.PI / 6);
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    if (i) shape.lineTo(r * Math.cos(a), r * Math.sin(a));
    else shape.moveTo(r * Math.cos(a), r * Math.sin(a));
  }
  if (bore) shape.holes.push(new THREE.Path().absarc(0, 0, bore, 0, Math.PI * 2, true));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 8 });
  geo.rotateY(Math.PI / 2);
  geo.translate(0, c, c);
  return new THREE.Mesh(geo, m);
}

/** A domed button head along x from 0 to `h`, `r` in radius, centered on (y, z) = (c, c). */
function dome(r: number, h: number, m: THREE.Material, c: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  geo.scale(r, h, r);
  geo.rotateZ(Math.PI / 2); // its top toward -x
  geo.translate(h, c, c);
  return new THREE.Mesh(geo, m);
}

/** Add `o` to `g` and return `o` (three's own `add` returns `g`). */
const child = <T extends THREE.Object3D>(g: THREE.Object3D, o: T): T => (g.add(o), o);

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
    case 'channel': {
      const tone = toneOf(def);
      g.add(slab(sx, sy, t, drilled(holesAlong, def.web ?? 2, tone)));
      g.add(slab(sx, t, sz, drilled(holesAlong, def.flange ?? 1, tone)));
      g.add(slab(sx, t, sz, drilled(holesAlong, def.flange ?? 1, tone), [0, sy - t, 0]));
      break;
    }
    case 'angle': {
      const tone = toneOf(def);
      g.add(slab(sx, sy, t, drilled(holesAlong, def.web ?? 1, tone)));
      g.add(slab(sx, t, sz, drilled(holesAlong, def.flange ?? 1, tone)));
      break;
    }
    case 'plate':
      // polycarbonate is clear; a bearing flat is black plastic; the rest drilled metal
      g.add(slab(sx, sy, sz, def.color === '#dfe8f0' ? clear(def.color) : def.color ? plain(def.color, 0.1, 0.6) : drilled(holesAlong, def.web ?? 5, toneOf(def))));
      break;
    case 'sprocket': {
      const pd = sprocketPitchDiameter(def) / 2;
      const pitch = def.pitch ?? 0.25;
      g.add(toothed(def.teeth ?? 12, pd - pitch * 0.32, pd + pitch * 0.3, sx, sy / 2, plain('#8d939b', 0.8, 0.35), true));
      break;
    }
    case 'chain': {
      // alternating inner and outer link plates on pins
      const pitch = def.pitch ?? 0.25;
      const links = Math.round(sx / pitch);
      const steel = plain('#7d838b', 0.85, 0.35);
      for (let i = 0; i < links; i++) {
        const outer = i % 2 === 0;
        const w = outer ? sy : sy * 0.7;
        g.add(slab(pitch * 1.05, w, sz * (outer ? 1 : 0.85), steel, [i * pitch, (sy - w) / 2, outer ? 0 : sz * 0.075]));
      }
      break;
    }
    case 'pulley': {
      const r = sy / 2;
      const nylon = plain(def.color ?? '#2a2d31', 0.05, 0.6);
      if (def.style === 'spool') {
        // a winch spool: flanges with string wound on the drum
        g.add(rod(r, 0.08, nylon, 32, r));
        child(g, rod(r, 0.08, nylon, 32, r)).position.x = sx - 0.08;
        child(g, rod(r * 0.62, sx - 0.16, plain('#e8e4d8', 0, 0.9), 24, r)).position.x = 0.08;
      } else {
        // two flanges and a grooved hub the string runs in
        g.add(rod(r, sx * 0.25, nylon, 32, r));
        child(g, rod(r * 0.72, sx * 0.5, nylon, 32, r)).position.x = sx * 0.25;
        child(g, rod(r, sx * 0.25, nylon, 32, r)).position.x = sx * 0.75;
      }
      child(g, rod(0.09, sx + 0.02, plain('#9aa0a6', 0.8, 0.3), 4, r)).position.x = -0.01;
      break;
    }
    case 'rope':
      g.add(rod(sy / 2, sx, plain(def.color ?? '#e8e4d8', 0, 0.9), 8));
      break;
    case 'rack': {
      const m = plain('#4b4f56', 0.2, 0.5);
      g.add(slab(sx, sy, sz * 0.6, m));
      for (let x = 0.065; x < sx; x += 1 / 8) g.add(slab(0.06, sy, sz * 0.4, m, [x, 0, sz * 0.6]));
      break;
    }
    case 'band': {
      const loop = new THREE.Mesh(new THREE.TorusGeometry(sy / 2 - 0.04, 0.04, 6, 32).rotateY(Math.PI / 2), plain('#c99a62', 0, 0.85));
      loop.scale.set(1, 1, sz / sy);
      loop.position.set(sx / 2, sy / 2, sz / 2);
      g.add(loop);
      break;
    }
    case 'wheel': {
      const r = sy / 2;
      if (def.style === 'mecanum') {
        // two hub plates and rollers at 45° around the rim
        const hub = plain('#8d939b', 0.7, 0.4);
        g.add(rod(r * 0.8, 0.12, hub, 32, r));
        child(g, rod(r * 0.8, 0.12, hub, 32, r)).position.x = sx - 0.12;
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, sx * 0.95, 12), plain('#2a2d31', 0, 0.85));
          // each roller along the rim's tangent, tilted 45° to the axle
          roll.rotation.set(a + Math.PI / 2, 0, Math.PI / 4, 'XYZ');
          roll.position.set(sx / 2, r + Math.cos(a) * (r - 0.35), r + Math.sin(a) * (r - 0.35));
          g.add(roll);
        }
        break;
      }
      if (def.style === 'flex') {
        // a flex wheel: a green rubber ring on thin spokes around a square-shaft hub
        const green = plain('#2fa84f', 0, 0.75);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r - 0.14, 0.14, 8, 32).rotateY(Math.PI / 2), green);
        ring.scale.set(sx / 0.28, 1, 1);
        ring.position.set(sx / 2, r, r);
        g.add(ring);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const spoke = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.7, 0.08, r - 0.35), green);
          spoke.rotation.x = a;
          spoke.position.set(sx / 2, r + Math.sin(a) * (r - 0.2) * 0.5, r - Math.cos(a) * (r - 0.2) * 0.5);
          g.add(spoke);
        }
        g.add(rod(0.22, sx, plain('#1f2125', 0.1, 0.6), 12, r));
        break;
      }
      g.add(rod(r, sx, plain(def.color ?? (def.style === 'traction' ? '#2a2d31' : '#3c4046'), 0, 0.9), 40));
      child(g, rod(r * 0.55, sx + 0.04, plain('#d8343a', 0.1, 0.5), 24, r)).position.x = -0.02;
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
      // the case (its output face at x = sx), with rounded back corners and a ribbed top
      const body = plain('#1f2125', 0.1, 0.6);
      g.add(slab(sx - 0.2, sy, sz, body));
      g.add(slab(0.2, sy - 0.3, sz - 0.1, body, [sx - 0.2, 0.15, 0.05]));
      for (let k = 1; k <= 3; k++) g.add(slab(sx * 0.5, 0.06, 0.03, plain('#2c2f34', 0.1, 0.5), [sx * 0.2, (k * sy) / 4 - 0.03, sz]));
      // the cartridge cap and its square output socket
      const cap = { red: '#d8343a', green: '#3fb950', blue: '#2f81f7' }[p.cartridge ?? def.cartridge ?? 'green'] ?? '#3fb950';
      child(g, rod(sz * 0.36, 0.08, plain(cap, 0.1, 0.5), 24, 0)).position.set(sx - 0.08, sy / 2, sz / 2);
      g.add(slab(0.02, 0.14, 0.14, plain('#0d0e10', 0, 0.9), [sx - 0.01, sy / 2 - 0.07, sz / 2 - 0.07]));
      // the four tapped mounting holes on the output face, around the shaft on the 0.5 in grid
      const brass = plain('#b08d57', 0.8, 0.35);
      for (const dy of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) child(g, rod(0.07, 0.02, brass, 10, 0)).position.set(sx - 0.2, sy / 2 + dy, sz / 2 + dz);
      // the Smart Port on its back
      g.add(slab(0.03, 0.45, 0.3, plain('#0d0e10', 0, 0.9), [-0.03, sy / 2 - 0.225, sz / 2 - 0.15]));
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
      g.add(new THREE.Mesh(geo, plain(def.color ?? '#4b4f56', 0.2, 0.5)));
      break;
    }
    case 'standoff': {
      // a hex standoff, 1/4 in across the flats, tapped 8-32 at each end
      const m = def.color ? plain(def.color, 0, 0.7) : plain('#c9cdd2', 0.7, 0.35);
      const body = hex(0.25, sz, m, 0, 0.07);
      body.rotation.y = -Math.PI / 2; // along +z
      body.position.set(sx / 2, sy / 2, 0);
      g.add(body);
      break;
    }
    case 'shaft':
      g.add(slab(sx, sy, sz, plain(def.color ?? '#9aa0a6', 0.8, 0.3)));
      break;
    case 'cylinder':
      g.add(rod(sy / 2, sx, plain(def.color ?? '#c9cdd2', 0.4, 0.4)));
      break;
    case 'screw': {
      // a star-drive button head (head toward -x, flat face at x = SCREW_HEAD) on a threaded shank
      const steel = plain(def.color ?? '#2a2d31', 0.7, 0.35);
      const r = sy / 2;
      child(g, dome(r, SCREW_HEAD, steel, r)).position.x = 0;
      child(g, rod(0.082, sx - SCREW_HEAD, steel, 10, r)).position.x = SCREW_HEAD;
      // the six-lobe recess in the head
      const star = hex(0.12, 0.02, plain('#0d0e10', 0, 0.9), r);
      star.position.x = -0.005;
      g.add(star);
      break;
    }
    case 'nut': {
      const steel = plain(def.color ?? '#9aa0a6', 0.75, 0.3);
      const af = def.diameter ?? 0.344;
      const c = sy / 2;
      if (def.style === 'nylock') {
        g.add(hex(af, sx * 0.65, steel, c, 0.082));
        child(g, ring(af / 2 - 0.02, 0.082, sx * 0.35, plain('#2f6fd6', 0, 0.6), 16, c)).position.x = sx * 0.65;
      } else {
        // a keps nut: the hex, and the toothed lock washer turning with it
        child(g, hex(af, sx * 0.7, steel, c, 0.082)).position.x = sx * 0.3;
        g.add(toothed(9, af / 2 - 0.01, af / 2 + 0.035, sx * 0.3, c, steel, true));
      }
      break;
    }
    case 'washer':
      g.add(ring(sy / 2, 0.09, sx, plain(def.color ?? '#b9bec5', def.color === '#f2f2ee' ? 0 : 0.7, def.color === '#f2f2ee' ? 0.7 : 0.3), 24, sy / 2));
      break;
    case 'spacer':
      g.add(ring(sy / 2, 0.095, sx, plain(def.color ?? '#e8e4d8', 0, 0.75), 20, sy / 2));
      break;
    case 'collar': {
      const r = sy / 2;
      const m = plain(def.color ?? '#9aa0a6', def.style === 'rubber' ? 0 : 0.7, def.style === 'rubber' ? 0.9 : 0.35);
      if (def.style === 'clamp') {
        // a split ring pinched shut by a screw across the slit
        const shape = new THREE.Shape().absarc(0, 0, r, 0.18, Math.PI * 2 - 0.18, false);
        shape.lineTo(0.1 * Math.cos(-0.5), 0.1 * Math.sin(-0.5));
        shape.absarc(0, 0, 0.1, -0.5, -Math.PI * 2 + 0.5, true);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: sx, bevelEnabled: false, curveSegments: 24 });
        geo.rotateY(Math.PI / 2);
        geo.translate(0, r, r);
        g.add(new THREE.Mesh(geo, m));
        // the pinch screw across the slit, near the rim
        const pinch = rod(0.06, 0.3, plain('#2a2d31', 0.7, 0.35), 8, 0);
        pinch.rotation.z = Math.PI / 2;
        pinch.position.set(sx / 2, r - 0.15, 2 * r - 0.1);
        g.add(pinch);
      } else {
        g.add(ring(r, def.style === 'rubber' ? 0.07 : 0.1, sx, m, 24, r));
        if (def.style !== 'rubber') {
          // the set screw, radially into the collar's rim
          const set = rod(0.055, 0.1, plain('#1a1b1e', 0.6, 0.4), 8, 0);
          set.rotation.z = Math.PI / 2;
          set.position.set(sx / 2, r, 2 * r - 0.06);
          g.add(set);
        }
      }
      break;
    }
    case 'bearing': {
      const black = plain(def.color ?? '#2a2d31', 0.05, 0.55);
      if (def.style === 'block') {
        // a pillow block: a raised housing around the shaft hole
        g.add(slab(sx, sy, 0.1, black));
        g.add(slab(0.6, sy, sz - 0.1, black, [sx / 2 - 0.3, 0, 0.1]));
      } else {
        // the flat, its round boss around the middle hole, and a rivet at each end hole
        g.add(slab(sx, sy, 0.063, black));
        const boss = child(g, ring(0.17, 0.09, BEARING_BOSS, black, 20, 0));
        boss.rotation.y = -Math.PI / 2;
        boss.position.set(sx / 2, sy / 2, 0.063);
        for (const x of [0.25, sx - 0.25]) {
          const rivet = dome(0.1, 0.05, plain('#3a3d42', 0.3, 0.5), 0);
          rivet.rotation.y = -Math.PI / 2;
          rivet.position.set(x, sy / 2, 0.063);
          g.add(rivet);
        }
      }
      break;
    }
    case 'gusset': {
      // a flat bent up at 90°: holes along both legs
      const tone = toneOf(def);
      g.add(slab(sx, sy, t, drilled(holesAlong, def.web ?? 2, tone)));
      g.add(slab(sx, t, sz, drilled(holesAlong, def.flange ?? 2, tone)));
      break;
    }
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

/** A part's own shape: x along its length, y across, z up, with its corner at the origin. */
export function partShape(def: PartDef, p: Pick<Placed, 'length' | 'cartridge'> = {}): THREE.Object3D {
  const key = `${def.id}|${p.length ?? ''}|${p.cartridge ?? ''}`;
  let proto = cache.get(key);
  if (!proto) {
    cache.set(key, (proto = build(def, { part: def.id, pos: [0, 0, 0], rot: [0, 0, 0], ...p })));
    // its clones share these: they belong to the cache, not to the scene a clone is in
    proto.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) keep(m.geometry);
      for (const x of m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : []) keep(x);
    });
  }
  return proto.clone(); // shares geometry and materials
}

/**
 * A part placed by the center of its box: its length (x) along `xDir` and its width (y)
 * along `yDir`, in whatever frame the caller works in.
 */
export function centeredPart(def: PartDef, p: Pick<Placed, 'length' | 'cartridge'>, center: THREE.Vector3, xDir: THREE.Vector3, yDir: THREE.Vector3): THREE.Object3D {
  const size = partSize(def, p);
  const inner = partShape(def, p);
  inner.position.set(-size[0] / 2, -size[1] / 2, -size[2] / 2);
  const outer = new THREE.Group();
  outer.add(inner);
  const x = xDir.clone().normalize();
  const y = yDir.clone().sub(x.clone().multiplyScalar(yDir.dot(x))).normalize();
  outer.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y)));
  outer.position.copy(center);
  return outer;
}

/** A placed part, positioned and rotated in the robot frame (x right, y forward, z up). */
export function partObject(def: PartDef, p: Placed): THREE.Object3D {
  const o = partShape(def, p);
  const R = rotation(p.rot);
  const { offset } = placement(def, p);
  o.matrixAutoUpdate = false;
  o.matrix.set(R[0], R[1], R[2], offset[0], R[3], R[4], R[5], offset[1], R[6], R[7], R[8], offset[2], 0, 0, 0, 1);
  o.userData.part = p;
  return o;
}
