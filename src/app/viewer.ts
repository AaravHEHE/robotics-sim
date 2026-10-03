// Three.js field + robot viewer. Field coordinates (inches, +y away from the near
// wall, heading clockwise from +y) map to three.js as x -> x, y -> -z, up = +y.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { FieldDef } from '../sim/field.ts';
import { isPneumatic, type MechanismSpec, type RobotProfile } from '../sim/profile.ts';
import type { Recording } from '../sim/recording.ts';
import type { OverrideRecording } from '../games/override/game.ts';
import { sampleAt } from '../games/override/replay.ts';
import type { OverrideState } from '../games/override/state.ts';
import { ManipulatorVisuals } from './manipulator-meshes.ts';
import { drawTape, goalMesh, loaderMesh, piecesGroup, placeNode, toggleMesh } from './override-meshes.ts';

export type ViewMode = 'top' | 'orbit' | 'follow';
export interface FieldPose {
  x: number;
  y: number;
  theta: number;
}

const DEG = Math.PI / 180;
const toThree = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);

interface MechVisual {
  spec: MechanismSpec;
  object: THREE.Object3D;
  base: { rotation: THREE.Euler; position: THREE.Vector3 };
}

export class FieldViewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly fieldGroup = new THREE.Group();
  private readonly robotGroup = new THREE.Group();
  private readonly ghost = new THREE.Group();
  private readonly overlay = new THREE.Group();
  /** Scoring objects of a game field. */
  private readonly gameGroup = new THREE.Group();
  /** Toggle id -> group to rotate for its roll angle. */
  private readonly toggleRolls = new Map<string, THREE.Group>();
  /** Movable piece nodes (floor stacks, lying pins) of the shown game state, by id. */
  private pieceNodes = new Map<string, THREE.Object3D>();
  private lyingIds = new Set<string>();
  private gameRec: OverrideRecording | null = null;
  private shownSnapshot = -1;
  private trail: THREE.Line | null = null;
  private futureTrail: THREE.Line | null = null;
  private rec: Recording | null = null;
  private mechs: MechVisual[] = [];
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
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 2000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.addEventListener('change', () => (this.needsRender = true));
    this.controls.addEventListener('start', () => (this.userMoved = true));

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x50555c, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(60, 160, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 400 });
    this.scene.add(sun);
    this.scene.add(this.fieldGroup, this.gameGroup, this.overlay, this.ghost, this.robotGroup);
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
    this.field = field;
    this.fieldGroup.clear();
    this.gameGroup.clear();
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
    // subtle foam speckle (deterministic)
    let seed = 7;
    for (let i = 0; i < 9000; i++) {
      seed = (seed * 16807) % 2147483647;
      const x = seed % px;
      seed = (seed * 16807) % 2147483647;
      const y = seed % px;
      g.fillStyle = `rgba(255,255,255,${(seed % 10) / 400})`;
      g.fillRect(x, y, 2, 2);
    }
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 3;
    for (let i = 1; i < n; i++) {
      const p = (i / n) * px;
      g.beginPath();
      g.moveTo(p, 0);
      g.lineTo(p, px);
      g.moveTo(0, p);
      g.lineTo(px, p);
      g.stroke();
    }
    drawTape(g, field, px);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(inside, inside), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.fieldGroup.add(floor);

    // surrounding floor
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(inside * 3, inside * 3), new THREE.MeshStandardMaterial({ color: 0x777b80, roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.05;
    outer.receiveShadow = true;
    this.fieldGroup.add(outer);

    // perimeter: aluminum rails with clear panels
    const { wallHeight: h, wallThickness: t } = field.perimeter;
    const rail = new THREE.MeshStandardMaterial({ color: 0xc8ccd1, metalness: 0.6, roughness: 0.35 });
    const panel = new THREE.MeshPhysicalMaterial({ color: 0xdfe8f0, transparent: true, opacity: 0.18, roughness: 0.05, depthWrite: false });
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
        this.fieldGroup.add(r);
      }
      const p = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w - 0.6, 0.3), h - 2, Math.max(d - 0.6, 0.3)), panel);
      p.position.set(x, h / 2, z);
      this.fieldGroup.add(p);
    }
    // corner posts
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(t * 1.4, h + 0.5, t * 1.4), rail);
        post.position.set(sx * (half + t / 2), h / 2, sz * (half + t / 2));
        post.castShadow = true;
        this.fieldGroup.add(post);
      }
    }
    // game field elements (goals, toggles, loaders)
    for (const goal of field.goals ?? []) this.fieldGroup.add(goalMesh(goal));
    for (const t of field.toggles ?? []) {
      const { outer, roll } = toggleMesh(t, field);
      this.toggleRolls.set(t.id, roll);
      this.fieldGroup.add(outer);
    }
    for (const l of field.loaders ?? []) this.fieldGroup.add(loaderMesh(l, field));
    this.setView(this.mode);
  }

  /** Show a game state's scoring objects and toggle angles (null hides them). */
  setGameState(state: OverrideState | null) {
    this.gameGroup.clear();
    this.pieceNodes = new Map();
    this.lyingIds = new Set(state?.lying.map((l) => l.id) ?? []);
    this.lastGameState = state;
    this.manipVis?.setHeld(state);
    if (state && this.field) {
      const { group, nodes } = piecesGroup(this.field, state);
      this.pieceNodes = nodes;
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
    this.profile = profile;
    this.robotGroup.clear();
    this.ghost.clear();
    this.mechs = [];
    const body = glb ? await this.loadModel(profile, glb).catch(() => null) : null;
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
    const g = new THREE.Group();
    const { width, length, height } = p.size;
    const metal = new THREE.MeshStandardMaterial({ color: 0xb9bec5, metalness: 0.55, roughness: 0.4 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xd8343a, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.8 });
    const wheelR = p.drivetrain.wheelDiameter / 2;

    // drive rails, cross members and a deck
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1, 2, length), metal);
      rail.position.set((sx * (width - 1)) / 2, wheelR + 0.5, 0);
      g.add(rail);
    }
    for (const sz of [-1, 0, 1]) {
      const cross = new THREE.Mesh(new THREE.BoxGeometry(width - 2, 1, 1), metal);
      cross.position.set(0, wheelR + 1, (sz * (length - 2)) / 2);
      g.add(cross);
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(width - 3, 0.25, length * 0.55), dark);
    deck.position.set(0, wheelR + 1.7, length * 0.08);
    g.add(deck);
    const brain = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1, 3), dark);
    brain.position.set(0, wheelR + 2.3, length * 0.15);
    g.add(brain);
    // tower so the robot reads at its real height
    const tower = new THREE.Mesh(new THREE.BoxGeometry(1, height - wheelR - 2, 1), metal);
    for (const sx of [-1, 1]) {
      const t = tower.clone();
      t.position.set((sx * (width - 4)) / 2, (height + wheelR + 2) / 2, length * 0.2);
      g.add(t);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(width - 3, 1, 1), accent);
    bar.position.set(0, height - 0.5, length * 0.2);
    g.add(bar);

    // wheels at the profile's track width
    const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 1.1, 24);
    wheelGeo.rotateZ(Math.PI / 2);
    const rollers = new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.7 });
    const nWheels = Math.max(2, Math.min(4, p.drivetrain.left.length));
    for (const sx of [-1, 1]) {
      for (let i = 0; i < nWheels; i++) {
        const w = new THREE.Mesh(wheelGeo, rollers);
        const z = -length / 2 + wheelR + 0.5 + (i * (length - 2 * wheelR - 1)) / (nWheels - 1);
        w.position.set((sx * p.drivetrain.trackWidth) / 2, wheelR, z);
        w.castShadow = true;
        g.add(w);
      }
    }
    // front marker
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.4, 3), accent);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, wheelR + 2.5, -length / 2 - 0.6);
    g.add(nose);

    // mechanisms
    let pistonSlot = 0;
    for (const m of p.mechanisms) {
      if (ManipulatorVisuals.handles(m)) continue;
      if (m.kind === 'piston') {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(width * 0.5, 2.5, 0.6), accent);
        plate.position.set(0, wheelR + 4 + pistonSlot * 3, -length / 2 + 1.2);
        pistonSlot++;
        g.add(plate);
        this.mechs.push({ spec: m, object: plate, base: { rotation: plate.rotation.clone(), position: plate.position.clone() } });
      } else {
        const roller = new THREE.Group();
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, width - 3, 16), new THREE.MeshStandardMaterial({ color: 0x2d6cdf, roughness: 0.5 }));
        drum.rotation.z = Math.PI / 2;
        const flap = new THREE.Mesh(new THREE.BoxGeometry(width - 3.2, 0.3, 2.8), dark);
        flap.position.y = 1.2;
        roller.add(drum, flap);
        roller.position.set(0, wheelR + 1.5, -length / 2 - 1.2);
        g.add(roller);
        this.mechs.push({ spec: m, object: roller, base: { rotation: roller.rotation.clone(), position: roller.position.clone() } });
      }
    }
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    return g;
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
    for (const m of p.mechanisms) {
      if (!m.node) continue;
      const obj = root.getObjectByName(m.node);
      if (obj) this.mechs.push({ spec: m, object: obj, base: { rotation: obj.rotation.clone(), position: obj.position.clone() } });
    }
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
    this.overlay.clear();
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
    this.manipVis?.update((m) => {
      const k = 6 + (this.profile?.mechanisms.indexOf(m) ?? -1);
      return k < 6 ? 0 : lerp(k);
    });
    this.showGameAt(t);
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
  }

  get currentFrame() {
    return this.frame;
  }

  dispose() {
    this.renderer.dispose();
  }
}
