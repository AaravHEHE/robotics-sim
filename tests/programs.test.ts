// End-to-end: compile real PROS projects with the in-browser toolchain and simulate them.
import { describe, expect, it } from 'vitest';
import { build, finalPose, fixture, prosProject, simulate } from './helpers.ts';

describe('plain PROS', () => {
  it('golden: drive 24 in forward, turn 90 with the IMU, drive 24 in again', async () => {
    const rec = await simulate(
      prosProject(`#include "main.h"
pros::MotorGroup left({-1, -2, -3}, pros::MotorGears::blue);
pros::MotorGroup right({4, 5, 6}, pros::MotorGears::blue);
pros::Imu imu(11);
const double IN_PER_DEG = 3.25 * M_PI / 360.0 * (450.0 / 600.0);

void driveInches(double in) {
  left.tare_position_all(); right.tare_position_all();
  left.set_encoder_units_all(pros::MotorUnits::degrees);
  int dir = in > 0 ? 1 : -1;
  left.move(80 * dir); right.move(80 * dir);
  while (std::fabs(left.get_position() * IN_PER_DEG) < std::fabs(in)) pros::delay(10);
  left.brake(); right.brake();
  pros::delay(300);
}

void initialize() {
  imu.reset(true);
  left.set_brake_mode_all(pros::MotorBrake::hold);
  right.set_brake_mode_all(pros::MotorBrake::hold);
}
void autonomous() {
  driveInches(24);
  left.move(30); right.move(-30);
  while (imu.get_heading() < 88 || imu.get_heading() > 300) pros::delay(10);
  left.brake(); right.brake();
  pros::delay(300);
  driveInches(24);
  printf("done at %u\\n", (unsigned)pros::millis());
}
`),
      'tank-6m-450',
    );
    expect(rec.error).toBeNull();
    const p = finalPose(rec);
    // bang-bang control overshoots a little, like a real robot would
    expect(p.theta).toBeGreaterThan(88);
    expect(p.theta).toBeLessThan(105);
    expect(p.y).toBeGreaterThan(24);
    expect(p.y).toBeLessThan(30);
    expect(p.x).toBeGreaterThan(20);
    expect(p.x).toBeLessThan(32);
    expect(rec.console.some((c) => c.text.startsWith('done at'))).toBe(true);
    expect(rec.autonStart).toBe(2000); // after the 2 s blocking IMU calibration
  });

  it('tasks interleave and runs are deterministic', async () => {
    const files = prosProject(`#include "main.h"
pros::Motor intake(10, pros::MotorGears::blue);
int ticks = 0;
void initialize() {
  pros::Task counter([] { while (true) { ticks++; pros::delay(7); } });
  pros::Task spinner([] { while (true) { intake.move(ticks % 2 ? 127 : -127); pros::delay(13); } });
}
void autonomous() { pros::delay(1000); printf("ticks=%d\\n", ticks); }
`);
    const a = await simulate(files, 'tank-6m-450', { autonMs: 2000 });
    const b = await simulate(files, 'tank-6m-450', { autonMs: 2000 });
    expect(a.error).toBeNull();
    expect(a.console.map((c) => c.text)).toEqual(['ticks=143']); // 1000 ms / 7 ms, plus the t=0 tick
    expect(Array.from(a.frames)).toEqual(Array.from(b.frames));
  });

  it('reports compile errors with file and line', async () => {
    const r = await build(prosProject('#include "main.h"\nvoid autonomous() {\n  int x = ;\n}\n'));
    expect(r.ok).toBe(false);
    const e = r.diagnostics.find((d) => d.severity === 'error')!;
    expect(e.file).toBe('src/main.cpp');
    expect(e.line).toBe(3);
  });

  it('fails the build on genuinely undefined functions', async () => {
    const r = await build(prosProject('#include "main.h"\nvoid driveTo(double x);\nvoid autonomous() { driveTo(3); }\n'));
    expect(r.ok).toBe(false);
    expect(r.diagnostics.map((d) => d.message)).toContain("undefined reference to 'driveTo'");
  });

  it('warns about unsupported API and missing devices instead of crashing', async () => {
    const rec = await simulate(
      prosProject(`#include "main.h"
pros::Optical eye(3);
pros::Motor arm(15);
void autonomous() { eye.get_hue(); arm.move(50); pros::delay(100); }
`),
      'tank-6m-450',
      { autonMs: 500 },
    );
    expect(rec.error).toBeNull();
    const text = rec.events.map((e) => e.message).join('\n');
    expect(text).toMatch(/optical_get_hue\(\) is not supported/);
    expect(text).toMatch(/motor on port 15, but the robot profile has nothing/);
  });

  it('stops a task that never yields', async () => {
    const rec = await simulate(
      prosProject(`#include "main.h"
pros::Motor m(10);
void autonomous() { while (true) { m.move(10); } }
`),
      'tank-6m-450',
    );
    expect(rec.error).toMatch(/without waiting/);
  });
});

describe('LemLib 0.5 template (unmodified)', () => {
  it('runs the full example autonomous', async () => {
    const rec = await simulate(await fixture('lemlib-template'), 'lemlib-template');
    expect(rec.error).toBeNull();
    expect(rec.motions.map((m) => m.label)).toEqual(['moveToPose', 'moveToPose', 'turnToPoint', 'turnToHeading', 'follow']);
    // first motion: moveToPose(20, 15, 90)
    const first = rec.motions[0];
    const i = Math.round(first.t1! / rec.frameEveryMs) * rec.stride;
    expect(Math.hypot(rec.frames[i + 1] - 20, rec.frames[i + 2] - 15)).toBeLessThan(1);
    expect(Math.abs(rec.frames[i + 3] - 90)).toBeLessThan(3);
    expect(rec.autonEnd).not.toBeNull();
    expect(rec.lcd.length).toBeGreaterThan(0);
  });

  it('first setPose places the robot when it is not the origin', async () => {
    const files = await fixture('lemlib-template', {
      'src/main.cpp': (s) =>
        s.replace('chassis.moveToPose(20, 15, 90, 4000);', 'chassis.setPose(-48, -48, 45);\n    chassis.moveToPoint(-24, -24, 4000);\n    chassis.waitUntilDone();\n    return;\n    chassis.moveToPose(20, 15, 90, 4000);'),
    });
    const rec = await simulate(files, 'lemlib-template');
    expect(rec.error).toBeNull();
    const p = finalPose(rec);
    expect(Math.hypot(p.x + 24, p.y + 24)).toBeLessThan(1);
    expect(rec.events.some((e) => e.message.includes('Robot placed at (-48, -48)'))).toBe(true);
  });
});

describe('EZ-Template 3.2 example (selector + real exit conditions)', () => {
  const run = async (auton: string) =>
    simulate(await fixture('ez-example', { 'src/main.cpp': (s) => s.replace('ez::as::auton_selector.selected_auton_call();', `${auton}();`) }), 'ez-example');

  it('drive_example: +24, -12, -12 returns to the start', async () => {
    const rec = await run('drive_example');
    expect(rec.error).toBeNull();
    const p = finalPose(rec);
    expect(Math.abs(p.y)).toBeLessThan(0.5);
    expect(rec.console.filter((c) => /Small Exit/.test(c.text)).length).toBe(3);
  });

  it('turn_example ends facing 0 after turning 90, 45, 0', async () => {
    const rec = await run('turn_example');
    expect(rec.error).toBeNull();
    expect(Math.abs(finalPose(rec).theta)).toBeLessThan(3);
    expect(rec.console.filter((c) => /Turn: Small Exit/.test(c.text)).length).toBe(3);
  });

  it('swing_example completes every swing', async () => {
    const rec = await run('swing_example');
    expect(rec.error).toBeNull();
    expect(rec.console.filter((c) => /Swing: Small Exit/.test(c.text)).length).toBeGreaterThanOrEqual(2);
  });

  it('odom_drive_example reaches its points', async () => {
    const rec = await run('odom_drive_example');
    expect(rec.error).toBeNull();
    expect(rec.console.filter((c) => /XY: Small Exit/.test(c.text)).length).toBeGreaterThanOrEqual(2);
  });
});
