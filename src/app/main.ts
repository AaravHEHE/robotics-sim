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
import { SAMPLES } from './samples-meta.ts';
import {
  deleteCustomRobot, download, fromBase64, idb, listCustomRobots, loadModel, loadProject, pickFile, projectFromZip,
  projectToZip, robotFromZip, robotToZip, safe, saveCustomRobot, saveModel, saveProject, toBase64,
} from './storage.ts';
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

const state = {
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
  const glb = r.model ? await loadModel(r.model.assetId) : undefined;
  await viewer.setRobot(r, glb);
  if (!state.recording) viewer.showPose(state.start);
  else viewer.showTime(state.t);
}

$<HTMLSelectElement>('robot-select').onchange = async (e) => {
  state.robotId = (e.target as HTMLSelectElement).value;
  invalidateRun();
  await applyRobot();
  persistSettings();
};

// ---------------- start pose ----------------

const spInputs = ['sp-x', 'sp-y', 'sp-t'].map((id) => $<HTMLInputElement>(id));
function readStart() {
  const [x, y, t] = spInputs.map((i) => Number(i.value) || 0);
  const half = field().perimeter.inside / 2 - 6;
  state.start = { x: Math.max(-half, Math.min(half, x)), y: Math.max(-half, Math.min(half, y)), theta: t };
  invalidateRun();
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
  invalidateRun();
  viewer.showPose(state.start);
  persistSettings();
}

/** Show the selected field and its starting layout (before any run). */
function applyField() {
  const f = field();
  viewer.setField(f);
  state.recording = null;
  viewer.setRecording(null);
  viewer.setGameState(f.game?.id === 'override' ? initialState(f, layoutId()) : null);
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
  invalidateRun();
  persistSettings();
};
$<HTMLSelectElement>('auton-length').onchange = (e) => {
  state.autonMs = Number((e.target as HTMLSelectElement).value);
  invalidateRun();
  applyField();
  persistSettings();
};

function invalidateRun() {
  state.dirtySinceRun = true;
}

// ---------------- compiler + simulator ----------------

const compiler = new Worker(new URL('../compiler/worker.ts', import.meta.url), { type: 'module' });
let reqId = 0;
const pending = new Map<number, { resolve: (r: BuildResult) => void; reject: (e: Error) => void }>();
compiler.onmessage = (ev: MessageEvent<CompilerResponse>) => {
  const m = ev.data;
  if (m.type === 'progress') {
    setStatus(m.message, '', m.total ? { loaded: m.loaded ?? 0, total: m.total } : undefined);
    return;
  }
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (m.type === 'result') p.resolve(m.result);
  else p.reject(new Error(m.message));
};
const SIMULATED = simulatedEnvNames();

function projectFiles(): Record<string, string | Uint8Array> {
  return { ...editor.files(), ...state.binary };
}

function compile(): Promise<BuildResult> {
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    compiler.postMessage({ id, type: 'build', files: projectFiles(), simulated: SIMULATED, base: new URL('.', location.href).href } satisfies CompilerRequest);
  });
}

function simulate(wasm: Uint8Array<ArrayBuffer>): Promise<Recording> {
  // a fresh sandbox per run; terminated on completion or if it hangs
  const w = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      w.terminate();
      reject(new Error('The program ran for over 45 s of real time without finishing. A loop that never calls pros::delay() can freeze the simulation.'));
    }, 45_000);
    w.onmessage = (ev: MessageEvent<SimResponse>) => {
      clearTimeout(timer);
      w.terminate();
      if (ev.data.type === 'result') resolve(ev.data.recording);
      else reject(new Error(ev.data.message));
    };
    w.onerror = (e) => {
      clearTimeout(timer);
      w.terminate();
      reject(new Error(e.message || 'The simulation worker crashed.'));
    };
    const req: SimRequest = {
      wasm,
      options: { profile: robot(), field: field(), start: state.start, autonMs: state.autonMs, placeAtSetPose: state.place },
    };
    w.postMessage(req, [wasm.buffer]);
  });
}

async function run() {
  if (state.running) return;
  if (typeof (WebAssembly as unknown as { Suspending?: unknown }).Suspending !== 'function') {
    setStatus('This browser is too old to run programs (needs WebAssembly JSPI: Chrome 137+, Firefox 153+, Safari 27+).', 'err');
    return;
  }
  state.running = true;
  setPlaying(false);
  $<HTMLButtonElement>('btn-run').disabled = true;
  setStatus('Compiling…');
  const t0 = performance.now();
  try {
    const b = await compile();
    renderProblems(b);
    if (!b.ok || !b.wasm) {
      const n = b.diagnostics.filter((d) => d.severity === 'error').length + b.notes.filter((n) => n.level === 'error').length;
      setStatus(`Build failed with ${n} error${n === 1 ? '' : 's'}.`, 'err');
      showTab('problems');
      return;
    }
    const compileMs = performance.now() - t0;
    setStatus('Running…');
    const rec = await simulate(b.wasm);
    loadRecording(rec);
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
    setStatus((e as Error).message, 'err');
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

function renderConsole(rec: Recording, t: number) {
  const panel = $('panel-console');
  if (!rec.console.length) {
    panel.innerHTML = '<p class="empty">No console output.</p>';
    return;
  }
  const base = rec.autonStart ?? 0;
  if (panel.childElementCount !== rec.console.length) {
    panel.replaceChildren(
      ...rec.console.map((c) => {
        const row = document.createElement('div');
        row.className = 'console-line';
        const ts = document.createElement('span');
        ts.className = 't';
        ts.textContent = c.t < base ? 'init' : fmtTime(c.t - base);
        const tx = document.createElement('span');
        tx.textContent = c.text;
        row.append(ts, tx);
        return row;
      }),
    );
  }
  rec.console.forEach((c, i) => (panel.children[i] as HTMLElement).classList.toggle('future', c.t > t));
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

function loadRecording(rec: Recording) {
  state.recording = rec;
  viewer.setRecording(rec);
  const start = rec.autonStart ?? 0;
  scrub.min = String(start);
  scrub.max = String(rec.stop);
  $('start-pose').classList.add('hidden');
  renderEvents(rec);
  $('panel-console').replaceChildren();
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
      ? rec.error ? 'Stopped: error' : `Auto-stop at ${state.autonMs / 1000} s`
      : rec.autonEnd !== null && state.t >= rec.autonEnd ? `autonomous() returned at ${fmtTime(rec.autonEnd - auton)}` : 'Autonomous';
  renderLcd(rec, state.t);
  renderConsole(rec, state.t);
}

function setPlaying(on: boolean) {
  state.playing = on && !!state.recording;
  playBtn.textContent = state.playing ? '❚❚' : '▶';
  playBtn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  if (state.playing && state.recording && state.t >= state.recording.stop - 1) seek(Number(scrub.min));
}

let lastFrame = performance.now();
function tick(now: number) {
  const dt = now - lastFrame;
  lastFrame = now;
  if (state.playing && state.recording) {
    seek(state.t + dt * state.speed);
    if (state.t >= state.recording.stop - 1) setPlaying(false);
  }
  requestAnimationFrame(tick);
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

// samples dialog
$('btn-samples').onclick = () => {
  const list = $('sample-list');
  list.replaceChildren(
    ...SAMPLES.map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'card';
      b.innerHTML = '<strong></strong><span></span>';
      b.querySelector('strong')!.textContent = s.name;
      b.querySelector('span')!.textContent = `${s.description} Robot: ${PRESETS.find((p) => p.id === s.robot)?.name ?? s.robot}.`;
      b.onclick = async () => {
        $<HTMLDialogElement>('dlg-samples').close();
        state.robotId = s.robot;
        renderRobotSelect();
        const firstStart = (field().startPositions ?? []).find((p) => p.layouts.includes(layoutId()));
        setStart(firstStart ?? { x: 0, y: 0, theta: 0 });
        await applyRobot();
        loadFiles(s.id, sampleProject(s.id));
        persistSettings();
        setStatus(`Opened “${s.name}”. Press Run.`);
      };
      return b;
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

async function boot() {
  $<HTMLButtonElement>('btn-run').disabled = true; // until the project is loaded
  state.robots = [...PRESETS, ...(await listCustomRobots())];
  const settings = await safe(idb.get<{ robotId: string; fieldId?: string; autonMs: number; start: typeof state.start; place: PlaceMode }>('settings', 'app'), undefined);
  if (settings) {
    if (state.robots.some((r) => r.id === settings.robotId)) state.robotId = settings.robotId;
    if (settings.fieldId && FIELDS.some((f) => f.id === settings.fieldId)) state.fieldId = settings.fieldId;
    state.autonMs = settings.autonMs ?? 15000;
    state.start = settings.start ?? state.start;
    state.place = settings.place ?? 'auto';
  }
  $<HTMLSelectElement>('auton-length').value = String(state.autonMs);
  $<HTMLSelectElement>('sp-place').value = state.place;
  [state.start.x, state.start.y, state.start.theta].forEach((v, i) => (spInputs[i].value = String(v)));
  renderRobotSelect();
  renderFieldSelect();
  applyField();
  if (!settings) {
    const first = (field().startPositions ?? []).find((p) => p.layouts.includes(layoutId()));
    if (first) setStart(first);
  }
  await applyRobot();

  const saved = await loadProject();
  if (saved && Object.keys(saved.files).length) {
    const binary: Record<string, Uint8Array> = {};
    for (const [p, b] of Object.entries(saved.binary ?? {})) binary[p] = fromBase64(b);
    loadFiles(saved.name, saved.files, binary);
    setStatus('Restored your last project. Press Run (Ctrl+Enter).');
  } else {
    const first = SAMPLES[0];
    state.robotId = first.robot;
    renderRobotSelect();
    await applyRobot();
    loadFiles(first.id, sampleProject(first.id));
    setStatus('Welcome! This is a sample project: press Run to compile it in your browser. The first run downloads the compiler (~40 MB, cached afterwards).');
  }
}

void boot().finally(() => ($<HTMLButtonElement>('btn-run').disabled = false));

// diagnostics type is re-exported for tooling
export type { Diagnostic };
