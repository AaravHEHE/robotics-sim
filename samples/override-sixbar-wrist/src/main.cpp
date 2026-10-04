#include "main.h"

// V5RC Override: 6-bar + wrist claw (EZ-Template).
// Robot: "Override: 6-bar + wrist claw". Start: Red 1 (left wall, south).
//
//  1. The Preload starts in the claw yellow end down. Turn the wrist over so the red end
//     is down (the claw now holds the Pin by its top end), raise the 6-bar so the Pin's
//     bottom clears the Goal, and drop it into red Goal R1: red half visible, 5 points.
//  2. Press the Red 1 Toggle twice with the front of the chassis (13" tall, so it reaches a
//     Toggle on top of the wall): yellow -> blue -> red. Now the Preload's yellow half and
//     the yellow Pin on neutral Goal N_R1 are Owned by red.
//
// Positions are field coordinates in inches; odom_xyt_set() tells EZ-Template where the
// robot starts.

ez::Drive chassis(
    {-1, -2, -3},  // left drive ports (negative = reversed)
    {4, 5, 6},     // right drive ports
    11,            // IMU port
    3.25,          // wheel diameter
    450);          // wheel rpm (600 rpm motors geared 36:48)

pros::Motor sixBar(7, pros::MotorGears::green, pros::MotorUnits::degrees);  // 1:5
pros::Motor wrist(8, pros::MotorGears::green, pros::MotorUnits::degrees);   // 1:2
pros::adi::Pneumatics claw('A', true);                                      // extended = closed

const int DRIVE_SPEED = 110;
const int TURN_SPEED = 90;

void liftTo(double barDegrees) { sixBar.move_absolute(barDegrees * 5, 200); }
void wristTo(double degrees) { wrist.move_absolute(degrees * 2, 200); }

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

  // 1. Flip the Preload red end down and raise it while turning toward R1 (-47.1, -23.5).
  wristTo(180);
  liftTo(10);  // the flipped Pin hangs ~3.5" below the claw: just clear of the Goal
  // 2" out from the wall first: turning in place right against it would swing a corner into it
  chassis.pid_drive_set(2_in, DRIVE_SPEED);
  chassis.pid_wait();
  chassis.pid_turn_set(40.8_deg, TURN_SPEED);  // straight at R1 from (-58.7, -37)
  chassis.pid_wait();
  // stop 11.1" from the Goal's center: the slightly raised claw reaches ~10.6" ahead
  chassis.pid_odom_set({{-54.35_in, -31.95_in}, fwd, DRIVE_SPEED});
  chassis.pid_wait();
  claw.retract();  // the Pin drops into the Goal
  pros::delay(200);
  liftTo(0);

  // 2. Up the lane x = -58.5 (between the wall-group Cups and R1) to the Red 1 Toggle.
  chassis.pid_odom_set({{-58.5_in, -35.0_in}, rev, DRIVE_SPEED});
  chassis.pid_wait();
  chassis.pid_turn_set(0_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{-58.5_in, -5_in}, fwd, DRIVE_SPEED});
  chassis.pid_wait();
  chassis.pid_turn_set(270_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.drive_mode_set(ez::DISABLE);
  for (int i = 0; i < 2; i++) {
    chassis.drive_set(80, 80);  // the wall stops the robot: plain power, not a PID drive
    pros::delay(600);
    chassis.drive_set(-60, -60);
    pros::delay(250);
  }
  chassis.drive_set(0, 0);
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
