// Three.js meshes for V5RC Override field elements and scoring objects, built from the
// manual's Appendix A dimensions (inches). Field (x, y) maps to three (x, -y), up = +y.

import * as THREE from 'three';
import { CUP, layoutStack, PIN, type Piece, type PinColor } from '../games/override/elements.ts';
import type { OverrideState } from '../games/override/state.ts';
import type { FieldDef, GoalDef, LoaderDef, ToggleDef } from '../sim/field.ts';

const DEG = Math.PI / 180;
const MM = 1 / 25.4;

const PIN_COLORS: Record<string, number> = { red: 0xd8343a, blue: 0x2f6fde, yellow: 0xf2c418 };
const mats = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = mats.get(key);
  if (!m) {
    m = make();
    mats.set(key, m);
  }
  return m;
}
const pinMat = (c: string) => mat('pin-' + c, () => new THREE.MeshStandardMaterial({ color: PIN_COLORS[c] ?? 0x999999, roughness: 0.45 }));
const cupMat = (half: 'gray' | 'clear') =>
  mat('cup-' + half, () =>
    half === 'gray'
      ? new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.5, side: THREE.DoubleSide })
      : new THREE.MeshPhysicalMaterial({ color: 0xe8f0f6, transparent: true, opacity: 0.32, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false }),
  );

// ---------------- scoring objects ----------------

/** One half of a pin (end at y = 0, collar side at y = PIN.half + collar/2), hexagonal. */
const pinHalfGeo = (() => {
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(PIN.endDiameter / 2, 0),
    new THREE.Vector2(PIN.endDiameter / 2, PIN.endStraight),
    new THREE.Vector2(PIN.coneDiameter / 2, PIN.half),
    new THREE.Vector2(PIN.collarDiameter / 2, PIN.half),
    new THREE.Vector2(PIN.collarDiameter / 2, PIN.half + PIN.collar / 2),
    new THREE.Vector2(0, PIN.half + PIN.collar / 2),
  ];
  return new THREE.LatheGeometry(pts, 6);
})();

/** One half of a cup (rim at y = 0, waist at y = CUP.height / 2). */
const cupHalfGeo = (() => {
  const h = CUP.height / 2;
  const pts = [new THREE.Vector2(CUP.rimDiameter / 2, 0), new THREE.Vector2(CUP.rimDiameter / 2 - 0.08, 0.15), new THREE.Vector2(CUP.waistDiameter / 2, h)];
  return new THREE.LatheGeometry(pts, 24);
})();

/** A pin standing upright; `colors` = [bottom, top]. Origin at the pin's bottom end. */
export function pinMesh(colors: [PinColor, PinColor]): THREE.Group {
  const g = new THREE.Group();
  const lower = new THREE.Mesh(pinHalfGeo, pinMat(colors[0]));
  const upper = new THREE.Mesh(pinHalfGeo, pinMat(colors[1]));
  upper.rotation.x = Math.PI;
  upper.position.y = PIN.length;
  for (const m of [lower, upper]) {
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/** A cup standing on its rim; `up` = which half is on top. Origin at the bottom rim. */
export function cupMesh(up: 'gray' | 'clear'): THREE.Group {
  const g = new THREE.Group();
  const lower = new THREE.Mesh(cupHalfGeo, cupMat(up === 'gray' ? 'clear' : 'gray'));
  const upper = new THREE.Mesh(cupHalfGeo, cupMat(up));
  upper.rotation.x = Math.PI;
  upper.position.y = CUP.height;
  lower.castShadow = upper.castShadow = true;
  g.add(lower, upper);
  return g;
}

function pieceMesh(p: Piece): THREE.Group {
  return p.kind === 'pin' ? pinMesh(p.colors) : cupMesh(p.up);
}

/**
 * All scoring objects of a game state. Returns the group and, for objects that can move
 * on the floor (stacks and lying pins), their nodes by id so a replay can move them.
 */
export function piecesGroup(field: FieldDef, state: OverrideState): { group: THREE.Group; nodes: Map<string, THREE.Object3D> } {
  const group = new THREE.Group();
  const nodes = new Map<string, THREE.Object3D>();
  const addStack = (pieces: Piece[], x: number, y: number, base: number, onGoal: boolean, id?: string) => {
    const holder = new THREE.Group();
    for (const slot of layoutStack(pieces, base, onGoal)) {
      const m = pieceMesh(slot.piece);
      m.position.set(0, slot.bottom, 0);
      m.userData.pieceId = slot.piece.id;
      holder.add(m);
    }
    holder.position.set(x, 0, -y);
    group.add(holder);
    if (id) nodes.set(id, holder);
  };
  for (const s of state.floor) addStack(s.pieces, s.x, s.y, 0, false, s.id);
  for (const g of field.goals ?? []) addStack(state.goals[g.id] ?? [], g.x, g.y, g.height, true);
  // Match Loads waiting in a Loader chute, stacked one above the other
  const half = field.perimeter.inside / 2;
  for (const l of field.loaders ?? []) {
    const inward = l.wall === 'left' ? 1 : -1;
    let base = 0;
    for (const p of state.loaders?.[l.id] ?? []) {
      addStack([p], -inward * half + (inward * l.depth) / 2, l.y, base, false);
      base += p.kind === 'pin' ? PIN.length : CUP.height;
    }
  }
  for (const l of state.lying) {
    const m = pinMesh(l.colors);
    // lay the pin along +z (three), then point it along the field heading
    const holder = new THREE.Group();
    m.rotation.x = Math.PI / 2; // pin axis +y -> +z
    m.position.set(0, PIN.collarDiameter / 2, -PIN.length / 2);
    holder.add(m);
    // three +z = field -y; field heading h (cw from +y) -> rotate so +z points to heading
    holder.rotation.y = Math.PI - l.heading * DEG;
    holder.position.set(l.x, 0, -l.y);
    holder.userData.pieceId = l.id;
    group.add(holder);
    nodes.set(l.id, holder);
  }
  return { group, nodes };
}

/** Pose a lying-pin or stack node from a track sample (field x, y, heading). */
export function placeNode(node: THREE.Object3D, x: number, y: number, heading: number, lying: boolean) {
  node.position.x = x;
  node.position.z = -y;
  if (lying) node.rotation.y = Math.PI - heading * DEG;
}

// ---------------- field elements ----------------

function octagonFrustum(bottomFlats: number, topFlats: number, height: number): THREE.BufferGeometry {
  const k = 1 / Math.cos(22.5 * DEG) / 2;
  const geo = new THREE.CylinderGeometry(topFlats * k, bottomFlats * k, height, 8, 1);
  geo.rotateY(22.5 * DEG);
  geo.translate(0, height / 2, 0);
  return geo;
}

export function goalMesh(g: GoalDef): THREE.Group {
  const color = g.color === 'red' ? 0xc8282e : g.color === 'blue' ? 0x2a66d0 : 0x202226;
  const m = mat('goal-' + g.color, () => new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
  const group = new THREE.Group();
  const plate = Math.min(g.bodyHeight, 10 * MM);
  if (g.bodyHeight > plate + 1e-6) {
    const body = new THREE.Mesh(octagonFrustum(g.baseWidth, g.baseWidth * 0.98, g.bodyHeight), m);
    group.add(body);
  } else {
    group.add(new THREE.Mesh(octagonFrustum(g.baseWidth, g.baseWidth, plate), m));
  }
  const cone = new THREE.Mesh(octagonFrustum(g.baseWidth * 0.9, g.topWidth, g.height - g.bodyHeight), m);
  cone.position.y = g.bodyHeight;
  group.add(cone);
  const socket = new THREE.Mesh(new THREE.CircleGeometry(g.socket / 2, 24), mat('socket', () => new THREE.MeshBasicMaterial({ color: 0x050505 })));
  socket.rotation.x = -Math.PI / 2;
  socket.position.y = g.height + 0.01;
  group.add(socket);
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      (o as THREE.Mesh).castShadow = true;
      (o as THREE.Mesh).receiveShadow = true;
    }
  });
  group.position.set(g.x, 0, -g.y);
  return group;
}

const TOGGLE_COLORS: Record<string, number> = { red: 0xd8343a, blue: 0x2f6fde, yellow: 0xf2c418 };

/**
 * A toggle: equilateral prism along the wall. Returns the outer (positioned) group and
 * the inner group to rotate for the roll angle (about its long axis).
 */
export function toggleMesh(t: ToggleDef, field: FieldDef): { outer: THREE.Group; roll: THREE.Group } {
  const outer = new THREE.Group();
  const roll = new THREE.Group();
  const side = (t.sectionHeight * 2) / Math.sqrt(3);
  const inradius = t.sectionHeight / 3;
  // local frame: axis = +x, up = +y, into the field = +z
  const faces: Array<[string, number]> = [
    [t.start.in, 30],
    [t.start.out, 150],
    [t.start.down, 270],
  ];
  for (const [color, phi] of faces) {
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(t.length, 0.08, side),
      mat('toggle-' + color, () => new THREE.MeshStandardMaterial({ color: TOGGLE_COLORS[color] ?? 0x888888, roughness: 0.5 })),
    );
    face.rotation.x = (90 - phi) * DEG;
    face.position.set(0, inradius * Math.sin(phi * DEG), inradius * Math.cos(phi * DEG));
    face.castShadow = true;
    roll.add(face);
  }
  const core = new THREE.Mesh(new THREE.CylinderGeometry(inradius * 0.95, inradius * 0.95, t.length * 0.995, 3), mat('toggle-core', () => new THREE.MeshStandardMaterial({ color: 0x1a1a1a })));
  core.rotation.z = Math.PI / 2;
  roll.add(core);
  outer.add(roll);
  const half = field.perimeter.inside / 2;
  const wt = field.perimeter.wallThickness;
  const axisHeight = t.topHeight - (t.sectionHeight - inradius);
  const yaw = { top: 0, bottom: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }[t.wall];
  const pos = {
    top: [t.x, half + wt / 2],
    bottom: [t.x, -half - wt / 2],
    left: [-half - wt / 2, t.y],
    right: [half + wt / 2, t.y],
  }[t.wall];
  // local +z must point into the field: top wall -> field -y = three +z (yaw 0)
  outer.rotation.y = yaw;
  outer.position.set(pos[0], axisHeight, -pos[1]);
  return { outer, roll };
}

export function loaderMesh(l: LoaderDef, field: FieldDef): THREE.Group {
  const g = new THREE.Group();
  const half = field.perimeter.inside / 2;
  const inward = l.wall === 'left' ? 1 : -1;
  const color = l.alliance === 'red' ? 0xd8343a : 0x2f6fde;
  const clear = mat('loader-clear', () => new THREE.MeshPhysicalMaterial({ color: 0xeef4f8, transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false }));
  const tube = new THREE.Mesh(new THREE.BoxGeometry(l.depth, l.height - l.opening, l.width), clear);
  tube.position.y = l.opening + (l.height - l.opening) / 2;
  const base = new THREE.Mesh(new THREE.BoxGeometry(l.depth * 0.3, l.opening, l.width), mat('loader-base', () => new THREE.MeshStandardMaterial({ color: 0x24272c })));
  base.position.set(-inward * l.depth * 0.35, l.opening / 2, 0);
  const band = new THREE.Mesh(new THREE.BoxGeometry(l.depth + 0.05, 0.6, l.width + 0.05), mat('loader-' + l.alliance, () => new THREE.MeshStandardMaterial({ color })));
  band.position.y = l.height - 0.3;
  g.add(tube, base, band);
  g.position.set(-inward * half + (inward * l.depth) / 2, 0, -l.y);
  return g;
}

/** Draw the field's tape lines and zone tints onto the tile canvas. */
export function drawTape(ctx: CanvasRenderingContext2D, field: FieldDef, px: number) {
  const inside = field.perimeter.inside;
  const half = inside / 2;
  const s = px / inside;
  const X = (x: number) => (x + half) * s;
  const Y = (y: number) => (half - y) * s;
  ctx.lineCap = 'butt';
  for (const t of field.tape ?? []) {
    ctx.strokeStyle = t.color;
    ctx.lineWidth = t.width * s;
    ctx.beginPath();
    ctx.moveTo(X(t.from[0]), Y(t.from[1]));
    ctx.lineTo(X(t.to[0]), Y(t.to[1]));
    ctx.stroke();
  }
}
