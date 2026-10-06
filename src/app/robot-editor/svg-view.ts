// One view of the robot layout editor (top or side) as an SVG on an inch grid: the
// chassis, wheels and mechanisms drawn from the profile, with draggable shapes.

import { clawEffector, liftEffector } from '../../sim/lift.ts';
import type { LiftSpec, RobotProfile } from '../../sim/profile.ts';
import { barPivot, snapIn, type Handle, type Shape, type View } from './draft.ts';

const NS = 'http://www.w3.org/2000/svg';
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
};

export interface ViewEvents {
  /** A shape was dragged (live, while dragging). */
  edit(h: Handle, s: Shape): void;
  /** A drag ended (one undo step). */
  commit(): void;
  /** Something was clicked: open its properties. */
  pick(owner: string): void;
}

export class SvgView {
  private readonly svg: SVGSVGElement;
  private profile: RobotProfile | null = null;
  private handles: Handle[] = [];
  private selected = '';
  private drag: { h: Handle; mode: 'move' | 'corner'; start: Shape; at: { u: number; v: number }; corner: [number, number] } | null = null;
  private readonly host: HTMLElement;
  private readonly view: View;
  private readonly on: ViewEvents;

  constructor(host: HTMLElement, view: View, on: ViewEvents) {
    this.host = host;
    this.view = view;
    this.on = on;
    this.svg = el('svg', { class: 'rl-svg', role: 'img', 'aria-label': view === 'top' ? 'Robot seen from above, front up' : 'Robot seen from the side, front to the right' }, host);
    this.svg.addEventListener('pointermove', this.move);
    this.svg.addEventListener('pointerup', this.up);
    this.svg.addEventListener('pointercancel', this.up);
  }

  render(p: RobotProfile, handles: Handle[], selected: string): void {
    this.profile = p;
    this.handles = handles.filter((h) => h.view === this.view);
    this.selected = selected;
    const s = this.svg;
    s.replaceChildren();
    // the frame: the robot plus room around it for mechanisms that reach out
    const reach = Math.max(p.size.width, p.size.length, p.size.height, 18);
    const [u0, u1, v0, v1] = this.view === 'top' ? [-reach * 0.75, reach * 0.75, -reach * 0.85, reach * 0.85] : [-reach * 0.95, reach * 0.95, -2, reach * 1.9];
    s.setAttribute('viewBox', `${u0} ${-v1} ${u1 - u0} ${v1 - v0}`);
    s.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    // inch grid (6" lines darker), axes
    const grid = el('g', { class: 'rl-grid' }, s);
    for (let u = Math.ceil(u0); u <= u1; u++) el('line', { x1: u, y1: -v1, x2: u, y2: -v0, class: u % 6 ? 'g1' : u ? 'g6' : 'g0' }, grid);
    for (let v = Math.ceil(v0); v <= v1; v++) el('line', { x1: u0, y1: -v, x2: u1, y2: -v, class: v % 6 ? 'g1' : v ? 'g6' : 'g0' }, grid);
    el('text', { x: u1 - 0.5, y: -v1 + 1.6, class: 'rl-axis', 'text-anchor': 'end' }, s).textContent = this.view === 'top' ? 'front ↑ · 1 square = 1″' : 'front → · up ↑ · 1 square = 1″';
    this.drawRobot(s, p);
    for (const h of this.handles) this.drawHandle(s, p, h);
  }

  /** The parts that aren't handles: wheels, lift bars and paths, claws. */
  private drawRobot(s: SVGSVGElement, p: RobotProfile): void {
    const d = p.drivetrain;
    const r = d.wheelDiameter / 2;
    const g = el('g', { class: 'rl-robot' }, s);
    if (this.view === 'top') {
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) el('rect', { x: sx * d.trackWidth / 2 - 0.5, y: -(sy * (p.size.length / 2 - r - 0.5)) - r, width: 1, height: 2 * r, class: 'rl-wheel' }, g);
      }
      // the front
      el('path', { d: `M -1.5 ${-p.size.length / 2 - 0.4} L 0 ${-p.size.length / 2 - 2} L 1.5 ${-p.size.length / 2 - 0.4} Z`, class: 'rl-front' }, g);
      return;
    }
    for (const sy of [-1, 1]) el('circle', { cx: sy * (p.size.length / 2 - r - 0.5), cy: -r, r, class: 'rl-wheel' }, g);
    for (const m of p.mechanisms) {
      if (m.kind !== 'lift') continue;
      const l = m as LiftSpec;
      // where the lift can take its end effector: its path over its whole range
      const [lo, hi] = l.range ?? (l.lift === 'piston' ? [0, 1] : [0, 90]);
      const pts: string[] = [];
      for (let i = 0; i <= 24; i++) {
        const e = liftEffector(l, lo + ((hi - lo) * i) / 24);
        pts.push(`${e.y},${-e.z}`);
      }
      el('polyline', { points: pts.join(' '), class: 'rl-path' }, g);
      if (['arm', 'fourbar', 'sixbar', 'chainbar'].includes(l.lift) && l.length) {
        const piv = barPivot(l);
        el('line', { x1: piv.y, y1: -piv.z, x2: l.home.y, y2: -l.home.z, class: 'rl-bar' }, g);
      } else if (l.lift === 'cascade' || l.lift === 'dr4b' || l.lift === 'piston') {
        el('line', { x1: l.home.y, y1: -l.home.z, x2: l.home.y, y2: 0, class: 'rl-bar' }, g);
      }
    }
    for (const m of p.mechanisms) {
      if (m.kind !== 'claw') continue;
      // the claw at rest, and how far it reaches for a piece
      const e = clawEffector(p, m, () => 0);
      el('circle', { cx: e.y, cy: -e.z, r: m.reach ?? 2, class: 'rl-reach' }, g);
      el('rect', { x: e.y - 0.6, y: -e.z - 0.6, width: 1.2, height: 1.2, class: 'rl-claw' }, g);
    }
  }

  private drawHandle(s: SVGSVGElement, p: RobotProfile, h: Handle): void {
    const sh = h.get(p);
    const sel = h.owner === this.selected;
    const g = el('g', { class: `rl-h ${sel ? 'sel' : ''}`, style: `--c: ${h.color}` }, s);
    el('title', {}, g).textContent = h.label;
    if (h.kind === 'rect') {
      const x = sh.u - sh.w! / 2;
      const y = -(sh.v + sh.h! / 2);
      const body = el('rect', { x, y, width: sh.w!, height: sh.h!, class: 'rl-rect' }, g);
      body.addEventListener('pointerdown', (e) => this.down(e, h, 'move', [0, 0]));
      // resize from any corner
      for (const cx of [-1, 1]) {
        for (const cy of [-1, 1]) {
          const k = el('rect', { x: sh.u + (cx * sh.w!) / 2 - 0.45, y: -(sh.v + (cy * sh.h!) / 2) - 0.45, width: 0.9, height: 0.9, class: 'rl-corner' }, g);
          k.addEventListener('pointerdown', (e) => this.down(e, h, 'corner', [cx, cy]));
        }
      }
    } else {
      const c = el('circle', { cx: sh.u, cy: -sh.v, r: 0.8, class: 'rl-point' }, g);
      c.addEventListener('pointerdown', (e) => this.down(e, h, 'move', [0, 0]));
    }
  }

  /** The view point (inches) under the pointer. */
  private at(e: PointerEvent): { u: number; v: number } {
    const m = this.svg.getScreenCTM();
    if (!m) return { u: 0, v: 0 };
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { u: pt.x, v: -pt.y };
  }

  private down(e: PointerEvent, h: Handle, mode: 'move' | 'corner', corner: [number, number]): void {
    if (e.button !== 0 || !this.profile) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      this.svg.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer the browser no longer tracks: the drag still works while over the view */
    }
    this.drag = { h, mode, start: h.get(this.profile), at: this.at(e), corner };
    this.on.pick(h.owner);
  }

  private move = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || !this.profile) return;
    const now = this.at(e);
    const coarse = e.shiftKey;
    const s = d.start;
    let next: Shape;
    if (d.mode === 'move') {
      if (d.h.centered) return; // the chassis stays centered on the robot
      next = { ...s, u: snapIn(s.u + now.u - d.at.u, coarse), v: d.h.uOnly ? s.v : snapIn(s.v + now.v - d.at.v, coarse) };
    } else if (d.h.centered) {
      // symmetric about the robot's center (and, seen from the side, standing on the floor)
      const w = Math.max(1, snapIn(Math.abs(now.u) * 2, coarse));
      const h = this.view === 'side' ? Math.max(1, snapIn(Math.abs(now.v), coarse)) : Math.max(1, snapIn(Math.abs(now.v) * 2, coarse));
      next = { u: 0, v: this.view === 'side' ? h / 2 : 0, w, h };
    } else {
      // the opposite corner stays put
      const [cx, cy] = d.corner;
      const fu = s.u - (cx * s.w!) / 2;
      const fv = s.v - (cy * s.h!) / 2;
      const nu = snapIn(now.u, coarse);
      const nv = snapIn(now.v, coarse);
      const w = Math.max(0.25, Math.abs(nu - fu));
      const h = Math.max(0.25, Math.abs(nv - fv));
      next = { u: (nu + fu) / 2, v: (nv + fv) / 2, w, h };
    }
    this.on.edit(d.h, next);
  };

  private up = (e: PointerEvent): void => {
    if (!this.drag) return;
    this.drag = null;
    if (this.svg.hasPointerCapture(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
    this.on.commit();
  };

  /** The host element (for layout). */
  get element(): HTMLElement {
    return this.host;
  }
}
