// Dev-only: one robot preset drawn large, from the box-robot builder plus its manipulators,
// with every mechanism at a chosen fraction of its range. ?robot=<id>&t=<0..1>&view=<iso|front|side|top>&held=<upright|along|across>
import * as THREE from 'three';
import { buildBoxRobot } from '../src/app/robot-meshes.ts';
import { ManipulatorVisuals } from '../src/app/manipulator-meshes.ts';
import type { MechanismSpec, RobotProfile } from '../src/sim/profile.ts';

const presets = import.meta.glob('../data/robots/*.json', { eager: true, import: 'default' }) as Record<string, RobotProfile>;
const q = new URLSearchParams(location.search);
const id = q.get('robot') ?? 'override-cascade';
const t = Number(q.get('t') ?? 0);
const view = q.get('view') ?? 'iso';
const profile = Object.values(presets).find((p) => p.id === id)!;
document.getElementById('bar')!.textContent = `${profile.name}  t=${t}  view=${view}  ` + Object.values(presets).map((p) => p.id).join(' ');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3a3d44);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(30, 60, 40);
sun.castShadow = true;
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x55585e }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(48, 2, 0x888888, 0x666666);
grid.position.y = 0.01;
scene.add(grid);

const root = new THREE.Group();
scene.add(root);
const { group } = buildBoxRobot(profile);
root.add(group);
const vis = new ManipulatorVisuals(profile, root, true);
const value = (m: MechanismSpec): number => {
  const r = (m as { range?: [number, number] }).range;
  if (m.kind === 'claw') return t > 0.5 ? 1 : 0;
  return r ? r[0] + (r[1] - r[0]) * t : 0;
};
// ?held=upright|along|across: the claw holding a red/yellow Pin that way
const held = q.get('held');
const claw = profile.mechanisms.find((m) => m.kind === 'claw');
if (held && claw) {
  const pin = { kind: 'pin', id: 'p', colors: ['red', 'yellow'] };
  vis.setHeld({ held: { [claw.name]: [pin] }, grip: { [claw.name]: 3.25 }, flipped: {}, sideways: held === 'upright' ? {} : { [claw.name]: held }, transit: {}, toggles: [], lying: [], floor: [], goals: {}, loaders: {} } as never);
}
vis.update(value);
// a box showing the 18 in start size
const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(18, 18, 18)), new THREE.LineBasicMaterial({ color: 0x4f8cff }));
box.position.y = 9;
scene.add(box);

const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 1, 500);
const d = 62;
const at: Record<string, [number, number, number]> = { iso: [d * 0.7, d * 0.55, d * 0.7], front: [0, 12, -d], side: [d, 12, 0], top: [0.01, d * 1.2, 0], back: [0, 14, d] };
cam.position.set(...at[view]);
cam.lookAt(0, 9, 0);
renderer.render(scene, cam);
(window as unknown as { done: boolean }).done = true;
