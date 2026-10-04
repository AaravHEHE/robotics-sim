#include "main.h"

// V5RC Override: the 4-bar "workhorse" (EZ-Template).
// Robot: "Override: 4-bar + rear piston claw + front Toggle bumper". Start: Red 1 (left wall,
// south). The claw is on the back of the robot and the Toggle bumper on the front, so it
// scores reversing into Goals and presses Toggles driving forward:
//  1. Back up to red Goal R1 and drop the Preload (red half down) in.
//  2. Back onto the Cup + yellow Pin standing at (-47, -47), grab it, and stack it on the
//     Preload.
//  3. Press the Red 1 Toggle twice with the front bumper: yellow -> blue -> red. Now every
//     visible yellow half in Red 1 is Owned by red: the stacked yellow Pin and the yellow
//     Pin that starts on neutral Goal N_R1.
//
// Turning in place sweeps the robot's corners 10.6" around its center, so it only turns
// where that circle is clear of the Goals and the diagonal stack.
//
// Positions are field coordinates in inches (origin at the center, +y toward the top wall);
// odom_xyt_set() tells EZ-Template where the robot starts.

ez::Drive chassis(
    {-1, -2, -3},  // left drive ports (negative = reversed)
    {4, 5, 6},     // right drive ports
    11,            // IMU port
    3.25,          // wheel diameter
    450);          // wheel rpm (600 rpm motors geared 36:48)

pros::Motor lift(7, pros::MotorGears::green, pros::MotorUnits::degrees);  // 4-bar, 1:5, reaching out the back
pros::adi::Pneumatics claw('A', true);  // extended = closed, holding the Preload

const int DRIVE_SPEED = 110;
const int TURN_SPEED = 90;

// The 4-bar is geared 1:5, so the bar turns a fifth of the motor.
void liftTo(double barDegrees) { lift.move_absolute(barDegrees * 5, 200); }

void default_constants() {
  chassis.pid_drive_constants_set(20.0, 0.0, 100.0);
  chassis.pid_heading_constants_set(11.0, 0.0, 20.0);
  chassis.pid_turn_constants_set(3.0, 0.05, 20.0, 15.0);
  chassis.pid_swing_constants_set(6.0, 0.0, 65.0);
  chassis.pid_odom_angular_constants_set(6.5, 0.0, 52.5);
  chassis.pid_odom_boomerang_constants_set(5.8, 0.0, 32.5);
  chassis.pid_turn_exit_condition_set(90_ms, 3_deg, 250_ms, 7_deg, 500_ms, 500_ms);
  chassis.pid_drive_exit_condition_set(90_ms, 1_in, 250_ms, 3_in, 500_ms, 500_ms);
  chassis.pid_odom_turn_exit_condition_set(90_ms, 3_deg, 250_ms, 7_deg, 500_ms, 750_ms);
  chassis.pid_odom_drive_exit_condition_set(90_ms, 1_in, 250_ms, 3_in, 500_ms, 750_ms);
  chassis.slew_drive_constants_set(3_in, 70);
  chassis.odom_look_ahead_set(7_in);
  chassis.pid_angle_behavior_set(ez::shortest);
}

void initialize() {
  pros::delay(500);
  default_constants();
  chassis.initialize();
}

void disabled() {}
void competition_initialize() {}

void autonomous() {
  chassis.pid_targets_reset();
  chassis.drive_imu_reset();
  chassis.drive_sensor_reset();
  chassis.odom_xyt_set(-60.7_in, -37_in, 90_deg);  // Red 1 (south) start
  chassis.drive_brake_set(MOTOR_BRAKE_HOLD);

  // 1. Preload into R1 (-47.1, -23.5). Out along y = -37 to a spot on R1's diagonal, turn
  //    the back toward R1 and reverse until the claw (11.5" behind, bar raised a little)
  //    is over it, without touching it.
  liftTo(5);
  chassis.pid_odom_set({{-33.64_in, -37_in}, fwd, DRIVE_SPEED});
  chassis.pid_wait();
  chassis.pid_turn_set(135_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{-38.96_in, -31.68_in}, rev, 70});
  chassis.pid_wait();
  claw.retract();  // let go: the Pin drops into the Goal
  pros::delay(200);
  liftTo(0);
  chassis.pid_odom_set({{-33.64_in, -37_in}, fwd, DRIVE_SPEED});  // straight back out
  chassis.pid_wait();

  // 2. Across to the line through the diagonal stack at (-47.1, -47.1), turn the back
  //    toward it, and reverse onto it. (Face each waypoint before driving to it.)
  chassis.pid_turn_set(274.3_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{-59.11_in, -35.07_in}, fwd, DRIVE_SPEED});
  chassis.pid_wait();
  chassis.pid_turn_set(315_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{-54.87_in, -39.31_in}, rev, 60});
  chassis.pid_wait();
  claw.extend();  // closes around the Cup (and the Pin standing in it)
  pros::delay(200);

  // Raise it and stack it on the Preload, reversing into R1 along its other diagonal: the
  // Cup nests over the Pin's top. The raised bar reaches a little further back (12.5").
  liftTo(22);
  chassis.pid_turn_set(321.6_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{-58.4_in, -34.86_in}, fwd, DRIVE_SPEED});
  chassis.pid_wait();
  chassis.pid_turn_set(225_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{-55.93_in, -32.39_in}, rev, 60});
  chassis.pid_wait();
  pros::delay(200);
  claw.retract();
  pros::delay(200);
  chassis.pid_odom_set({{-58.4_in, -34.86_in}, fwd, DRIVE_SPEED});
  chassis.pid_wait();
  liftTo(0);

  // 3. Up the lane x = -58.5 to the Red 1 Toggle on the left wall (centered on y = 0).
  chassis.pid_turn_set(0_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{-58.5_in, -5_in}, fwd, DRIVE_SPEED});
  chassis.pid_wait();
  chassis.pid_turn_set(270_deg, TURN_SPEED);
  chassis.pid_wait();

  // Two presses with the front bumper. The wall stops the robot, so these use plain power
  // for a set time rather than a PID drive (which would never reach its target).
  chassis.drive_mode_set(ez::DISABLE);
  for (int i = 0; i < 2; i++) {
    chassis.drive_set(70, 70);
    pros::delay(450);
    chassis.drive_set(-60, -60);
    pros::delay(250);
  }
  chassis.drive_set(0, 0);
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
