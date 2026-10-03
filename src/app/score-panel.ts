// Live Override score: the HUD chip over the field and the Score tab. Scores the
// replayed state at the scrubbed time "as if the run ended now".

import { scoreState, type OverrideRecording, type OverrideResult } from '../games/override/game.ts';
import { stateAt } from '../games/override/replay.ts';
import type { FieldDef, Vec2 } from '../sim/field.ts';
import type { Recording } from '../sim/recording.ts';

function footprintAt(rec: Recording, t: number, size: { width: number; length: number }): Vec2[] {
  const n = rec.frames.length / rec.stride;
  const i = Math.max(0, Math.min(n - 1, Math.round(t / rec.frameEveryMs)));
  const x = rec.frames[i * rec.stride + 1];
  const y = rec.frames[i * rec.stride + 2];
  const th = (rec.frames[i * rec.stride + 3] * Math.PI) / 180;
  const s = Math.sin(th);
  const c = Math.cos(th);
  const { width: w, length: l } = size;
  return ([[-w / 2, -l / 2], [w / 2, -l / 2], [w / 2, l / 2], [-w / 2, l / 2]] as Vec2[]).map(([lx, ly]): Vec2 => [x + lx * c + ly * s, y - lx * s + ly * c]);
}

export function liveResult(field: FieldDef, rec: Recording, g: OverrideRecording, t: number, size: { width: number; length: number }): OverrideResult {
  // at the end of the run show exactly what the simulator scored
  if (g.result && t >= rec.stop - 1) return g.result;
  const violated = g.violations.some((v) => v.t <= t);
  return scoreState(field, g.mode, g.alliance, stateAt(g, t), footprintAt(rec, t, size), violated, t);
}

const el = (tag: string, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function renderHud(hud: HTMLElement, g: OverrideRecording | null, r: OverrideResult | null) {
  hud.hidden = !g || !r;
  if (!g || !r) return;
  if (g.mode === 'skills') {
    hud.replaceChildren(el('span', 'sc team', `Skills ${r.score.red}`));
    return;
  }
  hud.replaceChildren(el('span', 'sc red', String(r.score.red)), el('span', 'sc blue', String(r.score.blue)));
}

export function renderScorePanel(panel: HTMLElement, g: OverrideRecording | null, r: OverrideResult | null, atEnd: boolean) {
  if (!g || !r) {
    panel.replaceChildren(el('p', 'empty', 'Scores appear here after a run on a game field.'));
    return;
  }
  const out: HTMLElement[] = [];
  const s = r.score;
  const head = el('div', 'score-head');
  if (g.mode === 'skills') head.append(el('span', 'sc team', `Skills ${s.red}`));
  else head.append(el('span', 'sc red', `Red ${s.red}`), el('span', 'sc blue', `Blue ${s.blue}`));
  head.append(el('span', 'score-note', atEnd ? 'Final (at auto-stop)' : 'If the run ended now'));
  out.push(head);

  if (g.mode === 'h2h') {
    out.push(el('p', 'score-note', `Your robot plays for ${g.alliance}. Autonomous scoring excludes the Midfield (SC7a).`));
    const ab = r.autonomousBonus!;
    const bonus = ab.red === ab.blue ? (ab.red ? 'tie: 6 each' : 'none (both violated)') : `${ab.red > ab.blue ? 'red' : 'blue'} +12`;
    out.push(row('Autonomous Bonus', bonus));
    const a = r.awp!;
    const list = el('ul', 'awp');
    const item = (ok: boolean, text: string) => {
      const li = el('li', ok ? 'ok' : 'no', text);
      list.append(li);
    };
    item(a.scoredPins >= 6, `${a.scoredPins} Pins Scored for ${g.alliance} on your side (6; 7 at Worlds-qualifying events)`);
    item(a.goalsWithTwo >= 2, `${a.goalsWithTwo} Goals with 2+ of your Pins (2; 3 at Worlds-qualifying events)`);
    item(!a.touchingPerimeter, a.touchingPerimeter ? 'Robot is touching the Field Perimeter' : 'Not touching the Field Perimeter');
    item(!a.violation, a.violation ? 'An autonomous rule was broken (see Notes)' : 'No autonomous violations');
    out.push(row('Autonomous Win Point', a.standard ? (a.worlds ? 'yes (also Worlds criteria)' : 'yes (standard events)') : 'no'), list);
  } else {
    out.push(row('Robot in Midfield', r.inMidfield ? '+8' : 'no'));
  }

  const tg = el('div', 'toggles');
  for (const t of s.toggles) {
    const chip = el('span', `tchip ${t.color}`, `${t.zone}: ${t.color === 'yellow' ? 'neutral' : t.color}`);
    tg.append(chip);
  }
  out.push(el('div', 'score-sub', 'Toggles'), tg);

  const goals = s.goals.filter((x) => x.placedPins > 0);
  out.push(el('div', 'score-sub', 'Goals'));
  if (!goals.length) out.push(el('p', 'empty', 'No Pins Placed.'));
  else {
    const table = el('table', 'score-table');
    const hr = el('tr');
    for (const h of ['Goal', 'Zone', 'Pins', 'Red', 'Blue']) hr.append(el('th', '', h));
    table.append(hr);
    for (const x of goals) {
      const tr = el('tr');
      for (const v of [x.goal, x.zone, String(x.placedPins), String(x.red), String(x.blue)]) tr.append(el('td', '', v));
      table.append(tr);
    }
    out.push(table);
  }
  panel.replaceChildren(...out);
}

function row(label: string, value: string) {
  const r = el('div', 'score-row');
  r.append(el('span', 'k', label), el('span', 'v', value));
  return r;
}
