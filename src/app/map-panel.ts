// The Map tab: plot points on the field (a 12 × 12 ft coordinate plane in inches), drag them,
// read their coordinates, and measure distances and headings between points and to field
// elements, to plan autonomous routes.

import type { FieldDef } from '../sim/field.ts';
import { maxSpeed, type RobotProfile } from '../sim/profile.ts';
import { deletePlan, download, idb, listPlans, pickFile, safe, savePlan, type SavedPlan } from './storage.ts';
import { MapLayer } from './map-layer.ts';
import {
  clampToField, decodePlan, driveDist, encodePlan, limitsAt, measure, nearestPoi, pointsOfInterest, routeTimes, segments, snap, validatePlan, type MapPlan, type MapPoint,
  type Poi,
} from './mapping.ts';
import type { FieldViewer } from './viewer.ts';

export type MapMode = 'off' | 'plot' | 'measure';

export interface MapHost {
  viewer: FieldViewer;
  field: () => FieldDef;
  layoutId: () => string;
  /** The selected robot (its speed and acceleration time the route). */
  robot: () => RobotProfile;
  /** The auto-stop time (ms): the route's total is compared with it. */
  autonMs: () => number;
  /** Put the robot's start pose here. */
  setStart: (p: { x: number; y: number; theta: number }) => void;
  /** A message for the status bar. */
  status: (text: string, kind?: '' | 'ok' | 'err') => void;
}

/** A link longer than this is better shared as a file. */
const MAX_LINK = 8000;
/** The plan being worked on, kept across reloads (settings store). */
const WORKING_KEY = 'mapWorking';

/** A spot to measure from or to: a point, a field element, or a spot on the floor. */
interface Spot {
  x: number;
  y: number;
  name: string;
}

/** A tap moves less than this (px) and lasts less than this (ms): anything else orbits the camera. */
const TAP_PX = 5;
const TAP_MS = 400;
/** A press this close (px) to a point picks it up to drag. */
const GRAB_PX = 14;
/** Taps this close (in) to a field element or point snap to it. */
const SNAP_IN = 2.5;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const f1 = (v: number) => (Math.abs(v) < 0.05 ? '0.0' : v.toFixed(1));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class MapPanel {
  points: MapPoint[] = [];
  private selected: string | null = null;
  private mode: MapMode = 'off';
  private nextId = 1;
  private pois: Poi[] = [];
  private from: Spot | null = null;
  private to: Spot | null = null;
  private readonly layer = new MapLayer();
  private press: { x: number; y: number; t: number; id: number; drag: string | null } | null = null;
  /** The plan being worked on: its saved id (null = not saved yet) and when it was made. */
  private plan: { id: string | null; created: number } = { id: null, created: Date.now() };
  private keepTimer = 0;
  /** Motor velocity (% of full) for the timing estimates. */
  private speedPct = 100;

  private readonly host: MapHost;

  constructor(host: MapHost) {
    this.host = host;
    host.viewer.addLayer(this.layer.group);
    const c = host.viewer.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onCancel);
    c.addEventListener('pointerleave', () => this.showCursor(null));
    document.querySelectorAll<HTMLButtonElement>('[data-map-mode]').forEach((b) => (b.onclick = () => this.setMode(b.dataset.mapMode as MapMode)));
    $('map-clear').onclick = () => {
      if (this.points.length && !confirm(`Remove all ${this.points.length} points?`)) return;
      this.setPoints([]);
    };
    $<HTMLSelectElement>('map-from').onchange = () => this.pickMeasure();
    $<HTMLSelectElement>('map-to').onchange = () => this.pickMeasure();
    $<HTMLInputElement>('plan-name').onchange = () => this.changed();
    $<HTMLInputElement>('map-speed').onchange = () => {
      this.setSpeed(Number($<HTMLInputElement>('map-speed').value));
      this.changed();
    };
    $('plan-save').onclick = () => void this.save();
    $<HTMLSelectElement>('plan-open').onchange = (e) => void this.openSaved((e.target as HTMLSelectElement).value);
    $('plan-delete').onclick = () => void this.deleteSaved();
    $('plan-export').onclick = () => this.exportFile();
    $('plan-import').onclick = () => void this.importFile();
    $('plan-link').onclick = () => void this.copyLink();
    this.fieldChanged();
  }

  /**
   * Restore the plan: one shared in the page link (#plan=...) if there is one, else the plan
   * being worked on last time.
   */
  async restore(): Promise<boolean> {
    const m = /[#&]plan=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (m) {
      // the link has done its job: a reload shouldn't open it again over later edits
      history.replaceState(null, '', location.pathname + location.search);
      try {
        this.open(decodePlan(m[1]), null);
        this.host.status(`Opened the shared plan “${this.name()}”. It isn't saved here yet: press Save in the Map tab to keep it.`, 'ok');
        this.warnField(this.lastOpened!);
        await this.renderPlans();
        return true;
      } catch (e) {
        this.host.status(`Couldn't open the shared plan: ${(e as Error).message}`, 'err');
      }
    } else {
      const w = await safe(idb.get<{ name: string; id: string | null; created: number; points: MapPoint[]; speedPct?: number }>('settings', WORKING_KEY), undefined);
      if (w && Array.isArray(w.points)) {
        $<HTMLInputElement>('plan-name').value = w.name ?? '';
        this.setSpeed(w.speedPct ?? 100);
        this.plan = { id: w.id ?? null, created: w.created ?? Date.now() };
        this.setPoints(w.points, false);
      }
    }
    await this.renderPlans();
    return false;
  }

  // ---------------- plans ----------------

  private lastOpened: MapPlan | null = null;
  private name = () => $<HTMLInputElement>('plan-name').value.trim() || 'Untitled plan';

  private current(): MapPlan {
    return {
      v: 1,
      name: this.name(),
      field: this.host.field().id,
      layout: this.host.layoutId(),
      points: this.points.map((p) => ({ ...p })),
      created: this.plan.created,
      speedPct: this.speedPct,
    };
  }

  private open(plan: MapPlan, id: string | null): void {
    this.lastOpened = plan;
    this.plan = { id, created: plan.created };
    $<HTMLInputElement>('plan-name').value = plan.name;
    this.setSpeed(plan.speedPct ?? 100);
    this.setPoints(plan.points);
  }

  /** A plan made on another field or layout: its points may not mean much here. */
  private warnField(plan: MapPlan): void {
    if (plan.field !== this.host.field().id) this.host.status(`This plan was made on the “${plan.field}” field; the ${this.host.field().name} is selected.`, 'err');
  }

  /** Remember what is being worked on (debounced), so a reload keeps it. */
  private changed(): void {
    clearTimeout(this.keepTimer);
    this.keepTimer = window.setTimeout(() => {
      void safe(
        idb.put('settings', WORKING_KEY, { name: $<HTMLInputElement>('plan-name').value, id: this.plan.id, created: this.plan.created, points: this.points, speedPct: this.speedPct }),
        undefined,
      );
    }, 300);
  }

  private async renderPlans(): Promise<void> {
    const plans = await listPlans();
    const sel = $<HTMLSelectElement>('plan-open');
    sel.innerHTML = `<option value="">${plans.length ? 'Open a saved plan…' : 'No saved plans yet'}</option>` +
      plans.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${p.points.length} point${p.points.length === 1 ? '' : 's'}${p.field === this.host.field().id ? '' : ', ' + esc(p.field)})</option>`).join('');
    sel.value = '';
    $<HTMLButtonElement>('plan-delete').disabled = !this.plan.id;
  }

  private async save(): Promise<void> {
    const plan: SavedPlan = { ...this.current(), id: this.plan.id ?? `plan-${Date.now().toString(36)}` };
    try {
      await savePlan(plan);
      this.plan.id = plan.id;
      $<HTMLInputElement>('plan-name').value = plan.name;
      this.changed();
      this.host.status(`Saved the plan “${plan.name}” in this browser.`, 'ok');
    } catch (e) {
      this.host.status(`Couldn't save the plan (${(e as Error).message}). Export it as a file instead.`, 'err');
    }
    await this.renderPlans();
  }

  private async openSaved(id: string): Promise<void> {
    if (!id) return;
    const plan = (await listPlans()).find((p) => p.id === id);
    if (!plan) return;
    if (this.points.length && !this.plan.id && !confirm(`Open “${plan.name}”? The ${this.points.length} unsaved points here will be replaced.`)) return void this.renderPlans();
    this.open(plan, plan.id);
    this.host.status(`Opened the plan “${plan.name}”.`, 'ok');
    this.warnField(plan);
    await this.renderPlans();
  }

  private async deleteSaved(): Promise<void> {
    const id = this.plan.id;
    if (!id || !confirm(`Delete the saved plan “${this.name()}” from this browser? (The points stay on the field until you clear them.)`)) return;
    await deletePlan(id);
    this.plan.id = null;
    this.changed();
    this.host.status('Deleted the saved plan.', 'ok');
    await this.renderPlans();
  }

  private exportFile(): void {
    const plan = this.current();
    const file = plan.name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'plan';
    download(`${file}.vexplan.json`, JSON.stringify(plan, null, 2) + '\n', 'application/json');
  }

  private async importFile(): Promise<void> {
    const f = await pickFile('.json,.vexplan');
    if (!f) return;
    try {
      const plan = JSON.parse(await f.text()) as MapPlan;
      const errs = validatePlan(plan);
      if (errs.length) throw new Error(errs.join(' '));
      plan.points = plan.points.map((q, i) => ({ ...q, id: q.id || `p${i + 1}` }));
      this.open(plan, null);
      this.host.status(`Imported the plan “${plan.name}”. Press Save to keep it in this browser.`, 'ok');
      this.warnField(plan);
      await this.renderPlans();
    } catch (e) {
      this.host.status(`Couldn't import that file: ${(e as Error).message}`, 'err');
    }
  }

  private async copyLink(): Promise<void> {
    const url = `${location.origin}${location.pathname}#plan=${encodePlan(this.current())}`;
    if (url.length > MAX_LINK) {
      this.host.status(`This plan is too big for a link (${url.length} characters): export it as a file instead.`, 'err');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      this.host.status('Copied a link to this plan. Anyone who opens it sees these points (nothing is uploaded: the plan is in the link).', 'ok');
    } catch {
      prompt('Copy this link to share the plan:', url);
    }
  }

  /** The motor velocity for the timing estimates (1-100%). */
  private setSpeed(pct: number): void {
    this.speedPct = Number.isFinite(pct) ? Math.max(1, Math.min(100, Math.round(pct))) : 100;
    $<HTMLInputElement>('map-speed').value = String(this.speedPct);
    this.render(false);
  }

  /** The robot or auto-stop changed: the timing follows. */
  robotChanged(): void {
    this.render(false);
  }

  /** The field or layout changed: its elements to measure to change too. */
  fieldChanged(): void {
    this.pois = pointsOfInterest(this.host.field(), this.host.layoutId());
    this.render();
  }

  setPoints(points: MapPoint[], keep = true): void {
    this.points = points.map((p) => ({ ...p }));
    this.nextId = Math.max(0, ...this.points.map((p) => Number(String(p.id ?? '').replace(/\D/g, '')) || 0)) + 1;
    for (const p of this.points) if (!p.id) p.id = `p${this.nextId++}`;
    this.selected = null;
    this.from = this.to = null;
    this.render();
    if (keep) this.changed();
  }

  setMode(mode: MapMode): void {
    this.mode = mode;
    document.querySelectorAll<HTMLButtonElement>('[data-map-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mapMode === mode));
    $('map-help').textContent =
      mode === 'plot'
        ? 'Click the field to add a point; drag a point to move it. Dragging elsewhere still turns the camera (the Top view is easiest).'
        : mode === 'measure'
          ? 'Click two spots to measure between them (they snap to points and field elements), or pick them below.'
          : 'Pick Plot points or Measure to use the field. Coordinates are inches from the field center: +x toward the right (blue) wall, +y toward the far wall; headings clockwise from +y, as in LemLib and the GPS.';
    this.host.viewer.canvas.style.cursor = mode === 'off' ? '' : 'crosshair';
    if (mode === 'off') this.showCursor(null);
  }

  // ---------------- pointer ----------------

  private onDown = (e: PointerEvent) => {
    if (this.mode === 'off' || !e.isPrimary || e.button !== 0) return;
    const grab = this.mode === 'plot' ? this.pointNear(e.clientX, e.clientY) : null;
    this.press = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, drag: grab?.id ?? null };
    if (grab) {
      // dragging a point: the camera stays put
      this.host.viewer.setOrbitEnabled(false);
      try {
        this.host.viewer.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer the browser no longer tracks */
      }
      this.selected = grab.id;
      this.render();
    }
  };

  private onMove = (e: PointerEvent) => {
    if (this.mode === 'off' || !e.isPrimary) return;
    const p = this.floorAt(e.clientX, e.clientY);
    this.showCursor(p);
    const drag = this.press?.drag && this.points.find((q) => q.id === this.press!.drag);
    if (drag && p) {
      Object.assign(drag, this.snapped(p, false));
      this.render();
    }
  };

  private onUp = (e: PointerEvent) => {
    const press = this.press;
    if (!press || e.pointerId !== press.id) return;
    this.press = null;
    if (press.drag) {
      this.host.viewer.setOrbitEnabled(true);
      this.host.viewer.canvas.releasePointerCapture(e.pointerId);
      this.changed();
      return;
    }
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (moved > TAP_PX || performance.now() - press.t > TAP_MS) return; // that was the camera
    const p = this.floorAt(e.clientX, e.clientY);
    if (!p) return;
    if (this.mode === 'plot') this.addPoint(p);
    else if (this.mode === 'measure') this.measureTap(p);
  };

  private onCancel = () => {
    if (this.press?.drag) this.host.viewer.setOrbitEnabled(true);
    this.press = null;
  };

  private floorAt(cx: number, cy: number): { x: number; y: number } | null {
    const p = this.host.viewer.fieldPointAt(cx, cy);
    if (!p) return null;
    const half = this.host.field().perimeter.inside / 2;
    return Math.abs(p.x) <= half + 6 && Math.abs(p.y) <= half + 6 ? clampToField(p, this.host.field()) : null;
  }

  private pointNear(cx: number, cy: number): MapPoint | null {
    let best: MapPoint | null = null;
    let bestD = GRAB_PX;
    for (const q of this.points) {
      const s = this.host.viewer.screenOf(q.x, q.y);
      const d = Math.hypot(s.x - cx, s.y - cy);
      if (d <= bestD) {
        best = q;
        bestD = d;
      }
    }
    return best;
  }

  /** Snap to the grid, or to a nearby field element (with its name). */
  private snapped(p: { x: number; y: number }, toElements = true): { x: number; y: number; label?: string } {
    if (toElements && $<HTMLInputElement>('map-snap-poi').checked) {
      const poi = nearestPoi(p, this.pois, SNAP_IN);
      if (poi) return { x: poi.x, y: poi.y, label: poi.label };
    }
    const step = Number($<HTMLSelectElement>('map-snap').value) || 0;
    return clampToField({ x: snap(p.x, step), y: snap(p.y, step) }, this.host.field());
  }

  private showCursor(p: { x: number; y: number } | null): void {
    this.layer.setCursor(this.mode === 'off' ? null : p);
    $('map-cursor').textContent = p ? `x ${f1(p.x)}, y ${f1(p.y)} in` : 'x —, y —';
    this.host.viewer.requestRender();
  }

  // ---------------- points ----------------

  private addPoint(p: { x: number; y: number }): void {
    const s = this.snapped(p);
    const q: MapPoint = { id: `p${this.nextId++}`, x: s.x, y: s.y };
    if (s.label) q.label = s.label;
    this.points.push(q);
    this.selected = q.id;
    this.render();
    this.changed();
  }

  private measureTap(p: { x: number; y: number }): void {
    const spot = this.spotAt(p);
    if (!this.from || this.to) {
      this.from = spot;
      this.to = null;
    } else this.to = spot;
    this.render();
  }

  /** A tapped spot: a nearby point or field element, or the floor there. */
  private spotAt(p: { x: number; y: number }): Spot {
    let best: Spot | null = null;
    let bestD = SNAP_IN;
    this.points.forEach((q, i) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= bestD) {
        best = { x: q.x, y: q.y, name: `point ${i + 1}` };
        bestD = d;
      }
    });
    if (best) return best;
    const poi = $<HTMLInputElement>('map-snap-poi').checked ? nearestPoi(p, this.pois, SNAP_IN) : null;
    if (poi) return { x: poi.x, y: poi.y, name: poi.label };
    const s = this.snapped(p, false);
    return { x: s.x, y: s.y, name: `(${f1(s.x)}, ${f1(s.y)})` };
  }

  /** The measure dropdowns changed. */
  private pickMeasure(): void {
    const spot = (v: string): Spot | null => {
      if (v.startsWith('pt:')) {
        const i = this.points.findIndex((q) => q.id === v.slice(3));
        return i >= 0 ? { x: this.points[i].x, y: this.points[i].y, name: `point ${i + 1}` } : null;
      }
      const poi = this.pois.find((q) => q.id === v.slice(4));
      return poi ? { x: poi.x, y: poi.y, name: poi.label } : null;
    };
    this.from = spot($<HTMLSelectElement>('map-from').value);
    this.to = spot($<HTMLSelectElement>('map-to').value);
    this.render(false);
  }

  // ---------------- drawing ----------------

  private render(selects = true): void {
    this.layer.setPoints(this.points, this.selected);
    const m = this.from && this.to ? measure(this.from, this.to) : null;
    this.layer.setMeasure(this.from, this.to, m ? `${f1(driveDist(m.dist))}″ · ${f1(m.heading)}°` : '');
    $('map-result').innerHTML = this.from
      ? m
        ? `<b>${f1(driveDist(m.dist))} in</b> (${(driveDist(m.dist) / 12).toFixed(2)} ft) from ${esc(this.from.name)} to ${esc(this.to!.name)} <span class="muted">(${f1(m.dist)} in apart, less the 18 in robot)</span><br>heading <b>${f1(m.heading)}°</b> · dx ${f1(m.dx)} · dy ${f1(m.dy)}`
        : `From ${esc(this.from.name)}: click a second spot.`
      : 'Pick two spots (or click them on the field in Measure mode).';
    this.renderTable();
    if (selects) this.renderSelects();
    this.host.viewer.requestRender();
  }

  private renderSelects(): void {
    const opts = (sel: HTMLSelectElement, current: Spot | null) => {
      const pts = this.points.map((q, i) => `<option value="pt:${q.id}">Point ${i + 1}${q.label ? ` (${esc(q.label)})` : ''}</option>`).join('');
      const groups = (['goal', 'toggle', 'loader', 'stack', 'pin', 'start'] as const)
        .map((k) => {
          const items = this.pois.filter((p) => p.kind === k);
          const name = { goal: 'Goals', toggle: 'Toggles', loader: 'Loaders', stack: 'Stacks', pin: 'Lying Pins', start: 'Start positions' }[k];
          return items.length ? `<optgroup label="${name}">${items.map((p) => `<option value="poi:${p.id}">${esc(p.label)}</option>`).join('')}</optgroup>` : '';
        })
        .join('');
      sel.innerHTML = `<option value="">—</option>${pts ? `<optgroup label="Points">${pts}</optgroup>` : ''}${groups}`;
      // keep showing what is being measured, if it is in the list
      const match = [...sel.options].find((o) => {
        const s = current;
        if (!s || !o.value) return false;
        const q = o.value.startsWith('pt:') ? this.points.find((p) => p.id === o.value.slice(3)) : this.pois.find((p) => p.id === o.value.slice(4));
        return !!q && Math.abs(q.x - s.x) < 1e-6 && Math.abs(q.y - s.y) < 1e-6;
      });
      sel.value = match?.value ?? '';
    };
    opts($<HTMLSelectElement>('map-from'), this.from);
    opts($<HTMLSelectElement>('map-to'), this.to);
  }

  private renderTable(): void {
    const body = $('map-points-body');
    const robot = this.host.robot();
    const limits = limitsAt(this.speedPct, maxSpeed(robot), robot.drivetrain.maxAccel, robot.drivetrain.trackWidth);
    $('map-speed-info').textContent = `= ${limits.speed.toFixed(1)} in/s for ${robot.name}`;
    if (!this.points.length) {
      body.innerHTML = `<tr><td colspan="10" class="empty">No points yet. Pick Plot points and click the field.</td></tr>`;
      $('map-total').textContent = '';
      return;
    }
    const segs = segments(this.points);
    const times = routeTimes(this.points, limits);
    const total = times.at(-1)?.total ?? 0;
    const budget = this.host.autonMs() / 1000;
    const foot = $('map-total');
    foot.textContent = times.length
      ? `Estimated total: ${total.toFixed(2)} s of the ${budget} s auto-stop at ${this.speedPct}% velocity (turns and drives from rest to rest; mechanisms and waits not included)${total > budget ? ' — over the limit' : ''}.`
      : '';
    foot.classList.toggle('over', total > budget);
    body.innerHTML = this.points
      .map((p, i) => {
        const s = segs[i - 1];
        return `<tr data-id="${p.id}" class="${p.id === this.selected ? 'sel' : ''}">
          <td>${i + 1}</td>
          <td><input data-f="label" value="${esc(p.label ?? '')}" placeholder="name" aria-label="Point ${i + 1} name"></td>
          <td><input data-f="x" type="number" step="0.5" value="${f1(p.x)}" aria-label="Point ${i + 1} x (in)"></td>
          <td><input data-f="y" type="number" step="0.5" value="${f1(p.y)}" aria-label="Point ${i + 1} y (in)"></td>
          <td><input data-f="heading" type="number" step="5" value="${p.heading === undefined ? '' : f1(p.heading)}" placeholder="—" aria-label="Point ${i + 1} heading (°)"></td>
          <td>${s ? f1(s.drive) : ''}</td>
          <td>${s ? f1(s.heading) + '°' : ''}</td>
          <td>${s && s.turn !== null ? (s.turn >= 0 ? '+' : '') + f1(s.turn) + '°' : ''}</td>
          <td title="${times[i - 1] ? `turn ${times[i - 1].turn.toFixed(2)} s + drive ${times[i - 1].drive.toFixed(2)} s; ${times[i - 1].total.toFixed(2)} s so far` : ''}">${times[i - 1] ? (times[i - 1].turn + times[i - 1].drive).toFixed(2) + ' s' : ''}</td>
          <td class="acts">
            <button data-a="up" title="Move up" aria-label="Move point ${i + 1} up" ${i ? '' : 'disabled'}>↑</button>
            <button data-a="down" title="Move down" aria-label="Move point ${i + 1} down" ${i < this.points.length - 1 ? '' : 'disabled'}>↓</button>
            <button data-a="start" title="Start the robot here (facing the point's heading, or toward the next point)">Start</button>
            <button data-a="del" title="Remove" aria-label="Remove point ${i + 1}">✕</button>
          </td></tr>`;
      })
      .join('');
    body.querySelectorAll<HTMLTableRowElement>('tr[data-id]').forEach((row) => {
      const id = row.dataset.id!;
      row.onclick = (e) => {
        if ((e.target as HTMLElement).closest('input,button')) return;
        this.selected = this.selected === id ? null : id;
        this.render(false);
      };
      row.querySelectorAll<HTMLInputElement>('input').forEach((inp) => {
        inp.onchange = () => this.editPoint(id, inp.dataset.f!, inp.value);
        inp.onkeydown = (e) => e.key === 'Enter' && inp.blur();
      });
      row.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => this.act(id, b.dataset.a!)));
    });
  }

  private editPoint(id: string, field: string, value: string): void {
    const p = this.points.find((q) => q.id === id);
    if (!p) return;
    if (field === 'label') p.label = value.trim() || undefined;
    else if (field === 'heading') p.heading = value.trim() === '' || !Number.isFinite(Number(value)) ? undefined : ((Number(value) % 360) + 360) % 360;
    else if (Number.isFinite(Number(value))) Object.assign(p, clampToField({ ...p, [field]: Number(value) }, this.host.field()));
    this.render();
    this.changed();
  }

  private act(id: string, action: string): void {
    const i = this.points.findIndex((q) => q.id === id);
    if (i < 0) return;
    if (action === 'del') this.points.splice(i, 1);
    else if (action === 'up' && i > 0) [this.points[i - 1], this.points[i]] = [this.points[i], this.points[i - 1]];
    else if (action === 'down' && i < this.points.length - 1) [this.points[i + 1], this.points[i]] = [this.points[i], this.points[i + 1]];
    else if (action === 'start') {
      const p = this.points[i];
      const next = this.points[i + 1];
      const theta = p.heading ?? (next ? measure(p, next).heading : 0);
      this.host.setStart({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, theta: Math.round(theta * 10) / 10 });
      return;
    }
    this.render();
    this.changed();
  }
}
