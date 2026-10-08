// What the physics is doing, drawn over the field while a run plays: the robot's velocity and
// acceleration, its center of mass, impacts (where, which way, how hard) and a readout of the
// drive's motors and battery. Data comes from the recording: the pose frames, the `dyn` rows
// (acceleration, spin, motor current and heat, battery) and the `contacts`.

import * as THREE from 'three';
import { resolveDynamics } from '../sim/dynamics-spec.ts';
import { DYN_COLUMNS, type Recording } from '../sim/recording.ts';
import type { RobotProfile } from '../sim/profile.ts';

const DEG = Math.PI / 180;
const toThree = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);
const arrow = (color: number) => {
  const a = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, color, 1.4, 0.9);
  a.visible = false;
  return a;
};

export interface PhysicsReadout {
  speed: number;
  accel: number;
  yawRate: number;
  currentA: [number, number];
  tempC: [number, number];
  batteryV: number;
  kineticJ: number;
}

/** How long (ms) an impact stays on screen. */
const IMPACT_SHOW_MS = 600;

export class PhysicsOverlay {
  readonly group = new THREE.Group();
  private readonly vel = arrow(0x58a6ff);
  private readonly acc = arrow(0xffa657);
  private readonly com = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshBasicMaterial({ color: 0xf85149, depthTest: false }));
  private readonly hits = new THREE.Group();
  private rec: Recording | null = null;
  private profile: RobotProfile | null = null;
  private mass = 5;

  constructor() {
    this.group.add(this.vel, this.acc, this.com, this.hits);
    this.group.visible = false;
    this.com.renderOrder = 10;
  }

  set visible(on: boolean) {
    this.group.visible = on;
  }
  get visible(): boolean {
    return this.group.visible;
  }

  setRecording(rec: Recording | null, profile: RobotProfile | null): void {
    this.rec = rec;
    this.profile = profile;
    this.mass = profile ? resolveDynamics(profile).mass : 5;
    this.hits.clear();
    this.vel.visible = this.acc.visible = false;
  }

  /** Whether the recording has dynamics to show (older ones do not). */
  get available(): boolean {
    return !!this.rec?.dyn && this.rec.dyn.length > 0;
  }

  /** Pose the overlay for frame position `f` (fractional) at time `t`; returns the readout for the HUD. */
  update(f: number, t: number): PhysicsReadout | null {
    const rec = this.rec;
    if (!rec || !rec.dyn || !this.group.visible) return null;
    const n = rec.frames.length / rec.stride;
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(f)));
    const i1 = Math.min(n - 1, i0 + 1);
    const a = Math.max(0, Math.min(1, f - i0));
    const at = (i: number, k: number) => rec.frames[i * rec.stride + k];
    const lerp = (k: number) => at(i0, k) * (1 - a) + at(i1, k) * a;
    const dn = DYN_COLUMNS.length;
    const dy = (k: number) => rec.dyn![i0 * dn + k] * (1 - a) + rec.dyn![i1 * dn + k] * a;
    const x = lerp(1);
    const y = lerp(2);
    const th = lerp(3) * DEG;
    const vL = lerp(4);
    const vR = lerp(5);
    const speed = (vL + vR) / 2;
    const fwd = new THREE.Vector3(Math.sin(th), 0, -Math.cos(th)); // three frame
    const place = (arr: THREE.ArrowHelper, mag: number, scale: number, h: number) => {
      const len = Math.min(18, Math.abs(mag) * scale);
      arr.visible = len > 0.4;
      if (!arr.visible) return;
      arr.position.copy(toThree(x, y, h));
      arr.setDirection(mag >= 0 ? fwd : fwd.clone().negate());
      arr.setLength(len, Math.min(1.6, len * 0.5), Math.min(1, len * 0.3));
    };
    place(this.vel, speed, 0.25, 3);
    const accel = dy(0);
    place(this.acc, accel, 0.04, 4);
    // center of mass
    if (this.profile) {
      const d = resolveDynamics(this.profile);
      const cx = d.com.x / 0.0254;
      const cy = d.com.y / 0.0254;
      this.com.position.copy(toThree(x + cx * Math.cos(th) + cy * Math.sin(th), y - cx * Math.sin(th) + cy * Math.cos(th), d.com.z / 0.0254));
    }
    // impacts in the last moments
    this.hits.clear();
    for (const c of rec.contacts ?? []) {
      if (c.impulse === undefined || c.x === undefined || c.y === undefined || c.nx === undefined || c.ny === undefined) continue;
      const age = t - c.t;
      if (age < 0 || age > IMPACT_SHOW_MS) continue;
      const k = 1 - age / IMPACT_SHOW_MS;
      const len = Math.min(14, 2 + c.impulse * 1.5) * k + 0.5;
      const h = new THREE.ArrowHelper(new THREE.Vector3(c.nx, 0, -c.ny), toThree(c.x, c.y, 2), len, 0xf85149, 1.4, 1);
      h.setColor(new THREE.Color().setHSL(0.0, 0.85, 0.35 + 0.3 * k));
      this.hits.add(h);
    }
    const w = (dy(1) * DEG) as number;
    const kinetic = 0.5 * this.mass * (speed * 0.0254) ** 2 + (this.profile ? 0.5 * resolveDynamics(this.profile).inertia * w * w : 0);
    return { speed, accel, yawRate: dy(1), currentA: [dy(2), dy(3)], tempC: [dy(4), dy(5)], batteryV: dy(6), kineticJ: kinetic };
  }
}

/** The readout as text lines for the HUD. */
export function readoutText(r: PhysicsReadout): string {
  const f = (n: number, d = 1) => n.toFixed(d);
  return [
    `speed ${f(r.speed)} in/s   accel ${f(r.accel, 0)} in/s²`,
    `turn ${f(r.yawRate, 0)} °/s   KE ${f(r.kineticJ, 2)} J`,
    `motor current L ${f(r.currentA[0], 2)} A  R ${f(r.currentA[1], 2)} A`,
    `motor temp L ${f(r.tempC[0], 0)} °C  R ${f(r.tempC[1], 0)} °C`,
    `battery ${f(r.batteryV, 2)} V`,
  ].join('\n');
}
