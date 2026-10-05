// The PROS C API ("env" imports of the linked program), implemented against the
// simulated world. The vendored PROS C++ classes (pros::Motor, pros::Imu, ...) call
// these, so both the C and C++ APIs behave like the real kernel. Blocking calls are
// WebAssembly.Suspending and park the calling task on the deterministic scheduler.

import { dcos, dsin } from './dmath.ts';
import type { Scheduler } from './scheduler.ts';
import type { MotorState, OpticalReading, World } from './world.ts';

export const PROS_ERR = 2147483647;
export const PROS_ERR_F = Infinity;
const ERR_BYTE = 255;

export interface ApiContext {
  world: World;
  sched: Scheduler;
  mem: () => WebAssembly.Memory;
  malloc: (n: number) => number;
  warn: (key: string, message: string) => void;
  /** 0 initialize, 2 autonomous, ... ; drives competition_* status. */
  phase: () => number;
  lcdPrint: (line: number, text: string) => void;
}

const DEVICE_CODE: Record<string, number> = {
  motor: 2, 'drive-motor': 2, rotation: 4, imu: 6, distance: 7, vision: 11, optical: 16, gps: 20, ai_vision: 29,
};

type Fn = (...args: never[]) => unknown;

/**
 * Build the env import table. `suspending` lists the names that must be wrapped in
 * WebAssembly.Suspending by the caller.
 */
export interface ProsApi {
  fns: Record<string, Fn>;
  suspending: Set<string>;
  /** Provide the promising task-entry export once the program is instantiated. */
  setTaskEntry(fn: (fn: number, arg: number) => Promise<unknown>): void;
}

export function createProsApi(ctx: ApiContext): ProsApi {
  const { world, sched } = ctx;
  const dv = () => new DataView(ctx.mem().buffer);
  const cstr = (ptr: number) => {
    const u8 = new Uint8Array(ctx.mem().buffer);
    let end = ptr;
    while (u8[end]) end++;
    return new TextDecoder().decode(u8.subarray(ptr, end));
  };
  const allocString = (s: string) => {
    const bytes = new TextEncoder().encode(s);
    const p = ctx.malloc(bytes.length + 1);
    new Uint8Array(ctx.mem().buffer).set([...bytes, 0], p);
    return p;
  };

  // ---- device lookup with profile checks ----
  const portOk = (port: number) => {
    const p = Math.abs(port);
    return p >= 1 && p <= 21;
  };
  // Configuration-only calls (set reversed, data rate, gearing, ...) are made by library
  // constructors for sensors a robot may not have; they don't warn, real use does.
  let quiet = false;
  const expectDevice = (port: number, type: string): boolean => {
    const p = Math.abs(port);
    if (quiet) {
      const dev = world.deviceAt(p);
      const have = dev === null ? null : dev === 'drive-motor' ? 'motor' : dev.type;
      return portOk(port) && have === type;
    }
    if (!portOk(port)) {
      ctx.warn(`badport:${p}`, `Code uses port ${p}, which is not a valid smart port (1-21).`);
      return false;
    }
    const dev = world.deviceAt(p);
    const have = dev === null ? null : dev === 'drive-motor' ? 'motor' : dev.type;
    if (have === type) return true;
    if (have === null) ctx.warn(`missing:${p}:${type}`, `Code uses a ${type} on port ${p}, but the robot profile has nothing on that port. Calls to it do nothing.`);
    else ctx.warn(`mismatch:${p}:${type}`, `Code uses a ${type} on port ${p}, but the robot profile has a ${have} there. Calls to it do nothing.`);
    return false;
  };
  const motor = (port: number): MotorState | null => (expectDevice(port, 'motor') ? world.motor(port) : null);
  const sgn = (port: number) => (port < 0 ? -1 : 1);

  const imu = (port: number) => (expectDevice(port, 'imu') ? world.imus.get(port) ?? null : null);
  const rot = (port: number) => (expectDevice(port, 'rotation') ? world.rotations.get(Math.abs(port)) ?? null : null);

  const adiKey = (smart: number, adi: number) => {
    let a = adi;
    if (a >= 97) a -= 96;
    else if (a >= 65) a -= 64;
    const letter = String.fromCharCode(64 + a);
    return smart === 22 ? letter : `${smart}${letter}`;
  };

  const f: Record<string, Fn> = {};
  const suspending = new Set<string>();
  const susp = (name: string, fn: Fn) => {
    f[name] = fn;
    suspending.add(name);
  };

  // ======================= RTOS =======================
  f.millis = () => sched.now >>> 0;
  f.micros = () => BigInt(sched.now) * 1000n;
  susp('delay', (ms: number) => sched.delay(ms >>> 0));
  susp('task_delay', (ms: number) => sched.delay(ms >>> 0));
  susp('task_delay_until', (prevPtr: number, delta: number) => {
    const prev = dv().getUint32(prevPtr, true);
    const wake = prev + (delta >>> 0);
    dv().setUint32(prevPtr, wake, true);
    // (a zero period still lets a tick pass, as delay(0) does: see Scheduler.delay)
    const until = Math.max(wake, delta >>> 0 ? 0 : sched.now + 1);
    return sched.park(() => sched.now >= until);
  });
  f.task_create = (fn: number, arg: number, _prio: number, depth: number, namePtr: number) => {
    const bytes = Math.max(64 * 1024, (depth & 0xffff) * 4 * 2);
    const base = ctx.malloc(bytes + 16);
    const top = (base + bytes) & ~15;
    const name = namePtr ? cstr(namePtr) : '';
    const t = sched.spawn(name || 'task', top, () => entryTask(fn, arg));
    return t.handle;
  };
  // filled in by the runtime (needs the promising export)
  let entryTask: (fn: number, arg: number) => Promise<unknown> = () => Promise.resolve();
  const taskOf = (h: number) => (h === 0 ? sched.current : sched.byHandle(h) ?? null);
  susp('task_delete', (h: number) => {
    const t = taskOf(h);
    if (!t) return undefined;
    if (t === sched.current) return sched.parkForever();
    t.state = 'done';
    return undefined;
  });
  f.task_get_current = () => sched.current?.handle ?? 0;
  f.task_get_priority = () => 8;
  f.task_set_priority = () => {};
  f.task_get_state = (h: number) => {
    const t = taskOf(h);
    if (!t) return 5; // E_TASK_STATE_INVALID
    return { running: 0, ready: 1, blocked: 2, suspended: 3, done: 4 }[t.state];
  };
  f.task_suspend = (h: number) => {
    const t = taskOf(h);
    if (t && t.state !== 'done' && t !== sched.current) {
      t.wasSuspendedFrom = t.state;
      t.state = 'suspended';
    }
  };
  f.task_resume = (h: number) => {
    const t = taskOf(h);
    if (t && t.state === 'suspended') t.state = t.wasSuspendedFrom ?? 'ready';
  };
  f.task_get_count = () => sched.liveTasks;
  f.task_get_name = (h: number) => {
    const t = taskOf(h);
    if (!t) return 0;
    if (!t.namePtr) t.namePtr = allocString(t.name);
    return t.namePtr;
  };
  f.task_get_by_name = (ptr: number) => {
    const n = cstr(ptr);
    return sched.tasks.find((t) => t.name === n && t.state !== 'done')?.handle ?? 0;
  };
  f.task_notify = (h: number) => {
    const t = taskOf(h);
    if (t) t.notifyValue++;
    return 1;
  };
  f.task_notify_ext = (h: number, value: number, action: number, prevPtr: number) => {
    const t = taskOf(h);
    if (!t) return 0;
    if (prevPtr) dv().setUint32(prevPtr, t.notifyValue >>> 0, true);
    if (action === 1) t.notifyValue |= value; // E_NOTIFY_ACTION_BITS
    else if (action === 2) t.notifyValue++; // INCR
    else if (action === 3 || action === 4) t.notifyValue = value >>> 0; // OWRITE / NO_OWRITE
    return 1;
  };
  susp('task_notify_take', (clear: number, timeout: number) => {
    const t = sched.current!;
    const deadline = timeout >>> 0 === 0xffffffff ? Infinity : sched.now + (timeout >>> 0);
    const take = () => {
      const v = t.notifyValue;
      t.notifyValue = clear ? 0 : Math.max(0, v - 1);
      return v >>> 0;
    };
    if (t.notifyValue > 0 || timeout === 0) return take();
    return sched.park(() => t.notifyValue > 0 || sched.now >= deadline, take);
  });
  f.task_notify_clear = (h: number) => {
    const t = taskOf(h);
    const had = !!t && t.notifyValue > 0;
    if (t) t.notifyValue = 0;
    return had ? 1 : 0;
  };
  susp('task_join', (h: number) => {
    const t = taskOf(h);
    if (!t || t.state === 'done') return undefined;
    return sched.park(() => t.state === 'done');
  });

  // mutexes: handle -> owner task id (0 = free) and recursion count
  const mutexes = new Map<number, { owner: number; count: number }>();
  let nextMutex = 0x20000;
  const newMutex = () => {
    const h = (nextMutex += 16);
    mutexes.set(h, { owner: 0, count: 0 });
    return h;
  };
  const takeMutex = (h: number, timeout: number, recursive: boolean) => {
    const m = mutexes.get(h);
    if (!m) return 0;
    const me = sched.current!.id;
    const free = () => m.owner === 0 || (recursive && m.owner === me);
    const acquire = () => {
      if (!free()) return 0;
      m.owner = me;
      m.count++;
      return 1;
    };
    if (free()) return acquire();
    if ((timeout >>> 0) === 0) return 0;
    const deadline = timeout >>> 0 === 0xffffffff ? Infinity : sched.now + (timeout >>> 0);
    return sched.park(() => free() || sched.now >= deadline, acquire);
  };
  const giveMutex = (h: number) => {
    const m = mutexes.get(h);
    if (!m || m.owner === 0) return 0;
    if (--m.count <= 0) {
      m.owner = 0;
      m.count = 0;
    }
    return 1;
  };
  f.mutex_create = newMutex;
  f.mutex_recursive_create = newMutex;
  susp('mutex_take', (h: number, timeout: number) => takeMutex(h, timeout, false));
  susp('mutex_recursive_take', (h: number, timeout: number) => takeMutex(h, timeout, true));
  f.mutex_give = giveMutex;
  f.mutex_recursive_give = giveMutex;
  f.mutex_delete = (h: number) => {
    mutexes.delete(h);
  };
  f.mutex_get_owner = (h: number) => {
    const m = mutexes.get(h);
    return m && m.owner ? Scheduler_handle(m.owner) : 0;
  };
  f.rtos_suspend_all = () => {};
  f.rtos_resume_all = () => 0;
  // kernel-internal port locks used by the vendored wrappers
  f.port_mutex_take = () => 1;
  f.port_mutex_give = () => 1;

  // ======================= Motors =======================
  const mv = (fn: (m: MotorState, sign: number) => void) => (port: number, ...rest: number[]) => {
    const m = motor(port);
    if (!m) return PROS_ERR;
    void rest;
    fn(m, sgn(port));
    return 1;
  };
  f.motor_move = (port: number, v: number) => {
    const m = motor(port);
    if (!m) return PROS_ERR;
    m.mode = 'voltage';
    m.cmd = sgn(port) * Math.max(-127, Math.min(127, v));
    return 1;
  };
  f.motor_move_voltage = (port: number, mvolts: number) => {
    const m = motor(port);
    if (!m) return PROS_ERR;
    m.mode = 'voltage';
    m.cmd = (sgn(port) * Math.max(-12000, Math.min(12000, mvolts)) * 127) / 12000;
    return 1;
  };
  f.motor_move_velocity = (port: number, rpm: number) => {
    const m = motor(port);
    if (!m) return PROS_ERR;
    m.mode = 'velocity';
    // velocity is in rpm of the code's configured gearset; the physical cartridge caps it
    m.cmd = sgn(port) * rpm;
    return 1;
  };
  f.motor_brake = mv((m) => {
    m.mode = 'velocity';
    m.cmd = 0;
  });
  const moveAbs = (m: MotorState, sign: number, positionUnits: number, vel: number) => {
    m.mode = 'position';
    // reported = sign*(angle - zero) -> angle = zero + reported/sign
    m.cmd = m.zero + m.fromUnits(positionUnits) * sign;
    m.profileRpm = Math.abs(vel);
  };
  f.motor_move_absolute = (port: number, pos: number, vel: number) => {
    const m = motor(port);
    if (!m) return PROS_ERR;
    moveAbs(m, sgn(port), pos, vel);
    return 1;
  };
  f.motor_move_relative = (port: number, pos: number, vel: number) => {
    const m = motor(port);
    if (!m) return PROS_ERR;
    const base = m.mode === 'position' ? m.cmd : m.angle;
    m.mode = 'position';
    m.cmd = base + m.fromUnits(pos) * sgn(port);
    m.profileRpm = Math.abs(vel);
    return 1;
  };
  f.motor_modify_profiled_velocity = (port: number, vel: number) => {
    const m = motor(port);
    if (!m) return PROS_ERR;
    if (m.mode === 'position') m.profileRpm = Math.abs(vel);
    else {
      m.mode = 'velocity';
      m.cmd = sgn(port) * vel;
    }
    return 1;
  };
  const getter = (fn: (m: MotorState, sign: number) => number, err: number = PROS_ERR_F) => (port: number) => {
    const m = motor(port);
    return m ? fn(m, sgn(port)) : err;
  };
  f.motor_get_target_position = getter((m, s) => (m.mode === 'position' ? m.reportedAt(m.cmd, s) : m.reported(s)));
  f.motor_get_target_velocity = getter((m, s) => (m.mode === 'velocity' ? Math.round(s * m.cmd) : 0), PROS_ERR);
  f.motor_get_actual_velocity = getter((m, s) => s * m.rpm * m.codeRpmPerPhysRpm);
  f.motor_get_position = getter((m, s) => m.reported(s));
  f.motor_get_raw_position = (port: number, tsPtr: number) => {
    const m = motor(port);
    if (!m) return PROS_ERR;
    if (tsPtr) dv().setUint32(tsPtr, sched.now >>> 0, true);
    return Math.round(m.reported(sgn(port)));
  };
  // Current: modest while moving, high only when a non-drive motor is stalled (e.g. an
  // arm at its hard stop). Drive motors are moved by the idealized drivetrain, never stalled.
  f.motor_get_current_draw = getter((m) => {
    if (!m.cartridge) return 0;
    const stalled = !m.driveSide && Math.abs(m.targetRpm()) > 5 && Math.abs(m.rpm) < 1;
    if (stalled) return 2500;
    return Math.round(120 + 600 * Math.min(1, Math.abs(m.rpm) / m.freeRpm));
  }, PROS_ERR);
  f.motor_get_direction = getter((m, s) => (s * m.rpm >= 0 ? 1 : -1), PROS_ERR);
  f.motor_get_efficiency = getter((m) => (m.rpm === 0 ? 0 : 80));
  f.motor_is_over_current = getter(() => 0, PROS_ERR);
  f.motor_is_over_temp = getter(() => 0, PROS_ERR);
  f.motor_get_faults = getter(() => 0, 0);
  f.motor_get_flags = getter(() => 0, 0);
  f.motor_get_power = getter((m) => Math.abs(m.rpm / (m.freeRpm || 1)) * 5);
  f.motor_get_temperature = getter(() => 30);
  f.motor_get_torque = getter(() => 0.1);
  f.motor_get_voltage = getter((m, s) => Math.round((s * m.rpm * 12000) / (m.freeRpm || 1)), PROS_ERR);
  f.motor_set_zero_position = (port: number, pos: number) => {
    const m = motor(port);
    if (!m) return PROS_ERR;
    // make reported == pos now
    m.zero = m.angle - (m.fromUnits(pos) * sgn(port));
    return 1;
  };
  f.motor_tare_position = mv((m) => {
    m.zero = m.angle;
  });
  f.motor_set_brake_mode = (port: number, mode: number) => {
    const m = motor(port);
    if (!m) return PROS_ERR;
    m.brakeMode = mode;
    return 1;
  };
  f.motor_get_brake_mode = getter((m) => m.brakeMode, 3);
  f.motor_set_current_limit = (port: number, lim: number) => {
    const m = motor(port);
    if (!m) return PROS_ERR;
    m.currentLimit = lim;
    return 1;
  };
  f.motor_get_current_limit = getter((m) => m.currentLimit, PROS_ERR);
  f.motor_set_voltage_limit = (port: number, lim: number) => {
    const m = motor(port);
    if (!m) return PROS_ERR;
    m.voltageLimit = lim;
    return 1;
  };
  f.motor_get_voltage_limit = getter((m) => m.voltageLimit, PROS_ERR);
  f.motor_set_encoder_units = (port: number, units: number) => {
    const m = motor(port);
    if (!m) return PROS_ERR;
    m.encoderUnits = units;
    return 1;
  };
  f.motor_get_encoder_units = getter((m) => m.encoderUnits, 3);
  f.motor_set_gearing = (port: number, gearset: number) => {
    const m = motor(port);
    if (!m) return PROS_ERR;
    m.codeGearset = gearset;
    m.gearsetSetByCode = true;
    const physical = ['red', 'green', 'blue'].indexOf(m.cartridge ?? '');
    if (physical >= 0 && gearset !== physical && gearset >= 0 && gearset <= 2) {
      const names = ['red (100 rpm)', 'green (200 rpm)', 'blue (600 rpm)'];
      ctx.warn(`gear:${m.port}`, `Port ${m.port}: code configures a ${names[gearset]} cartridge but the robot profile has ${names[physical]}. Speeds follow the profile.`);
    }
    return 1;
  };
  f.motor_get_gearing = getter((m) => m.codeGearset, 3);
  f.motor_get_type = getter(() => 0, 2);
  f.motor_set_reversed = () => 1;
  f.motor_is_reversed = (port: number) => (port < 0 ? 1 : 0);

  // ======================= IMU =======================
  const imuReady = (port: number) => {
    const s = imu(port);
    if (!s) return null;
    return sched.now < s.calibratingUntil ? null : s;
  };
  const CAL_MS = 2000;
  susp('imu_reset', (port: number) => {
    const s = imu(port);
    if (!s) return PROS_ERR;
    s.calibratingUntil = sched.now + CAL_MS;
    s.rotationOffset = world.pose.theta;
    s.headingOffset = world.pose.theta;
    s.yawOffset = world.pose.theta; // calibrating zeroes yaw too
    return sched.delay(5).then(() => 1);
  });
  susp('imu_reset_blocking', (port: number) => {
    const s = imu(port);
    if (!s) return PROS_ERR;
    s.calibratingUntil = sched.now + CAL_MS;
    s.rotationOffset = world.pose.theta;
    s.headingOffset = world.pose.theta;
    s.yawOffset = world.pose.theta; // calibrating zeroes yaw too
    return sched.delay(CAL_MS).then(() => 1);
  });
  f.imu_set_data_rate = (port: number) => (imu(port) ? 1 : PROS_ERR);
  f.imu_get_status = (port: number) => {
    const s = imu(port);
    if (!s) return ERR_BYTE;
    return sched.now < s.calibratingUntil ? 1 : 0;
  };
  f.imu_get_rotation = (port: number) => {
    const s = imuReady(port);
    return s ? world.imuRotation(s) : PROS_ERR_F;
  };
  f.imu_get_heading = (port: number) => {
    const s = imuReady(port);
    return s ? world.imuHeading(s) : PROS_ERR_F;
  };
  f.imu_get_yaw = (port: number) => {
    const s = imuReady(port);
    if (!s) return PROS_ERR_F;
    const y = ((world.pose.theta - s.yawOffset + 180) % 360 + 360) % 360 - 180;
    return y;
  };
  f.imu_get_pitch = (port: number) => (imuReady(port) ? 0 : PROS_ERR_F);
  f.imu_get_roll = (port: number) => (imuReady(port) ? 0 : PROS_ERR_F);
  // struct returns use an sret pointer as the first argument
  f.imu_get_euler = (ret: number, port: number) => {
    const d = dv();
    const s = imuReady(port);
    const yaw = s ? (((world.pose.theta - s.yawOffset + 180) % 360) + 360) % 360 - 180 : PROS_ERR_F;
    d.setFloat64(ret, s ? 0 : PROS_ERR_F, true);
    d.setFloat64(ret + 8, s ? 0 : PROS_ERR_F, true);
    d.setFloat64(ret + 16, yaw, true);
  };
  f.imu_get_quaternion = (ret: number, port: number) => {
    const d = dv();
    const s = imuReady(port);
    const half = s ? (-(world.pose.theta - s.yawOffset) * Math.PI) / 360 : 0;
    // rotation about +z (yaw, counter-clockwise positive in the IMU frame)
    const sinH = dsin(half);
    const cosH = dcos(half);
    d.setFloat64(ret, s ? 0 : PROS_ERR_F, true);
    d.setFloat64(ret + 8, s ? 0 : PROS_ERR_F, true);
    d.setFloat64(ret + 16, s ? sinH : PROS_ERR_F, true);
    d.setFloat64(ret + 24, s ? cosH : PROS_ERR_F, true);
  };
  f.imu_get_gyro_rate = (ret: number, port: number) => {
    const d = dv();
    const s = imuReady(port);
    d.setFloat64(ret, s ? 0 : PROS_ERR_F, true);
    d.setFloat64(ret + 8, s ? 0 : PROS_ERR_F, true);
    d.setFloat64(ret + 16, s ? -world.omega : PROS_ERR_F, true);
  };
  f.imu_get_accel = (ret: number, port: number) => {
    const d = dv();
    const s = imuReady(port);
    const [ax, ay, az] = s ? world.imuAccel() : [PROS_ERR_F, PROS_ERR_F, PROS_ERR_F];
    d.setFloat64(ret, ax, true);
    d.setFloat64(ret + 8, ay, true);
    d.setFloat64(ret + 16, az, true);
  };
  const imuSet = (fn: (s: NonNullable<ReturnType<typeof imu>>, v: number) => void) => (port: number, v = 0) => {
    const s = imuReady(port);
    if (!s) return PROS_ERR;
    fn(s, v);
    return 1;
  };
  f.imu_set_rotation = imuSet((s, v) => { s.rotationOffset = world.pose.theta - v; });
  f.imu_set_heading = imuSet((s, v) => { s.headingOffset = world.pose.theta - v; });
  f.imu_set_yaw = imuSet((s, v) => { s.yawOffset = world.pose.theta - v; });
  f.imu_set_pitch = imuSet(() => {});
  f.imu_set_roll = imuSet(() => {});
  f.imu_tare_rotation = imuSet((s) => { s.rotationOffset = world.pose.theta; });
  f.imu_tare_heading = imuSet((s) => { s.headingOffset = world.pose.theta; });
  f.imu_tare_yaw = imuSet((s) => { s.yawOffset = world.pose.theta; });
  f.imu_tare_pitch = imuSet(() => {});
  f.imu_tare_roll = imuSet(() => {});
  f.imu_tare_euler = imuSet((s) => { s.yawOffset = world.pose.theta; });
  f.imu_tare = imuSet((s) => {
    s.rotationOffset = world.pose.theta;
    s.headingOffset = world.pose.theta;
    s.yawOffset = world.pose.theta;
  });
  f.imu_set_euler = (port: number, eulerPtr: number) => {
    const s = imuReady(port);
    if (!s) return PROS_ERR;
    s.yawOffset = world.pose.theta - dv().getFloat64(eulerPtr + 16, true);
    return 1;
  };
  f.imu_get_physical_orientation = (port: number) => (imu(port) ? 0 : ERR_BYTE);

  // ======================= Rotation sensor =======================
  const rotPos = (r: NonNullable<ReturnType<typeof rot>>, port: number) => {
    const rev = (port < 0) !== r.reversed ? -1 : 1;
    return Math.round(rev * (r.raw - r.zero));
  };
  // PROS: reset() makes the position equal to the sensor's angle (0-360°); reset_position() zeroes it
  f.rotation_reset = (port: number) => {
    const r = rot(port);
    if (!r) return PROS_ERR;
    const rev = (port < 0) !== r.reversed ? -1 : 1;
    const angle = (((rev * r.raw) % 36000) + 36000) % 36000;
    r.zero = r.raw - rev * angle;
    return 1;
  };
  f.rotation_reset_position = (port: number) => {
    const r = rot(port);
    if (!r) return PROS_ERR;
    r.zero = r.raw;
    return 1;
  };
  f.rotation_set_data_rate = (port: number) => (rot(port) ? 1 : PROS_ERR);
  f.rotation_set_position = (port: number, pos: number) => {
    const r = rot(port);
    if (!r) return PROS_ERR;
    const rev = (port < 0) !== r.reversed ? -1 : 1;
    r.zero = r.raw - pos / rev;
    return 1;
  };
  f.rotation_get_position = (port: number) => {
    const r = rot(port);
    return r ? rotPos(r, port) : PROS_ERR;
  };
  f.rotation_get_velocity = (port: number) => {
    const r = rot(port);
    if (!r) return PROS_ERR;
    const rev = (port < 0) !== r.reversed ? -1 : 1;
    return Math.round(rev * r.velocity);
  };
  f.rotation_get_angle = (port: number) => {
    const r = rot(port);
    if (!r) return PROS_ERR;
    const rev = (port < 0) !== r.reversed ? -1 : 1;
    return ((Math.round(rev * r.raw) % 36000) + 36000) % 36000;
  };
  f.rotation_set_reversed = (port: number, value: number) => {
    const r = rot(port);
    if (!r) return PROS_ERR;
    r.reversed = !!value;
    return 1;
  };
  f.rotation_init_reverse = f.rotation_set_reversed;
  f.rotation_reverse = (port: number) => {
    const r = rot(port);
    if (!r) return PROS_ERR;
    r.reversed = !r.reversed;
    return 1;
  };
  f.rotation_get_reversed = (port: number) => {
    const r = rot(port);
    return r ? (r.reversed ? 1 : 0) : PROS_ERR;
  };

  // ======================= Distance sensor =======================
  const dist = (port: number) => (expectDevice(port, 'distance') ? (world.profile.devices.find((d) => d.port === port && d.type === 'distance') as Extract<typeof world.profile.devices[number], { type: 'distance' }>) : null);
  f.distance_get = (port: number) => {
    const d = dist(port);
    if (!d) return PROS_ERR;
    const mm = world.raycast(d.mount) * 25.4;
    return mm > 2000 || mm < 20 ? 9999 : Math.round(mm);
  };
  f.distance_get_confidence = (port: number) => (dist(port) ? 63 : PROS_ERR);
  f.distance_get_object_size = (port: number) => (dist(port) ? 400 : PROS_ERR);
  f.distance_get_object_velocity = (port: number) => (dist(port) ? 0 : PROS_ERR_F);

  // ======================= GPS =======================
  // The GPS reads the field code strip; idealized, it reports where the robot's turning
  // center is: the sensor's real position minus the offset the code declares (meters,
  // robot frame). A wrong offset in code gives wrong positions, as on a real robot.
  const M_PER_IN = 0.0254;
  type GpsSpec = Extract<(typeof world.profile.devices)[number], { type: 'gps' }>;
  const gpsState = new Map<number, { offset: [number, number]; rate: number }>();
  const gps = (port: number) => {
    if (!expectDevice(port, 'gps')) return null;
    const spec = world.profile.devices.find((d) => d.port === Math.abs(port) && d.type === 'gps') as GpsSpec;
    let st = gpsState.get(spec.port);
    if (!st) gpsState.set(spec.port, (st = { offset: [0, 0], rate: 20 }));
    return { spec, st };
  };
  const gpsPose = (g: NonNullable<ReturnType<typeof gps>>) => {
    const m = g.spec.mount ?? { x: 0, y: 0 };
    const th = world.pose.theta;
    // sensor position (inches) -> minus the code's offset rotated into the field frame (meters)
    const s = dsin((th * Math.PI) / 180);
    const c = dcos((th * Math.PI) / 180);
    const sx = world.pose.x + m.x * c + m.y * s;
    const sy = world.pose.y - m.x * s + m.y * c;
    const [ox, oy] = g.st.offset;
    const x = sx * M_PER_IN - (ox * c + oy * s);
    const y = sy * M_PER_IN - (-ox * s + oy * c);
    const heading = ((((th + (m.heading ?? 0)) % 360) + 360) % 360);
    return { x, y, heading, yaw: heading >= 180 ? heading - 360 : heading };
  };
  f.gps_initialize_full = (port: number, _x: number, _y: number, _h: number, xOffset: number, yOffset: number) => {
    const g = gps(port);
    if (!g) return PROS_ERR;
    g.st.offset = [xOffset, yOffset];
    return 1;
  };
  f.gps_set_offset = (port: number, xOffset: number, yOffset: number) => {
    const g = gps(port);
    if (!g) return PROS_ERR;
    g.st.offset = [xOffset, yOffset];
    return 1;
  };
  f.gps_get_offset = (ret: number, port: number) => {
    const g = gps(port);
    dv().setFloat64(ret, g ? g.st.offset[0] : PROS_ERR_F, true);
    dv().setFloat64(ret + 8, g ? g.st.offset[1] : PROS_ERR_F, true);
  };
  // the starting-position guess only matters when the strip can't be seen
  f.gps_set_position = (port: number) => (gps(port) ? 1 : PROS_ERR);
  f.gps_set_data_rate = (port: number, rate: number) => {
    const g = gps(port);
    if (!g) return PROS_ERR;
    g.st.rate = Math.max(5, rate);
    return 1;
  };
  f.gps_get_error = (port: number) => (gps(port) ? 0.01 : PROS_ERR_F);
  f.gps_get_position_and_orientation = (ret: number, port: number) => {
    const g = gps(port);
    const p = g ? gpsPose(g) : null;
    const d = dv();
    d.setFloat64(ret, p ? p.x : PROS_ERR_F, true);
    d.setFloat64(ret + 8, p ? p.y : PROS_ERR_F, true);
    d.setFloat64(ret + 16, p ? 0 : PROS_ERR_F, true);
    d.setFloat64(ret + 24, p ? 0 : PROS_ERR_F, true);
    d.setFloat64(ret + 32, p ? p.yaw : PROS_ERR_F, true);
  };
  f.gps_get_position = (ret: number, port: number) => {
    const g = gps(port);
    const p = g ? gpsPose(g) : null;
    dv().setFloat64(ret, p ? p.x : PROS_ERR_F, true);
    dv().setFloat64(ret + 8, p ? p.y : PROS_ERR_F, true);
  };
  f.gps_get_position_x = (port: number) => {
    const g = gps(port);
    return g ? gpsPose(g).x : PROS_ERR_F;
  };
  f.gps_get_position_y = (port: number) => {
    const g = gps(port);
    return g ? gpsPose(g).y : PROS_ERR_F;
  };
  f.gps_get_orientation = (ret: number, port: number) => {
    const g = gps(port);
    const d = dv();
    d.setFloat64(ret, g ? 0 : PROS_ERR_F, true);
    d.setFloat64(ret + 8, g ? 0 : PROS_ERR_F, true);
    d.setFloat64(ret + 16, g ? gpsPose(g).yaw : PROS_ERR_F, true);
  };
  f.gps_get_pitch = (port: number) => (gps(port) ? 0 : PROS_ERR_F);
  f.gps_get_roll = (port: number) => (gps(port) ? 0 : PROS_ERR_F);
  f.gps_get_yaw = (port: number) => {
    const g = gps(port);
    return g ? gpsPose(g).yaw : PROS_ERR_F;
  };
  f.gps_get_heading = (port: number) => {
    const g = gps(port);
    return g ? gpsPose(g).heading : PROS_ERR_F;
  };
  f.gps_get_heading_raw = f.gps_get_heading;
  f.gps_get_gyro_rate = (ret: number, port: number) => {
    const g = gps(port);
    const d = dv();
    d.setFloat64(ret, g ? 0 : PROS_ERR_F, true);
    d.setFloat64(ret + 8, g ? 0 : PROS_ERR_F, true);
    d.setFloat64(ret + 16, g ? -world.omega : PROS_ERR_F, true);
  };
  f.gps_get_gyro_rate_x = (port: number) => (gps(port) ? 0 : PROS_ERR_F);
  f.gps_get_gyro_rate_y = (port: number) => (gps(port) ? 0 : PROS_ERR_F);
  f.gps_get_gyro_rate_z = (port: number) => (gps(port) ? -world.omega : PROS_ERR_F);
  f.gps_get_accel = (ret: number, port: number) => {
    const g = gps(port);
    const [ax, ay, az] = g ? world.imuAccel() : [PROS_ERR_F, PROS_ERR_F, PROS_ERR_F];
    const d = dv();
    d.setFloat64(ret, ax, true);
    d.setFloat64(ret + 8, ay, true);
    d.setFloat64(ret + 16, az, true);
  };
  f.gps_get_accel_x = (port: number) => (gps(port) ? world.imuAccel()[0] : PROS_ERR_F);
  f.gps_get_accel_y = (port: number) => (gps(port) ? world.imuAccel()[1] : PROS_ERR_F);
  f.gps_get_accel_z = (port: number) => (gps(port) ? world.imuAccel()[2] : PROS_ERR_F);

  // ======================= Optical sensor =======================
  // What the sensor sees comes from the game on the field (world.sensors.optical): the
  // color and closeness of a Pin, Cup, Goal or Toggle face in front of it, or of what a
  // claw / intake / staging area it watches holds. Nothing in range reads as dark gray.
  type OpticalSpec = Extract<(typeof world.profile.devices)[number], { type: 'optical' }>;
  const opticalState = new Map<number, { led: number; integration: number; gestures: boolean }>();
  const optical = (port: number) => {
    if (!expectDevice(port, 'optical')) return null;
    const spec = world.profile.devices.find((d) => d.port === Math.abs(port) && d.type === 'optical') as OpticalSpec;
    let st = opticalState.get(spec.port);
    if (!st) opticalState.set(spec.port, (st = { led: 0, integration: 100, gestures: false }));
    return { spec, st };
  };
  const NOTHING: OpticalReading = { hue: 0, saturation: 0, brightness: 0.02, proximity: 0 };
  const see = (port: number): OpticalReading | null => {
    const o = optical(port);
    if (!o) return null;
    return world.sensors.optical?.(o.spec) ?? NOTHING;
  };
  const rgbOf = (r: OpticalReading): [number, number, number] => {
    // HSV -> RGB, 0-255
    const c = r.brightness * r.saturation;
    const hp = (((r.hue % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const [a, b, d] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
    const m = r.brightness - c;
    return [(a + m) * 255, (b + m) * 255, (d + m) * 255];
  };
  f.optical_get_hue = (port: number) => see(port)?.hue ?? PROS_ERR_F;
  f.optical_get_saturation = (port: number) => see(port)?.saturation ?? PROS_ERR_F;
  f.optical_get_brightness = (port: number) => see(port)?.brightness ?? PROS_ERR_F;
  f.optical_get_proximity = (port: number) => {
    const r = see(port);
    return r ? Math.round(r.proximity) : PROS_ERR;
  };
  f.optical_set_led_pwm = (port: number, value: number) => {
    const o = optical(port);
    if (!o) return PROS_ERR;
    o.st.led = Math.max(0, Math.min(100, value));
    return 1;
  };
  f.optical_get_led_pwm = (port: number) => optical(port)?.st.led ?? PROS_ERR;
  f.optical_get_rgb = (ret: number, port: number) => {
    const r = see(port);
    const [red, green, blue] = r ? rgbOf(r) : [PROS_ERR_F, PROS_ERR_F, PROS_ERR_F];
    const d = dv();
    d.setFloat64(ret, red, true);
    d.setFloat64(ret + 8, green, true);
    d.setFloat64(ret + 16, blue, true);
    d.setFloat64(ret + 24, r ? r.brightness : PROS_ERR_F, true);
  };
  f.optical_get_raw = (ret: number, port: number) => {
    const r = see(port);
    const [red, green, blue] = r ? rgbOf(r) : [0, 0, 0];
    const d = dv();
    d.setUint32(ret, r ? Math.round(r.brightness * 1023) : PROS_ERR, true);
    d.setUint32(ret + 4, r ? Math.round(red * 4) : PROS_ERR, true);
    d.setUint32(ret + 8, r ? Math.round(green * 4) : PROS_ERR, true);
    d.setUint32(ret + 12, r ? Math.round(blue * 4) : PROS_ERR, true);
  };
  // gestures are not simulated: no hand ever waves in front of the robot
  f.optical_get_gesture = (port: number) => (optical(port) ? 0 : PROS_ERR);
  f.optical_get_gesture_raw = (ret: number, port: number) => {
    const ok = !!optical(port);
    const d = dv();
    for (let i = 0; i < 12; i++) d.setUint8(ret + i, ok ? 0 : 255);
  };
  f.optical_enable_gesture = (port: number) => {
    const o = optical(port);
    if (!o) return PROS_ERR;
    o.st.gestures = true;
    return 1;
  };
  f.optical_disable_gesture = (port: number) => {
    const o = optical(port);
    if (!o) return PROS_ERR;
    o.st.gestures = false;
    return 1;
  };
  f.optical_get_integration_time = (port: number) => optical(port)?.st.integration ?? PROS_ERR_F;
  f.optical_set_integration_time = (port: number, ms: number) => {
    const o = optical(port);
    if (!o) return PROS_ERR;
    o.st.integration = Math.max(3, Math.min(712, ms));
    return 1;
  };

  // ======================= Registry =======================
  f.registry_get_plugged_type = (zeroIndexed: number) => {
    const dev = world.deviceAt(zeroIndexed + 1);
    if (dev === null) return 0;
    return DEVICE_CODE[dev === 'drive-motor' ? 'motor' : dev.type] ?? 0;
  };
  f.registry_get_bound_type = f.registry_get_plugged_type;
  f.registry_bind_port = () => 1;
  f.registry_unbind_port = () => 1;

  // ======================= ADI (3-wire) =======================
  const adiCfg = (smart: number, adi: number, type: number) => {
    world.adiConfig.set(adiKey(smart, adi), type);
    return 1;
  };
  const adiWrite = (smart: number, adi: number, value: number) => {
    const key = adiKey(smart, adi);
    const known = world.profile.devices.some((d) => d.type === 'adi_digital_out' && String(d.port).toUpperCase() === key);
    if (!known) ctx.warn(`adi:${key}`, `Code writes ADI port ${key}, but the robot profile has no digital output (piston) there.`);
    world.adiOut.set(key, !!value);
    return 1;
  };
  const adiRead = (smart: number, adi: number) => (world.adiOut.get(adiKey(smart, adi)) ? 1 : 0);
  f.ext_adi_port_set_config = (smart: number, adi: number, type: number) => adiCfg(smart, adi, type);
  f.ext_adi_port_get_config = (smart: number, adi: number) => world.adiConfig.get(adiKey(smart, adi)) ?? 0;
  f.ext_adi_port_set_value = (smart: number, adi: number, v: number) => adiWrite(smart, adi, v);
  f.ext_adi_port_get_value = (smart: number, adi: number) => adiRead(smart, adi);
  f.ext_adi_digital_write = (smart: number, adi: number, v: number) => adiWrite(smart, adi, v);
  f.ext_adi_digital_read = (smart: number, adi: number) => adiRead(smart, adi);
  f.ext_adi_digital_get_new_press = () => 0;
  f.ext_adi_analog_read = () => 0;
  f.ext_adi_analog_read_calibrated = () => 0;
  f.ext_adi_analog_calibrate = () => 0;
  f.ext_adi_pin_mode = (smart: number, adi: number, mode: number) => adiCfg(smart, adi, mode);
  f.adi_port_set_config = (adi: number, type: number) => adiCfg(22, adi, type);
  f.adi_port_get_config = (adi: number) => world.adiConfig.get(adiKey(22, adi)) ?? 0;
  f.adi_port_set_value = (adi: number, v: number) => adiWrite(22, adi, v);
  f.adi_port_get_value = (adi: number) => adiRead(22, adi);
  f.adi_digital_write = (adi: number, v: number) => adiWrite(22, adi, v);
  f.adi_digital_read = (adi: number) => adiRead(22, adi);
  f.adi_digital_get_new_press = () => 0;
  f.adi_pin_mode = (adi: number, mode: number) => adiCfg(22, adi, mode);
  f.adi_analog_read = () => 0;
  f.adi_analog_read_calibrated = () => 0;
  f.adi_analog_calibrate = () => 0;

  // ADI encoders (3-wire quadrature): not modelled yet; they read 0 without failing.
  const adiEncoders = new Map<number, number>();
  let nextEnc = 1;
  f.ext_adi_encoder_init = () => {
    const h = nextEnc++;
    adiEncoders.set(h, 0);
    return h;
  };
  f.adi_encoder_init = f.ext_adi_encoder_init;
  f.ext_adi_encoder_get = (h: number) => adiEncoders.get(h) ?? PROS_ERR;
  f.adi_encoder_get = f.ext_adi_encoder_get;
  f.ext_adi_encoder_reset = () => 1;
  f.adi_encoder_reset = () => 1;
  f.ext_adi_encoder_shutdown = () => 1;
  f.adi_encoder_shutdown = () => 1;

  // ======================= Controller / competition / battery =======================
  f.controller_is_connected = () => 1;
  f.controller_get_analog = () => 0;
  f.controller_get_digital = () => 0;
  f.controller_get_digital_new_press = () => 0;
  f.controller_get_digital_new_release = () => 0;
  f.controller_get_battery_capacity = () => 100;
  f.controller_get_battery_level = () => 100;
  f.controller_rumble = () => 1;
  f.controller_clear = () => 1;
  f.controller_clear_line = () => 1;
  f.controller_set_text = () => 1;
  f.controller_print = () => 1;
  f.competition_get_status = () => (ctx.phase() === 2 ? 0b110 : 0b101);
  f.competition_is_disabled = () => (ctx.phase() === 2 ? 0 : 1);
  f.competition_is_connected = () => 1;
  f.competition_is_autonomous = () => (ctx.phase() === 2 ? 1 : 0);
  f.competition_is_field = () => 0;
  f.competition_is_switch = () => 1;
  f.battery_get_voltage = () => 12800;
  f.battery_get_current = () => 2000;
  f.battery_get_temperature = () => 25;
  f.battery_get_capacity = () => 100;
  f.usd_is_installed = () => 0;

  // LLEMU through the C API (pros::lcd::print goes via the shim's lcd_print)
  void ctx.lcdPrint;

  for (const name of Object.keys(f)) {
    if (!/^(motor_set_|motor_tare|rotation_set_|rotation_init|rotation_reset|rotation_reverse|imu_set_data_rate|motor_get_(gearing|encoder_units|brake_mode)$)/.test(name)) continue;
    const inner = f[name];
    f[name] = (...args: never[]) => {
      quiet = true;
      try {
        return inner(...args);
      } finally {
        quiet = false;
      }
    };
  }

  return {
    fns: f,
    suspending,
    setTaskEntry(fn) {
      entryTask = fn;
    },
  };
}

function Scheduler_handle(id: number): number {
  return 0x10000 + id * 16;
}

/** Every env import name the runtime implements (for build-time classification). */
export function simulatedEnvNames(): string[] {
  const dummy = createProsApi({
    world: null as unknown as World,
    sched: null as unknown as Scheduler,
    mem: () => null as unknown as WebAssembly.Memory,
    malloc: () => 0,
    warn: () => {},
    phase: () => 0,
    lcdPrint: () => {},
  });
  return Object.keys(dummy.fns);
}
