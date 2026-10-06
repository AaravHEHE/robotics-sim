// App entry: wires the editor, compiler worker, simulation sandbox, 3D viewer,
// timeline, robot profiles and browser storage together.

import type * as THREE from 'three';
import type { BuildResult } from '../compiler/build.ts';
import type { Diagnostic } from '../compiler/diagnostics.ts';
import type { CompilerRequest, CompilerResponse } from '../compiler/worker.ts';
import { startingState } from '../games/override/manipulators.ts';
import type { FieldDef } from '../sim/field.ts';
import { maxSpeed, validateProfile, type RobotProfile } from '../sim/profile.ts';
import { simulatedEnvNames } from '../sim/pros-api.ts';
import type { Recording } from '../sim/recording.ts';
import type { PlaceMode } from '../sim/runtime.ts';
import type { SimRequest, SimResponse } from '../sim/worker.ts';
import {
  applyFieldSettings, clearFieldModel, DEFAULT_FIELD_SETTINGS, FIELD_ASSET_TYPES, fieldModelFrom, fitToField, loadFieldModel, loadFieldSettings,
  readFieldModel, saveFieldModel, saveFieldSettings, statusText, toGlb, type FieldModelSettings,
} from './field-assets.ts';
import { jsonEditor, ProjectEditor } from './editor.ts';
import { SAMPLES, type SampleMeta } from './samples-meta.ts';
import {
  deleteCustomRobot, download, loadAssembly, saveAssembly, fromBase64, idb, listCustomRobots, loadModel, loadProject, pickFile, projectFromZip,
  projectToZip, robotFromZip, robotToZip, safe, saveCustomRobot, saveModel, saveProject, toBase64,
} from './storage.ts';
import { MapPanel } from './map-panel.ts';
import { LayoutEditor } from './robot-editor/index.ts';
import { validateAssembly, type Assembly } from './parts/assembly.ts';
import { CATALOG, PartsBuilder } from './parts/builder.ts';
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
  // the map needs room for its table
  document.querySelector('.bottom')?.classList.toggle('tall', name === 'map');
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
  mapPanel?.robotChanged(); // its route timing uses this robot
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

// The code follows the robot: each preset has its own auton (and mechanism test), written
// for its ports. Picking a robot opens its auton unless you have your own code open.
$<HTMLSelectElement>('robot-select').onchange = async (e) => {
  state.robotId = (e.target as HTMLSelectElement).value;
  settingsChanged();
  clearRecording();
  await applyRobot();
  persistSettings();
  const { auton } = samplesFor(state.robotId);
  if (!auton) return;
  if (codeIsUnchangedSample()) {
    await openSample(auton);
    setStatus(`Opened “${auton.name}”, the auton written for this robot. Press Run.`, 'ok');
  } else if (confirm(`Open the auton written for “${robot().name}”?\n\nYour current code was written for its own robot's ports; on this robot its motors and pistons may do nothing. OK replaces it (use Export first to keep a copy). Cancel keeps your code.`)) {
    await openSample(auton);
    setStatus(`Opened “${auton.name}”. Press Run.`, 'ok');
  } else {
    setStatus(`Kept your code. Check that its ports match “${robot().name}” (Edit shows them).`);
  }
};

/** The auton and the mechanism test written for a robot preset. */
function samplesFor(robotId: string): { auton?: SampleMeta; test?: SampleMeta } {
  return {
    auton: SAMPLES.find((x) => x.robot === robotId && x.kind !== 'test'),
    test: SAMPLES.find((x) => x.robot === robotId && x.kind === 'test'),
  };
}

/** Is the editor showing a shipped sample, unchanged? (Then it is safe to replace.) */
function codeIsUnchangedSample(): boolean {
  if (!SAMPLES.some((x) => x.id === state.projectName)) return false;
  const now = editor.files();
  const orig = editableFiles(sampleProject(state.projectName));
  const keys = Object.keys(orig);
  return keys.length === Object.keys(now).length && keys.every((k) => now[k] === orig[k]);
}

async function openRobotSample(kind: 'auton' | 'test') {
  const s = samplesFor(state.robotId)[kind];
  if (!s) {
    setStatus(`“${robot().name}” has no ${kind === 'auton' ? 'auton' : 'mechanism test'} sample.`);
    return;
  }
  if (!codeIsUnchangedSample() && !confirm(`Open “${s.name}”? It replaces the code in the editor (use Export first to keep a copy).`)) return;
  await openSample(s);
  setStatus(`Opened “${s.name}”. Press Run.`, 'ok');
}
$('btn-robot-auton').onclick = () => void openRobotSample('auton');
$('btn-robot-test').onclick = () => void openRobotSample('test');

// ---------------- start pose ----------------

const spInputs = ['sp-x', 'sp-y', 'sp-t'].map((id) => $<HTMLInputElement>(id));
function readStart() {
  const [x, y, t] = spInputs.map((i) => Number(i.value) || 0);
  const half = field().perimeter.inside / 2 - 6;
  state.start = { x: Math.max(-half, Math.min(half, x)), y: Math.max(-half, Math.min(half, y)), theta: t };
  // show what is used: a clamped value, and no preset once the start is edited
  spInputs[0].value = String(state.start.x);
  spInputs[1].value = String(state.start.y);
  settingsChanged();
  clearRecording();
  renderPresets();
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
  clearRecording();
  persistSettings();
}

/** Show the selected field and its starting layout (before any run). */
function applyField() {
  const f = field();
  settingsChanged();
  viewer.setField(f);
  clearRecording();
  renderPresets();
  void showFieldModel();
  mapPanel?.fieldChanged();
}

// ---------------- auton mapping (the Map tab) ----------------

let mapPanel: MapPanel | null = null;
function initMap() {
  mapPanel = new MapPanel({ viewer, field, layoutId, robot, autonMs: () => state.autonMs, setStart, status: setStatus });
  mapPanel.setMode('off');
}

// ---------------- field model (official CAD, local only) ----------------

/** The field model on screen (if any), and a conversion in progress (if any). */
const fieldModel = {
  shown: null as null | { fieldId: string; name: string; glb: ArrayBuffer; holder: THREE.Object3D; saved: boolean },
  settings: { ...DEFAULT_FIELD_SETTINGS } as FieldModelSettings,
  /** A stored model that could not be shown (why). */
  broken: '',
  busy: null as null | { fieldId: string; abort: AbortController; progress: string },
};
let fieldModelLoad = 0;

/** Show the visitor's stored model of the current field, if any. */
async function showFieldModel(): Promise<void> {
  const token = ++fieldModelLoad;
  const id = field().id;
  const [m, settings] = await Promise.all([loadFieldModel(id), loadFieldSettings(id)]);
  let holder: THREE.Object3D | null = null;
  let broken = '';
  if (m) {
    try {
      holder = await fieldModelFrom(m.glb);
      applyFieldSettings(holder, settings);
    } catch (e) {
      broken = (e as Error).message;
    }
  }
  if (token !== fieldModelLoad) return;
  fieldModel.shown = m && holder ? { fieldId: id, name: m.name, glb: m.glb, holder, saved: true } : null;
  fieldModel.settings = settings;
  fieldModel.broken = broken;
  viewer.setFieldModel(holder, { base: settings.hideBase, statics: settings.hideStatics });
  if (broken) setStatus(`The saved field model can't be shown (${broken}). Remove it in Field › Model… and load it again.`, 'err');
}

function fieldDialogShow(msg?: string) {
  const { shown, settings, broken, busy } = fieldModel;
  const here = busy?.fieldId === field().id ? busy : null;
  $('fm-status').textContent =
    msg ??
    (here
      ? here.progress
      : broken
        ? `The saved model can't be shown (${broken}). Remove it and load it again.`
        : shown
          ? `Showing “${shown.name}”.${shown.saved ? '' : ' It could not be kept in this browser (storage full, or a private window): download it to keep it.'}`
          : 'No model loaded: the built-in field is shown.');
  $<HTMLInputElement>('fm-hide-base').checked = settings.hideBase;
  $<HTMLInputElement>('fm-hide-statics').checked = settings.hideStatics;
  $<HTMLSelectElement>('fm-turns').value = String(settings.turns);
  $<HTMLInputElement>('fm-lift').value = String(settings.lift);
  for (const id of ['fm-hide-base', 'fm-hide-statics', 'fm-turns', 'fm-lift']) $<HTMLInputElement>(id).disabled = !shown;
  $<HTMLButtonElement>('fm-load').disabled = !!busy;
  $<HTMLButtonElement>('fm-clear').disabled = !!busy || (!shown && !broken);
  $('fm-cancel').hidden = !busy;
  $('fm-download').hidden = !shown;
}

$('btn-field-look').onclick = () => {
  fieldDialogShow();
  $<HTMLDialogElement>('dlg-field').showModal();
};

$('fm-load').onclick = async () => {
  if (fieldModel.busy) return;
  const file = await pickFile(FIELD_ASSET_TYPES);
  if (!file || fieldModel.busy) return;
  // the field it was loaded for, even if the visitor switches fields while it reads
  const f = field();
  const busy = (fieldModel.busy = { fieldId: f.id, abort: new AbortController(), progress: 'Reading the file…' });
  const progress = (m: string) => {
    busy.progress = m;
    setStatus(`Field model: ${m}`);
    if ($<HTMLDialogElement>('dlg-field').open) fieldDialogShow();
  };
  fieldDialogShow();
  let done = '';
  try {
    const { model, source } = await readFieldModel(file.name, await file.arrayBuffer(), progress, busy.abort.signal);
    const report = fitToField(model, f, source);
    progress('Saving it in this browser…');
    const glb = await toGlb(model);
    const settings: FieldModelSettings = {
      ...DEFAULT_FIELD_SETTINGS,
      hideBase: $<HTMLInputElement>('fm-hide-base').checked,
      hideStatics: $<HTMLInputElement>('fm-hide-statics').checked,
    };
    let saved = true;
    try {
      await saveFieldModel(f.id, { name: file.name, glb });
      await saveFieldSettings(f.id, settings);
    } catch {
      saved = false; // shown for this session anyway, and it can be downloaded
    }
    if (field().id === f.id) {
      const holder = await fieldModelFrom(glb);
      applyFieldSettings(holder, settings);
      ++fieldModelLoad; // a slower load of the old model must not replace this one
      fieldModel.shown = { fieldId: f.id, name: file.name, glb, holder, saved };
      fieldModel.settings = settings;
      fieldModel.broken = '';
      viewer.setFieldModel(holder, { base: settings.hideBase, statics: settings.hideStatics });
    }
    done = `Showing “${file.name}” (${statusText(report)}).${saved ? '' : ' It could not be kept in this browser (storage full, or a private window): download it to keep it.'}`;
    setStatus(`Field model loaded: ${file.name}.`, saved ? 'ok' : 'err');
  } catch (e) {
    const err = e as Error;
    done = err.name === 'AbortError' ? 'Cancelled.' : `Couldn't use that file: ${err.message}`;
    setStatus(`Field model: ${done}`, err.name === 'AbortError' ? undefined : 'err');
  } finally {
    fieldModel.busy = null;
  }
  fieldDialogShow(done);
};
$('fm-cancel').onclick = () => fieldModel.busy?.abort.abort();
$('fm-download').onclick = () => {
  const m = fieldModel.shown;
  if (m) download(`${m.name.replace(/\.[^.]+$/, '')}.glb`, new Uint8Array(m.glb), 'model/gltf-binary');
};

/** A placement change: instant (the model isn't touched), and remembered for this field. */
function updateFieldSettings(change: Partial<FieldModelSettings>) {
  const m = fieldModel.shown;
  if (!m) return;
  fieldModel.settings = { ...fieldModel.settings, ...change };
  applyFieldSettings(m.holder, fieldModel.settings);
  viewer.setFieldModelHidden({ base: fieldModel.settings.hideBase, statics: fieldModel.settings.hideStatics });
  void saveFieldSettings(m.fieldId, fieldModel.settings);
}
$<HTMLInputElement>('fm-hide-base').onchange = (e) => updateFieldSettings({ hideBase: (e.target as HTMLInputElement).checked });
$<HTMLInputElement>('fm-hide-statics').onchange = (e) => updateFieldSettings({ hideStatics: (e.target as HTMLInputElement).checked });
$<HTMLSelectElement>('fm-turns').onchange = (e) => updateFieldSettings({ turns: Number((e.target as HTMLSelectElement).value) });
$<HTMLInputElement>('fm-lift').onchange = (e) => updateFieldSettings({ lift: Number((e.target as HTMLInputElement).value) || 0 });
// Enter in the number box would submit (close) the dialog
$<HTMLInputElement>('fm-lift').onkeydown = (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    (e.target as HTMLInputElement).blur(); // its change event applies it (once)
  }
};
$('fm-clear').onclick = async () => {
  if (fieldModel.busy || !confirm('Remove the field model from this browser? Loading it again converts it again.')) return;
  await clearFieldModel(field().id);
  await showFieldModel();
  fieldDialogShow();
};

/**
 * Show the field exactly as a run will start: every piece in its starting place, the
 * Preload in the robot and the robot at its start.
 */
function showStart() {
  const f = field();
  viewer.setGameState(f.game?.id === 'override' ? startingState(f, layoutId(), robot(), state.start) : null);
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
  clearRecording();
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
  // the field goes back to how a run starts (not where the last run left everything)
  showStart();
  // and the last run's notes, console and brain screen go with it
  $('panel-events').innerHTML = '<p class="empty">Press Run to see notes about the run.</p>';
  $('badge-events').textContent = '';
  $('panel-console').replaceChildren();
  delete $('panel-console').dataset.rows;
  $('lcd').textContent = '';
  $('start-pose').classList.remove('hidden');
  const timer = $('timer');
  timer.textContent = '0:00.00';
  timer.classList.remove('done');
  $('timer-sub').textContent = 'Autonomous';
  const scrub = $<HTMLInputElement>('scrub'); // (this can run before the timeline code below is set up)
  scrub.min = '0';
  scrub.max = String(state.autonMs);
  scrub.value = '0';
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
  let seq = ++state.runSeq;
  let setup: RunSetup = { robot: robot(), field: field(), start: { ...state.start }, autonMs: state.autonMs, place: state.place };
  const stale = () => seq !== state.runSeq;
  state.running = true;
  clearRecording(); // the field resets: the new run starts from the starting layout
  $<HTMLButtonElement>('btn-run').disabled = true;
  setStatus('Compiling…');
  const t0 = performance.now();
  try {
    const b = await compile();
    // compiling doesn't depend on the robot, field or start: if one changed meanwhile, simulate
    // with what is selected now. From here on, everything the run depends on is frozen and
    // changing a setting cancels it.
    if (stale()) {
      seq = ++state.runSeq;
      setup = { robot: robot(), field: field(), start: { ...state.start }, autonMs: state.autonMs, place: state.place };
      clearRecording();
    }
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
    } else if (portProblems(rec).length) {
      // the code was written for another robot: say so where it can't be missed
      const ports = portProblems(rec);
      setStatus(
        `This code doesn't match “${setup.robot.name}”: it uses ${ports.length === 1 ? 'port' : 'ports'} ${ports.join(', ')}, which this robot doesn't have (or has something else on). Those motors and sensors do nothing. Open this robot's auton with the Auton button, or Edit the robot.`,
        'err',
      );
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

/** Ports the code used that the robot profile doesn't have (or has a different device on). */
function portProblems(rec: Recording): string[] {
  const ports = new Set<string>();
  for (const e of rec.events) {
    const m = e.message.match(/^Code (?:uses (?:a \w+ on )?port|writes ADI port) (\w+), (?:but the robot profile has|which is not a valid)/);
    if (m) ports.add(m[1]);
  }
  return [...ports];
}
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
  // ~10 times a second while playing; exactly the shown moment when paused or scrubbing
  const bucket = atEnd ? -1 : state.playing ? Math.floor(t / 100) : t + 0.5;
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

/** The files of a project the editor shows (library headers are provided by the simulator). */
function editableFiles(files: Record<string, string>): Record<string, string> {
  const editable: Record<string, string> = {};
  for (const [p, t] of Object.entries(files)) {
    if (/^(src|include)\//.test(p) || p.startsWith('static/') || p === 'project.pros') {
      if (/^include\/(api\.h|pros\/|lemlib\/|fmt\/|EZ-Template\/|okapi\/|liblvgl\/)/.test(p)) continue;
      editable[p] = t;
    }
  }
  return editable;
}

function loadFiles(name: string, files: Record<string, string>, binary: Record<string, Uint8Array> = {}) {
  // Text files from static/ are assets too (LemLib paths)
  state.binary = { ...binary };
  state.projectName = name;
  editor.load(editableFiles(files));
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
  setStart(s.startAt ?? start ?? { x: 0, y: 0, theta: 0 });
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
let layoutEditor: LayoutEditor | null = null;
let partsBuilder: PartsBuilder | null = null;

/** The robot dialog's tabs: the visual layout editor, or the JSON. */
function showRobotTab(tab: 'layout' | 'json') {
  document.querySelectorAll<HTMLButtonElement>('[data-rtab]').forEach((b) => b.classList.toggle('active', b.dataset.rtab === tab));
  $('robot-layout').hidden = tab !== 'layout';
  $('robot-json').hidden = tab !== 'json';
}
document.querySelectorAll<HTMLButtonElement>('[data-rtab]').forEach((b) => (b.onclick = () => showRobotTab(b.dataset.rtab as 'layout' | 'json')));
// Ctrl+Z in the layout editor (the JSON editor has its own)
$('dlg-robot').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !$('robot-layout').hidden && !(e.target as HTMLElement).closest('input, textarea, select')) {
    e.preventDefault();
    layoutEditor?.undo();
  }
});
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
  // the layout editor writes into the JSON (where it is validated); a JSON edit redraws the layout
  let fromLayout = false;
  layoutEditor ??= new LayoutEditor(
    {
      top: $('rl-top'),
      side: $('rl-side'),
      preview: $('rl-preview'),
      pick: $<HTMLSelectElement>('rl-pick'),
      add: $<HTMLSelectElement>('rl-add'),
      remove: $<HTMLButtonElement>('rl-remove'),
      undo: $<HTMLButtonElement>('rl-undo'),
      form: $('rl-form'),
    },
    (p) => {
      fromLayout = true;
      robotEditor?.setValue(JSON.stringify(p, null, 2));
      fromLayout = false;
    },
  );
  layoutEditor.reset();
  layoutEditor.load(r);
  showRobotTab('layout');
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
  const parseRobotJson = (): RobotProfile | null => {
    try {
      const p = JSON.parse(robotEditor!.getValue()) as RobotProfile;
      return p?.size && p.drivetrain ? p : null;
    } catch {
      return null;
    }
  };
  /** Change the profile in the JSON editor (it is validated and the layout redrawn). */
  const editRobotJson = (change: (p: RobotProfile) => void) => {
    const p = parseRobotJson();
    if (!p) return;
    change(p);
    robotEditor!.setValue(JSON.stringify(p, null, 2));
  };
  $('pk-undo').onclick = () => partsBuilder?.undo();
  $('pk-clear').onclick = () => partsBuilder?.clear();
  $('pk-fit').onclick = () => {
    const s = partsBuilder?.suggestion();
    if (!s?.size) return setStatus('Place some parts first.', 'err');
    const what = [`size ${s.size.width}″ × ${s.size.length}″ × ${s.size.height}″`, s.trackWidth ? `track width ${s.trackWidth}″` : '', s.wheelDiameter ? `${s.wheelDiameter}″ wheels` : ''].filter(Boolean).join(', ');
    if (!confirm(`Set the robot's ${what} from the build? (This changes how it drives and collides.)`)) return;
    editRobotJson((p) => {
      p.size = { ...s.size! };
      if (s.trackWidth) p.drivetrain.trackWidth = s.trackWidth;
      if (s.wheelDiameter) p.drivetrain.wheelDiameter = s.wheelDiameter;
    });
    setStatus(`Robot set to ${what}. Save the robot to keep it.`, 'ok');
  };
  $('pk-use').onclick = async () => {
    const b = partsBuilder;
    if (!b || !b.asm.parts.length) return setStatus('Place some parts first.', 'err');
    const assetId = 'glb-' + Date.now().toString(36);
    try {
      await saveModel(assetId, await b.toGlb());
      await saveAssembly(assetId, b.asm);
    } catch (e) {
      return setStatus(`Couldn't keep the model: ${(e as Error).message}`, 'err');
    }
    editingGlb = { assetId };
    // real inches: no fitting to the footprint
    editRobotJson((p) => (p.model = { assetId, scale: 1 }));
    $<HTMLDialogElement>('dlg-parts').close();
    setStatus(`The ${b.asm.parts.length}-part build is the robot's model now. Save the robot to keep it.`, 'ok');
  };
  robotEditor.onDidChangeModelContent(() => {
    validate();
    if (fromLayout) return;
    try {
      const p = JSON.parse(robotEditor!.getValue()) as RobotProfile;
      // only a profile complete enough to draw
      if (p?.size && p.drivetrain && Array.isArray(p.mechanisms) && Array.isArray(p.devices)) layoutEditor?.load(p);
    } catch {
      /* mid-edit JSON: the layout waits for valid JSON */
    }
  });
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
    settingsChanged();
    clearRecording();
    await applyRobot();
    persistSettings();
    $<HTMLDialogElement>('dlg-robot').close();
    setStatus(`Saved robot “${p.name}” in this browser.`, 'ok');
  };
  $('rb-parts').onclick = async () => {
    const p = parseRobotJson();
    if (!p) return setStatus('Fix the robot profile first (see the errors).', 'err');
    partsBuilder ??= new PartsBuilder({
      view: $('pk-view'),
      palette: $('pk-palette'),
      length: $<HTMLSelectElement>('pk-length'),
      cartridge: $<HTMLSelectElement>('pk-cartridge'),
      level: $<HTMLInputElement>('pk-level'),
      info: $('pk-info'),
      count: $('pk-count'),
    });
    if (import.meta.env.DEV) Object.assign(window, { __parts: partsBuilder });
    partsBuilder.load(editingGlb ? ((await loadAssembly(editingGlb.assetId)) ?? null) : null, p.size);
    $<HTMLDialogElement>('dlg-parts').showModal();
    partsBuilder.refresh();
  };
  $('rb-model').onclick = async () => {
    const f = await pickFile('.glb,model/gltf-binary');
    if (!f) return;
    const buf = await f.arrayBuffer();
    const assetId = 'glb-' + Date.now().toString(36);
    await saveModel(assetId, buf);
    editingGlb = { assetId };
    setStatus(`Attached ${f.name}. Save the robot to see and keep it.`);
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
          // its VEX parts build, to keep editing it
          if (z.assembly && !validateAssembly(z.assembly, CATALOG).length) await saveAssembly(assetId, z.assembly as Assembly);
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
    settingsChanged();
    clearRecording();
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
  initMap();
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
  // the plan being worked on, or one shared in the link (which opens the Map tab)
  if (await mapPanel?.restore()) showTab('map');
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
