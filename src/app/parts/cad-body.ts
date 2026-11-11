// A robot's body drawn from a CAD build (data/builds), moving with the robot's lift: the build
// from scripts/import-onshape.ts, the motion from scripts/gen-motion.ts (when the lift has one).
// Cosmetic only, like every model: the profile decides what the robot does.
import * as THREE from 'three';
import type { Assembly } from './assembly.ts';
import { poseBuild, type MotionSpec } from './build-motion.ts';
import { CATALOG } from './catalog.ts';
import { placeObject, partObject } from './geometry.ts';

/** The CAD builds the app knows, loaded when a robot asks for one (they are large). */
const BUILDS: Record<string, () => Promise<{ build: Assembly; motion?: MotionSpec }>> = {
  cascade: async () => ({
    build: (await import('../../../data/builds/cascade.fixed.build.json')).default as unknown as Assembly,
    motion: (await import('../../../data/builds/cascade.motion.json')).default as unknown as MotionSpec,
  }),
  continuous: async () => ({
    build: (await import('../../../data/builds/continuous.fixed.build.json')).default as unknown as Assembly,
    motion: (await import('../../../data/builds/continuous.motion.json')).default as unknown as MotionSpec,
  }),
  dr4b: async () => ({
    build: (await import('../../../data/builds/dr4b.fixed.build.json')).default as unknown as Assembly,
    motion: (await import('../../../data/builds/dr4b.motion.json')).default as unknown as MotionSpec,
  }),
  // the DR6B moves from its real mates (scripts/onshape/mates-to-motion.py); its gears are meant to counter-rotate in
  // pairs (a 1:1 gear relation in the CAD), so it uses the imported build, not the odd-gear copy
  dr6b: async () => ({
    build: (await import('../../../data/builds/dr6b.build.json')).default as unknown as Assembly,
    motion: (await import('../../../data/builds/dr6b.motion.json')).default as unknown as MotionSpec,
  }),
  sixbar: async () => ({ build: (await import('../../../data/builds/sixbar.fixed.build.json')).default as unknown as Assembly }),
  fourbar: async () => ({
    build: (await import('../../../data/builds/fourbar.fixed.build.json')).default as unknown as Assembly,
    motion: (await import('../../../data/builds/fourbar.motion.json')).default as unknown as MotionSpec,
  }),
  'claw-piston': async () => ({ build: (await import('../../../data/builds/claw-piston.build.json')).default as unknown as Assembly }),
  twobar: async () => ({
    build: (await import('../../../data/builds/twobar.fixed.build.json')).default as unknown as Assembly,
    motion: (await import('../../../data/builds/twobar.motion.json')).default as unknown as MotionSpec,
  }),
};

export const CAD_BUILD_NAMES = Object.keys(BUILDS);

export class CadBody {
  /** The body, in three.js axes (y up, the robot's front toward -z), inches. */
  readonly group = new THREE.Group();
  private readonly objects: THREE.Object3D[] = [];
  private readonly moving: number[];
  private readonly build: Assembly;
  private readonly motion?: MotionSpec;
  private last = NaN;

  constructor(build: Assembly, motion?: MotionSpec) {
    this.build = build;
    this.motion = motion;
    const inner = new THREE.Group();
    inner.rotation.x = -Math.PI / 2; // robot frame (x right, y forward, z up) into three.js
    this.group.add(inner);
    for (const p of build.parts) {
      const def = CATALOG.parts.find((d) => d.id === p.part);
      const o = def ? partObject(def, p, build.meshes) : new THREE.Group();
      this.objects.push(o);
      inner.add(o);
    }
    this.moving = [...new Set(motion?.groups.flatMap((g) => g.parts) ?? [])];
  }

  /** Whether the build moves at all (a build without a motion spec is a static pose). */
  get animated(): boolean {
    return this.moving.length > 0;
  }

  /** The motion output for a lift that is a fraction `t` (0..1) of the way through its range: the CAD's travel, from its rest pose. */
  outAt(t: number): number {
    return this.motion ? Math.max(0, Math.min(1, t)) * this.motion.out.max : 0;
  }

  /** Pose the build for the lift's output (degrees for arms, inches of rise for slides). */
  setOut(out: number): void {
    const m = this.motion;
    if (!m || !this.moving.length) return;
    const o = Math.max(m.out.min, Math.min(m.out.max, out));
    if (o === this.last) return;
    this.last = o;
    const posed = poseBuild(this.build, m, o);
    for (const i of this.moving) {
      const def = CATALOG.parts.find((d) => d.id === posed.parts[i].part);
      if (def) placeObject(this.objects[i], def, posed.parts[i]);
    }
  }
}

/** The body for a CAD build by name, or null when the app has no such build. */
export async function loadCadBody(name: string): Promise<CadBody | null> {
  const load = BUILDS[name];
  if (!load) return null;
  const { build, motion } = await load();
  return new CadBody(build, motion);
}
