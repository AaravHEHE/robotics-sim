#include "main.h"
#include "lemlib/api.hpp" // IWYU pragma: keep

// V5RC Override: DR4B + roller claw (LemLib).
// Robot: "Override: DR4B + roller claw". Start: Red 1 (left wall, south).
//
//  1. Roll the Preload (red half down) out into red Goal R1.
//  2. Roll in the Cup + yellow Pin standing at (-47, -47), lift it with the DR4B and roll
//     it out onto the Preload: the Cup nests over the Pin's top.
//
// setPose() puts LemLib's odometry in field coordinates (inches, origin at the center,
// +y toward the top wall, headings clockwise from +y).

pros::MotorGroup leftMotors({-1, -2, -3}, pros::MotorGearset::blue);
pros::MotorGroup rightMotors({4, 5, 6}, pros::MotorGearset::blue);
pros::Imu imu(11);
pros::MotorGroup lift({7, 8}, pros::MotorGearset::green, pros::MotorUnits::degrees);  // DR4B, 1:5
pros::Motor claw(9, pros::MotorGearset::blue);                                        // roller claw

lemlib::Drivetrain drivetrain(&leftMotors, &rightMotors, 11.5, lemlib::Omniwheel::NEW_325, 450, 2);
lemlib::ControllerSettings linearController(10, 0, 3, 3, 1, 100, 3, 500, 20);
lemlib::ControllerSettings angularController(2, 0, 10, 3, 1, 100, 3, 500, 0);
lemlib::OdomSensors sensors(nullptr, nullptr, nullptr, nullptr, &imu);
lemlib::Chassis chassis(drivetrain, linearController, angularController, sensors);

// The DR4B is geared 1:5: the bars turn a fifth of the motors.
void liftTo(double barDegrees) { lift.move_absolute(barDegrees * 5, 200); }

// Face (x, y), drive straight at it and stop `standoff` inches short, still facing it:
// a claw `standoff` inches ahead of the robot's center then sits right over the target.
void approach(double x, double y, double standoff, float maxSpeed = 100) {
  chassis.turnToPoint(x, y, 700);
  chassis.waitUntilDone();
  const lemlib::Pose p = chassis.getPose();
  const double dx = x - p.x, dy = y - p.y, d = std::hypot(dx, dy);
  chassis.moveToPoint(x - dx / d * standoff, y - dy / d * standoff, 1500, {.maxSpeed = maxSpeed});
  chassis.turnToPoint(x, y, 500);
  chassis.waitUntilDone();
}

// Spin the claw rollers in (grab) or out (let go) for a moment.
void rollClaw(int power, int ms = 300) {
  claw.move(power);
  pros::delay(ms);
  claw.brake();
}

// Push into the wall ahead at a fixed power, then back off.
void press() {
  leftMotors.move(80);
  rightMotors.move(80);
  pros::delay(450);
  leftMotors.move(-70);
  rightMotors.move(-70);
  pros::delay(250);
  leftMotors.brake();
  rightMotors.brake();
}

void initialize() {
  pros::lcd::initialize();
  chassis.calibrate();
}

void disabled() {}
void competition_initialize() {}

void autonomous() {
  chassis.setPose(-60.7, -37, 90);  // Red 1 (south) start

  // 1. Preload into R1 (-47.1, -23.5): the straight line from the start is clear. Stop 11"
  //    from its center (not touching it) with the claw (10" ahead) over it.
  approach(-47.09, -23.55, 11);
  rollClaw(-127);

  // 2. Onto the line through the diagonal stack at (-47.1, -47.1), roll it in, carry it back.
  chassis.moveToPoint(-58.86, -35.32, 1000, {.forwards = false});
  approach(-47.09, -47.09, 10, 70);
  rollClaw(127);
  liftTo(14);  // the Cup's bottom just above the Preload's collar
  approach(-47.09, -23.55, 10.7, 60);
  rollClaw(-127);
  liftTo(0);

  chassis.moveToPoint(-53.5, -38.5, 1000, {.forwards = false});
  chassis.waitUntilDone();
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
