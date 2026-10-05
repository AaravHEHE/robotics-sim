#include "main.h"
#include "lemlib/api.hpp" // IWYU pragma: keep

// V5RC Override: Claw Gate (LemLib). Robot: "Override: Claw Gate". Start: Red 1 (left wall, south).
//
// The funnel intake drives a standing stack (a Cup with a Pin in it) up into the claw while
// the chain bar holds it down in front; the claw clamps it, and the chain bar swings it up
// level. The cascade sets the height for taller Goals.
//
//  1. Drop the Preload (red half down) into red Goal R1.
//  2. Intake the Cup + yellow Pin at (-47, -47) into the claw and set it on the Preload.
//  3. Intake the Cup + yellow Pin at (-23.5, -23.5) and carry it up the field.
//  4. Ram the Red 1 Toggle fast: two faces, yellow -> red, so red Owns every visible yellow
//     half in Red 1.
//  5. Raise the cascade and set the stack on neutral Goal N_R1, onto its yellow Pin.
//
// setPose() puts LemLib's odometry in field coordinates (inches, origin at the center,
// +y toward the top wall, headings clockwise from +y).

pros::MotorGroup leftMotors({-1, -2, -3}, pros::MotorGearset::blue);
pros::MotorGroup rightMotors({4, 5, 6}, pros::MotorGearset::blue);
pros::Imu imu(11);
pros::MotorGroup cascade({7, 8}, pros::MotorGearset::blue, pros::MotorUnits::degrees);  // 1:3 to the spool
pros::Motor chainBar(9, pros::MotorGearset::green, pros::MotorUnits::degrees);           // 1:3
pros::Motor intake(10, pros::MotorGearset::blue);
pros::adi::Pneumatics claw('A', true);  // extended = closed, holding the Preload

lemlib::Drivetrain drivetrain(&leftMotors, &rightMotors, 11.5, lemlib::Omniwheel::NEW_325, 450, 2);
lemlib::ControllerSettings linearController(10, 0, 3, 3, 1, 100, 3, 500, 20);
lemlib::ControllerSettings angularController(2, 0, 10, 3, 1, 100, 3, 500, 0);
lemlib::OdomSensors sensors(nullptr, nullptr, nullptr, nullptr, &imu);
lemlib::Chassis chassis(drivetrain, linearController, angularController, sensors);

constexpr double R1_X = -47.09, R1_Y = -23.55;    // red Goal R1
constexpr double NR1_X = -47.09, NR1_Y = 23.55;   // neutral Goal N_R1 (2.5" taller)

// Chain bar: 0 = straight out front (the claw 11" ahead, 6" up), -25 = down in front of
// the intake where it takes stacks, 90 = straight up (out of the way).
void chainBarTo(double deg) { chainBar.move_absolute(deg * 3, 200); }
// Cascade: spool degrees (each 100 deg raises the carriage ~3.6").
void cascadeTo(double spoolDeg) { cascade.move_absolute(spoolDeg * 3, 600); }

// Face (x, y), drive straight at it and stop `standoff` inches short, still facing it.
void approach(double x, double y, double standoff, float maxSpeed = 127) {
  chassis.turnToPoint(x, y, 700);
  chassis.waitUntilDone();
  const lemlib::Pose p = chassis.getPose();
  const double dx = x - p.x, dy = y - p.y, d = std::hypot(dx, dy);
  chassis.moveToPoint(x - dx / d * standoff, y - dy / d * standoff, 1500, {.maxSpeed = maxSpeed});
  chassis.waitUntilDone();
}

// Back straight away from whatever is ahead.
void backOff(double inches) {
  const lemlib::Pose p = chassis.getPose();
  const double h = p.theta * M_PI / 180;
  chassis.moveToPoint(p.x - std::sin(h) * inches, p.y - std::cos(h) * inches, 800, {.forwards = false});
  chassis.waitUntilDone();
}

// Intake the stack at (x, y) into the lowered claw and clamp it.
void intakeStack(double x, double y) {
  chainBarTo(-25);
  claw.retract();
  intake.move(127);
  approach(x, y, 9.5, 90);
  pros::delay(350);  // up the funnel into the claw
  claw.extend();
  intake.brake();
}

void initialize() {
  pros::lcd::initialize();
  cascade.set_brake_mode_all(pros::MotorBrake::hold);
  chainBar.set_brake_mode(pros::MotorBrake::hold);
  chainBarTo(0);  // hold the claw up level with the Preload: unpowered, the chain bar sags
  chassis.calibrate();
}

void disabled() {}
void competition_initialize() {}

void autonomous() {
  chassis.setPose(-60.7, -37, 90);  // Red 1 (south) start
  // 3" out from the wall first: turning in place right against it swings a corner into it
  chassis.moveToPoint(-57.7, -37, 600);

  // 1. Preload into R1: the claw holds it 11" ahead, its bottom just above the Goal.
  approach(R1_X, R1_Y, 11);
  claw.retract();
  pros::delay(150);

  // 2. The stack at (-47, -47), onto the Preload.
  backOff(6);
  intakeStack(-47.09, -47.09);
  chainBarTo(0);
  backOff(4);
  approach(R1_X, R1_Y, 11);
  claw.retract();
  pros::delay(150);

  // 3. The stack at (-23.5, -23.5), carried with the chain bar up out of the way. Round
  //    the south side of R1 first: the straight line from here clips it.
  backOff(6);
  approach(-40, -40, 0);
  intakeStack(-23.55, -23.55);
  chainBarTo(90);

  // 4. Up the field to the Red 1 Toggle and hit it at full speed.
  approach(-40, -2, 0);
  chassis.turnToHeading(270, 700);
  chassis.waitUntilDone();
  leftMotors.move(127);
  rightMotors.move(127);
  pros::delay(600);
  leftMotors.brake();
  rightMotors.brake();

  // 5. Back out, raise the stack and set it on N_R1's yellow Pin.
  chassis.moveToPoint(-53, -2, 800, {.forwards = false});
  chainBarTo(0);
  cascadeTo(60);
  approach(NR1_X, NR1_Y, 11);
  claw.retract();
  pros::delay(150);
  backOff(4);
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
