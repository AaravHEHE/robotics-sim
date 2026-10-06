// The robot layout editor: drag the chassis, wheels and mechanisms on a top and a side view,
// edit the details in a form, add or remove mechanisms and sensors, and see the robot in 3D.
// It edits the same profile as the JSON editor next to it (every change is written there,
// where it is validated).

import type { DeviceSpec, RobotProfile } from '../../sim/profile.ts';
import { handlesFor, type Handle, type Shape } from './draft.ts';
import { renderForm } from './forms.ts';
import { RobotPreview } from './preview.ts';
import { SvgView } from './svg-view.ts';
import { addMechanism, addSensor, MECHANISM_TEMPLATES, removeMechanism, SENSOR_TEMPLATES, type MechanismTemplate, type SensorTemplate } from './templates.ts';
import { esc } from '../html.ts';

export interface LayoutElements {
  top: HTMLElement;
  side: HTMLElement;
  preview: HTMLElement;
  pick: HTMLSelectElement;
  add: HTMLSelectElement;
  remove: HTMLButtonElement;
  undo: HTMLButtonElement;
  form: HTMLElement;
}


export class LayoutEditor {
  private draft: RobotProfile | null = null;
  private handles: Handle[] = [];
  private selected = 'robot';
  private readonly undoStack: string[] = [];
  private readonly top: SvgView;
  private readonly side: SvgView;
  private readonly preview: RobotPreview;
  private writeTimer = 0;
  private readonly els: LayoutElements;
  private readonly write: (p: RobotProfile) => void;

  /** `write` puts the edited profile into the JSON editor. */
  constructor(els: LayoutElements, write: (p: RobotProfile) => void) {
    this.els = els;
    this.write = write;
    const on = {
      edit: (h: Handle, s: Shape) => this.dragged(h, s),
      commit: () => this.commit(),
      pick: (owner: string) => this.select(owner),
    };
    this.top = new SvgView(els.top, 'top', on);
    this.side = new SvgView(els.side, 'side', on);
    this.preview = new RobotPreview(els.preview);
    els.pick.onchange = () => this.select(els.pick.value);
    els.add.innerHTML =
      `<option value="">+ Add…</option><optgroup label="Mechanism">${Object.entries(MECHANISM_TEMPLATES).map(([k, v]) => `<option value="m:${k}">${v}</option>`).join('')}</optgroup>` +
      `<optgroup label="Sensor">${Object.entries(SENSOR_TEMPLATES).map(([k, v]) => `<option value="s:${k}">${v}</option>`).join('')}</optgroup>`;
    els.add.onchange = () => {
      const v = els.add.value;
      els.add.value = '';
      if (v) this.add(v);
    };
    els.remove.onclick = () => this.removeSelected();
    els.undo.onclick = () => this.undo();
  }

  /** Show a profile (from the JSON editor): keeps the selection when it still exists. */
  load(p: RobotProfile): void {
    this.draft = structuredClone(p);
    if (!this.ownerExists(this.selected)) this.selected = 'robot';
    this.redraw(true);
  }

  /** Forget the undo history (a different robot was opened). */
  reset(): void {
    this.undoStack.length = 0;
    this.selected = 'robot';
    this.els.undo.disabled = true;
  }

  /** Ctrl+Z inside the dialog. */
  undo(): void {
    const prev = this.undoStack.pop();
    this.els.undo.disabled = !this.undoStack.length;
    if (!prev) return;
    this.draft = JSON.parse(prev);
    if (!this.ownerExists(this.selected)) this.selected = 'robot';
    this.redraw(true);
    this.write(this.draft!);
  }

  private ownerExists(owner: string): boolean {
    const p = this.draft;
    if (!p) return false;
    if (owner === 'robot') return true;
    if (owner.startsWith('mech:')) return p.mechanisms.some((m) => m.name === owner.slice(5));
    return !!p.devices[Number(owner.slice(4))];
  }

  /** Remember the state before a change (one undo step). */
  private checkpoint(): void {
    if (!this.draft) return;
    this.undoStack.push(JSON.stringify(this.draft));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.els.undo.disabled = false;
  }

  private dragStarted = false;
  private dragged(h: Handle, s: Shape): void {
    if (!this.draft) return;
    if (!this.dragStarted) {
      this.checkpoint();
      this.dragStarted = true;
    }
    h.set(this.draft, s);
    this.redraw(false);
    // the JSON (and its validation) follows a few times a second while dragging
    clearTimeout(this.writeTimer);
    this.writeTimer = window.setTimeout(() => this.write(this.draft!), 120);
  }

  private commit(): void {
    this.dragStarted = false;
    clearTimeout(this.writeTimer);
    if (this.draft) {
      this.write(this.draft);
      this.redraw(true);
    }
  }

  /** A form field changed. */
  private formChanged = (): void => {
    if (!this.draft) return;
    this.redraw(false);
    this.write(this.draft);
  };

  private select(owner: string): void {
    if (!this.ownerExists(owner)) return;
    this.selected = owner;
    this.redraw(true);
  }

  private add(v: string): void {
    if (!this.draft) return;
    this.checkpoint();
    try {
      if (v.startsWith('m:')) this.selected = `mech:${addMechanism(this.draft, v.slice(2) as MechanismTemplate)}`;
      else this.selected = `dev:${addSensor(this.draft, v.slice(2) as SensorTemplate)}`;
    } catch (e) {
      this.undoStack.pop();
      alert((e as Error).message);
      return;
    }
    this.redraw(true);
    this.write(this.draft);
  }

  private removeSelected(): void {
    const p = this.draft;
    if (!p || this.selected === 'robot') return;
    this.checkpoint();
    if (this.selected.startsWith('mech:')) removeMechanism(p, this.selected.slice(5));
    else p.devices.splice(Number(this.selected.slice(4)), 1);
    this.selected = 'robot';
    this.redraw(true);
    this.write(p);
  }

  /** Redraw the views and preview; `full` also rebuilds the picker and the form. */
  private redraw(full: boolean): void {
    const p = this.draft;
    if (!p) return;
    this.handles = handlesFor(p);
    this.top.render(p, this.handles, this.selected);
    this.side.render(p, this.handles, this.selected);
    this.preview.show(p);
    if (!full) return;
    const pick = this.els.pick;
    const dev = (d: DeviceSpec, i: number) => `<option value="dev:${i}">${esc(d.name ?? d.type)} · ${esc(d.type)} port ${esc(d.port)}</option>`;
    pick.innerHTML =
      `<option value="robot">Robot and drivetrain</option>` +
      (p.mechanisms.length ? `<optgroup label="Mechanisms">${p.mechanisms.map((m) => `<option value="mech:${esc(m.name)}">${esc(m.name)} · ${esc(m.kind === 'lift' ? m.lift : m.kind)}</option>`).join('')}</optgroup>` : '') +
      `<optgroup label="Devices">${p.devices.map(dev).join('')}</optgroup>`;
    pick.value = this.selected;
    this.els.remove.disabled = this.selected === 'robot';
    this.els.remove.textContent = this.selected.startsWith('mech:') ? 'Remove mechanism' : this.selected.startsWith('dev:') ? 'Remove device' : 'Remove';
    const form = this.els.form;
    if (this.selected === 'robot') {
      renderForm(form, p as unknown as Record<string, unknown>, p, this.formChanged, ['name', 'description', 'mass', 'size']);
      const h = document.createElement('div');
      h.className = 'sp-title';
      h.textContent = 'Drivetrain';
      form.appendChild(h);
      renderForm(form, p.drivetrain as unknown as Record<string, unknown>, p, this.formChanged, undefined, true);
    } else if (this.selected.startsWith('mech:')) {
      const m = p.mechanisms.find((x) => x.name === this.selected.slice(5))!;
      renderForm(form, m as unknown as Record<string, unknown>, p, () => {
        // a renamed mechanism stays selected
        this.selected = `mech:${m.name}`;
        this.formChanged();
        this.redraw(true);
      });
    } else {
      renderForm(form, p.devices[Number(this.selected.slice(4))] as unknown as Record<string, unknown>, p, this.formChanged);
    }
  }

  dispose(): void {
    this.preview.dispose();
  }
}
