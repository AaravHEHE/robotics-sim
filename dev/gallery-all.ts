// Dev-only: the seven Override presets side by side, at ?t= of their lift travel.
import * as THREE from 'three';
import { buildBoxRobot } from '../src/app/robot-meshes.ts';
import { ManipulatorVisuals } from '../src/app/manipulator-meshes.ts';
import type { MechanismSpec, RobotProfile } from '../src/sim/profile.ts';

const presets = import.meta.glob('../data/robots/override-*.json', { eager: true, import: 'default' }) as Record<string, RobotProfile>;
const t = Number(new URLSearchParams(location.search).get('t') ?? 0);
const grid = document.getElementById('g')!;
for (const profile of Object.values(presets)) {
  const cell = document.createElement('div');
  cell.className = 'c';
  const label = document.createElement('span');
  label.textContent = profile.name.replace('Override: ', '');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(360, 360);
  cell.append(renderer.domElement, label);
  grid.append(cell);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x3a3d44);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(30, 60, 40);
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x55585e }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const root = new THREE.Group();
  scene.add(root);
  root.add(buildBoxRobot(profile).group);
  const vis = new ManipulatorVisuals(profile, root, true);
  vis.update((m: MechanismSpec) => {
    const r = (m as { range?: [number, number] }).range;
    if (m.kind === 'claw') return 1;
    return r ? r[0] + (r[1] - r[0]) * t : 0;
  });
  const cam = new THREE.PerspectiveCamera(35, 1, 1, 500);
  cam.position.set(-44, 34 + t * 12, -44); // from the front left
  cam.lookAt(0, 9 + t * 8, 0);
  renderer.render(scene, cam);
}
