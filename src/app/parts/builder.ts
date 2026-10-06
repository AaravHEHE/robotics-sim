// The VEX parts kit: build a robot's look from C-channel, wheels, motors, gears and the rest
// on VEX's 0.5 in hole grid, and use it as the robot's 3D model. Cosmetic only: the robot
// profile still decides how it drives and what it can do.

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { bounds, MAX_PARTS, partSize, PITCH, suggestProfile, type Assembly, type PartDef, type Placed } from './assembly.ts';
import { partObject } from './geometry.ts';
import { CATALOG } from './catalog.ts';

export { CATALOG };

const GROUPS: Array<[string, PartDef['kind'][]]> = [
  ['Structure', ['channel', 'angle', 'plate', 'standoff']],
  ['Motion', ['wheel', 'gear', 'shaft']],
  ['Electronics & air', ['motor', 'box', 'cylinder']],
];

/** A tap moves less than this (px): anything else turns the camera. */
const TAP_PX = 5;

export interface BuilderElements {
  view: HTMLElement;
  palette: HTMLElement;
  length: HTMLSelectElement;
  cartridge: HTMLSelectElement;
  level: HTMLInputElement;
  info: HTMLElement;
  count: HTMLElement;
}

export class PartsBuilder {
  asm: Assembly = { v: 1, parts: [] };
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.3, 1000);
  private readonly controls: OrbitControls;
  /** Robot frame (x right, y forward, z up) inside three.js (y up, forward -z). */
  private readonly root = new THREE.Group();
  private readonly partsGroup = new THREE.Group();
  private readonly grid: THREE.GridHelper;
  private readonly ghost = new THREE.Group();
  private readonly selBox = new THREE.Box3Helper(new THREE.Box3(), 0xffb020);
  private readonly footprint: THREE.LineSegments;
  private part: PartDef = CATALOG.parts[0];
  private selected = -1;
  private readonly undoStack: string[] = [];
  private press: { x: number; y: number } | null = null;
  private frame = 0;
  private readonly els: BuilderElements;

  constructor(els: BuilderElements) {
    this.els = els;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    els.view.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x50555c, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(20, 40, 30);
    this.scene.add(sun);
    this.root.rotation.x = -Math.PI / 2;
    this.scene.add(this.root);
    // a 24 × 24 in build plate with 0.5 in squares, raised to the build level
    this.grid = new THREE.GridHelper(24, 48, 0x8a94a6, 0x4a505a);
    this.grid.rotation.x = Math.PI / 2;
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.55;
    this.footprint = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x4f8cff }));
    this.root.add(this.grid, this.partsGroup, this.ghost, this.footprint);
    this.scene.add(this.selBox);
    this.selBox.visible = false;
    this.camera.position.set(22, 20, 26);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => this.draw());
    new ResizeObserver(() => this.resize()).observe(els.view);
    const c = this.renderer.domElement;
    c.addEventListener('pointerdown', (e) => e.isPrimary && (this.press = { x: e.clientX, y: e.clientY }));
    c.addEventListener('pointerup', (e) => this.tap(e));
    c.addEventListener('pointermove', (e) => this.hover(e));
    c.addEventListener('pointerleave', () => ((this.ghost.visible = false), this.draw()));
    c.tabIndex = 0;
    c.addEventListener('keydown', (e) => this.key(e));
    els.level.onchange = () => this.setLevel(Number(els.level.value) || 0);
    els.length.onchange = () => this.updateGhost();
    els.cartridge.onchange = () => this.updateGhost();
    this.renderPalette();
    this.pick(this.part);
  }

  /** Open a build (or start an empty one) next to a robot of this size. */
  load(asm: Assembly | null, size: { width: number; length: number; height: number }): void {
    this.asm = asm ? structuredClone(asm) : { v: 1, parts: [] };
    this.undoStack.length = 0;
    this.selected = -1;
    // the robot's footprint (centered under the build) for reference
    this.footprint.scale.set(size.width, size.length, size.height);
    const b = bounds(this.asm, CATALOG);
    const c = b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] : [size.width / 2, size.length / 2];
    this.footprint.position.set(c[0], c[1], size.height / 2);
    this.controls.target.set(c[0], size.height / 3, -c[1]);
    this.camera.position.set(c[0] + 22, 20, -c[1] + 26);
    this.setLevel(0);
    this.rebuild();
  }

  // ---------------- palette ----------------

  private renderPalette(): void {
    const p = this.els.palette;
    p.replaceChildren();
    for (const [title, kinds] of GROUPS) {
      const h = document.createElement('div');
      h.className = 'sp-title';
      h.textContent = title;
      p.appendChild(h);
      for (const d of CATALOG.parts.filter((x) => kinds.includes(x.kind))) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pk-part';
        b.textContent = d.name;
        b.dataset.part = d.id;
        b.onclick = () => this.pick(d);
        p.appendChild(b);
      }
    }
  }

  private pick(d: PartDef): void {
    this.part = d;
    this.els.palette.querySelectorAll<HTMLButtonElement>('.pk-part').forEach((b) => b.classList.toggle('active', b.dataset.part === d.id));
    this.els.length.innerHTML = (d.lengths ?? []).map((l) => `<option value="${l}">${l} holes (${(l * PITCH).toFixed(1)}″)</option>`).join('');
    this.els.length.disabled = !d.lengths;
    if (d.length) this.els.length.value = String(d.length);
    this.els.cartridge.disabled = d.kind !== 'motor';
    this.updateGhost();
    this.renderer.domElement.focus();
  }

  /** The part the next click places. */
  private next(pos: [number, number, number]): Placed {
    const p: Placed = { part: this.part.id, pos, rot: [0, 0, 0] };
    if (this.part.lengths) p.length = Number(this.els.length.value) || this.part.length;
    if (this.part.kind === 'motor') p.cartridge = this.els.cartridge.value;
    return p;
  }

  private updateGhost(): void {
    this.ghost.clear();
    const o = partObject(this.part, this.next([0, 0, this.level]));
    o.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = new THREE.MeshBasicMaterial({ color: 0x4f8cff, transparent: true, opacity: 0.4, depthWrite: false });
      }
    });
    this.ghost.add(o);
    this.ghost.visible = false;
    this.draw();
  }

  // ---------------- placing ----------------

  private level = 0;
  private setLevel(n: number): void {
    this.level = Math.max(-4, Math.min(80, Math.round(n)));
    this.els.level.value = String(this.level);
    this.grid.position.set(12, 12, this.level * PITCH);
    this.updateGhost();
  }

  /** The hole under the pointer on the build level, or null. */
  private holeAt(e: PointerEvent): [number, number, number] | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    // the build level as a plane: z = level in the robot frame is three.js y = level
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.level * PITCH), new THREE.Vector3());
    if (!hit) return null;
    return [Math.floor(hit.x / PITCH), Math.floor(-hit.z / PITCH), this.level];
  }

  private partAt(e: PointerEvent): number {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = ray.intersectObjects(this.partsGroup.children, true)[0];
    if (!hit) return -1;
    let o: THREE.Object3D | null = hit.object;
    while (o && o.parent !== this.partsGroup) o = o.parent;
    return o ? this.partsGroup.children.indexOf(o) : -1;
  }

  private hover(e: PointerEvent): void {
    const h = this.holeAt(e);
    this.ghost.visible = !!h;
    if (h) {
      const o = this.ghost.children[0];
      const placed = partObject(this.part, this.next(h));
      o.matrix.copy(placed.matrix);
    }
    this.draw();
  }

  private tap(e: PointerEvent): void {
    const p = this.press;
    this.press = null;
    if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_PX) return; // that was the camera
    const hit = this.partAt(e);
    if (hit >= 0 && !e.shiftKey) {
      // a click on a part selects it (Shift+click places on top of it instead)
      this.select(hit === this.selected ? -1 : hit);
      return;
    }
    const h = this.holeAt(e);
    if (!h) return;
    if (this.asm.parts.length >= MAX_PARTS) {
      this.els.info.textContent = `A build can have at most ${MAX_PARTS} parts.`;
      return;
    }
    this.checkpoint();
    this.asm.parts.push(this.next(h));
    this.selected = this.asm.parts.length - 1;
    this.rebuild();
  }

  private key(e: KeyboardEvent): void {
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') {
      e.preventDefault();
      this.undo();
      return;
    }
    if (k === 'PageUp' || k === 'PageDown') {
      e.preventDefault();
      if (this.selected >= 0) this.edit((p) => (p.pos[2] += k === 'PageUp' ? 1 : -1));
      else this.setLevel(this.level + (k === 'PageUp' ? 1 : -1));
      return;
    }
    if (this.selected < 0) return;
    const move: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (move[k]) {
      e.preventDefault();
      const n = e.shiftKey ? 4 : 1;
      this.edit((p) => {
        p.pos[0] += move[k][0] * n;
        p.pos[1] += move[k][1] * n;
      });
    } else if (k === 'r' || k === 'R') this.edit((p) => (p.rot[2] = (p.rot[2] + 1) % 4));
    else if (k === 't' || k === 'T') this.edit((p) => (p.rot[0] = (p.rot[0] + 1) % 4));
    else if (k === 'y' || k === 'Y') this.edit((p) => (p.rot[1] = (p.rot[1] + 1) % 4));
    else if (k === 'd' || k === 'D') {
      this.checkpoint();
      const copy = structuredClone(this.asm.parts[this.selected]);
      copy.pos[0] += Math.round(partSize(CATALOG.parts.find((d) => d.id === copy.part)!, copy)[0] / PITCH);
      this.asm.parts.push(copy);
      this.selected = this.asm.parts.length - 1;
      this.rebuild();
    } else if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      this.checkpoint();
      this.asm.parts.splice(this.selected, 1);
      this.selected = -1;
      this.rebuild();
    } else if (k === 'Escape') {
      e.preventDefault();
      this.select(-1);
    }
  }

  private edit(change: (p: Placed) => void): void {
    this.checkpoint();
    change(this.asm.parts[this.selected]);
    this.rebuild();
  }

  private checkpoint(): void {
    this.undoStack.push(JSON.stringify(this.asm));
    if (this.undoStack.length > 200) this.undoStack.shift();
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.asm = JSON.parse(prev);
    this.selected = Math.min(this.selected, this.asm.parts.length - 1);
    this.rebuild();
  }

  clear(): void {
    if (!this.asm.parts.length) return;
    this.checkpoint();
    this.asm.parts = [];
    this.selected = -1;
    this.rebuild();
  }

  private select(i: number): void {
    this.selected = i;
    this.showSelection();
    this.draw();
  }

  private showSelection(): void {
    const o = this.partsGroup.children[this.selected];
    this.selBox.visible = !!o;
    if (o) {
      this.partsGroup.updateMatrixWorld(true);
      this.selBox.box.setFromObject(o);
    }
    const p = this.asm.parts[this.selected];
    const d = p && CATALOG.parts.find((x) => x.id === p.part);
    this.els.info.textContent = d
      ? `${d.name}${p.length ? `, ${p.length} holes` : ''} at hole (${p.pos.join(', ')}). Arrows move it (Shift: 4 holes), PgUp/PgDn up and down, R/T/Y turn it, D duplicates, Delete removes, Esc deselects.`
      : 'Click the grid to place the part picked on the left; click a part to select it. PgUp/PgDn change the build level. Drag to turn the camera. Ctrl+Z undoes.';
  }

  private rebuild(): void {
    this.partsGroup.clear();
    for (const p of this.asm.parts) {
      const d = CATALOG.parts.find((x) => x.id === p.part);
      if (d) this.partsGroup.add(partObject(d, p));
    }
    this.els.count.textContent = `${this.asm.parts.length} part${this.asm.parts.length === 1 ? '' : 's'}`;
    this.showSelection();
    this.draw();
  }

  /** The profile changes the build suggests (size, track width, wheels). */
  suggestion(): ReturnType<typeof suggestProfile> {
    return suggestProfile(this.asm, CATALOG);
  }

  /**
   * The build as a GLB for the robot's model: centered over the robot, bottom on the floor,
   * in inches with the robot's front toward three.js -z (as the viewer expects; scale 1).
   */
  async toGlb(): Promise<ArrayBuffer> {
    const out = new THREE.Group();
    const inner = new THREE.Group();
    inner.rotation.x = -Math.PI / 2;
    out.add(inner);
    for (const p of this.asm.parts) {
      const d = CATALOG.parts.find((x) => x.id === p.part);
      if (d) inner.add(partObject(d, p));
    }
    out.updateMatrixWorld(true);
    return (await new GLTFExporter().parseAsync(out, { binary: true })) as ArrayBuffer;
  }

  /** Fit the view to its box (call after the dialog opens). */
  refresh(): void {
    this.resize();
  }

  /** A JPEG of the view (for checking the look). */
  snapshot(): string {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/jpeg', 0.85);
  }

  private resize(): void {
    const w = this.els.view.clientWidth;
    const h = this.els.view.clientHeight;
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
}
