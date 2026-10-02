// Prototype simulator runtime: runs a linked user program under a deterministic
// simulated clock. Each PROS task is a separate JSPI "promising" call with its own
// shadow stack; the scheduler swaps the exported __stack_pointer global on switch.
// Physics is a minimal tank-drive kinematic model stepped at 1 ms.

const GEAR_RPM = [100, 200, 600];
const STEP_MS = 1;

class Drive {
  constructor() {
    this.motors = new Map(); // port(abs) -> {gearset, mode, cmd, rpm, posDeg}
    this.left = [];
    this.right = [];
    this.trackWidth = 12;
    this.wheelDiameter = 3.25;
    this.wheelRpm = 200;
    this.pose = { x: 0, y: 0, theta: 0 }; // LemLib convention: deg, 0 = +y, clockwise positive
    this.imuOffset = 0;
    this.vL = 0;
    this.vR = 0;
    this.accel = 120; // in/s^2, idealized drivetrain acceleration limit
    this.motion = null;
  }
  motor(port) {
    const p = Math.abs(port);
    if (!this.motors.has(p)) this.motors.set(p, { gearset: 1, mode: 'voltage', cmd: 0, rpm: 0, posDeg: 0 });
    return this.motors.get(p);
  }
  get maxV() { return (this.wheelRpm * Math.PI * this.wheelDiameter) / 60; } // in/s
  sideTargetFromMotors(ports) {
    if (!ports.length) return 0;
    let sum = 0;
    for (const port of ports) {
      const m = this.motor(port);
      const max = GEAR_RPM[m.gearset] ?? 200;
      const rpm = m.mode === 'voltage' ? (Math.max(-127, Math.min(127, m.cmd)) / 127) * max : Math.max(-max, Math.min(max, m.cmd));
      sum += rpm / max; // reversal flag assumed to match mounting (profile decides in M1)
    }
    return (sum / ports.length) * this.maxV;
  }
  step(dtMs) {
    const dt = dtMs / 1000;
    let tL, tR;
    if (this.motion) {
      [tL, tR] = this.motion.target(this, dt);
    } else {
      tL = this.sideTargetFromMotors(this.left);
      tR = this.sideTargetFromMotors(this.right);
    }
    const dv = this.accel * dt;
    this.vL += Math.max(-dv, Math.min(dv, tL - this.vL));
    this.vR += Math.max(-dv, Math.min(dv, tR - this.vR));
    const v = (this.vL + this.vR) / 2;
    const w = (this.vL - this.vR) / this.trackWidth; // rad/s, clockwise positive
    const th = (this.pose.theta * Math.PI) / 180;
    this.pose.x += v * Math.sin(th) * dt;
    this.pose.y += v * Math.cos(th) * dt;
    this.pose.theta += (w * dt * 180) / Math.PI;
    // Encoders: drive motors follow their side's wheel speed; others follow their own command.
    const degPerIn = 360 / (Math.PI * this.wheelDiameter);
    for (const [p, m] of this.motors) {
      const max = GEAR_RPM[m.gearset] ?? 200;
      const gear = max / this.wheelRpm; // motor turns per wheel turn
      const l = this.left.find((q) => Math.abs(q) === p);
      const r = this.right.find((q) => Math.abs(q) === p);
      let degPerSec;
      if (l !== undefined) degPerSec = this.vL * degPerIn * gear;
      else if (r !== undefined) degPerSec = this.vR * degPerIn * gear;
      else degPerSec = (m.mode === 'voltage' ? (m.cmd / 127) * max : m.cmd) * 6;
      m.posDeg += degPerSec * dt;
    }
    if (this.motion) this.motion.after(this, dtMs);
  }
}

// ---- idealized motions (no PID): kinematic tracking limited by drivetrain speed/accel ----
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

class MoveToPoint {
  constructor(x, y, timeout, forwards, maxSpeed) {
    Object.assign(this, { x, y, timeout, forwards, maxSpeed, elapsed: 0, traveled: 0, done: false });
  }
  target(d, dt) {
    const dx = this.x - d.pose.x;
    const dy = this.y - d.pose.y;
    const dist = Math.hypot(dx, dy);
    let ang = (Math.atan2(dx, dy) * 180) / Math.PI;
    if (!this.forwards) ang += 180;
    const err = wrap180(ang - d.pose.theta);
    const vmax = (d.maxV * this.maxSpeed) / 127;
    const vStop = Math.sqrt(2 * d.accel * Math.max(0, dist)); // decel to stop at the point
    let v = Math.min(vmax, vStop) * Math.max(0, Math.cos((err * Math.PI) / 180));
    if (!this.forwards) v = -v;
    const wmax = (2 * vmax) / d.trackWidth;
    const w = Math.max(-wmax, Math.min(wmax, ((err * Math.PI) / 180) * 8)) * (dist < 2 ? 0 : 1);
    const half = (w * d.trackWidth) / 2;
    return [v + half, v - half];
  }
  after(d, dtMs) {
    this.elapsed += dtMs;
    this.traveled += (Math.abs(d.vL + d.vR) / 2) * (dtMs / 1000);
    const dist = Math.hypot(this.x - d.pose.x, this.y - d.pose.y);
    if (dist < 0.5 || this.elapsed >= this.timeout) this.done = true;
  }
}

class TurnToHeading {
  constructor(theta, timeout, direction, maxSpeed) {
    Object.assign(this, { theta, timeout, direction, maxSpeed, elapsed: 0, traveled: 0, done: false, last: null });
  }
  target(d) {
    let err = wrap180(this.theta - d.pose.theta);
    if (this.direction === 0 && err < 0 && Math.abs(err) > 1) err += 360; // CW
    if (this.direction === 1 && err > 0 && Math.abs(err) > 1) err -= 360; // CCW
    const vmax = (d.maxV * this.maxSpeed) / 127;
    const arc = (Math.abs(err) * Math.PI / 180) * (d.trackWidth / 2);
    const v = Math.min(vmax, Math.sqrt(2 * d.accel * arc)) * Math.sign(err);
    return [v, -v];
  }
  after(d, dtMs) {
    this.elapsed += dtMs;
    if (this.last !== null) this.traveled += Math.abs(wrap180(d.pose.theta - this.last));
    this.last = d.pose.theta;
    if (Math.abs(wrap180(this.theta - d.pose.theta)) < 0.5 || this.elapsed >= this.timeout) this.done = true;
  }
}

function makeWasi(getMemory, out) {
  const ENOSYS = 52;
  const view = () => new DataView(getMemory().buffer);
  let rng = 0x12345678;
  return {
    fd_write(fd, iovs, iovsLen, nwritten) {
      const dv = view();
      const mem = new Uint8Array(getMemory().buffer);
      let total = 0;
      let s = '';
      for (let i = 0; i < iovsLen; i++) {
        const ptr = dv.getUint32(iovs + i * 8, true);
        const len = dv.getUint32(iovs + i * 8 + 4, true);
        s += new TextDecoder().decode(mem.subarray(ptr, ptr + len));
        total += len;
      }
      out(fd, s);
      dv.setUint32(nwritten, total, true);
      return 0;
    },
    fd_fdstat_get(fd, buf) {
      const dv = view();
      dv.setUint8(buf, fd <= 2 ? 2 : 0); // character device
      dv.setUint16(buf + 2, 0, true);
      dv.setBigUint64(buf + 8, 0n, true);
      dv.setBigUint64(buf + 16, 0n, true);
      return fd <= 2 ? 0 : 8;
    },
    proc_exit(code) { throw new Error(`program called exit(${code})`); },
    environ_sizes_get(c, s) { view().setUint32(c, 0, true); view().setUint32(s, 0, true); return 0; },
    environ_get() { return 0; },
    args_sizes_get(c, s) { view().setUint32(c, 0, true); view().setUint32(s, 0, true); return 0; },
    args_get() { return 0; },
    random_get(buf, len) {
      const mem = new Uint8Array(getMemory().buffer);
      for (let i = 0; i < len; i++) { rng = (rng * 1103515245 + 12345) >>> 0; mem[buf + i] = rng >>> 24; }
      return 0;
    },
    __fallback: () => ENOSYS,
  };
}

/**
 * Run a linked program for `stopMs` simulated milliseconds.
 * @returns {{log:string[], frames:object[], stdout:string, ms:number, error?:string}}
 */
export async function runProgram(wasmModule, { stopMs = 15000, frameEveryMs = 10, debug = false } = {}) {
  if (typeof WebAssembly.Suspending !== 'function') throw new Error('JSPI (WebAssembly.Suspending) not available');
  const t0 = performance.now();
  const drive = new Drive();
  const log = [];
  const frames = [];
  let stdout = '';
  const sched = { now: 0, seq: 0, current: null, yield: null, tasks: [] };
  let exports;
  let memory;
  const mem = () => memory;
  const cstr = (ptr) => {
    const u8 = new Uint8Array(memory.buffer);
    let end = ptr;
    while (u8[end]) end++;
    return new TextDecoder().decode(u8.subarray(ptr, end));
  };
  const ev = (s) => { log.push(`${sched.now} ${s}`); if (debug) console.log(`[ev] ${sched.now} ${s}`); };

  const park = (t, state, extra) => {
    t.sp = exports.__stack_pointer.value;
    Object.assign(t, { state, seq: sched.seq++ }, extra);
    return new Promise((res) => {
      t.resume = res;
      sched.yield();
    });
  };

  const sim = {
    delay: new WebAssembly.Suspending((ms) => park(sched.current, 'sleeping', { wake: sched.now + ms })),
    millis: () => sched.now,
    task_spawn: (id, stackTop, namePtr) => {
      const name = cstr(namePtr);
      sched.tasks.push({ id, sp: stackTop, state: 'sleeping', wake: sched.now, seq: sched.seq++, started: false, name });
      ev(`task_spawn ${id} ${name}`);
    },
    motor_config: (port, gearset) => { drive.motor(port).gearset = gearset; },
    motor_move: (port, v) => { const m = drive.motor(port); m.mode = 'voltage'; m.cmd = v; ev(`motor ${port} move ${v}`); },
    motor_move_velocity: (port, v) => { const m = drive.motor(port); m.mode = 'velocity'; m.cmd = v; ev(`motor ${port} vel ${v}`); },
    motor_get_position: (port) => drive.motor(port).posDeg,
    motor_tare: (port) => { drive.motor(port).posDeg = 0; },
    imu_get_rotation: () => drive.pose.theta - drive.imuOffset,
    imu_set_rotation: (_port, deg) => { drive.imuOffset = drive.pose.theta - deg; },
    chassis_config: (lp, nl, rp, nr, track, wheel, rpm) => {
      const i8 = new Int8Array(memory.buffer);
      drive.left = Array.from(i8.subarray(lp, lp + nl));
      drive.right = Array.from(i8.subarray(rp, rp + nr));
      Object.assign(drive, { trackWidth: track, wheelDiameter: wheel, wheelRpm: rpm });
    },
    motion_move_to_point: (x, y, timeout, fwd, max) => { drive.motion = new MoveToPoint(x, y, timeout, !!fwd, max); ev(`moveToPoint ${x} ${y}`); },
    motion_turn_to_heading: (th, timeout, dir, max) => { drive.motion = new TurnToHeading(th, timeout, dir, max); ev(`turnToHeading ${th}`); },
    motion_wait: new WebAssembly.Suspending((until) => {
      const cond = () => !drive.motion || drive.motion.done || (until >= 0 && drive.motion.traveled >= until);
      if (cond()) return undefined; // no suspension needed
      return park(sched.current, 'waiting', { cond });
    }),
    motion_cancel: () => { drive.motion = null; },
    motion_is_active: () => (drive.motion && !drive.motion.done ? 1 : 0),
    pose_set: (x, y, th) => { drive.pose = { x, y, theta: th }; drive.imuOffset = 0; },
    pose_get: (ptr) => {
      const f = new Float64Array(memory.buffer, ptr, 3);
      f[0] = drive.pose.x; f[1] = drive.pose.y; f[2] = drive.pose.theta;
    },
    log: (ptr, len) => { stdout += new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len)); },
    unsupported: (ptr) => { ev(`UNSUPPORTED ${cstr(ptr)}`); },
  };

  const wasi = makeWasi(mem, (_fd, s) => { stdout += s; });
  const imports = { sim: {}, wasi_snapshot_preview1: {} };
  for (const imp of WebAssembly.Module.imports(wasmModule)) {
    if (imp.module === 'sim') {
      if (!(imp.name in sim)) throw new Error(`missing sim import ${imp.name}`);
      imports.sim[imp.name] = sim[imp.name];
    } else if (imp.module === 'wasi_snapshot_preview1') {
      imports.wasi_snapshot_preview1[imp.name] = wasi[imp.name] ?? wasi.__fallback;
    } else {
      throw new Error(`unexpected import ${imp.module}.${imp.name}`);
    }
  }
  const instance = await WebAssembly.instantiate(wasmModule, imports);
  exports = instance.exports;
  memory = exports.memory;
  exports._initialize(); // static constructors (device objects, chassis)
  const competition = WebAssembly.promising(exports.sim_competition_entry);
  const taskEntry = WebAssembly.promising(exports.sim_task_entry);
  sched.tasks.unshift({ id: 0, sp: exports.__stack_pointer.value, state: 'sleeping', wake: 0, seq: -1, started: false, name: 'competition' });

  let error;
  const runTask = (t) => new Promise((yielded) => {
    sched.current = t;
    sched.yield = yielded;
    exports.__stack_pointer.value = t.sp;
    t.state = 'running';
    if (!t.started) {
      t.started = true;
      const p = t.id === 0 ? competition() : taskEntry(t.id);
      // Completion may happen during a later resume, so signal through sched.yield
      // (the current run's resolver), not this first run's `yielded`.
      p.then(
        () => { t.state = 'done'; ev(`task_done ${t.id}`); sched.yield(); },
        (e) => { t.state = 'done'; error ??= `task ${t.name}: ${e?.message ?? e}`; sched.yield(); },
      );
    } else {
      const r = t.resume;
      t.resume = null;
      r();
    }
  });

  let nextFrame = 0;
  while (!error) {
    let pick = null;
    for (const t of sched.tasks) {
      const ready = (t.state === 'sleeping' && t.wake <= sched.now) || (t.state === 'waiting' && t.cond());
      if (ready && (!pick || t.seq < pick.seq)) pick = t;
    }
    if (pick) {
      if (debug) console.log(`[run] t=${sched.now} task ${pick.id} (${pick.name}) sp=${pick.sp}`);
      await runTask(pick);
      continue;
    }
    if (sched.now >= stopMs) break;
    if (sched.now >= nextFrame) {
      frames.push({ t: sched.now, x: drive.pose.x, y: drive.pose.y, theta: drive.pose.theta });
      nextFrame += frameEveryMs;
    }
    drive.step(STEP_MS);
    sched.now += STEP_MS;
    if (drive.motion?.done) {
      // LemLib stops the drivetrain when a motion ends.
      ev('motion_done');
      drive.motion = null;
      for (const p of [...drive.left, ...drive.right]) Object.assign(drive.motor(p), { mode: 'voltage', cmd: 0 });
    }
  }
  frames.push({ t: sched.now, x: drive.pose.x, y: drive.pose.y, theta: drive.pose.theta });
  return { log, frames, stdout, error, ms: performance.now() - t0, finalPose: { ...drive.pose } };
}
