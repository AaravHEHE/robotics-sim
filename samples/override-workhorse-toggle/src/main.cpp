#include "main.h"

// V5RC Override: the 4-bar "workhorse" (EZ-Template).
// Robot: "Override: 4-bar + piston claw + Toggle bumper". Start: Red 1 (left wall, south).
//
//  1. Drop the Preload (red half down) into red Goal R1.
//  2. Pick up the Cup + yellow Pin standing at (-47, -47) and stack it on the Preload.
//  3. Press the Red 1 Toggle twice with the front bumper: yellow -> blue -> red. Now every
//     visible yellow half in Red 1 is Owned by red: the stacked yellow Pin and the yellow
//     Pin that starts on neutral Goal N_R1.
//
// Positions are field coordinates in inches (origin at the center, +y toward the top wall);
// odom_xyt_set() tells EZ-Template where the robot starts.

ez::Drive chassis(
    {-1, -2, -3},  // left drive ports (negative = reversed)
    {4, 5, 6},     // right drive ports
    11,            // IMU port
    3.25,          // wheel diameter
    450);          // wheel rpm (600 rpm motors geared 36:48)

pros::Motor lift(7, pros::MotorGears::green, pros::MotorUnits::degrees);  // 4-bar, 1:5
pros::adi::Pneumatics claw('A', true);                                    // extended = closed, holding the Preload

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

  // 1. Preload into R1 (-47.1, -23.5), approached on the diagonal so nothing is in the way.
  //    Stop 11" short of the Goal's center (not touching it: pushing into it would make the
  //    wheels slip and the odometry drift) and reach over it with the bar raised a little.
  liftTo(5);
  chassis.pid_turn_set(45_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{-54.87_in, -31.33_in}, fwd, DRIVE_SPEED});
  chassis.pid_wait();
  claw.retract();  // let go: the Pin drops into the Goal
  pros::delay(150);
  liftTo(0);

  // 2. Back onto the line through the diagonal stack at (-47.1, -47.1), then grab it.
  chassis.pid_odom_set({{-58.9_in, -35.3_in}, rev, DRIVE_SPEED});
  chassis.pid_wait();
  chassis.pid_turn_set(135_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{-54.2_in, -40.0_in}, fwd, 70});
  chassis.pid_wait();
  claw.extend();  // closes around the Cup (and the Pin standing in it)
  pros::delay(150);

  // Lift a little and stack it on the Preload: the Cup nests over the Pin's top.
  liftTo(15);
  chassis.pid_turn_set(23_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{-51.5_in, -33.85_in}, fwd, 60});
  chassis.pid_wait();
  claw.retract();
  pros::delay(200);
  liftTo(0);

  // 3. Over to the Red 1 Toggle on the left wall (centered on y = 0).
  chassis.pid_odom_set({{-53.5_in, -38.5_in}, rev, DRIVE_SPEED});
  chassis.pid_wait();
  chassis.pid_turn_set(270_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{-58.5_in, -38.5_in}, fwd, DRIVE_SPEED});
  chassis.pid_wait();
  chassis.pid_turn_set(0_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{-58.5_in, -5_in}, fwd, DRIVE_SPEED});
  chassis.pid_wait();
  chassis.pid_turn_set(270_deg, TURN_SPEED);
  chassis.pid_wait();

  // Two presses with the bumper. The wall stops the robot, so these use plain power for a
  // set time rather than a PID drive (which would never reach its target).
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
