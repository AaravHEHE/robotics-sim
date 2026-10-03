#include "main.h"

// V5RC Override: Midfield pusher, Autonomous Coding Skills (60 s, plain PROS).
// Robot: "Override: Midfield pusher". Start: Red 1 (left wall, south).
//
// In Robot Skills (RSC3) a robot ending in the Midfield scores 8 points (and Owns any
// yellow Pins Placed on the center Goal). In head-to-head autonomous the Midfield does not
// count at all (SC7a): this robot is built for the end of the Match, not for auton.
//
// Field headings: 0° faces the top wall, clockwise positive (the GPS / LemLib convention).
// The robot starts facing 90° (into the field from the left wall); the IMU starts at 0.

pros::MotorGroup leftDrive({-1, -2, -3}, pros::MotorGears::blue, pros::MotorUnits::degrees);
pros::MotorGroup rightDrive({4, 5, 6}, pros::MotorGears::blue, pros::MotorUnits::degrees);
pros::Imu imu(11);

// 4" traction wheels geared 600 -> 333 rpm
constexpr double IN_PER_MOTOR_DEG = 4.0 * M_PI / 360.0 * (333.0 / 600.0);
constexpr double START_HEADING = 90.0;

double fieldHeading() { return START_HEADING + imu.get_rotation(); }

// Drive straight using motor encoders: a P loop on the remaining distance (so the robot
// slows down before the target instead of skidding past it), holding the heading with
// the IMU. Gives up after `timeoutMs` (e.g. when a wall stops the robot).
void drive(double inches, int maxSpeed = 127, int timeoutMs = 2500) {
  leftDrive.tare_position_all();
  rightDrive.tare_position_all();
  const double heading = imu.get_rotation();
  const std::uint32_t end = pros::millis() + timeoutMs;
  int settled = 0;
  while (pros::millis() < end && settled < 3) {
    const double traveled = (leftDrive.get_position() + rightDrive.get_position()) / 2 * IN_PER_MOTOR_DEG;
    const double error = inches - traveled;
    settled = std::fabs(error) < 0.5 ? settled + 1 : 0;
    const double power = std::clamp(error * 8.0, -double(maxSpeed), double(maxSpeed));
    const double correction = (heading - imu.get_rotation()) * 2.0;
    leftDrive.move(power + correction);
    rightDrive.move(power - correction);
    pros::delay(10);
  }
  leftDrive.brake();
  rightDrive.brake();
  pros::delay(100);
}

// Turn in place to a field heading (degrees, clockwise from the top wall): a P loop that
// waits until the robot has settled on the target.
void turnTo(double target, int maxSpeed = 127) {
  const std::uint32_t end = pros::millis() + 2000;
  int settled = 0;
  while (pros::millis() < end && settled < 3) {
    const double error = std::remainder(target - fieldHeading(), 360.0);
    settled = std::fabs(error) < 1.5 ? settled + 1 : 0;
    const double power = std::clamp(error * 2.5, -double(maxSpeed), double(maxSpeed));
    leftDrive.move(power);
    rightDrive.move(-power);
    pros::delay(10);
  }
  leftDrive.brake();
  rightDrive.brake();
  pros::delay(100);
}


void initialize() {
  pros::lcd::initialize();
  imu.reset(true);  // blocks ~2 s while the IMU calibrates
  leftDrive.set_brake_mode_all(pros::MotorBrake::hold);
  rightDrive.set_brake_mode_all(pros::MotorBrake::hold);
}

void disabled() {}
void competition_initialize() {}

void autonomous() {
  // Along y = -37 (clear of Goal R1 above and the diagonal stack below), then
  // diagonally into the Midfield, nose first: any part of the robot inside counts.
  drive(26);
  turnTo(45);
  drive(28);
  printf("Parked at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
