// Auton mapping drawn over the field: plotted points (numbered), the route between them, a
// measuring line with its reading, and the cursor. Field inches map to three.js as
// x -> x, y -> -z, up = +y (as in the viewer).

import * as THREE from 'three';
import type { MapPoint } from './mapping.ts';

const LIFT = 0.35; // just above the floor (and its tape)
const COLORS = { point: 0x4f8cff, selected: 0xffb020, route: 0x4f8cff, measure: 0xff4fa3, cursor: 0xffffff };

const at = (x: number, y: number, h = LIFT) => new THREE.Vector3(x, h, -y);

/** A text label that always faces the camera, `height` inches tall. */
function label(text: string, color: string, height: number): THREE.Sprite {
  const pad = 12;
  const font = '600 44px system-ui, sans-serif';
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width) + pad * 2;
  c.height = 60;
  g.font = font;
  g.fillStyle = 'rgba(15, 17, 21, 0.78)';
  g.beginPath();
  g.roundRect(0, 0, c.width, c.height, 14);
  g.fill();
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, pad, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set((height * c.width) / c.height, height, 1);
  s.renderOrder = 10;
  return s;
}

function dispose(group: THREE.Object3D): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material & { map?: THREE.Texture };
    if (mat) {
      mat.map?.dispose();
      mat.dispose();
    }
  });
  group.clear();
}

export class MapLayer {
  readonly group = new THREE.Group();
  private readonly points = new THREE.Group();
  private readonly measureGroup = new THREE.Group();
  private readonly cursor: THREE.Mesh;

  constructor() {
    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.3, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: COLORS.cursor, transparent: true, opacity: 0.85, depthTest: false }),
    );
    this.cursor.renderOrder = 9;
    this.cursor.visible = false;
    this.group.add(this.points, this.measureGroup, this.cursor);
  }

  /** The plotted points, numbered in order, with the route between them and each one's heading. */
  setPoints(points: MapPoint[], selected: string | null): void {
    dispose(this.points);
    if (points.length > 1) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points.map((p) => at(p.x, p.y))),
        new THREE.LineDashedMaterial({ color: COLORS.route, dashSize: 2, gapSize: 1.2, depthTest: false }),
      );
      line.computeLineDistances();
      line.renderOrder = 8;
      this.points.add(line);
    }
    points.forEach((p, i) => {
      const color = p.id === selected ? COLORS.selected : COLORS.point;
      const dot = new THREE.Mesh(new THREE.CircleGeometry(1.1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      dot.position.copy(at(p.x, p.y));
      dot.renderOrder = 9;
      this.points.add(dot);
      if (p.heading !== undefined) {
        // an arrow for the heading the robot should face here
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3, 3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, depthTest: false }));
        const r = (p.heading * Math.PI) / 180;
        arrow.position.copy(at(p.x + Math.sin(r) * 3, p.y + Math.cos(r) * 3));
        arrow.rotation.y = -r;
        arrow.renderOrder = 9;
        this.points.add(arrow);
      }
      const tag = label(p.label ? `${i + 1} ${p.label}` : String(i + 1), p.id === selected ? '#ffb020' : '#cfe0ff', 3.6);
      tag.position.copy(at(p.x, p.y, 4));
      this.points.add(tag);
    });
  }

  /** A measuring line from a to b with its reading (or none). */
  setMeasure(a: { x: number; y: number } | null, b: { x: number; y: number } | null, text: string): void {
    dispose(this.measureGroup);
    if (!a) return;
    const mark = (p: { x: number; y: number }) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COLORS.measure, depthTest: false }));
      m.position.copy(at(p.x, p.y, LIFT + 0.05));
      m.renderOrder = 9;
      this.measureGroup.add(m);
    };
    mark(a);
    if (!b) return;
    mark(b);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([at(a.x, a.y, LIFT + 0.05), at(b.x, b.y, LIFT + 0.05)]), new THREE.LineBasicMaterial({ color: COLORS.measure, depthTest: false }));
    line.renderOrder = 9;
    this.measureGroup.add(line);
    const tag = label(text, '#ffb3d9', 3.6);
    tag.position.copy(at((a.x + b.x) / 2, (a.y + b.y) / 2, 4));
    this.measureGroup.add(tag);
  }

  /** The cursor on the floor (or hidden). */
  setCursor(p: { x: number; y: number } | null): void {
    this.cursor.visible = !!p;
    if (p) this.cursor.position.copy(at(p.x, p.y, LIFT + 0.1));
  }
}
