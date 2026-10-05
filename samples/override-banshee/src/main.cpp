#include "main.h"
#include "lemlib/api.hpp" // IWYU pragma: keep

// V5RC Override: Banshee (LemLib). Robot: "Override: Banshee". Start: Red 1 (left wall, south).
//
// The Banshee's floor intake brings a whole standing stack (a Cup with a Pin in it) up to
// the roller claw, which waits folded back over the intake. The arm then swings forward and
// up, with the geared wrist keeping the claw upright, and the rollers spit the stack out
// onto the Goal: the Cup nests over the Pin already there.
//
//  1. Roll the Preload (red half down) into red Goal R1.
//  2. Intake the Cup + yellow Pin at (-47, -47) and stack it on the Preload.
//  3. Intake the Cup + yellow Pin at (-23.5, -23.5) and stack it on top: a 3-Pin stack.
//  4. Ram the Red 1 Toggle fast: the bumper flips it two faces, yellow -> red, so red Owns
//     every visible yellow half in Red 1 (including the Pin on neutral Goal N_R1).
//
// setPose() puts LemLib's odometry in field coordinates (inches, origin at the center,
// +y toward the top wall, headings clockwise from +y).

pros::MotorGroup leftMotors({-1, -2, -3}, pros::MotorGearset::blue);
pros::MotorGroup rightMotors({4, 5, 6}, pros::MotorGearset::blue);
pros::Imu imu(11);
pros::Motor arm(7, pros::MotorGearset::green, pros::MotorUnits::degrees);    // 1:5 to the arm
pros::Motor wrist(8, pros::MotorGearset::green, pros::MotorUnits::degrees);  // 12:48 to the claw
pros::Motor rollers(9, pros::MotorGearset::green);                           // roller claw
pros::Motor intake(10, pros::MotorGearset::green);

lemlib::Drivetrain drivetrain(&leftMotors, &rightMotors, 11.5, lemlib::Omniwheel::NEW_325, 450, 2);
lemlib::ControllerSettings linearController(10, 0, 3, 3, 1, 100, 3, 500, 20);
lemlib::ControllerSettings angularController(2, 0, 10, 3, 1, 100, 3, 500, 0);
lemlib::OdomSensors sensors(nullptr, nullptr, nullptr, nullptr, &imu);
lemlib::Chassis chassis(drivetrain, linearController, angularController, sensors);

// Red Goal R1 and the two stacks this auton builds onto it.
constexpr double R1_X = -47.09, R1_Y = -23.55;

// Arm angles (degrees from folded back over the intake): the claw takes stacks from the
// intake at 0; at 25 it sets a Pin into an empty Goal, at 38 a Cup onto a 1-Pin stack,
// at 65 a Cup onto a 2-Pin stack. Each places the claw about 10" ahead of the robot center.
constexpr double FOLDED = 0, ONE_PIN = 25, ON_ONE = 38, ON_TWO = 65;

// The claw turns with the arm, so the wrist turns back by the same angle to keep it upright.
void armTo(double deg) {
  arm.move_absolute(deg * 5, 200);
  wrist.move_absolute(-deg * 4, 200);
}

// Face (x, y), drive straight at it and stop `standoff` inches short, still facing it.
void approach(double x, double y, double standoff, float maxSpeed = 127) {
  chassis.turnToPoint(x, y, 700);
  chassis.waitUntilDone();
  const lemlib::Pose p = chassis.getPose();
  const double dx = x - p.x, dy = y - p.y, d = std::hypot(dx, dy);
  chassis.moveToPoint(x - dx / d * standoff, y - dy / d * standoff, 1500, {.maxSpeed = maxSpeed});
  chassis.waitUntilDone();
}

// Back straight away from whatever is ahead, far enough to turn freely.
void backOff(double inches) {
  const lemlib::Pose p = chassis.getPose();
  const double h = p.theta * M_PI / 180;
  chassis.moveToPoint(p.x - std::sin(h) * inches, p.y - std::cos(h) * inches, 800, {.forwards = false});
  chassis.waitUntilDone();
}

// Spit what the roller claw holds out of its mouth: the bottom piece first.
void rollOut(int ms) {
  rollers.move(-127);
  pros::delay(ms);
  rollers.brake();
}

void initialize() {
  pros::lcd::initialize();
  chassis.calibrate();
  arm.set_brake_mode(pros::MotorBrake::hold);
  wrist.set_brake_mode(pros::MotorBrake::hold);
}

void disabled() {}
void competition_initialize() {}

void autonomous() {
  chassis.setPose(-60.7, -37, 90);  // Red 1 (south) start
  // 3" out from the wall first: turning in place right against it swings a corner into it
  chassis.moveToPoint(-57.7, -37, 600);

  // 1. Preload into R1.
  armTo(ONE_PIN);
  approach(R1_X, R1_Y, 10.5);
  rollOut(300);

  // 2. Fold the arm back over the intake and run the intake through the stack at (-47, -47).
  backOff(6);
  armTo(FOLDED);
  intake.move(127);
  approach(-47.09, -47.09, 9.5, 90);
  pros::delay(450);  // up the intake and into the claw
  armTo(ON_ONE);
  approach(R1_X, R1_Y, 10.6);
  rollOut(500);      // the Cup, then its Pin

  // 3. Same with the stack at (-23.5, -23.5), east of R1, then onto the top of the stack.
  backOff(6);
  armTo(FOLDED);
  approach(-23.55, -23.55, 9.5, 90);
  pros::delay(450);
  intake.brake();
  armTo(ON_TWO);
  approach(R1_X, R1_Y, 10.8);
  rollOut(500);

  // 4. Up the field to the Red 1 Toggle and hit it at full speed: two faces, to red.
  backOff(6);
  armTo(FOLDED);
  chassis.turnToPoint(-40, -2, 600);
  chassis.moveToPoint(-40, -2, 1200);
  chassis.turnToHeading(270, 700);
  chassis.waitUntilDone();
  leftMotors.move(127);
  rightMotors.move(127);
  pros::delay(700);
  leftMotors.move(-60);
  rightMotors.move(-60);
  pros::delay(250);
  leftMotors.brake();
  rightMotors.brake();
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
