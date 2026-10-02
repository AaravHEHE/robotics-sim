// Run a compiled user program against the simulated robot and record a timeline.
//
// Competition flow (like a match): initialize() runs first as its own task; when it
// returns, autonomous() starts and the match clock starts. The run stops at the
// auto-stop time (15 s or 60 s after autonomous starts). Tasks created anywhere keep
// running until then.

import { demangleName } from '../compiler/demangle.ts';
import { datan2, dcos, dhypot, dsin, RAD } from './dmath.ts';
import type { FieldDef } from './field.ts';
import { DriveDistance, FollowPath, Motion, MoveToPoint, MoveToPose, parsePath, Turn } from './motion.ts';
import type { RobotProfile } from './profile.ts';
import { createProsApi } from './pros-api.ts';
import type { MotionMarker, Recording, SimEvent } from './recording.ts';
import { Scheduler, StuckError } from './scheduler.ts';
import { OdomFrame, World, type Pose } from './world.ts';

export type PlaceMode = 'auto' | 'always' | 'never';

export interface RunOptions {
  profile: RobotProfile;
  field: FieldDef;
  /** Robot starting pose on the field. */
  start: Pose;
  /** Autonomous length: the run auto-stops this long after autonomous() starts. */
  autonMs: number;
  /**
   * Whether LemLib's first setPose() (before the robot moves) also places the robot
   * on the field there. 'auto' does so unless the pose is the origin (relative odometry).
   */
  placeAtSetPose?: PlaceMode;
  /** initialize() must return within this much simulated time. */
  initializeLimitMs?: number;
  frameEveryMs?: number;
  /** Wall-clock budget for the whole run (runaway arithmetic loops). */
  wallLimitMs?: number;
}

const STEP_MS = 1;

export async function runProgram(wasm: WebAssembly.Module, opts: RunOptions): Promise<Recording> {
  if (typeof (WebAssembly as unknown as { Suspending?: unknown }).Suspending !== 'function') {
    throw new Error('This browser does not support WebAssembly JSPI. Please use Chrome 137+, Firefox 153+ or Safari 27+.');
  }
  const wallStart = performance.now();
  const frameEvery = opts.frameEveryMs ?? 10;
  const initLimit = opts.initializeLimitMs ?? 30000;
  const wallLimit = opts.wallLimitMs ?? 30000;
  const place = opts.placeAtSetPose ?? 'auto';

  const world = new World(opts.profile, opts.field, opts.start);
  const sched = new Scheduler();
  const frame = new OdomFrame();
  frame.anchor(world.pose, { x: 0, y: 0, theta: 0 }); // odometry starts at 0,0,0 where the robot sits
  let robotHasMoved = false;
  let placed = false;

  const events: SimEvent[] = [];
  const warned = new Set<string>();
  const warn = (key: string, message: string, level: SimEvent['level'] = 'warning') => {
    if (warned.has(key)) return;
    warned.add(key);
    events.push({ t: sched.now, level, message });
  };
  const consoleLines: Recording['console'] = [];
  const lcd: Recording['lcd'] = [];
  const motions: MotionMarker[] = [];
  const outBuf = ['', '', ''];
  const write = (fd: number, s: string) => {
    const i = fd === 2 ? 2 : 1;
    outBuf[i] += s;
    let nl: number;
    while ((nl = outBuf[i].indexOf('\n')) >= 0) {
      consoleLines.push({ t: sched.now, text: outBuf[i].slice(0, nl) });
      outBuf[i] = outBuf[i].slice(nl + 1);
    }
  };

  let exports: WebAssembly.Exports & Record<string, unknown>;
  let memory: WebAssembly.Memory;
  let phase = 0;
  let autonStart: number | null = null;
  let autonEnd: number | null = null;
  let error: string | null = null;

  const api = createProsApi({
    world, sched,
    mem: () => memory,
    malloc: (n) => (exports.malloc as (n: number) => number)(n),
    warn,
    phase: () => phase,
    lcdPrint: (line, text) => lcd.push({ t: sched.now, line, text }),
  });

  const cstr = (ptr: number, len?: number) => {
    const u8 = new Uint8Array(memory.buffer);
    let end = len === undefined ? ptr : ptr + len;
    if (len === undefined) while (u8[end]) end++;
    return new TextDecoder().decode(u8.subarray(ptr, end));
  };

  // ---------------- idealized-motion imports (module "sim") ----------------
  let pendingPath = '';
  // (casts keep TypeScript from narrowing these to null; they change inside import callbacks)
  let motion = null as Motion | null;
  let marker = null as MotionMarker | null;
  const startMotion = (m: Motion, target: MotionMarker['target'], path?: Array<{ x: number; y: number }>) => {
    if (marker && marker.t1 === null) marker.t1 = sched.now;
    motion = m;
    world.controller = m;
    // like LemLib's control loop, the motion owns the drive motors while it runs
    for (const p of [...opts.profile.drivetrain.left, ...opts.profile.drivetrain.right]) {
      const mm = world.motor(p);
      mm.mode = 'voltage';
      mm.cmd = 0;
    }
    marker = { t0: sched.now, t1: null, label: m.label, target, path };
    motions.push(marker);
  };
  const endMotion = () => {
    if (marker && marker.t1 === null) marker.t1 = sched.now;
    motion = null;
    world.controller = null;
  };
  const toField = (x: number, y: number, theta = 0) => frame.toField({ x, y, theta });

  const simImports: Record<string, (...a: never[]) => unknown> = {
    chassis_config: (lp: number, nl: number, rp: number, nr: number, track: number, wheel: number, rpm: number) => {
      const i8 = new Int8Array(memory.buffer);
      const left = Array.from(i8.subarray(lp, lp + nl));
      const right = Array.from(i8.subarray(rp, rp + nr));
      const d = opts.profile.drivetrain;
      const same = (a: number[], b: number[]) => a.length === b.length && a.every((p) => b.includes(p));
      if (!same(left, d.left) || !same(right, d.right)) {
        warn('chassis-ports', `The code's drivetrain motors (left ${JSON.stringify(left)}, right ${JSON.stringify(right)}) differ from the robot profile (left ${JSON.stringify(d.left)}, right ${JSON.stringify(d.right)}). Motion commands drive the profile's drivetrain.`);
      }
      const diffs: string[] = [];
      // 0 = the library doesn't know the value (EZ-Template has no track width)
      if (track > 0 && Math.abs(track - d.trackWidth) > 0.25) diffs.push(`track width ${track}" vs ${d.trackWidth}"`);
      if (wheel > 0 && Math.abs(wheel - d.wheelDiameter) > 0.05) diffs.push(`wheel ${wheel}" vs ${d.wheelDiameter}"`);
      if (rpm > 0 && Math.abs(rpm - d.wheelRpm) > 1) diffs.push(`${rpm} rpm vs ${d.wheelRpm} rpm`);
      if (diffs.length) warn('chassis-geom', `Drivetrain settings in code differ from the robot profile (${diffs.join(', ')}). The simulator uses the profile.`, 'info');
    },
    motion_path: (ptr: number, len: number) => {
      pendingPath = cstr(ptr, len);
    },
    motion_start: (kind: number, ptr: number, n: number) => {
      const p = Array.from(new Float64Array(memory.buffer.slice(ptr, ptr + n * 8)));
      robotHasMoved = true;
      switch (kind) {
        case 1: { // moveToPoint x y timeout forwards max min early
          const t = toField(p[0], p[1]);
          startMotion(new MoveToPoint(t.x, t.y, p[2], { forwards: !!p[3], maxSpeed: p[4], minSpeed: p[5], earlyExitRange: p[6] }), { x: t.x, y: t.y });
          break;
        }
        case 2: { // moveToPose x y theta timeout forwards max min early lead
          const t = toField(p[0], p[1], p[2]);
          startMotion(new MoveToPose(t.x, t.y, t.theta, p[3], { forwards: !!p[4], maxSpeed: p[5], minSpeed: p[6], earlyExitRange: p[7], lead: p[8] }), { x: t.x, y: t.y, theta: t.theta });
          break;
        }
        case 3: { // turnToHeading theta timeout dir max min early
          const th = toField(0, 0, p[0]).theta;
          startMotion(new Turn('turnToHeading', () => th, p[1], { direction: p[2], maxSpeed: p[3], minSpeed: p[4], earlyExitRange: p[5] }), null);
          break;
        }
        case 4: { // turnToPoint x y timeout forwards dir max min early
          const t = toField(p[0], p[1]);
          const fwd = !!p[3];
          startMotion(new Turn('turnToPoint', (pose) => headingTo(pose, t.x, t.y) + (fwd ? 0 : 180), p[2], { direction: p[4], maxSpeed: p[5], minSpeed: p[6], earlyExitRange: p[7] }), { x: t.x, y: t.y });
          break;
        }
        case 5: { // swingToHeading theta side timeout dir max min early
          const th = toField(0, 0, p[0]).theta;
          startMotion(new Turn('swingToHeading', () => th, p[2], { direction: p[3], maxSpeed: p[4], minSpeed: p[5], earlyExitRange: p[6] }, p[1] === 0 ? 'left' : 'right'), null);
          break;
        }
        case 6: { // swingToPoint x y side timeout forwards dir max min early
          const t = toField(p[0], p[1]);
          const fwd = !!p[4];
          startMotion(new Turn('swingToPoint', (pose) => headingTo(pose, t.x, t.y) + (fwd ? 0 : 180), p[3], { direction: p[5], maxSpeed: p[6], minSpeed: p[7], earlyExitRange: p[8] }, p[2] === 0 ? 'left' : 'right'), { x: t.x, y: t.y });
          break;
        }
        case 7: { // follow lookahead timeout forwards (+ pending path)
          const pts = parsePath(pendingPath).map((q) => ({ ...toField(q.x, q.y), speed: q.speed }));
          if (pts.length < 2) warn('path-empty', 'follow(): the path asset has fewer than 2 points.');
          startMotion(new FollowPath(pts, p[0], p[1], !!p[2]), pts.length ? { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y } : null, pts.map((q) => ({ x: q.x, y: q.y })));
          break;
        }
        // EZ-Template: goals relative to the robot's current pose (EZ keeps its own odometry)
        case 10: { // drive: distance headingError maxSpeed
          startMotion(new DriveDistance(p[0], world.pose.theta + p[1], p[2], 0), null);
          break;
        }
        case 11: { // turn: error maxSpeed
          const th = world.pose.theta + p[0];
          startMotion(new Turn('pid_turn', () => th, 0, { direction: Math.sign(p[0]), maxSpeed: p[1], minSpeed: 0, earlyExitRange: 0 }), null);
          break;
        }
        case 12: { // swing: error side maxSpeed opposite
          const th = world.pose.theta + p[0];
          const ratio = p[2] > 0 ? p[3] / p[2] : 0;
          // LEFT_SWING moves the left side, so the right side is the (mostly) locked one
          startMotion(new Turn('pid_swing', () => th, 0, { direction: Math.sign(p[0]), maxSpeed: p[2], minSpeed: 0, earlyExitRange: 0 }, p[1] === 0 ? 'right' : 'left', ratio), null);
          break;
        }
        case 13: { // point: localX localY forwards maxSpeed
          const s = dsin(world.pose.theta * RAD);
          const c = dcos(world.pose.theta * RAD);
          const tx = world.pose.x + p[0] * c + p[1] * s;
          const ty = world.pose.y - p[0] * s + p[1] * c;
          startMotion(new MoveToPoint(tx, ty, 0, { forwards: !!p[2], maxSpeed: p[3], minSpeed: 0, earlyExitRange: 0 }), { x: tx, y: ty });
          break;
        }
        case 14: { // pose: localX localY headingError forwards maxSpeed lead
          const s = dsin(world.pose.theta * RAD);
          const c = dcos(world.pose.theta * RAD);
          const tx = world.pose.x + p[0] * c + p[1] * s;
          const ty = world.pose.y - p[0] * s + p[1] * c;
          const th = world.pose.theta + p[2];
          startMotion(new MoveToPose(tx, ty, th, 0, { forwards: !!p[3], maxSpeed: p[4], minSpeed: 0, earlyExitRange: 0, lead: p[5] }), { x: tx, y: ty, theta: th });
          break;
        }
        default:
          warn(`motion-kind:${kind}`, `Unknown motion kind ${kind}.`, 'error');
      }
    },
    motion_poll: () => {
      if (!motion) return -1;
      return motion.done ? -1 : motion.traveled;
    },
    motion_cancel: () => endMotion(),
    odom_set: (x: number, y: number, theta: number) => {
      const isOrigin = Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6;
      if (!placed && !robotHasMoved && (place === 'always' || (place === 'auto' && !isOrigin))) {
        const half = opts.field.perimeter.inside / 2;
        if (Math.abs(x) < half && Math.abs(y) < half) {
          placed = true;
          const old = world.pose.theta;
          world.pose = { x, y, theta };
          // the IMU reading must not jump: shift its offsets by the heading change
          for (const imu of world.imus.values()) {
            imu.rotationOffset += theta - old;
            imu.headingOffset += theta - old;
            imu.yawOffset += theta - old;
          }
          events.push({ t: sched.now, level: 'info', message: `Robot placed at (${fmt(x)}, ${fmt(y)}) facing ${fmt(theta)}° from setPose().` });
        } else {
          warn('place-oob', `setPose(${fmt(x)}, ${fmt(y)}, ${fmt(theta)}) is outside the field, so the robot stays at its start position.`);
        }
      }
      frame.anchor(world.pose, { x, y, theta });
    },
    odom_get: (ptr: number) => {
      const o = frame.toOdom(world.pose);
      const d = new DataView(memory.buffer);
      d.setFloat64(ptr, o.x, true);
      d.setFloat64(ptr + 8, o.y, true);
      d.setFloat64(ptr + 16, o.theta, true);
    },
    odom_speed: (local: number, ptr: number) => {
      const d = new DataView(memory.buffer);
      const v = world.speed;
      if (local) {
        d.setFloat64(ptr, 0, true);
        d.setFloat64(ptr + 8, v, true);
      } else {
        const o = frame.toOdom(world.pose);
        const rad = (o.theta * Math.PI) / 180;
        // direction only needs to be consistent; use the deterministic helpers via OdomFrame
        const [vx, vy] = [v * sinDet(rad), v * cosDet(rad)];
        d.setFloat64(ptr, vx, true);
        d.setFloat64(ptr + 8, vy, true);
      }
      d.setFloat64(ptr + 16, world.omega, true);
    },
    lcd_set_text: (line: number, ptr: number) => {
      lcd.push({ t: sched.now, line, text: cstr(ptr) });
    },
    lcd_clear: (line: number) => {
      if (line < 0) for (let i = 0; i < 8; i++) lcd.push({ t: sched.now, line: i, text: '' });
      else lcd.push({ t: sched.now, line, text: '' });
    },
    warn: (ptr: number) => warn('w:' + cstr(ptr), cstr(ptr)),
  };

  // ---------------- WASI (stdout/stderr, clocks) ----------------
  let rng = 0x2545f491;
  const wasi: Record<string, (...a: never[]) => unknown> = {
    fd_write: (fd: number, iovs: number, n: number, nwritten: number) => {
      const d = new DataView(memory.buffer);
      let total = 0;
      for (let i = 0; i < n; i++) {
        const p = d.getUint32(iovs + i * 8, true);
        const l = d.getUint32(iovs + i * 8 + 4, true);
        write(fd, cstr(p, l));
        total += l;
      }
      d.setUint32(nwritten, total, true);
      return 0;
    },
    fd_fdstat_get: (fd: number, buf: number) => {
      const d = new DataView(memory.buffer);
      d.setUint8(buf, 2);
      d.setUint16(buf + 2, 0, true);
      d.setBigUint64(buf + 8, 0n, true);
      d.setBigUint64(buf + 16, 0n, true);
      return fd <= 2 ? 0 : 8;
    },
    clock_time_get: (_id: number, _prec: bigint, out: number) => {
      new DataView(memory.buffer).setBigUint64(out, BigInt(sched.now) * 1_000_000n, true);
      return 0;
    },
    random_get: (buf: number, len: number) => {
      const u8 = new Uint8Array(memory.buffer);
      for (let i = 0; i < len; i++) {
        rng = (Math.imul(rng, 1103515245) + 12345) >>> 0;
        u8[buf + i] = rng >>> 24;
      }
      return 0;
    },
    environ_sizes_get: (c: number, s: number) => {
      const d = new DataView(memory.buffer);
      d.setUint32(c, 0, true);
      d.setUint32(s, 0, true);
      return 0;
    },
    environ_get: () => 0,
    args_sizes_get: (c: number, s: number) => {
      const d = new DataView(memory.buffer);
      d.setUint32(c, 0, true);
      d.setUint32(s, 0, true);
      return 0;
    },
    args_get: () => 0,
    proc_exit: (code: number) => {
      throw new Error(`program called exit(${code})`);
    },
  };

  // ---------------- import object ----------------
  let wallChecks = 0;
  const guard = <T extends (...a: never[]) => unknown>(fn: T): T =>
    ((...a: never[]) => {
      sched.tick();
      if ((++wallChecks & 4095) === 0 && performance.now() - wallStart > wallLimit) {
        throw new StuckError(`The simulation took longer than ${wallLimit / 1000} s of real time. Is a loop missing pros::delay()?`);
      }
      return fn(...a);
    }) as T;
  const Suspending = (WebAssembly as unknown as { Suspending: new (f: unknown) => unknown }).Suspending;
  const imports: Record<string, Record<string, unknown>> = { env: {}, sim: {}, wasi_snapshot_preview1: {} };
  for (const imp of WebAssembly.Module.imports(wasm)) {
    if (imp.kind !== 'function') continue;
    if (imp.module === 'env') {
      const fn = api.fns[imp.name];
      if (fn) imports.env[imp.name] = api.suspending.has(imp.name) ? new Suspending(guard(fn)) : guard(fn);
      else if (/^(screen_|_ZN4pros6screen)/.test(imp.name)) {
        // brain-screen drawing (e.g. EZ-Template's auton selector): harmless, not shown yet
        imports.env[imp.name] = guard(() => 1);
      } else {
        const name = demangleName(imp.name);
        imports.env[imp.name] = guard(() => {
          warn('unsupported:' + imp.name, `${name}() is not supported by the simulator yet; the call was ignored.`);
          return 0;
        });
      }
    } else if (imp.module === 'sim') {
      const fn = simImports[imp.name];
      if (!fn) throw new Error(`Program needs sim.${imp.name}, which this simulator version does not provide. Rebuild the project.`);
      imports.sim[imp.name] = guard(fn);
    } else if (imp.module === 'wasi_snapshot_preview1') {
      imports.wasi_snapshot_preview1[imp.name] = wasi[imp.name] ?? (() => 52); // ENOSYS
    } else {
      throw new Error(`Unexpected import ${imp.module}.${imp.name}`);
    }
  }

  const instance = await WebAssembly.instantiate(wasm, imports as WebAssembly.Imports);
  exports = instance.exports as typeof exports;
  memory = exports.memory as WebAssembly.Memory;
  sched.stackPointer = exports.__stack_pointer as WebAssembly.Global;
  const promising = (WebAssembly as unknown as { promising: (f: unknown) => (...a: number[]) => Promise<unknown> }).promising;
  const competitionEntry = promising(exports.sim_competition_entry);
  const taskEntry = promising(exports.sim_task_entry);
  api.setTaskEntry((fn, arg) => taskEntry(fn, arg));

  const mainSp = (sched.stackPointer.value as number) >>> 0;
  const startPhase = (p: number, name: string) => {
    phase = p;
    // competition tasks reuse the main stack region: only one runs at a time
    const sp = p === 0 ? mainSp : allocStack(256 * 1024);
    sched.spawn(name, sp, () => competitionEntry(p), p);
  };
  const allocStack = (bytes: number) => ((exports.malloc as (n: number) => number)(bytes + 16) + bytes) & ~15;

  sched.onTaskDone = (t) => {
    if (t.phase === 0) {
      autonStart = sched.now;
      startPhase(2, 'autonomous');
    } else if (t.phase === 2) {
      autonEnd = sched.now;
    }
  };
  sched.onTaskError = (t, e) => {
    error ??= describeError(t.name, e);
  };

  // static constructors (global pros::Motor, lemlib::Chassis, ...) run here
  try {
    (exports._initialize as () => void)();
  } catch (e) {
    error = describeError('global constructors', e);
  }

  // ---------------- main loop ----------------
  const mechs = opts.profile.mechanisms;
  const stride = 6 + mechs.length;
  const frames: number[] = [];
  const pushFrame = () => {
    frames.push(sched.now, world.pose.x, world.pose.y, world.pose.theta, world.vL, world.vR);
    for (const m of mechs) frames.push(world.mechanismState(m));
  };
  if (!error) startPhase(0, 'initialize');
  pushFrame();
  while (!error) {
    const t = sched.pick();
    if (t) {
      await sched.run(t);
      continue;
    }
    if (autonStart !== null && sched.now >= autonStart + opts.autonMs) break;
    if (autonStart === null && sched.now >= initLimit) {
      error = `initialize() did not return within ${initLimit / 1000} s of simulated time, so autonomous never started.`;
      break;
    }
    world.step(STEP_MS);
    sched.now += STEP_MS;
    if (Math.abs(world.vL) + Math.abs(world.vR) > 1e-6) robotHasMoved = true;
    if (motion && motion.done) {
      if (marker && marker.t1 === null) marker.t1 = sched.now;
      world.controller = null;
    }
    if (sched.now % frameEvery === 0) pushFrame();
    if (performance.now() - wallStart > wallLimit) {
      error = `The simulation took longer than ${wallLimit / 1000} s of real time.`;
    }
  }
  if (marker && marker.t1 === null) marker.t1 = sched.now;
  for (const c of world.collisions) events.push({ t: c.t, level: 'info', message: `Robot hit the ${c.wall} wall.` });
  events.sort((a, b) => a.t - b.t);
  if (outBuf[1]) consoleLines.push({ t: sched.now, text: outBuf[1] });
  if (outBuf[2]) consoleLines.push({ t: sched.now, text: outBuf[2] });

  return {
    frameEveryMs: frameEvery,
    stride,
    frames: Float64Array.from(frames),
    mechanisms: mechs.map((m) => m.name),
    autonStart,
    autonEnd,
    stop: sched.now,
    console: consoleLines,
    lcd,
    events,
    motions,
    error,
    wallMs: performance.now() - wallStart,
  };
}

// ---------------- helpers ----------------

const sinDet = dsin;
const cosDet = dcos;
const headingTo = (from: Pose, x: number, y: number) => datan2(x - from.x, y - from.y) / RAD;
const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

function describeError(where: string, e: unknown): string {
  if (e instanceof StuckError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  if (/unreachable/.test(msg)) return `The program crashed in ${where} (it hit "unreachable", e.g. a failed assertion, abort() or an uncaught C++ exception).`;
  if (/out of bounds|memory access/.test(msg)) return `The program crashed in ${where}: invalid memory access (null pointer or out-of-bounds array?).`;
  if (/SuspendError|suspend/i.test(msg)) return `${where}: a blocking call (like pros::delay) was made where it cannot wait, e.g. inside a global object's constructor.`;
  return `${where}: ${msg}`;
}

export { dhypot };
