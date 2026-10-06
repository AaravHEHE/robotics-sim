// PROS API details checked against the vendored headers (shim/vendor/pros/include/pros/):
// error values, task and notification semantics, mutexes, encoder counts, current limits.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../scripts/node-toolchain.ts';
import { Turn } from '../src/sim/motion.ts';
import type { FieldDef } from '../src/sim/field.ts';
import { World } from '../src/sim/world.ts';
import { prosProject, robot, simulate } from './helpers.ts';

const lines = (rec: { console: Array<{ text: string }> }) => Object.fromEntries(rec.console.map((c) => c.text.split('=')));

describe('PROS semantics', () => {
  it('motors, notifications, suspend, deleting other tasks and mutexes behave like PROS', async () => {
    const rec = await simulate(
      prosProject(`#include "main.h"
#include <climits>
pros::Motor intake(10, pros::MotorGears::blue, pros::MotorUnits::degrees);
pros::task_t initTask = nullptr;
volatile bool resumed = false;
void initialize() {
  initTask = pros::c::task_get_current();
  // a helper deletes initialize() while it waits: autonomous must still start
  pros::Task([] { pros::delay(50); pros::c::task_delete(initTask); });
  pros::delay(100000);
}
void autonomous() {
  // modify_profiled_velocity has no effect unless the motor is in a profiled move
  intake.move(0);
  intake.modify_profiled_velocity(300);
  pros::delay(200);
  printf("idle_rpm=%d\\n", (int)intake.get_actual_velocity());
  // raw counts are encoder ticks (blue cartridge: 300 per turn), not the configured degrees
  intake.tare_position();
  intake.move_absolute(360, 600);
  pros::delay(800);
  printf("raw=%d\\n", (int)intake.get_raw_position(nullptr));
  // move_relative is relative to where the motor is now
  intake.move_relative(90, 600);
  pros::delay(400);
  printf("relpos=%d\\n", (int)intake.get_position());
  // an empty port reports PROS_ERR (INT32_MAX) for its gearing, brake mode, units and type
  printf("gearing_err=%d\\n", pros::c::motor_get_gearing(15) == INT32_MAX);
  printf("type_err=%d\\n", pros::c::motor_get_type(15) == INT32_MAX);
  printf("faults_err=%d\\n", pros::c::motor_get_faults(15) == INT32_MAX);
  // NO_OWRITE keeps a pending notification and fails
  pros::task_t me = pros::c::task_get_current();
  pros::c::task_notify(me);
  printf("no_owrite=%d\\n", (int)pros::c::task_notify_ext(me, 5, pros::E_NOTIFY_ACTION_NO_OWRITE, nullptr));
  printf("pending=%u\\n", (unsigned)pros::c::task_notify_take(true, 0));
  // bit 31 set by BITS still wakes a waiting task
  pros::c::task_notify_ext(me, 0x80000000u, pros::E_NOTIFY_ACTION_BITS, nullptr);
  printf("bit31=%u\\n", (unsigned)pros::c::task_notify_take(true, 100));
  // a task that suspends itself waits until another task resumes it
  pros::Task sleeper([] { pros::c::task_suspend(nullptr); resumed = true; });
  pros::delay(50);
  printf("before_resume=%d\\n", (int)resumed);
  sleeper.resume();
  pros::delay(50);
  printf("after_resume=%d\\n", (int)resumed);
  // only the owner can give a mutex back
  static pros::Mutex lock;
  lock.take();
  bool otherGave = true;
  pros::Task([&] { otherGave = lock.give(); });
  pros::delay(20);
  printf("other_give=%d\\n", (int)otherGave);
  lock.give();
  // a current limit of 0 lets no current through: the motor doesn't turn
  intake.tare_position();
  intake.set_current_limit(0);
  intake.move(127);
  pros::delay(300);
  printf("limited=%d\\n", (int)intake.get_position());
}
`),
      'tank-6m-450',
    );
    expect(rec.error).toBeNull();
    expect(lines(rec)).toMatchObject({
      idle_rpm: '0',
      raw: '300',
      relpos: '450',
      gearing_err: '1',
      type_err: '1',
      faults_err: '1',
      no_owrite: '0',
      pending: '1',
      bit31: '2147483648',
      before_resume: '0',
      after_resume: '1',
      other_give: '0',
      limited: '0',
    });
  });

  it('an EZ-Template-style relative turn of 450° turns 450°, not 90°', async () => {
    const f = JSON.parse(await readFile(path.join(repoRoot, 'data/fields/generic-12ft.json'), 'utf8')) as FieldDef;
    const world = new World(await robot('tank-6m-450'), f, { x: 0, y: 0, theta: 0 });
    const turn = new Turn('pid_turn', () => 450, 0, { direction: 1, maxSpeed: 127, minSpeed: 0, earlyExitRange: 0, exact: true });
    world.controller = turn;
    for (let t = 0; t < 8000 && !turn.done; t++) world.step(1);
    expect(turn.done).toBe(true);
    expect(world.pose.theta).toBeCloseTo(450, 0);
  });

  it('the IMU heading is never 360', async () => {
    const f = JSON.parse(await readFile(path.join(repoRoot, 'data/fields/generic-12ft.json'), 'utf8')) as FieldDef;
    const world = new World(await robot('tank-6m-450'), f, { x: 0, y: 0, theta: 0 });
    world.pose.theta = -1e-15;
    const h = world.imuHeading({ port: 11, calibratingUntil: 0, rotationOffset: 0, headingOffset: 0, pitchOffset: 0, rollOffset: 0, yawOffset: 0 });
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });
});
