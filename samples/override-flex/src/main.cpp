#include "main.h"

// V5RC Override: Flex, the official Hero Bot (plain PROS).
// Robot: "Override: Flex (Hero Bot) arm + claw". Start: Red 1 (left wall, south).
//
//  1. Lift the Preload clear of the 3.25" Goal and drop it (red half down) into red Goal
//     R1: 5 points for the red half.
//  2. Press the Red 1 Toggle twice with the front of the chassis (the Flex is 12" tall,
//     tall enough to reach a Toggle on top of the wall): yellow -> blue -> red. Now the
//     Preload's yellow half and the yellow Pin on neutral Goal N_R1 are Owned by red.
//
// The Flex's claw is on a single-pivot arm, so it tilts as the arm rises: past 20° it can't
// set a stack down level. That limits it to about 3" of lift: enough for the Preload over
// an empty alliance Goal, not enough to bring a Cup over the Pin standing in it.
//
// Field headings: 0° faces the top wall, clockwise positive (the GPS / LemLib convention).
// The robot starts facing 90° (into the field from the left wall); the IMU starts at 0.

pros::MotorGroup leftDrive({-1}, pros::MotorGears::green, pros::MotorUnits::degrees);
pros::MotorGroup rightDrive({2}, pros::MotorGears::green, pros::MotorUnits::degrees);
pros::Motor arm(7, pros::MotorGears::green, pros::MotorUnits::degrees);   // 1:5 to the arm
pros::Motor claw(8, pros::MotorGears::green, pros::MotorUnits::degrees);  // closed past 60°
pros::Imu imu(11);

// 4" wheels, direct drive
constexpr double IN_PER_MOTOR_DEG = 4.0 * M_PI / 360.0;
constexpr double START_HEADING = 90.0;

double fieldHeading() { return START_HEADING + imu.get_rotation(); }

// Where the robot is on the field (inches), kept up to date by drive(): a simple
// dead-reckoning odometry, good enough because turns happen in place.
double robotX = -60.7, robotY = -37;

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
    const double power = std::clamp(error * 14.0, -double(maxSpeed), double(maxSpeed));
    const double correction = (heading - imu.get_rotation()) * 2.0;
    leftDrive.move(power + correction);
    rightDrive.move(power - correction);
    pros::delay(10);
  }
  leftDrive.brake();
  rightDrive.brake();
  pros::delay(20);
  const double traveled = (leftDrive.get_position() + rightDrive.get_position()) / 2 * IN_PER_MOTOR_DEG;
  const double h = fieldHeading() * M_PI / 180;
  robotX += traveled * std::sin(h);
  robotY += traveled * std::cos(h);
}

// Turn in place to a field heading (degrees, clockwise from the top wall): a PD loop.
// The D term uses the IMU's gyro rate, so the robot eases into the target instead of
// swinging past it, and the turn ends only once the robot is on target AND has stopped.
void turnTo(double target, int maxSpeed = 127) {
  constexpr double kP = 4.0, kD = 0.3;
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
  pros::delay(20);
}


// Turn to face the field point (x, y), then drive at it and stop `standoff` inches short.
void goTo(double x, double y, double standoff, int maxSpeed = 127) {
  const double dx = x - robotX, dy = y - robotY;
  turnTo(std::atan2(dx, dy) * 180 / M_PI);
  drive(std::hypot(dx, dy) - standoff, maxSpeed);
}

// Push into whatever is ahead (a wall) at a fixed power for a moment, then back off.
void press(int ms = 800) {
  leftDrive.move(80);
  rightDrive.move(80);
  pros::delay(ms);
  leftDrive.move(-70);
  rightDrive.move(-70);
  pros::delay(250);
  leftDrive.brake();
  rightDrive.brake();
  pros::delay(100);
}

void initialize() {
  pros::lcd::initialize();
  imu.reset(true);  // blocks ~2 s while the IMU calibrates
  leftDrive.set_brake_mode_all(pros::MotorBrake::hold);
  rightDrive.set_brake_mode_all(pros::MotorBrake::hold);
  claw.move_absolute(90, 100);  // grip the Preload
}

void disabled() {}
void competition_initialize() {}

void autonomous() {
  // 1. Preload into R1 (-47.1, -23.5). First 2" out from the wall: turning in place right
  //    against it would swing a corner into it. Raise the arm to 19.8° (just under the most it can tilt
  //    and still set the Pin down level): the Pin's bottom is then 3.1" up, just over the
  //    Goal top. Then straight at R1, stopping 10.27" from the Goal's center so the claw
  //    (10.27" ahead with the arm up) is over it.
  drive(2);
  arm.move_absolute(19.8 * 5, 100);
  goTo(-47.09, -23.55, 10.27);
  claw.move_absolute(0, 100);  // open: the Pin drops into the Goal
  pros::delay(300);
  arm.move_absolute(0, 100);

  // 2. Back off, then up the lane x = -58 to the Red 1 Toggle (left wall, y = 0).
  drive(-6);
  goTo(-58, -36, 0);
  turnTo(0);
  drive(-5 - robotY);
  turnTo(270);
  // fold the arm up: the claw, low out in front, would hit the wall before the chassis
  // reaches the Toggle (straight up it is over the robot)
  arm.move_absolute(95 * 5, 100);
  pros::delay(300);
  press();  // yellow -> blue
  press();  // blue -> red
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
