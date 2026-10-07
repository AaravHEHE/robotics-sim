// Three.js field + robot viewer. Field coordinates (inches, +y away from the near
// wall, heading clockwise from +y) map to three.js as x -> x, y -> -z, up = +y.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { FieldDef } from '../sim/field.ts';
import { isPneumatic, type RobotProfile } from '../sim/profile.ts';
import type { Recording } from '../sim/recording.ts';
import type { OverrideRecording } from '../games/override/game.ts';
import { sampleAt } from '../games/override/replay.ts';
import type { OverrideState } from '../games/override/state.ts';
import { ManipulatorVisuals } from './manipulator-meshes.ts';
import { buildBoxRobot, type MechVisual } from './robot-meshes.ts';
import { drawTape, shared, goalMesh, loaderMesh, piecesGroup, placeNode, toggleMesh } from './override-meshes.ts';

export type ViewMode = 'top' | 'orbit' | 'follow';
export interface FieldPose {
  x: number;
  y: number;
  theta: number;
}

const DEG = Math.PI / 180;
/** Gravity (in/s^2), for drawing falling pieces. */
const GRAVITY_IN = 386;

/**
 * Remove a group's children and free their GPU resources (geometries, materials,
 * textures), except the ones shared by many meshes. Without this, each field, robot or
 * replay change leaks GPU memory until WebGL gives up.
 */
function clearGroup(group: THREE.Object3D): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !shared.has(m.geometry)) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      if (shared.has(mat)) continue;
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
  group.clear();
}
const toThree = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);


export class FieldViewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly fieldGroup = new THREE.Group();
  /** Built-in floor and perimeter, and built-in Goals and Loaders (hidden under a loaded field model). */
  private baseGroup = new THREE.Group();
  private staticGroup = new THREE.Group();
  /** A field model the visitor loaded (cosmetic only), and which built-in parts it replaces. */
  private readonly fieldModel = new THREE.Group();
  private hideBuiltIn = { base: false, statics: false };
  private readonly robotGroup = new THREE.Group();
  private readonly ghost = new THREE.Group();
  private readonly overlay = new THREE.Group();
  /** Scoring objects of a game field. */
  private readonly gameGroup = new THREE.Group();
  /** Toggle id -> group to rotate for its roll angle. */
  private readonly toggleRolls = new Map<string, THREE.Group>();
  /** Movable piece nodes (floor stacks, lying pins) of the shown game state, by id. */
  private pieceNodes = new Map<string, THREE.Object3D>();
  /** Standing pieces by id, and where each was built (its place on its stack). */
  private pieceMeshes = new Map<string, { mesh: THREE.Object3D; home: THREE.Vector3 }>();
  private lyingIds = new Set<string>();
  private gameRec: OverrideRecording | null = null;
  private shownSnapshot = -1;
  private trail: THREE.Line | null = null;
  private futureTrail: THREE.Line | null = null;
  private rec: Recording | null = null;
  private mechs: MechVisual[] = [];
  private robotLoad = 0;
  /** Game manipulators and the pieces they hold. */
  private manipVis: ManipulatorVisuals | null = null;
  private lastGameState: OverrideState | null = null;
  private profile: RobotProfile | null = null;
  private field: FieldDef | null = null;
  private mode: ViewMode = 'orbit';
  private frame = 0;
  private readonly container: HTMLElement;
  private needsRender = true;
  /** Once the user orbits/zooms, stop re-framing the camera on resize. */
  private userMoved = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // filmic tone mapping and a soft studio environment: metal, polycarbonate and plastic
    // pick up reflections instead of looking flat
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();
    container.appendChild(this.renderer.domElement);
    // the GPU can drop the context (driver reset, too many tabs): allow it to come back
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());
    this.renderer.domElement.addEventListener('webglcontextrestored', () => (this.needsRender = true));
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 2000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.addEventListener('change', () => (this.needsRender = true));
    this.controls.addEventListener('start', () => (this.userMoved = true));

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x50555c, 1.0));
    const sun = new THREE.DirectionalLight(0xfff6ea, 2.4);
    sun.position.set(60, 160, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 400 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.scene.add(this.fieldGroup, this.fieldModel, this.gameGroup, this.overlay, this.ghost, this.robotGroup);
    this.applyTheme();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());

    new ResizeObserver(() => this.resize()).observe(container);
    this.setView('orbit');
    this.loop();
  }

  private applyTheme() {
    const dark = document.documentElement.dataset.theme === 'dark' ||
      (!document.documentElement.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
    this.scene.background = new THREE.Color(dark ? 0x15181d : 0xe9ecef);
    this.needsRender = true;
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.userMoved && this.mode !== 'follow') this.setView(this.mode);
    this.needsRender = true;
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    if (this.mode === 'follow') this.followRobot();
    if (this.controls.update()) this.needsRender = true;
    if (this.needsRender) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
  };

  setView(mode: ViewMode) {
    this.mode = mode;
    this.userMoved = false;
    // keep the whole field in view on tall (portrait) viewports too
    const half = ((this.field?.perimeter.inside ?? 140) / 2) * Math.max(1, 1 / (this.camera.aspect || 1));
    if (mode === 'top') {
      this.camera.position.set(0, half * 3.3, 0.01);
      this.controls.target.set(0, 0, 0);
      this.controls.enableRotate = false;
    } else {
      this.controls.enableRotate = true;
      if (mode === 'orbit') {
        this.camera.position.set(0, half * 1.7, half * 2.2);
        this.controls.target.set(0, 0, -4);
      }
    }
    this.controls.update();
    this.needsRender = true;
  }

  private followRobot() {
    const p = this.robotGroup.position;
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.robotGroup.quaternion).multiplyScalar(48);
    const want = p.clone().add(back).add(new THREE.Vector3(0, 36, 0));
    this.camera.position.lerp(want, 0.08);
    this.controls.target.lerp(p, 0.2);
    this.needsRender = true;
  }

  // ---------------- field ----------------

  setField(field: FieldDef) {
    const same = this.field?.id === field.id;
    this.field = field;
    clearGroup(this.fieldGroup);
    // the last field's model isn't this field's (the app loads this one's, if any); the same
    // field redrawn (a new auto-stop, a sample opened) keeps its model as it is
    if (!same) {
      clearGroup(this.fieldModel);
      this.hideBuiltIn = { base: false, statics: false };
    }
    clearGroup(this.gameGroup);
    this.toggleRolls.clear();
    const inside = field.perimeter.inside;
    const half = inside / 2;

    // foam tiles: one canvas texture with seams
    const n = field.tiles.count;
    const px = field.tape?.length ? 2048 : 1024;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = px;
    const g = canvas.getContext('2d')!;
    g.fillStyle = field.tiles.color;
    g.fillRect(0, 0, px, px);
    // deterministic noise for the foam
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // each foam tile is a slightly different shade, as on a real field
    const tile = px / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = rand();
        g.fillStyle = v < 0.5 ? `rgba(0,0,0,${(0.5 - v) * 0.06})` : `rgba(255,255,255,${(v - 0.5) * 0.05})`;
        g.fillRect(i * tile, j * tile, tile, tile);
      }
    }
    for (let i = 0; i < 14000; i++) {
      const x = rand() * px;
      const y = rand() * px;
      g.fillStyle = `rgba(255,255,255,${rand() * 0.035})`;
      g.fillRect(x, y, 2, 2);
    }
    // seams with the interlocking teeth of the tile edges
    g.strokeStyle = 'rgba(0,0,0,0.26)';
    g.lineWidth = Math.max(2, px / 700);
    const teeth = 6;
    const tooth = tile / teeth;
    const depth = tooth * 0.22;
    for (let i = 1; i < n; i++) {
      const p = i * tile;
      for (const vertical of [true, false]) {
        g.beginPath();
        for (let k = 0; k <= n * teeth; k++) {
          const a = k * tooth;
          const off = k % 2 ? depth : -depth;
          if (vertical) {
            if (!k) g.moveTo(p + off, a);
            g.lineTo(p + off, a);
            g.lineTo(p + off, a + tooth);
          } else {
            if (!k) g.moveTo(a, p + off);
            g.lineTo(a, p + off);
            g.lineTo(a + tooth, p + off);
          }
        }
        g.stroke();
      }
    }
    drawTape(g, field, px);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    // foam grain as a bump map (tiled)
    const grain = document.createElement('canvas');
    grain.width = grain.height = 256;
    const gg = grain.getContext('2d')!;
    const img = gg.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 110 + rand() * 60;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    gg.putImageData(img, 0, 0);
    const bump = new THREE.CanvasTexture(grain);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    bump.repeat.set(n * 4, n * 4);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(inside, inside),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.97, bumpMap: bump, bumpScale: 0.6 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.baseGroup = new THREE.Group();
    this.staticGroup = new THREE.Group();
    this.fieldGroup.add(this.baseGroup, this.staticGroup);
    this.baseGroup.add(floor);

    // surrounding floor
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(inside * 3, inside * 3), new THREE.MeshStandardMaterial({ color: 0x777b80, roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.05;
    outer.receiveShadow = true;
    this.baseGroup.add(outer);

    // perimeter: aluminum rails with clear panels
    const { wallHeight: h, wallThickness: t } = field.perimeter;
    const rail = new THREE.MeshStandardMaterial({ color: 0xd2d6db, metalness: 0.85, roughness: 0.32 });
    const panel = new THREE.MeshPhysicalMaterial({ color: 0xe6eef5, transparent: true, opacity: 0.16, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false });
    for (const [x, z, w, d] of [
      [0, -half - t / 2, inside + 2 * t, t],
      [0, half + t / 2, inside + 2 * t, t],
      [-half - t / 2, 0, t, inside],
      [half + t / 2, 0, t, inside],
    ]) {
      for (const y of [1, h - 0.5]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), rail);
        r.position.set(x, y, z);
        r.castShadow = true;
        this.baseGroup.add(r);
      }
      const p = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w - 0.6, 0.3), h - 2, Math.max(d - 0.6, 0.3)), panel);
      p.position.set(x, h / 2, z);
      this.baseGroup.add(p);
      // upright extrusions where the perimeter panels meet (one per tile)
      const along = w > d;
      for (let i = 1; i < n; i++) {
        const u = -half + (i * inside) / n;
        const post = new THREE.Mesh(new THREE.BoxGeometry(along ? 1 : t, h - 1, along ? t : 1), rail);
        post.position.set(along ? u : x, h / 2, along ? z : u);
        post.castShadow = true;
        this.baseGroup.add(post);
      }
    }
    // corner posts
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(t * 1.4, h + 0.5, t * 1.4), rail);
        post.position.set(sx * (half + t / 2), h / 2, sz * (half + t / 2));
        post.castShadow = true;
        this.baseGroup.add(post);
      }
    }
    // game field elements (goals, toggles, loaders)
    for (const goal of field.goals ?? []) this.staticGroup.add(goalMesh(goal));
    for (const t of field.toggles ?? []) {
      const { outer, roll } = toggleMesh(t, field);
      this.toggleRolls.set(t.id, roll);
      this.fieldGroup.add(outer);
    }
    for (const l of field.loaders ?? []) this.staticGroup.add(loaderMesh(l, field));
    this.applyHidden();
    this.setView(this.mode);
  }

  /**
   * Show a field model the visitor loaded (already in field inches, three.js axes), or
   * none. It is cosmetic: it replaces the look of the built-in floor and perimeter
   * (`base`) and/or Goals and Loaders (`statics`); the simulation never sees it.
   */
  setFieldModel(model: THREE.Object3D | null, hide: { base: boolean; statics: boolean }) {
    clearGroup(this.fieldModel);
    if (model) this.fieldModel.add(model);
    this.hideBuiltIn = model ? hide : { base: false, statics: false };
    this.applyHidden();
  }

  /** Show or hide the built-in parts a field model replaces (the model stays as it is). */
  setFieldModelHidden(hide: { base: boolean; statics: boolean }) {
    if (!this.fieldModel.children.length) return;
    this.hideBuiltIn = hide;
    this.applyHidden();
  }

  // ---------------- for tools drawn over the field (auton mapping) ----------------

  /** The canvas the field is drawn on (for pointer events). */
  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Add a group of its own to the scene: clearing a run or a field doesn't touch it. */
  addLayer(o: THREE.Object3D) {
    this.scene.add(o);
    this.needsRender = true;
  }

  /** The field point (inches) on the floor under a screen position, or null (looking past the floor). */
  fieldPointAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    // the floor as a plane (the floor mesh can be hidden under a field model)
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    return hit ? { x: hit.x, y: -hit.z } : null;
  }

  /** Where a field point (inches, on the floor) is on screen (client pixels). */
  screenOf(x: number, y: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const v = toThree(x, y).project(this.camera);
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  /** Let the mouse orbit the camera, or not (while a tool drags something on the field). */
  setOrbitEnabled(on: boolean) {
    this.controls.enabled = on;
  }

  /** Draw the next frame (after changing something in the scene from outside). */
  requestRender() {
    this.needsRender = true;
  }

  private applyHidden() {
    this.baseGroup.visible = !this.hideBuiltIn.base;
    this.staticGroup.visible = !this.hideBuiltIn.statics;
    this.needsRender = true;
  }

  /** A JPEG of the current view (for checking the look without a visible window). */
  snapshot(width = 640): string {
    const c = this.renderer.domElement;
    this.renderer.render(this.scene, this.camera);
    const out = document.createElement('canvas');
    out.width = width;
    out.height = Math.round((width * c.height) / c.width);
    out.getContext('2d')!.drawImage(c, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.7);
  }

  /** Show a game state's scoring objects and toggle angles (null hides them). */
  setGameState(state: OverrideState | null) {
    this.gameGroup.clear();
    this.pieceNodes = new Map();
    this.pieceMeshes = new Map();
    this.lyingIds = new Set(state?.lying.map((l) => l.id) ?? []);
    this.lastGameState = state;
    this.manipVis?.setHeld(state);
    if (state && this.field) {
      const { group, nodes, pieces } = piecesGroup(this.field, state);
      this.pieceNodes = nodes;
      this.pieceMeshes = new Map([...pieces].map(([id, mesh]) => [id, { mesh, home: mesh.position.clone() }]));
      this.gameGroup.add(group);
      for (const t of state.toggles) {
        // +angle = top rolls outward = negative rotation about the local x axis
        const roll = this.toggleRolls.get(t.id);
        if (roll) roll.rotation.x = (-t.angle * Math.PI) / 180;
      }
    }
    this.needsRender = true;
  }

  // ---------------- robot ----------------

  async setRobot(profile: RobotProfile, glb?: ArrayBuffer) {
    // two quick robot changes: only the last one may build the robot
    const token = ++this.robotLoad;
    const body = glb ? await this.loadModel(profile, glb).catch(() => null) : null;
    if (token !== this.robotLoad) {
      if (body) clearGroup(body);
      return;
    }
    this.profile = profile;
    clearGroup(this.robotGroup);
    clearGroup(this.ghost);
    this.mechs = (body?.userData.mechs as MechVisual[] | undefined) ?? [];
    this.robotGroup.add(body ?? this.boxRobot(profile));
    this.manipVis = new ManipulatorVisuals(profile, this.robotGroup, !body);
    this.manipVis.setHeld(this.lastGameState);
    this.manipVis.update(() => 0);
    // ghost (start pose marker)
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(profile.size.width, 0.2, profile.size.length)),
      new THREE.LineBasicMaterial({ color: 0x4f8cff, transparent: true, opacity: 0.8 }),
    );
    outline.position.y = 0.15;
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3, 3), new THREE.MeshBasicMaterial({ color: 0x4f8cff }));
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(0, 0.2, -profile.size.length / 2 - 2);
    this.ghost.add(outline, arrow);
    this.ghost.visible = false;
    this.needsRender = true;
  }

  private boxRobot(p: RobotProfile): THREE.Group {
    const { group, mechs } = buildBoxRobot(p);
    this.mechs.push(...mechs);
    return group;
  }

  private async loadModel(p: RobotProfile, glb: ArrayBuffer): Promise<THREE.Object3D> {
    const gltf = await new GLTFLoader().parseAsync(glb, '');
    const root = gltf.scene;
    const holder = new THREE.Group();
    holder.add(root);
    root.rotation.y = (p.model?.rotationDeg ?? 0) * DEG;
    // Scale: explicit, or fit the model's footprint to the profile's footprint.
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const scale = p.model?.scale ?? Math.max(p.size.width, p.size.length) / Math.max(size.x, size.z, 1e-6);
    root.scale.setScalar(scale);
    box.setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const off = p.model?.offset ?? [0, 0, 0];
    root.position.set(-center.x + off[0], -box.min.y + off[2], -center.z - off[1]);
    // the model's named moving parts (kept on the model until the robot is shown)
    const mechs: MechVisual[] = [];
    for (const m of p.mechanisms) {
      if (!m.node) continue;
      const obj = root.getObjectByName(m.node);
      if (obj) mechs.push({ spec: m, object: obj, base: { rotation: obj.rotation.clone(), position: obj.position.clone() } });
    }
    holder.userData.mechs = mechs;
    holder.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    return holder;
  }

  // ---------------- poses and recordings ----------------

  /** Robot pose without a recording (before running). */
  showPose(p: FieldPose, ghostToo = true) {
    this.robotGroup.position.copy(toThree(p.x, p.y));
    this.robotGroup.rotation.set(0, -p.theta * DEG, 0);
    this.ghost.position.copy(this.robotGroup.position);
    this.ghost.rotation.copy(this.robotGroup.rotation);
    this.ghost.visible = ghostToo && !this.rec;
    this.needsRender = true;
  }

  setRecording(rec: Recording | null) {
    this.rec = rec;
    this.gameRec = rec?.game ?? null;
    this.shownSnapshot = -1;
    clearGroup(this.overlay);
    this.trail = this.futureTrail = null;
    this.ghost.visible = false;
    if (!rec) return;
    const n = rec.frames.length / rec.stride;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) pts.push(toThree(rec.frames[i * rec.stride + 1], rec.frames[i * rec.stride + 2], 0.3));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.futureTrail = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0x8a94a6, dashSize: 1.5, gapSize: 1.5, transparent: true, opacity: 0.6 }));
    this.futureTrail.computeLineDistances();
    this.trail = new THREE.Line(geo.clone(), new THREE.LineBasicMaterial({ color: 0xffb020, linewidth: 2 }));
    this.overlay.add(this.futureTrail, this.trail);
    // motion targets
    for (const m of rec.motions) {
      if (m.path && m.path.length > 1) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(m.path.map((q) => toThree(q.x, q.y, 0.25))),
          new THREE.LineBasicMaterial({ color: 0x3fb950, transparent: true, opacity: 0.8 }),
        );
        this.overlay.add(line);
      }
      if (!m.target) continue;
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 2, 24), new THREE.MeshBasicMaterial({ color: 0x3fb950, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(toThree(m.target.x, m.target.y, 0.3));
      this.overlay.add(ring);
      if (m.target.theta !== undefined) {
        const tick = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 4), new THREE.MeshBasicMaterial({ color: 0x3fb950 }));
        tick.position.copy(toThree(m.target.x, m.target.y, 0.35));
        tick.rotation.y = -m.target.theta * DEG;
        tick.translateZ(-3);
        this.overlay.add(tick);
      }
    }
    this.needsRender = true;
  }

  /** Show the recording at simulated time t (ms since program start). */
  showTime(t: number) {
    const rec = this.rec;
    if (!rec) return;
    const n = rec.frames.length / rec.stride;
    const f = Math.max(0, Math.min(n - 1, t / rec.frameEveryMs));
    const i0 = Math.floor(f);
    const i1 = Math.min(n - 1, i0 + 1);
    const a = f - i0;
    const at = (i: number, k: number) => rec.frames[i * rec.stride + k];
    const lerp = (k: number) => at(i0, k) * (1 - a) + at(i1, k) * a;
    this.robotGroup.position.copy(toThree(lerp(1), lerp(2)));
    this.robotGroup.rotation.set(0, -lerp(3) * DEG, 0);
    this.mechs.forEach((m) => {
      const k = 6 + (this.profile?.mechanisms.indexOf(m.spec) ?? -1);
      if (k < 6) return;
      const v = lerp(k);
      if (isPneumatic(m.spec)) {
        m.object.position.copy(m.base.position);
        m.object.translateZ(-(('travel' in m.spec && m.spec.travel) || 2) * v);
      } else {
        m.object.rotation.copy(m.base.rotation);
        m.object.rotateX(-v * DEG);
      }
    });
    // the game state first: what each mechanism holds, then where it is
    this.showGameAt(t);
    this.manipVis?.update(
      (m) => {
        const k = 6 + (this.profile?.mechanisms.indexOf(m) ?? -1);
        return k < 6 ? 0 : lerp(k);
      },
      t,
      { x: lerp(1), y: lerp(2), theta: lerp(3) },
    );
    const count = Math.max(2, i0 + 1);
    this.trail?.geometry.setDrawRange(0, count);
    this.frame = i0;
    this.needsRender = true;
  }

  /** Replay scoring objects: latest structural snapshot at t, then each object's track. */
  private showGameAt(t: number) {
    const g = this.gameRec;
    if (!g) return;
    let idx = 0;
    for (let i = 0; i < g.snapshots.length; i++) if (g.snapshots[i].t <= t) idx = i;
    if (idx !== this.shownSnapshot) {
      this.setGameState(g.snapshots[idx].state);
      this.shownSnapshot = idx;
    }
    for (const [id, tr] of Object.entries(g.tracks)) {
      const k = sampleAt(tr, t);
      if (k < 0) continue;
      const roll = this.toggleRolls.get(id);
      if (roll) {
        roll.rotation.x = (-tr[k + 1] * Math.PI) / 180;
        continue;
      }
      const node = this.pieceNodes.get(id);
      if (node) placeNode(node, tr[k + 1], tr[k + 2], tr[k + 3], this.lyingIds.has(id));
    }
    // dropped pieces fall from where they were let go
    for (const [id, tr] of Object.entries(this.lastGameState?.transit ?? {})) {
      if (tr.to) {
        // set down above a Goal or stack: it falls onto its place there
        const p = this.pieceMeshes.get(id);
        if (!p) continue;
        p.mesh.position.copy(p.home);
        if (t >= tr.t1) continue;
        const s = Math.max(0, (t - tr.t0) / 1000);
        const h = tr.from.z - tr.to.z;
        const fallen = 0.5 * GRAVITY_IN * s * s;
        const k = h > 0 ? Math.min(1, fallen / h) : Math.min(1, (t - tr.t0) / Math.max(1, tr.t1 - tr.t0));
        // three: x = field x, y up, z = -field y
        p.mesh.position.x += (tr.from.x - tr.to.x) * (1 - k);
        p.mesh.position.y += Math.max(0, h - fallen);
        p.mesh.position.z -= (tr.from.y - tr.to.y) * (1 - k);
        continue;
      }
      const node = this.pieceNodes.get(id);
      if (!node) continue;
      const s = Math.max(0, (t - tr.t0) / 1000);
      node.position.y = t < tr.t1 ? Math.max(0, tr.from.z - 0.5 * GRAVITY_IN * s * s) : 0;
    }
  }

  get currentFrame() {
    return this.frame;
  }

  dispose() {
    this.renderer.dispose();
  }
}
