// Multi-file project editor (Monaco).

// Only the editor core plus the C++ and JSON languages (not all of Monaco's languages).
import * as monaco from 'monaco-editor/editor';
import 'monaco-editor/languages/definitions/cpp/register';
import 'monaco-editor/language/json/monaco.contribution';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import type { Diagnostic } from '../compiler/diagnostics.ts';

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: (_id: string, label: string) => (label === 'json' ? new JsonWorker() : new EditorWorker()),
};

const languageOf = (p: string) => (/\.(c|cc|cpp|cxx|h|hh|hpp|hxx|inc|ipp)$/i.test(p) ? 'cpp' : /\.json$/i.test(p) ? 'json' : 'plaintext');
const isDark = () =>
  document.documentElement.dataset.theme === 'dark' ||
  (!document.documentElement.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);

/** Sort: include/main.h first, then src, then the rest. */
function fileOrder(a: string, b: string): number {
  const rank = (p: string) => (p.startsWith('src/') ? 0 : p.startsWith('include/') ? 1 : 2);
  return rank(a) - rank(b) || a.localeCompare(b);
}

export class ProjectEditor {
  private readonly editor: monaco.editor.IStandaloneCodeEditor;
  private readonly models = new Map<string, monaco.editor.ITextModel>();
  private readonly tabs: HTMLElement;
  private active = '';
  onChange: () => void = () => {};
  onRunShortcut: () => void = () => {};

  constructor(host: HTMLElement, tabs: HTMLElement) {
    this.tabs = tabs;
    this.editor = monaco.editor.create(host, {
      automaticLayout: true,
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 2,
      theme: isDark() ? 'vs-dark' : 'vs',
      renderWhitespace: 'selection',
      fixedOverflowWidgets: true,
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => monaco.editor.setTheme(isDark() ? 'vs-dark' : 'vs'));
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => this.onRunShortcut());
  }

  setTheme(dark: boolean) {
    monaco.editor.setTheme(dark ? 'vs-dark' : 'vs');
  }

  load(files: Record<string, string>) {
    for (const m of this.models.values()) m.dispose();
    this.models.clear();
    for (const [p, text] of Object.entries(files)) this.addModel(p, text);
    const first = this.paths().find((p) => p === 'src/main.cpp') ?? this.paths()[0];
    if (first) this.open(first);
    this.renderTabs();
  }

  private addModel(path: string, text: string) {
    const m = monaco.editor.createModel(text, languageOf(path), monaco.Uri.parse('file:///' + path));
    m.onDidChangeContent(() => this.onChange());
    this.models.set(path, m);
  }

  paths(): string[] {
    return [...this.models.keys()].sort(fileOrder);
  }

  files(): Record<string, string> {
    return Object.fromEntries([...this.models].map(([p, m]) => [p, m.getValue()]));
  }

  open(path: string, line?: number, column?: number) {
    const m = this.models.get(path);
    if (!m) return;
    this.active = path;
    this.editor.setModel(m);
    if (line) {
      this.editor.revealLineInCenter(line);
      this.editor.setPosition({ lineNumber: line, column: column ?? 1 });
      this.editor.focus();
    }
    this.renderTabs();
  }

  addFile(path: string, text = '') {
    if (this.models.has(path)) return this.open(path);
    this.addModel(path, text);
    this.open(path);
    this.onChange();
  }

  renameFile(from: string, to: string) {
    const m = this.models.get(from);
    if (!m || this.models.has(to)) return;
    // the new file first: if it can't be made, the old one is still there
    this.addModel(to, m.getValue());
    m.dispose();
    this.models.delete(from);
    this.open(to);
    this.onChange();
  }

  deleteFile(path: string) {
    const m = this.models.get(path);
    if (!m) return;
    m.dispose();
    this.models.delete(path);
    if (this.active === path) this.open(this.paths()[0] ?? '');
    this.renderTabs();
    this.onChange();
  }

  get activePath() {
    return this.active;
  }

  setDiagnostics(diags: Diagnostic[]) {
    for (const [p, m] of this.models) {
      // the file may have been edited while it compiled: keep markers on lines that exist
      const last = m.getLineCount();
      const markers = diags
        .filter((d) => d.file === p && d.line > 0)
        .map((d) => {
          const line = Math.min(d.line, last);
          return {
            severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : d.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
            message: d.message,
            startLineNumber: line,
            startColumn: d.column || 1,
            endLineNumber: line,
            endColumn: m.getLineMaxColumn(line),
          };
        });
      try {
        monaco.editor.setModelMarkers(m, 'clang', markers);
      } catch {
        // markers are cosmetic; the Problems panel still lists everything
      }
    }
    this.diags = diags;
    this.renderTabs();
  }

  /** The last build's diagnostics: tab badges stay when tabs are redrawn (switching files). */
  private diags: Diagnostic[] = [];

  private renderTabs(diags: Diagnostic[] = this.diags) {
    this.tabs.replaceChildren(
      ...this.paths().map((p) => {
        const b = document.createElement('button');
        b.className = 'tab' + (p === this.active ? ' active' : '');
        b.title = p;
        const errs = diags.filter((d) => d.file === p && d.severity === 'error').length;
        b.textContent = p.replace(/^(src|include)\//, '');
        if (errs) {
          const dot = document.createElement('span');
          dot.className = 'tab-err';
          dot.textContent = String(errs);
          b.append(dot);
        }
        b.onclick = () => this.open(p);
        return b;
      }),
    );
  }
}

/** A small JSON editor (robot profiles). */
export function jsonEditor(host: HTMLElement, text: string): monaco.editor.IStandaloneCodeEditor {
  return monaco.editor.create(host, {
    value: text,
    language: 'json',
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    tabSize: 2,
    scrollBeyondLastLine: false,
    theme: isDark() ? 'vs-dark' : 'vs',
  });
}
