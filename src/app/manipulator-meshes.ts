// Box-robot visuals for game manipulators (lifts, claws, intakes, staging, Toggle
// tools) and the pieces each one holds. Everything lives in the robot group's local
// frame: three (x, y, z) = robot (x right, z up, -forward).

import * as THREE from 'three';
import { layoutStack, type Piece } from '../games/override/elements.ts';
import { clawClosed } from '../games/override/manipulators.ts';
import type { OverrideState } from '../games/override/state.ts';
import { clawEffector, liftEffector, type Point3 } from '../sim/lift.ts';
import type { LiftSpec, MechanismSpec, RobotProfile } from '../sim/profile.ts';
import { cupMesh, pinMesh } from './override-meshes.ts';

const local = (p: Point3) => new THREE.Vector3(p.x, p.z, -p.y);
const DEG = Math.PI / 180;
const Z = new THREE.Vector3(0, 0, 1);

type ValueOf = (m: MechanismSpec) => number;

/** A bar from a to b (robot-local three coordinates), as a unit box scaled each update. */
function bar(color: number, thickness = 0.8): { mesh: THREE.Mesh; set(a: THREE.Vector3, b: THREE.Vector3): void } {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, 1), new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.5 }));
  return {
    mesh,
    set(a, b) {
      const len = Math.max(0.01, a.distanceTo(b));
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.scale.set(1, 1, len);
      mesh.quaternion.setFromUnitVectors(Z, b.clone().sub(a).normalize());
    },
  };
}

function stackMeshes(pieces: Piece[]): THREE.Group {
  const g = new THREE.Group();
  for (const slot of layoutStack(pieces, 0, false)) {
    const m = slot.piece.kind === 'pin' ? pinMesh(slot.piece.colors) : cupMesh(slot.piece.up);
    m.position.y = slot.bottom;
    g.add(m);
  }
  return g;
}

export class ManipulatorVisuals {
  /** Where each holder's pieces sit (claw grip point, intake, staging). */
  private readonly holders = new Map<string, THREE.Group>();
  private readonly updates: Array<(v: ValueOf) => void> = [];
  private grips: Record<string, number> = {};

  /** `boxes`: draw mechanisms (box robot); otherwise only held pieces (GLB models). */
  constructor(profile: RobotProfile, root: THREE.Group, boxes: boolean) {
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.7 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xffb020, roughness: 0.5 });
    for (const m of profile.mechanisms) {
      if (m.kind === 'lift' && boxes) this.lift(m, root);
      if (m.kind === 'claw') {
        const holder = new THREE.Group();
        root.add(holder);
        this.holders.set(m.name, holder);
        const fingers = boxes ? [new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.5, 2), accent), new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.5, 2), accent)] : [];
        for (const f of fingers) root.add(f);
        this.updates.push((v) => {
          const e = local(clawEffector(profile, m, v));
          holder.position.copy(e).add(new THREE.Vector3(0, -(this.grips[m.name] ?? 0), 0));
          const gap = m.grip === 'roller' || clawClosed(m, v(m)) ? 1.9 : 2.8;
          fingers.forEach((f, i) => f.position.copy(e).add(new THREE.Vector3(i ? gap : -gap, 0, 0)));
        });
      }
      if (m.kind === 'intake') {
        const holder = new THREE.Group();
        holder.position.copy(local({ x: m.zone.x, y: m.zone.y - m.zone.length / 2 - 2, z: 0.5 }));
        root.add(holder);
        this.holders.set(m.name, holder);
        if (boxes) {
          const drum = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, m.zone.width, 12), new THREE.MeshStandardMaterial({ color: 0x2d6cdf, roughness: 0.5 }));
          drum.rotation.z = Math.PI / 2;
          const spin = new THREE.Group();
          spin.add(drum, new THREE.Mesh(new THREE.BoxGeometry(m.zone.width - 0.2, 0.25, 2.4), dark));
          spin.position.copy(local({ x: m.zone.x, y: m.zone.y + m.zone.length / 2 - 1, z: 1.5 }));
          root.add(spin);
          this.updates.push((v) => (spin.rotation.x = -v(m) * DEG));
        }
      }
      if (m.kind === 'staging') {
        const holder = new THREE.Group();
        holder.position.copy(local({ x: m.at.x ?? 0, y: m.at.y, z: m.at.z }));
        root.add(holder);
        this.holders.set(m.name, holder);
        if (boxes) {
          const tray = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 4), dark);
          tray.position.copy(holder.position).add(new THREE.Vector3(0, -0.2, 0));
          root.add(tray);
        }
      }
      if (m.kind === 'toggleTool' && boxes) {
        const h = m.top - m.bottom;
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(m.box.width, h, m.box.length),
          new THREE.MeshStandardMaterial({ color: m.tool === 'roller' ? 0x2d6cdf : 0x8a5cf6, roughness: 0.5, transparent: true, opacity: 0.9 }),
        );
        const at = local({ x: m.box.x, y: m.box.y, z: m.bottom + h / 2 });
        box.position.copy(at);
        root.add(box);
        if (m.tool === 'plate') {
          this.updates.push((v) => {
            const out = v(m) >= 0.5;
            box.position.copy(at).add(new THREE.Vector3(0, 0, out ? 0 : m.box.length + 1));
            (box.material as THREE.MeshStandardMaterial).opacity = out ? 0.9 : 0.35;
          });
        }
        if (m.tool === 'roller') this.updates.push((v) => (box.rotation.x = -v(m) * DEG * 0.1));
      }
    }
  }

  private lift(m: LiftSpec, root: THREE.Group): void {
    const L = m.length ?? 0;
    const a0 = (m.startAngle ?? 0) * DEG;
    const arm = m.lift === 'arm' || m.lift === 'fourbar' || m.lift === 'sixbar';
    const pivot = arm
      ? local({ x: m.home.x ?? 0, y: m.home.y - L * Math.cos(a0), z: m.home.z - L * Math.sin(a0) })
      : local({ x: m.home.x ?? 0, y: m.home.y, z: 2 });
    const bars = [-1.5, 1.5].map(() => bar(0xb9bec5));
    for (const b of bars) root.add(b.mesh);
    this.updates.push((v) => {
      const e = local(liftEffector(m, v(m)));
      bars.forEach((b, i) => {
        const dx = new THREE.Vector3(i ? 1.5 : -1.5, 0, 0);
        b.set(pivot.clone().add(dx), e.clone().add(dx));
      });
    });
  }

  /** Show what each holder has (from a game state snapshot). */
  setHeld(state: OverrideState | null): void {
    this.grips = state?.grip ?? {};
    for (const [name, holder] of this.holders) {
      holder.clear();
      const pieces = state?.held[name] ?? [];
      if (pieces.length) holder.add(stackMeshes(pieces));
    }
  }

  /** Pose everything for the mechanisms' current outputs. */
  update(valueOf: ValueOf): void {
    for (const u of this.updates) u(valueOf);
  }

  /** Mechanism kinds drawn here rather than by the generic roller / piston visuals. */
  static handles(m: MechanismSpec): boolean {
    return ['lift', 'claw', 'intake', 'staging', 'wrist', 'toggleTool'].includes(m.kind);
  }
}
