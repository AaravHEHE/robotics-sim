#include "main.h"

// V5RC Override: ACE (EZ-Template). Robot: "Override: ACE". Start: Red 2 (bottom wall, west).
//
// ACE has no intake: its lobster claw rides a chain bar on a cascade, and clamps standing
// stacks (a Cup with a Pin in it) straight off the floor. The chain bar keeps the claw level
// as it swings, and the cascade sets the height.
//
//  1. Drop the Preload (red half down) into red Goal R2.
//  2. Clamp the Cup + yellow Pin at (-47, -47) off the floor and set it on the Preload.
//  3. Clamp the Cup + yellow Pin at (-23.5, -23.5), raise the cascade and set it on top:
//     a 3-Pin stack.
//  4. Ram the Red 2 Toggle fast with the "finger": two faces, yellow -> red, so red Owns
//     every visible yellow half in Red 2 (including the Pin on neutral Goal N_R2).
//
// Positions are field coordinates in inches; odom_xyt_set() tells EZ-Template where the
// robot starts. Headings are clockwise from +y (toward the blue wall).

ez::Drive chassis(
    {-1, -2, -3},  // left drive ports (negative = reversed)
    {4, 5, 6},     // right drive ports
    11,            // IMU port
    3.25,          // wheel diameter
    450);          // wheel rpm (600 rpm motors geared 36:48)

pros::MotorGroup cascade({7, 8}, pros::MotorGears::blue, pros::MotorUnits::degrees);  // 1:3 to the spool
pros::Motor chainBar(9, pros::MotorGears::green, pros::MotorUnits::degrees);           // 1:3
pros::adi::Pneumatics claw('A', true);                                                 // extended = closed

const int DRIVE_SPEED = 120;
const int TURN_SPEED = 110;

// Red Goal R2.
const double R2_X = -23.55, R2_Y = -47.09;

// Chain bar: 0 = straight out front (the claw 11" ahead, 6" up), -25 = down at the floor
// (9.97" ahead, 1.35" up: around a standing Cup's waist).
void chainBarTo(double deg) { chainBar.move_absolute(deg * 3, 200); }
// Cascade: spool degrees (each 100 deg raises the carriage ~3.6").
void cascadeTo(double spoolDeg) { cascade.move_absolute(spoolDeg * 3, 600); }

// Turn to face (x, y), then drive straight at it and stop `standoff` inches short.
void approach(double x, double y, double standoff, int speed = DRIVE_SPEED) {
  const double px = chassis.odom_x_get(), py = chassis.odom_y_get();
  const double dx = x - px, dy = y - py, d = std::hypot(dx, dy);
  chassis.pid_turn_set(std::atan2(dx, dy) * 180 / M_PI, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{(x - dx / d * standoff) * okapi::inch, (y - dy / d * standoff) * okapi::inch}, fwd, speed});
  chassis.pid_wait();
}

// Back straight up `inches`.
void backOff(double inches) {
  chassis.pid_drive_set(-inches * okapi::inch, DRIVE_SPEED);
  chassis.pid_wait();
}

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
  cascade.set_brake_mode_all(pros::MotorBrake::hold);
  chainBar.set_brake_mode(pros::MotorBrake::hold);
  chainBarTo(0);  // hold the claw up level with the Preload: unpowered, the chain bar sags
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
  chassis.odom_xyt_set(-37_in, -60.7_in, 0_deg);  // Red 2 (west) start
  chassis.drive_brake_set(MOTOR_BRAKE_HOLD);

  // 3" out from the wall first: turning in place right against it swings a corner into it
  backOff(-3);

  // 1. Preload into R2: the claw holds it 11" ahead, its bottom just above the Goal.
  approach(R2_X, R2_Y, 11);
  claw.retract();
  pros::delay(150);

  // 2. Claw down at the floor, open, around the stack at (-47, -47); clamp, carry it back.
  backOff(6);
  chainBarTo(-25);
  approach(-47.09, -47.09, 9.97);
  claw.extend();
  pros::delay(150);
  chainBarTo(0);
  backOff(6);
  approach(R2_X, R2_Y, 11);
  claw.retract();
  pros::delay(150);

  // 3. The stack at (-23.5, -23.5), north of R2: up the lane west of R2 first (a straight
  //    line would clip it), then up one Pin with the cascade to set it on top.
  backOff(6);
  chainBarTo(-25);
  approach(-36, -38, 0);
  approach(-23.55, -23.55, 9.97);
  claw.extend();
  pros::delay(150);
  chainBarTo(0);
  cascadeTo(170);
  backOff(6);
  approach(R2_X, R2_Y, 11);
  claw.retract();
  pros::delay(150);

  // 4. Over to the Red 2 Toggle (bottom wall, x = 0) and hit it at full speed: two faces.
  backOff(6);
  cascadeTo(0);
  approach(-4, -36, 0);  // along y = -35, clear of R2 and of the stack at (0, -23.5)
  chassis.pid_turn_set(180_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.drive_mode_set(ez::DISABLE);
  chassis.drive_set(127, 127);  // the wall stops the robot: plain power, not a PID drive
  pros::delay(600);
  chassis.drive_set(-60, -60);
  pros::delay(250);
  chassis.drive_set(0, 0);
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
