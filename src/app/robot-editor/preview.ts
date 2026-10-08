// A small live 3D view of the robot being edited, drawn exactly as on the field (the box
// robot plus its game manipulators).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { RobotProfile } from '../../sim/profile.ts';
import { ManipulatorVisuals } from '../manipulator-meshes.ts';
import { buildBoxRobot } from '../robot-meshes.ts';
import { shared } from '../override-meshes.ts';

export class RobotPreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.5, 500);
  private readonly controls: OrbitControls;
  private readonly robot = new THREE.Group();
  private frame = 0;
  private readonly host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    host.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x50555c, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(30, 60, 40);
    this.scene.add(sun, this.robot);
    const floor = new THREE.GridHelper(48, 24, 0x8a94a6, 0x8a94a6);
    (floor.material as THREE.Material).opacity = 0.35;
    (floor.material as THREE.Material).transparent = true;
    this.scene.add(floor);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => this.draw());
    new ResizeObserver(() => this.resize()).observe(host);
  }

  /** Show this profile (call on every edit). */
  show(p: RobotProfile): void {
    this.robot.traverse((o) => {
      const m = o as THREE.Mesh;
      // cached parts' geometry and materials are shared (see parts/geometry.ts)
      if (m.geometry && !shared.has(m.geometry)) m.geometry.dispose();
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      for (const x of mats) if (!shared.has(x)) x.dispose();
    });
    this.robot.clear();
    try {
      const { group } = buildBoxRobot(p);
      this.robot.add(group);
      const vis = new ManipulatorVisuals(p, group, true);
      vis.update(() => 0);
    } catch {
      /* a half-edited robot that can't be drawn yet */
    }
    if (!this.frame) {
      const r = Math.max(p.size.width, p.size.length, p.size.height);
      this.camera.position.set(r * 1.6, r * 1.3, r * 1.9);
      this.controls.target.set(0, p.size.height / 3, 0);
    }
    this.draw();
  }

  private resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  private draw(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
