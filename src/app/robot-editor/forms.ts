// The properties panel of the robot layout editor: a form for whatever is selected (the
// robot and its drivetrain, a mechanism, or a device), generated from its fields.

import type { RobotProfile } from '../../sim/profile.ts';

/** Fields that pick from a fixed list. */
const CHOICES: Record<string, string[]> = {
  cartridge: ['red', 'green', 'blue'],
  lift: ['arm', 'fourbar', 'sixbar', 'dr4b', 'cascade', 'chainbar', 'piston'],
  grip: ['piston', 'motor', 'roller'],
  tool: ['bumper', 'plate', 'roller', 'jammer'],
  facing: ['front', 'rear'],
  preload: ['', 'alliance-down', 'yellow-down'],
  axis: ['vertical', 'horizontal'],
};
/** Fields that name another mechanism (by kind). */
const REFS: Record<string, string[]> = { lift: ['lift'], base: ['lift'], into: ['claw', 'staging'], claw: ['claw'], watches: ['claw', 'intake', 'staging'] };
/** Help shown next to a field. */
const HELP: Record<string, string> = {
  ratio: 'output turns per motor turn (1:5 = 0.2)',
  range: 'hard stops, output degrees (low, high)',
  motors: 'smart ports (unsigned)',
  left: 'signed ports, as your code declares them',
  right: 'signed ports, as your code declares them',
  home: 'end effector at rest (robot frame, in)',
  startAngle: 'degrees above horizontal at rest',
  reach: 'how far it grabs from (in)',
  maxAccel: 'in/s²',
  wheelRpm: 'wheel speed after gearing',
  closedAt: 'output degrees at which it holds',
  transferMs: 'time a piece takes to ride through (ms)',
};
const NOT_EDITABLE = new Set(['kind', 'type', 'schema', 'model']);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Fill `host` with a form for `obj` (a part of `profile`), for all its fields or `only` those.
 * Every change writes into `obj` and calls `changed`. `append` adds to what is there.
 */
export function renderForm(host: HTMLElement, obj: Record<string, unknown>, profile: RobotProfile, changed: () => void, only?: string[], append = false): void {
  if (!append) host.replaceChildren();
  const table = document.createElement('div');
  table.className = 'rl-form';
  host.appendChild(table);
  const row = (label: string, input: HTMLElement, help?: string) => {
    const l = document.createElement('label');
    l.innerHTML = `<span>${esc(label)}</span>`;
    l.appendChild(input);
    if (help) l.title = help;
    table.appendChild(l);
  };
  const keys = (only ?? Object.keys(obj)).filter((k) => !NOT_EDITABLE.has(k) && k in obj);
  for (const k of keys) {
    const v = obj[k];
    const refKinds = REFS[k] && !(k === 'lift' && obj.kind === 'lift') ? REFS[k] : null;
    if (refKinds) {
      // another mechanism, by name
      const sel = document.createElement('select');
      const names = profile.mechanisms.filter((m) => refKinds.includes(m.kind) && m.name !== obj.name).map((m) => m.name);
      sel.innerHTML = `<option value="">(none)</option>${names.map((n) => `<option>${esc(n)}</option>`).join('')}`;
      sel.value = String(v ?? '');
      sel.onchange = () => {
        if (sel.value) obj[k] = sel.value;
        else delete obj[k];
        changed();
      };
      row(k, sel, HELP[k]);
    } else if (CHOICES[k] && (typeof v === 'string' || v === undefined)) {
      const sel = document.createElement('select');
      sel.innerHTML = CHOICES[k].map((c) => `<option value="${c}">${c || '(none)'}</option>`).join('');
      sel.value = String(v ?? '');
      sel.onchange = () => {
        if (sel.value) obj[k] = sel.value;
        else delete obj[k];
        changed();
      };
      row(k, sel, HELP[k]);
    } else if (typeof v === 'number') {
      row(k, numberInput(v, (n) => ((obj[k] = n), changed())), HELP[k]);
    } else if (typeof v === 'boolean') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = v;
      cb.onchange = () => ((obj[k] = cb.checked), changed());
      row(k, cb, HELP[k]);
    } else if (typeof v === 'string') {
      const t = document.createElement('input');
      t.value = v;
      t.onchange = () => ((obj[k] = t.value), changed());
      row(k, t, HELP[k]);
    } else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) {
      // a list of numbers: ports, a range
      const t = document.createElement('input');
      t.value = v.join(', ');
      t.onchange = () => {
        const nums = t.value.split(/[\s,]+/).filter(Boolean).map(Number);
        if (nums.every(Number.isFinite)) obj[k] = nums;
        changed();
      };
      row(k, t, HELP[k]);
    } else if (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'number')) {
      // a point or box: one small box per number
      const box = document.createElement('span');
      box.className = 'rl-sub';
      for (const [sk, sv] of Object.entries(v as Record<string, number>)) {
        const lab = document.createElement('label');
        lab.textContent = sk;
        lab.appendChild(numberInput(sv, (n) => (((v as Record<string, number>)[sk] = n), changed())));
        box.appendChild(lab);
      }
      row(k, box, HELP[k]);
    } else {
      // anything else: as JSON
      const t = document.createElement('textarea');
      t.rows = 2;
      t.value = JSON.stringify(v);
      t.onchange = () => {
        try {
          obj[k] = JSON.parse(t.value);
          t.classList.remove('bad');
          changed();
        } catch {
          t.classList.add('bad');
        }
      };
      row(k, t, HELP[k]);
    }
  }
}

function numberInput(v: number, set: (n: number) => void): HTMLInputElement {
  const n = document.createElement('input');
  n.type = 'number';
  n.step = 'any';
  n.value = String(v);
  n.onchange = () => {
    const x = Number(n.value);
    if (n.value.trim() !== '' && Number.isFinite(x)) set(x);
  };
  n.onkeydown = (e) => e.key === 'Enter' && (e.preventDefault(), n.blur());
  return n;
}
