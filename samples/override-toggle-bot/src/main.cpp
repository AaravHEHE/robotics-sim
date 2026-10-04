#include "main.h"

// V5RC Override: Toggle control bot (plain PROS, no motion library).
// Robot: "Override: Toggle control bot". Start: Red 1 (left wall, south), facing the field.
//
// Neutral Goals N_R1 and N_R2 start the Match with a yellow Pin Placed. A yellow Pin in a
// Quadrant is Owned by the color its Toggle is set to, so turning both red-side Toggles
// red is worth 2 x 20 points without touching a single Pin.
//
// Every Toggle starts yellow-in with the alliance color facing out of the field. The
// front roller spins the top of a Toggle into the field, bringing the red face in; an
// optical sensor beside it says when red has come around.
//
// The robot also has a C-channel jammer (ADI C) that wedges a Toggle so the other
// alliance can't turn it back. It is for the end of driver control: a Toggle a robot is
// still touching when the Match ends counts as neutral, so jam it, then let go just before
// the buzzer. This 15 s routine needs all its time for the two Toggles, so it leaves the
// jammer in.

pros::MotorGroup leftDrive({-1, -2, -3}, pros::MotorGears::blue, pros::MotorUnits::degrees);
pros::MotorGroup rightDrive({4, 5, 6}, pros::MotorGears::blue, pros::MotorUnits::degrees);
pros::Motor toggleRoller(8, pros::MotorGears::green);
pros::Optical toggleEye(9);  // looks at the Toggle face in front of the roller
pros::adi::Pneumatics plate('B', false);
pros::adi::Pneumatics jammer('C', false);  // retracted: not touching anything
pros::Imu imu(11);

// 3.25" wheels geared 36:48 (450 rpm from 600 rpm motors)
constexpr double IN_PER_MOTOR_DEG = 3.25 * M_PI / 360.0 * (450.0 / 600.0);
// Field headings: 0° faces the top wall, clockwise positive (the GPS / LemLib convention).
// The robot starts facing 90° (into the field from the left wall); the IMU starts at 0.
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

// Turn in place to a field heading (degrees, clockwise from the top wall): a PD loop.
// The D term uses the IMU's gyro rate, so the robot eases into the target instead of
// swinging past it, and the turn ends only once the robot is on target AND has stopped.
void turnTo(double target, int maxSpeed = 127) {
  constexpr double kP = 2.5, kD = 0.2;
  const std::uint32_t end = pros::millis() + 2000;
  while (pros::millis() < end) {
    const double error = std::remainder(target - fieldHeading(), 360.0);
    const double rate = -imu.get_gyro_rate().z;  // deg/s, clockwise positive like the heading
    if (std::fabs(error) < 1.0 && std::fabs(rate) < 5.0) break;
    const double power = std::clamp(error * kP - rate * kD, -double(maxSpeed), double(maxSpeed));
    leftDrive.move(power);
    rightDrive.move(-power);
    pros::delay(10);
  }
  leftDrive.brake();
  rightDrive.brake();
  pros::delay(100);
}

// Is the optical sensor looking at something red? (Red hues wrap around 0°.)
bool seesRed() {
  const double hue = toggleEye.get_hue();
  return toggleEye.get_proximity() > 50 && toggleEye.get_saturation() > 0.5 && (hue < 20 || hue > 340);
}

// Spin the roller against a Toggle until the optical sensor sees the red face come
// over, then stop: the Toggle settles onto that face. Gives up after a second.
void rollToggleIn() {
  const std::uint32_t end = pros::millis() + 1000;
  toggleRoller.move(127);
  while (!seesRed() && pros::millis() < end) pros::delay(5);
  toggleRoller.brake();
  pros::delay(150);
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
  // Red 1 Toggle: left wall, centered on y = 0. Lane x = -58.5 clears the wall-group Cups and Goal R1.
  drive(2.2);
  turnTo(0);
  drive(37);          // up to y = 0
  turnTo(270);
  drive(8, 60, 500);       // roller against the Toggle (the wall stops the robot)
  rollToggleIn();     // yellow -> red
  drive(-5);          // back off (a touched Toggle counts as neutral) to the middle of the lane

  // Red 2 Toggle: bottom wall, centered on x = 0. Around Goal R2 and along the bottom wall.
  turnTo(180);
  drive(37);          // back to y = -37
  turnTo(90);
  drive(22);          // x = -36
  turnTo(180);
  drive(22);          // y = -59
  turnTo(90);
  drive(36);          // x = 0
  turnTo(180);
  drive(8, 60, 500);
  rollToggleIn();
  drive(-5);
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
