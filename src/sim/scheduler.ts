// Deterministic cooperative scheduler for PROS tasks.
//
// Each PROS task runs as its own WebAssembly.promising() call on its own shadow stack.
// When a task blocks (delay, mutex, notify, join, idealized motion wait) its import is
// a WebAssembly.Suspending function that parks the task and hands control back to
// the simulator loop, which advances simulated time in 1 ms steps and resumes tasks
// whose wait condition is satisfied, oldest-parked first. No wall-clock timing is
// involved anywhere, so every run of the same program is identical.

export type TaskState = 'ready' | 'running' | 'blocked' | 'suspended' | 'done';

export interface Task {
  id: number;
  handle: number;
  name: string;
  state: TaskState;
  /** Saved __stack_pointer while parked. */
  sp: number;
  started: boolean;
  start: () => Promise<unknown>;
  /** Order in which tasks parked; lowest resumes first among ready tasks. */
  seq: number;
  /** Returns true when the blocked task may resume. */
  ready: () => boolean;
  /** Value handed back to the suspended import (computed at resume time). */
  resumeValue: () => unknown;
  resume: ((v: unknown) => void) | null;
  notifyValue: number;
  namePtr: number;
  phase: number | null;
  wasSuspendedFrom: TaskState | null;
}

export class StuckError extends Error {}

export class Scheduler {
  now = 0;
  private seq = 0;
  private nextId = 1;
  readonly tasks: Task[] = [];
  current: Task | null = null;
  private yieldToLoop: (() => void) | null = null;
  /** Import calls since the current task last blocked (runaway-loop detection). */
  callsSinceBlock = 0;
  static readonly MAX_CALLS_WITHOUT_BLOCK = 2_000_000;
  stackPointer: WebAssembly.Global | null = null;
  onTaskDone: (t: Task) => void = () => {};
  onTaskError: (t: Task, e: unknown) => void = () => {};

  static handleOf(id: number): number {
    return 0x10000 + id * 16;
  }

  byHandle(handle: number): Task | undefined {
    return this.tasks.find((t) => t.handle === handle);
  }

  spawn(name: string, sp: number, start: () => Promise<unknown>, phase: number | null = null): Task {
    const id = this.nextId++;
    const t: Task = {
      id, handle: Scheduler.handleOf(id), name, state: 'ready', sp, started: false, start,
      seq: this.seq++, ready: () => true, resumeValue: () => undefined, resume: null,
      notifyValue: 0, namePtr: 0, phase, wasSuspendedFrom: null,
    };
    this.tasks.push(t);
    return t;
  }

  /** Count an import call from user code; throws if a task never yields. */
  tick(): void {
    if (++this.callsSinceBlock > Scheduler.MAX_CALLS_WITHOUT_BLOCK) {
      throw new StuckError(
        `Task "${this.current?.name ?? '?'}" made ${Scheduler.MAX_CALLS_WITHOUT_BLOCK.toLocaleString()} PROS calls without waiting. ` +
          'Add pros::delay() inside loops so other tasks and the simulation can run.',
      );
    }
  }

  /**
   * Park the current task until `ready()`; the import returns `resumeValue()`.
   * Must be called from inside a WebAssembly.Suspending import.
   */
  park<T>(ready: () => boolean, resumeValue: () => T = () => undefined as T): Promise<T> {
    const t = this.current;
    if (!t) throw new Error('blocking PROS call made outside a task (e.g. in a global constructor)');
    t.sp = (this.stackPointer!.value as number) >>> 0;
    t.state = 'blocked';
    t.seq = this.seq++;
    t.ready = ready;
    t.resumeValue = resumeValue;
    this.callsSinceBlock = 0;
    return new Promise<T>((res) => {
      t.resume = res as (v: unknown) => void;
      this.yieldToLoop?.();
    });
  }

  /** Park forever (task deleted itself). */
  parkForever(): Promise<never> {
    const t = this.current!;
    t.state = 'done';
    this.onTaskDone(t);
    return new Promise<never>(() => this.yieldToLoop?.());
  }

  delay(ms: number): Promise<void> {
    const wake = this.now + Math.max(0, ms);
    return this.park(() => this.now >= wake);
  }

  /** Next runnable task (oldest parked first), or null. */
  pick(): Task | null {
    let best: Task | null = null;
    for (const t of this.tasks) {
      if (t.state !== 'ready' && t.state !== 'blocked') continue;
      if (t.state === 'blocked' && !t.ready()) continue;
      if (!best || t.seq < best.seq) best = t;
    }
    return best;
  }

  /** Run a task until it parks or finishes. */
  run(t: Task): Promise<void> {
    return new Promise<void>((yielded) => {
      this.current = t;
      this.yieldToLoop = yielded;
      this.callsSinceBlock = 0;
      if (this.stackPointer) this.stackPointer.value = t.sp;
      if (!t.started) {
        t.started = true;
        t.state = 'running';
        t.start().then(
          () => {
            t.state = 'done';
            this.onTaskDone(t);
            this.yieldToLoop?.();
          },
          (e) => {
            t.state = 'done';
            this.onTaskError(t, e);
            this.yieldToLoop?.();
          },
        );
      } else {
        const value = t.resumeValue();
        t.state = 'running';
        const r = t.resume!;
        t.resume = null;
        r(value);
      }
    });
  }

  get liveTasks(): number {
    return this.tasks.filter((t) => t.state !== 'done').length;
  }
}
