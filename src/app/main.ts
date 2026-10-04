// App entry: wires the editor, compiler worker, simulation sandbox, 3D viewer,
// timeline, robot profiles and browser storage together.

import type { BuildResult } from '../compiler/build.ts';
import type { Diagnostic } from '../compiler/diagnostics.ts';
import type { CompilerRequest, CompilerResponse } from '../compiler/worker.ts';
import { initialState } from '../games/override/state.ts';
import type { FieldDef } from '../sim/field.ts';
import { maxSpeed, validateProfile, type RobotProfile } from '../sim/profile.ts';
import { simulatedEnvNames } from '../sim/pros-api.ts';
import type { Recording } from '../sim/recording.ts';
import type { PlaceMode } from '../sim/runtime.ts';
import type { SimRequest, SimResponse } from '../sim/worker.ts';
import { jsonEditor, ProjectEditor } from './editor.ts';
import { SAMPLES, type SampleMeta } from './samples-meta.ts';
import {
  deleteCustomRobot, download, fromBase64, idb, listCustomRobots, loadModel, loadProject, pickFile, projectFromZip,
  projectToZip, robotFromZip, robotToZip, safe, saveCustomRobot, saveModel, saveProject, toBase64,
} from './storage.ts';
import { liveResult, renderHud, renderScorePanel } from './score-panel.ts';
import { FieldViewer, type ViewMode } from './viewer.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fieldModules = import.meta.glob('../../data/fields/*.json', { eager: true, import: 'default' }) as Record<string, FieldDef>;
const FIELDS: FieldDef[] = Object.values(fieldModules).sort((a, b) => (a.game ? -1 : 1) - (b.game ? -1 : 1) || a.name.localeCompare(b.name));

// ---------------- data: presets and samples ----------------

const presetModules = import.meta.glob('../../data/robots/*.json', { eager: true, import: 'default' }) as Record<string, RobotProfile>;
const PRESETS: RobotProfile[] = Object.values(presetModules).sort((a, b) => a.name.localeCompare(b.name));
const sampleFiles = import.meta.glob('../../samples/**/*', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

function sampleProject(id: string): Record<string, string> {
  const prefix = `../../samples/${id}/`;
  const files: Record<string, string> = {};
  for (const [p, text] of Object.entries(sampleFiles)) if (p.startsWith(prefix)) files[p.slice(prefix.length)] = text;
  return files;
}

// ---------------- state ----------------

/** Everything a run depends on besides the code, frozen when Run is pressed. */
interface RunSetup {
  robot: RobotProfile;
  field: FieldDef;
  start: { x: number; y: number; theta: number };
  autonMs: number;
  place: PlaceMode;
}

const AUTON_LENGTHS = [15000, 60000];
const DEFAULT_FIELD = 'generic-12ft';

const state = {
  /** Bumped whenever a setting a run depends on changes: results of older runs are stale. */
  runSeq: 0,
  /** The setup of the shown recording. */
  setup: null as RunSetup | null,
  booted: false,
  projectName: 'my-auton',
  binary: {} as Record<string, Uint8Array>,
  robots: [...PRESETS] as RobotProfile[],
  robotId: PRESETS.find((p) => p.id === 'tank-6m-450')?.id ?? PRESETS[0].id,
  fieldId: FIELDS.find((f) => f.id === 'override')?.id ?? FIELDS[0].id,
  autonMs: 15000,
  start: { x: 0, y: 0, theta: 0 },
  place: 'auto' as PlaceMode,
  recording: null as Recording | null,
  t: 0,
  playing: false,
  speed: 1,
  running: false,
  dirtySinceRun: true,
};
const robot = () => state.robots.find((r) => r.id === state.robotId) ?? PRESETS[0];
const field = () => FIELDS.find((f) => f.id === state.fieldId) ?? FIELDS[0];
/** Game fields have a Head-to-Head and a Skills layout; the auto-stop length picks one. */
const layoutId = () => (state.autonMs >= 60000 ? 'skills' : 'h2h');

// ---------------- UI pieces ----------------

const editor = new ProjectEditor($('editor'), $('file-tabs'));
const viewer = new FieldViewer($('viewer'));
if (import.meta.env.DEV) Object.assign(window, { __viewer: viewer, __state: state });

function setStatus(text: string, kind: '' | 'ok' | 'err' = '', progress?: { loaded: number; total: number }) {
  const s = $('status');
  s.className = 'status ' + kind;
  s.textContent = text;
  if (progress && progress.total) {
    const bar = document.createElement('progress');
    bar.max = progress.total;
    bar.value = progress.loaded;
    s.append(bar, ` ${(progress.loaded / 1e6).toFixed(1)} / ${(progress.total / 1e6).toFixed(1)} MB`);
  }
}

// bottom panel tabs
document.querySelectorAll<HTMLButtonElement>('.btab').forEach((b) => {
  b.onclick = () => showTab(b.dataset.tab!);
});
function showTab(name: string) {
  document.querySelectorAll('.btab').forEach((x) => x.classList.toggle('active', (x as HTMLElement).dataset.tab === name));
  document.querySelectorAll('.bpanel').forEach((x) => x.classList.toggle('active', x.id === 'panel-' + name));
}

// camera buttons
document.querySelectorAll<HTMLButtonElement>('.view-buttons button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.view-buttons button').forEach((x) => x.classList.toggle('active', x === b));
    viewer.setView(b.dataset.view as ViewMode);
  };
});

// ---------------- robots ----------------

function renderRobotSelect() {
  const sel = $<HTMLSelectElement>('robot-select');
  sel.replaceChildren();
  const groups: Array<[string, RobotProfile[]]> = [
    ['Presets', state.robots.filter((r) => PRESETS.includes(r))],
    ['My robots', state.robots.filter((r) => !PRESETS.includes(r))],
  ];
  for (const [label, list] of groups) {
    if (!list.length) continue;
    const og = document.createElement('optgroup');
    og.label = label;
    for (const r of list) og.append(new Option(r.name, r.id, false, r.id === state.robotId));
    sel.append(og);
  }
}

async function applyRobot() {
  const r = robot();
  try {
    const glb = r.model ? await loadModel(r.model.assetId) : undefined;
    await viewer.setRobot(r, glb);
  } catch (e) {
    // a broken model or profile must not take the app down: show the plain box robot
    console.error(e);
    setStatus(`Could not show “${r.name}”: ${(e as Error).message}`, 'err');
    try {
      await viewer.setRobot({ ...r, model: undefined, mechanisms: [] });
    } catch {
      /* nothing more to try */
    }
  }
  if (!state.recording) viewer.showPose(state.start);
  else viewer.showTime(state.t);
}

$<HTMLSelectElement>('robot-select').onchange = async (e) => {
  state.robotId = (e.target as HTMLSelectElement).value;
  settingsChanged();
  clearRecording();
  await applyRobot();
  persistSettings();
};

// ---------------- start pose ----------------

const spInputs = ['sp-x', 'sp-y', 'sp-t'].map((id) => $<HTMLInputElement>(id));
function readStart() {
  const [x, y, t] = spInputs.map((i) => Number(i.value) || 0);
  const half = field().perimeter.inside / 2 - 6;
  state.start = { x: Math.max(-half, Math.min(half, x)), y: Math.max(-half, Math.min(half, y)), theta: t };
  settingsChanged();
  viewer.showPose(state.start);
  persistSettings();
}
spInputs.forEach((i) => i.addEventListener('change', readStart));

// ---------------- fields and start presets ----------------

function renderFieldSelect() {
  const sel = $<HTMLSelectElement>('field-select');
  sel.replaceChildren(...FIELDS.map((f) => new Option(f.name, f.id, false, f.id === state.fieldId)));
}

function renderPresets() {
  const f = field();
  const presets = (f.startPositions ?? []).filter((p) => p.layouts.includes(layoutId()));
  const sel = $<HTMLSelectElement>('sp-preset');
  $('sp-preset-label').hidden = presets.length === 0;
  const match = presets.find((p) => p.x === state.start.x && p.y === state.start.y && p.theta === state.start.theta);
  sel.replaceChildren(new Option('Custom', '', false, !match), ...presets.map((p) => new Option(p.name, p.id, false, p === match)));
}

function setStart(p: { x: number; y: number; theta: number }) {
  state.start = { x: p.x, y: p.y, theta: p.theta };
  [p.x, p.y, p.theta].forEach((v, i) => (spInputs[i].value = String(v)));
  settingsChanged();
  viewer.showPose(state.start);
  persistSettings();
}

/** Show the selected field and its starting layout (before any run). */
function applyField() {
  const f = field();
  settingsChanged();
  viewer.setField(f);
  clearRecording();
  viewer.setGameState(f.game?.id === 'override' ? initialState(f, layoutId()) : null);
  renderScore(null, 0);
  $('start-pose').classList.remove('hidden');
  renderPresets();
  viewer.showPose(state.start);
}

$<HTMLSelectElement>('field-select').onchange = (e) => {
  state.fieldId = (e.target as HTMLSelectElement).value;
  const f = field();
  // jump to the first legal start on a game field
  const first = (f.startPositions ?? []).find((p) => p.layouts.includes(layoutId()));
  applyField();
  setStart(first ?? { x: 0, y: 0, theta: 0 });
  renderPresets();
};
$<HTMLSelectElement>('sp-preset').onchange = (e) => {
  const p = (field().startPositions ?? []).find((x) => x.id === (e.target as HTMLSelectElement).value);
  if (p) setStart(p);
};
$<HTMLSelectElement>('sp-place').onchange = (e) => {
  state.place = (e.target as HTMLSelectElement).value as PlaceMode;
  settingsChanged();
  persistSettings();
};
$<HTMLSelectElement>('auton-length').onchange = (e) => {
  state.autonMs = Number((e.target as HTMLSelectElement).value);
  applyField();
  // a start that is only legal in the other layout (e.g. Red 2 in Skills) moves to a legal one
  const legal = (field().startPositions ?? []).filter((p) => p.layouts.includes(layoutId()));
  const onPreset = (field().startPositions ?? []).find((p) => p.x === state.start.x && p.y === state.start.y);
  if (onPreset && !legal.includes(onPreset) && legal[0]) setStart(legal[0]);
  renderPresets();
  persistSettings();
};

/** The code changed: the shown run no longer matches it. */
function invalidateRun() {
  state.dirtySinceRun = true;
}

/** A setting a run depends on changed: a run in progress is stale, so stop it. */
function settingsChanged() {
  state.dirtySinceRun = true;
  if (state.running) cancelRun();
}

/** Forget the shown run (its robot, field or layout no longer match what's selected). */
function clearRecording() {
  setPlaying(false);
  state.recording = null;
  state.setup = null;
  viewer.setRecording(null);
  renderScore(null, 0);
  $('start-pose').classList.remove('hidden');
}

// ---------------- compiler + simulator ----------------

// The compiler worker lives as long as the page (the toolchain stays compiled in it).
// If it crashes, can't load (e.g. the site was updated under an open tab) or goes quiet,
// pending builds fail with a message and the next build gets a fresh worker.
let compiler: Worker | null = null;
let reqId = 0;
const pending = new Map<number, { resolve: (r: BuildResult) => void; reject: (e: Error) => void; timer: number }>();
/** A build that sends nothing (no progress, no result) for this long is given up (ms). */
const COMPILER_SILENCE_MS = 120_000;

function compilerWorker(): Worker {
  if (compiler) return compiler;
  const w = new Worker(new URL('../compiler/worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (ev: MessageEvent<CompilerResponse>) => {
    const m = ev.data;
    const p = pending.get(m.id);
    if (p) {
      clearTimeout(p.timer);
      p.timer = window.setTimeout(() => restartCompiler('The compiler stopped responding.'), COMPILER_SILENCE_MS);
    }
    if (m.type === 'progress') {
      setStatus(m.message, '', m.total ? { loaded: m.loaded ?? 0, total: m.total } : undefined);
      return;
    }
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(m.id);
    if (m.type === 'result') p.resolve(m.result);
    else {
      // the worker's toolchain may be in a bad state (e.g. out of memory): start over next time
      restartCompiler();
      p.reject(new Error(m.message));
    }
  };
  w.onerror = (e) => {
    e.preventDefault();
    restartCompiler(e.message ? `The compiler crashed: ${e.message}` : 'The compiler could not start. If the site was just updated, reload the page.');
  };
  w.onmessageerror = () => restartCompiler('The compiler sent a message that could not be read.');
  return (compiler = w);
}

/** Throw the compiler worker away; pending builds fail with `message`. */
function restartCompiler(message?: string) {
  compiler?.terminate();
  compiler = null;
  if (!message) return;
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    pending.delete(id);
    p.reject(new Error(message));
  }
}

const SIMULATED = simulatedEnvNames();

function projectFiles(): Record<string, string | Uint8Array> {
  return { ...editor.files(), ...state.binary };
}

function compile(): Promise<BuildResult> {
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => restartCompiler('The compiler stopped responding.'), COMPILER_SILENCE_MS);
    pending.set(id, { resolve, reject, timer });
    compilerWorker().postMessage({ id, type: 'build', files: projectFiles(), simulated: SIMULATED, base: new URL('.', location.href).href } satisfies CompilerRequest);
  });
}

class Cancelled extends Error {}

/** The simulation sandbox of the run in progress. */
let activeSim: { w: Worker; reject: (e: Error) => void } | null = null;

/** Stop a run in progress: its result would no longer match the selected settings. */
function cancelRun() {
  state.runSeq++;
  activeSim?.reject(new Cancelled());
}

function simulate(wasm: Uint8Array<ArrayBuffer>, setup: RunSetup): Promise<Recording> {
  // a fresh sandbox per run; terminated on completion, cancellation, or if it hangs
  const w = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    let timer = 0;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      w.terminate();
      if (activeSim?.w === w) activeSim = null;
      fn();
    };
    activeSim = { w, reject: (e) => finish(() => reject(e)) };
    // the real-time budget starts once the sandbox has loaded; long Skills runs get more
    const budgetMs = 30_000 + setup.autonMs;
    timer = window.setTimeout(() => finish(() => reject(new Error('The simulation sandbox did not start. If the site was just updated, reload the page.'))), 30_000);
    w.onmessage = (ev: MessageEvent<SimResponse>) => {
      const m = ev.data;
      if (m.type === 'ready') {
        clearTimeout(timer);
        timer = window.setTimeout(
          () => finish(() => reject(new Error(`The program ran for over ${budgetMs / 1000} s of real time without finishing. A loop that never calls pros::delay() can freeze the simulation.`))),
          budgetMs,
        );
        const req: SimRequest = {
          wasm,
          options: { profile: setup.robot, field: setup.field, start: setup.start, autonMs: setup.autonMs, placeAtSetPose: setup.place, wallLimitMs: budgetMs - 5000 },
        };
        w.postMessage(req, [wasm.buffer]);
        return;
      }
      if (m.type === 'result') finish(() => resolve(m.recording));
      else finish(() => reject(new Error(m.message)));
    };
    w.onerror = (e) => {
      e.preventDefault();
      finish(() => reject(new Error(e.message ? `The simulation crashed: ${e.message}` : 'The simulation sandbox could not load. If the site was just updated, reload the page.')));
    };
  });
}

async function run() {
  if (state.running || !state.booted) return;
  if (typeof (WebAssembly as unknown as { Suspending?: unknown }).Suspending !== 'function') {
    setStatus('This browser is too old to run programs (needs WebAssembly JSPI: Chrome 137+, Firefox 153+, Safari 27+).', 'err');
    return;
  }
  // everything the run depends on is frozen now; changing a setting cancels it
  const seq = ++state.runSeq;
  const setup: RunSetup = { robot: robot(), field: field(), start: { ...state.start }, autonMs: state.autonMs, place: state.place };
  const stale = () => seq !== state.runSeq;
  state.running = true;
  setPlaying(false);
  $<HTMLButtonElement>('btn-run').disabled = true;
  setStatus('Compiling…');
  const t0 = performance.now();
  try {
    const b = await compile();
    if (stale()) throw new Cancelled();
    renderProblems(b);
    if (!b.ok || !b.wasm) {
      const n = b.diagnostics.filter((d) => d.severity === 'error').length + b.notes.filter((n) => n.level === 'error').length;
      setStatus(n ? `Build failed with ${n} error${n === 1 ? '' : 's'}.` : 'Build failed (see Problems).', 'err');
      showTab('problems');
      return;
    }
    const compileMs = performance.now() - t0;
    setStatus('Running…');
    const rec = await simulate(b.wasm, setup);
    if (stale()) throw new Cancelled();
    loadRecording(rec, setup);
    const warnings = rec.events.filter((e) => e.level !== 'info').length;
    if (rec.error) {
      setStatus(rec.error, 'err');
      showTab('events');
    } else {
      const ran = rec.autonStart !== null ? (rec.stop - rec.autonStart) / 1000 : 0;
      setStatus(
        `Compiled in ${(compileMs / 1000).toFixed(1)} s · simulated ${ran.toFixed(1)} s of autonomous in ${(rec.wallMs / 1000).toFixed(2)} s` +
          (warnings ? ` · ${warnings} note${warnings === 1 ? '' : 's'}` : ''),
        'ok',
      );
    }
    state.dirtySinceRun = false;
    setPlaying(true);
  } catch (e) {
    if (e instanceof Cancelled) setStatus('Run cancelled: the robot, field or start changed. Press Run again.');
    else {
      console.error(e);
      setStatus((e as Error).message, 'err');
    }
  } finally {
    state.running = false;
    $<HTMLButtonElement>('btn-run').disabled = false;
  }
}
$('btn-run').onclick = run;
editor.onRunShortcut = run;

// ---------------- results panels ----------------

function renderProblems(b: BuildResult) {
  const panel = $('panel-problems');
  const items: Array<{ sev: string; loc: string; message: string; detail?: string; open?: () => void }> = [];
  for (const n of b.notes) items.push({ sev: n.level === 'info' ? 'info' : n.level, loc: 'project', message: n.message });
  for (const d of b.diagnostics) {
    items.push({
      sev: d.severity,
      loc: d.file ? `${d.file}:${d.line}:${d.column}` : 'linker',
      message: d.message,
      detail: d.detail,
      open: d.file && !d.file.startsWith('<') ? () => editor.open(d.file!, d.line, d.column) : undefined,
    });
  }
  editor.setDiagnostics(b.diagnostics);
  const errors = items.filter((i) => i.sev === 'error').length;
  const badge = $('badge-problems');
  badge.textContent = errors ? String(errors) : items.filter((i) => i.sev === 'warning').length ? String(items.filter((i) => i.sev === 'warning').length) : '';
  badge.className = 'badge ' + (errors ? 'err' : 'warn');
  if (!items.length) {
    panel.innerHTML = '<p class="empty">No problems. 🎉</p>';
    return;
  }
  panel.replaceChildren(
    ...items.map((i) => {
      const row = document.createElement('div');
      row.className = 'diag';
      const sev = document.createElement('span');
      sev.className = 'sev ' + i.sev;
      const body = document.createElement('div');
      const loc = document.createElement('div');
      loc.className = 'loc';
      loc.textContent = i.loc;
      const msg = document.createElement('div');
      msg.textContent = i.message;
      body.append(loc, msg);
      if (i.detail && i.detail.includes('\n')) {
        const pre = document.createElement('pre');
        pre.textContent = i.detail.split('\n').slice(1).join('\n');
        body.append(pre);
      }
      row.append(sev, body);
      if (i.open) row.onclick = i.open;
      return row;
    }),
  );
}

const fmtTime = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

function renderEvents(rec: Recording) {
  const panel = $('panel-events');
  const all = [...rec.events];
  if (rec.error) all.unshift({ t: rec.stop, level: 'error', message: rec.error });
  const badge = $('badge-events');
  const warn = all.filter((e) => e.level !== 'info').length;
  badge.textContent = warn ? String(warn) : '';
  badge.className = 'badge ' + (all.some((e) => e.level === 'error') ? 'err' : 'warn');
  if (!all.length) {
    panel.innerHTML = '<p class="empty">Nothing to report.</p>';
    return;
  }
  const base = rec.autonStart ?? 0;
  panel.replaceChildren(
    ...all.map((e) => {
      const row = document.createElement('div');
      row.className = 'diag';
      row.innerHTML = `<span class="sev ${e.level === 'info' ? 'info' : e.level}"></span><div><div class="loc"></div><div class="m"></div></div>`;
      row.querySelector('.loc')!.textContent = e.t < base ? `initialize() · ${fmtTime(e.t)}` : `auton ${fmtTime(e.t - base)}`;
      row.querySelector('.m')!.textContent = e.message;
      row.onclick = () => seek(Math.max(e.t, base));
      return row;
    }),
  );
}

/** Console rows shown (a program printing in a tight loop must not freeze the page). */
const CONSOLE_ROWS = 2000;
/** Number of console rows currently shown as "already printed" (rows are in time order). */
let consolePast = 0;
function renderConsole(rec: Recording, t: number) {
  const panel = $('panel-console');
  if (!rec.console.length) {
    if (!panel.querySelector('.empty')) panel.innerHTML = '<p class="empty">No console output.</p>';
    return;
  }
  const base = rec.autonStart ?? 0;
  const lines = rec.console.slice(0, CONSOLE_ROWS);
  if (panel.dataset.rows !== String(lines.length) || panel.dataset.rec !== String(rec.stop) + ':' + rec.console.length) {
    panel.replaceChildren(
      ...lines.map((c) => {
        const row = document.createElement('div');
        row.className = 'console-line future';
        const ts = document.createElement('span');
        ts.className = 't';
        ts.textContent = c.t < base ? 'init' : fmtTime(c.t - base);
        const tx = document.createElement('span');
        tx.textContent = c.text;
        row.append(ts, tx);
        return row;
      }),
    );
    if (rec.console.length > CONSOLE_ROWS) {
      const more = document.createElement('p');
      more.className = 'empty';
      more.textContent = `… and ${rec.console.length - CONSOLE_ROWS} more lines (only the first ${CONSOLE_ROWS} are shown).`;
      panel.append(more);
    }
    panel.dataset.rows = String(lines.length);
    panel.dataset.rec = String(rec.stop) + ':' + rec.console.length;
    consolePast = 0;
  }
  // rows printed by time t: binary search, then only flip the rows that changed
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  for (let i = Math.min(lo, consolePast); i < Math.max(lo, consolePast); i++) (panel.children[i] as HTMLElement).classList.toggle('future', i >= lo);
  consolePast = lo;
}

function renderLcd(rec: Recording, t: number) {
  const lines = Array<string>(8).fill('');
  for (const e of rec.lcd) {
    if (e.t > t) break;
    if (e.line >= 0 && e.line < 8) lines[e.line] = e.text;
  }
  $('lcd').textContent = lines.join('\n');
}

// ---------------- timeline ----------------

const scrub = $<HTMLInputElement>('scrub');
const playBtn = $<HTMLButtonElement>('btn-play');

function loadRecording(rec: Recording, setup: RunSetup) {
  state.recording = rec;
  state.setup = setup;
  scoreCache = null;
  viewer.setRecording(rec);
  const start = rec.autonStart ?? 0;
  scrub.min = String(start);
  scrub.max = String(rec.stop);
  $('start-pose').classList.add('hidden');
  renderEvents(rec);
  $('panel-console').replaceChildren();
  delete $('panel-console').dataset.rows; // rebuild the rows for this run
  seek(start);
}

function seek(t: number) {
  const rec = state.recording;
  if (!rec) return;
  state.t = Math.max(Number(scrub.min), Math.min(rec.stop, t));
  scrub.value = String(state.t);
  viewer.showTime(state.t);
  const auton = rec.autonStart ?? 0;
  const elapsed = state.t - auton;
  const timer = $('timer');
  timer.textContent = fmtTime(elapsed);
  const atStop = state.t >= rec.stop - 1;
  timer.classList.toggle('done', atStop);
  $('timer-sub').textContent = rec.autonStart === null
    ? 'initialize() never returned'
    : atStop
      ? rec.error ? 'Stopped: error' : `Auto-stop at ${(state.setup?.autonMs ?? state.autonMs) / 1000} s`
      : rec.autonEnd !== null && state.t >= rec.autonEnd ? `autonomous() returned at ${fmtTime(rec.autonEnd - auton)}` : 'Autonomous';
  renderLcd(rec, state.t);
  renderConsole(rec, state.t);
  renderScore(rec, state.t);
}

/** Scoring a replayed moment clones and scores the whole state: do it ~10 times a second. */
let scoreCache: { rec: Recording; bucket: number } | null = null;
function renderScore(rec: Recording | null, t: number) {
  const g = rec?.game ?? null;
  const setup = state.setup;
  const atEnd = !!rec && t >= rec.stop - 1;
  const bucket = atEnd ? -1 : Math.floor(t / 100);
  if (rec && scoreCache?.rec === rec && scoreCache.bucket === bucket) return;
  scoreCache = rec ? { rec, bucket } : null;
  // the run's own field and robot, not whatever is selected now
  const r = rec && g && setup ? liveResult(setup.field, rec, g, t, setup.robot.size) : null;
  renderHud($('hud-score'), g, r);
  renderScorePanel($('panel-score'), g, r, atEnd);
}

function setPlaying(on: boolean) {
  state.playing = on && !!state.recording;
  playBtn.textContent = state.playing ? '❚❚' : '▶';
  playBtn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  if (state.playing && state.recording && state.t >= state.recording.stop - 1) seek(Number(scrub.min));
}

let lastFrame = performance.now();
function tick(now: number) {
  // schedule first: one bad frame must not stop playback for good
  requestAnimationFrame(tick);
  const dt = now - lastFrame;
  lastFrame = now;
  if (!state.playing || !state.recording) return;
  try {
    seek(state.t + dt * state.speed);
    if (state.t >= state.recording.stop - 1) setPlaying(false);
  } catch (e) {
    console.error(e);
    setPlaying(false);
    setStatus('Playback stopped: ' + (e as Error).message, 'err');
  }
}
requestAnimationFrame(tick);

playBtn.onclick = () => {
  if (!state.recording) return run();
  setPlaying(!state.playing);
};
scrub.oninput = () => {
  setPlaying(false);
  seek(Number(scrub.value));
};
$<HTMLSelectElement>('speed').onchange = (e) => (state.speed = Number((e.target as HTMLSelectElement).value));
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !(e.target as HTMLElement).closest('.monaco-editor, input, select, textarea, dialog')) {
    e.preventDefault();
    playBtn.click();
  }
});

// ---------------- project files ----------------

let saveTimer = 0;
editor.onChange = () => {
  invalidateRun();
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persistProject, 600);
};

function persistProject() {
  const binary: Record<string, string> = {};
  for (const [p, b] of Object.entries(state.binary)) binary[p] = toBase64(b);
  void saveProject({ name: state.projectName, files: editor.files(), binary, robotId: state.robotId });
}

function loadFiles(name: string, files: Record<string, string>, binary: Record<string, Uint8Array> = {}) {
  // Text files from static/ are assets too (LemLib paths)
  state.binary = { ...binary };
  const editable: Record<string, string> = {};
  for (const [p, t] of Object.entries(files)) {
    if (/^(src|include)\//.test(p) || p.startsWith('static/') || p === 'project.pros') {
      if (/^include\/(api\.h|pros\/|lemlib\/|fmt\/|EZ-Template\/|okapi\/|liblvgl\/)/.test(p)) continue; // provided by the simulator
      editable[p] = t;
    }
  }
  state.projectName = name;
  editor.load(editable);
  applyField();
  persistProject();
}

$('btn-new-file').onclick = () => {
  const name = prompt('New file path (e.g. src/autons.cpp or include/robot.hpp):', 'src/autons.cpp');
  if (!name) return;
  const p = name.trim().replace(/^\/+/, '');
  if (!/^(src|include|static)\/[\w./-]+$/.test(p)) {
    alert('Files must live in src/, include/ or static/.');
    return;
  }
  editor.addFile(p, p.endsWith('.cpp') ? '#include "main.h"\n\n' : p.match(/\.(h|hpp)$/) ? '#pragma once\n#include "main.h"\n\n' : '');
};
$('btn-file-menu').onclick = () => {
  const p = editor.activePath;
  if (!p) return;
  const action = prompt(`File: ${p}\nType a new path to rename it, or "delete" to remove it.`, p);
  if (!action || action === p) return;
  if (action.trim().toLowerCase() === 'delete') {
    if (confirm(`Delete ${p}?`)) editor.deleteFile(p);
  } else editor.renameFile(p, action.trim());
};

$('btn-import').onclick = async () => {
  const f = await pickFile('.zip,application/zip');
  if (!f) return;
  try {
    const { files, binary } = projectFromZip(new Uint8Array(await f.arrayBuffer()));
    const strip = commonRoot(Object.keys(files));
    const rel = (p: string) => p.slice(strip.length);
    const tf: Record<string, string> = {};
    const bf: Record<string, Uint8Array> = {};
    for (const [p, t] of Object.entries(files)) tf[rel(p)] = t;
    for (const [p, b] of Object.entries(binary)) if (rel(p).startsWith('static/')) bf[rel(p)] = b;
    if (!Object.keys(tf).some((p) => p.startsWith('src/'))) throw new Error('No src/ folder found in the zip. Zip your whole PROS project folder.');
    loadFiles(f.name.replace(/\.zip$/i, ''), tf, bf);
    setStatus(`Imported ${f.name}. Library headers bundled in include/ are replaced by the simulator's.`, 'ok');
  } catch (e) {
    setStatus('Import failed: ' + (e as Error).message, 'err');
  }
};

function commonRoot(paths: string[]): string {
  const withSrc = paths.find((p) => /(^|\/)src\//.test(p));
  if (!withSrc) return '';
  return withSrc.slice(0, withSrc.search(/(^|\/)src\//) + (withSrc.match(/^src\//) ? 0 : 1));
}

$('btn-export').onclick = () => download(`${state.projectName || 'project'}.zip`, projectToZip(editor.files(), state.binary), 'application/zip');

/**
 * Open a sample with everything it was written for: its robot, its field (the empty field
 * unless it names a game field), start position and auto-stop.
 */
async function openSample(s: SampleMeta) {
  settingsChanged();
  state.robotId = state.robots.some((r) => r.id === s.robot) ? s.robot : PRESETS[0].id;
  renderRobotSelect();
  state.fieldId = s.field && FIELDS.some((f) => f.id === s.field) ? s.field : DEFAULT_FIELD;
  state.autonMs = s.autonMs ?? 15000;
  renderFieldSelect();
  $<HTMLSelectElement>('auton-length').value = String(state.autonMs);
  const starts = (field().startPositions ?? []).filter((p) => p.layouts.includes(layoutId()));
  const start = starts.find((p) => p.id === s.start) ?? starts[0];
  setStart(start ?? { x: 0, y: 0, theta: 0 });
  await applyRobot();
  loadFiles(s.id, sampleProject(s.id));
  persistSettings();
}

// samples dialog
$('btn-samples').onclick = () => {
  const list = $('sample-list');
  // grouped: starters on the empty field, Override autons, then the robots' mechanism tests
  const groups: Array<[string, SampleMeta[]]> = [
    ['Starters (empty 12 ft field)', SAMPLES.filter((s) => !s.field)],
    ['V5RC Override autons', SAMPLES.filter((s) => s.field && s.kind !== 'test')],
    ['Mechanism tests: one per Override robot (PASS / FAIL in the Console)', SAMPLES.filter((s) => s.kind === 'test')],
  ];
  const card = (s: SampleMeta) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card';
    b.innerHTML = '<strong></strong><span></span>';
    b.querySelector('strong')!.textContent = s.name;
    b.querySelector('span')!.textContent = `${s.description} Robot: ${PRESETS.find((p) => p.id === s.robot)?.name ?? s.robot}.`;
    b.onclick = async () => {
      $<HTMLDialogElement>('dlg-samples').close();
      await openSample(s);
      setStatus(`Opened “${s.name}”. Press Run.`);
    };
    return b;
  };
  list.replaceChildren(
    ...groups.flatMap(([title, items]) => {
      if (!items.length) return [];
      const h = document.createElement('h3');
      h.className = 'cards-title';
      h.textContent = title;
      return [h, ...items.map(card)];
    }),
  );
  $<HTMLDialogElement>('dlg-samples').showModal();
};

// ---------------- robot editor dialog ----------------

let robotEditor: ReturnType<typeof jsonEditor> | null = null;
let editingGlb: { assetId: string } | null = null;

function robotSummary(r: RobotProfile): string {
  const d = r.drivetrain;
  const ms = maxSpeed(r);
  return `<div>${d.left.length + d.right.length}-motor ${d.type}, ${d.cartridge} cartridges</div>
    <div>Top speed <b>${ms.toFixed(1)} in/s</b> (${(ms / 12).toFixed(1)} ft/s)</div>
    <div>Accel <b>${d.maxAccel}</b> in/s² · 0→top in <b>${(ms / d.maxAccel).toFixed(2)} s</b></div>
    <div>Footprint <b>${r.size.width}" × ${r.size.length}"</b>, track ${d.trackWidth}"</div>
    <div>${r.model ? '3D model attached' : 'Box model (no GLB)'}</div>`;
}

function openRobotDialog() {
  const r = robot();
  const isPreset = PRESETS.includes(r);
  $('robot-title').textContent = isPreset ? `${r.name} (preset)` : r.name;
  const host = $('robot-json');
  robotEditor?.dispose();
  robotEditor = jsonEditor(host, JSON.stringify(r, null, 2));
  editingGlb = r.model ? { assetId: r.model.assetId } : null;
  const validate = () => {
    let parsed: unknown;
    const errs: string[] = [];
    try {
      parsed = JSON.parse(robotEditor!.getValue());
      errs.push(...validateProfile(parsed));
    } catch (e) {
      errs.push('JSON: ' + (e as Error).message);
    }
    $('robot-errors').replaceChildren(...errs.map((m) => Object.assign(document.createElement('li'), { textContent: m })));
    if (!errs.length) $('robot-summary').innerHTML = robotSummary(parsed as RobotProfile);
    $<HTMLButtonElement>('rb-save').disabled = errs.length > 0;
    return errs.length ? null : (parsed as RobotProfile);
  };
  robotEditor.onDidChangeModelContent(validate);
  validate();
  $<HTMLButtonElement>('rb-delete').hidden = isPreset;
  $<HTMLButtonElement>('rb-save').textContent = isPreset ? 'Save as my robot (copy)' : 'Save';
  $<HTMLButtonElement>('rb-save').onclick = async () => {
    const p = validate();
    if (!p) return;
    if (PRESETS.some((x) => x.id === p.id)) {
      p.id = `${p.id}-custom-${Date.now().toString(36)}`;
      if (!/custom|my /i.test(p.name)) p.name = `My ${p.name}`;
    }
    if (editingGlb) p.model = { ...(p.model ?? {}), assetId: editingGlb.assetId };
    else delete p.model;
    await saveCustomRobot(p);
    state.robots = [...PRESETS, ...(await listCustomRobots())];
    state.robotId = p.id;
    renderRobotSelect();
    await applyRobot();
    invalidateRun();
    persistSettings();
    $<HTMLDialogElement>('dlg-robot').close();
    setStatus(`Saved robot “${p.name}” in this browser.`, 'ok');
  };
  $('rb-model').onclick = async () => {
    const f = await pickFile('.glb,model/gltf-binary');
    if (!f) return;
    const buf = await f.arrayBuffer();
    const assetId = 'glb-' + Date.now().toString(36);
    await saveModel(assetId, buf);
    editingGlb = { assetId };
    const p = validate();
    if (p) await viewer.setRobot(p, buf);
    setStatus(`Attached ${f.name}. Save the robot to keep it.`);
  };
  $('rb-model-clear').onclick = () => {
    editingGlb = null;
    setStatus('3D model removed. Save the robot to keep the change.');
  };
  $('rb-export').onclick = async () => {
    const p = validate();
    if (!p) return;
    if (editingGlb) p.model = { ...(p.model ?? {}), assetId: editingGlb.assetId };
    download(`${p.id}.zip`, await robotToZip(p), 'application/zip');
  };
  $('rb-import').onclick = async () => {
    const f = await pickFile('.json,.zip');
    if (!f) return;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      let profile: unknown;
      if (/\.zip$/i.test(f.name)) {
        const z = robotFromZip(bytes);
        profile = z.profile;
        if (z.glb) {
          const assetId = 'glb-' + Date.now().toString(36);
          await saveModel(assetId, z.glb.slice().buffer);
          editingGlb = { assetId };
        }
      } else profile = JSON.parse(new TextDecoder().decode(bytes));
      robotEditor!.setValue(JSON.stringify(profile, null, 2));
    } catch (e) {
      setStatus('Could not import robot: ' + (e as Error).message, 'err');
    }
  };
  $('rb-delete').onclick = async () => {
    if (!confirm(`Delete “${r.name}” from this browser?`)) return;
    await deleteCustomRobot(r.id);
    state.robots = [...PRESETS, ...(await listCustomRobots())];
    state.robotId = PRESETS[0].id;
    renderRobotSelect();
    await applyRobot();
    persistSettings();
    $<HTMLDialogElement>('dlg-robot').close();
  };
  $<HTMLDialogElement>('dlg-robot').showModal();
}
$('btn-robot').onclick = openRobotDialog;

// ---------------- settings persistence ----------------

function persistSettings() {
  void safe(idb.put('settings', 'app', { robotId: state.robotId, fieldId: state.fieldId, autonMs: state.autonMs, start: state.start, place: state.place }), undefined);
}

/** Saved robots that no longer validate (e.g. made with an older version) are skipped, not fatal. */
async function loadRobots(): Promise<string[]> {
  const custom = await safe(listCustomRobots(), []);
  const ok: RobotProfile[] = [];
  const skipped: string[] = [];
  for (const r of custom) {
    let errs: string[];
    try {
      errs = validateProfile(r);
    } catch (e) {
      errs = [(e as Error).message];
    }
    if (errs.length) skipped.push(r?.name ?? r?.id ?? 'a robot');
    else ok.push(r);
  }
  state.robots = [...PRESETS, ...ok];
  return skipped;
}

async function boot() {
  $<HTMLButtonElement>('btn-run').disabled = true; // until the project is loaded
  const skipped = await loadRobots();
  const settings = await safe(idb.get<{ robotId: string; fieldId?: string; autonMs: number; start: typeof state.start; place: PlaceMode }>('settings', 'app'), undefined);
  // restore only what still makes sense: a robot that exists, a field, a valid auto-stop
  if (settings) {
    if (state.robots.some((r) => r.id === settings.robotId)) state.robotId = settings.robotId;
    if (settings.fieldId && FIELDS.some((f) => f.id === settings.fieldId)) state.fieldId = settings.fieldId;
    state.autonMs = AUTON_LENGTHS.includes(settings.autonMs) ? settings.autonMs : 15000;
    const st = settings.start;
    const half = field().perimeter.inside / 2;
    if (st && [st.x, st.y, st.theta].every(Number.isFinite) && Math.abs(st.x) < half && Math.abs(st.y) < half) state.start = { x: st.x, y: st.y, theta: st.theta };
    state.place = (['auto', 'always', 'never'] as PlaceMode[]).includes(settings.place) ? settings.place : 'auto';
  }
  $<HTMLSelectElement>('auton-length').value = String(state.autonMs);
  $<HTMLSelectElement>('sp-place').value = state.place;
  [state.start.x, state.start.y, state.start.theta].forEach((v, i) => (spInputs[i].value = String(v)));
  renderRobotSelect();
  renderFieldSelect();
  applyField();
  await applyRobot();

  const saved = await safe(loadProject(), undefined);
  if (saved && Object.keys(saved.files).length) {
    const binary: Record<string, Uint8Array> = {};
    for (const [p, b] of Object.entries(saved.binary ?? {})) binary[p] = fromBase64(b);
    loadFiles(saved.name, saved.files, binary);
    setStatus('Restored your last project. Press Run (Ctrl+Enter).');
  } else {
    // first visit: the plain PROS starter on the empty field
    await openSample(SAMPLES[0]);
    setStatus('Welcome! This is a sample project: press Run to compile it in your browser. The first run downloads the compiler (~40 MB, cached afterwards).');
  }
  if (skipped.length) setStatus(`Skipped saved robot${skipped.length > 1 ? 's' : ''} ${skipped.join(', ')}: ${skipped.length > 1 ? 'they no longer match' : 'it no longer matches'} the robot format. Open it from an exported file to fix it.`, 'err');
}

void boot()
  .catch((e) => {
    console.error(e);
    setStatus('Something went wrong while starting: ' + (e as Error).message + '. Reload the page to try again.', 'err');
  })
  .finally(() => {
    state.booted = true;
    $<HTMLButtonElement>('btn-run').disabled = false;
  });

// diagnostics type is re-exported for tooling
export type { Diagnostic };
