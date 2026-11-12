#include "main.h"
#include "lemlib/api.hpp" // IWYU pragma: keep

// V5RC Override: Autonomous Coding Skills, 60 s (LemLib).
// Robot: "Override: 4-bar + rear piston claw + front Toggle bumper". Start: Red 1 (left wall,
// south), 3.1" off the wall: the Preload standing in the rear claw must be inside the field.
//
// Skills field: every Goal starts empty; Match Loads come in only through the red Loaders, as loaded
// stacks (a Pin with a Cup over it). Red halves score in red Quadrants, yellow halves where that
// Quadrant's Toggle is red, every half on the center Goal while the robot is in the Midfield.
//
// The claw is on the back of the robot and the Toggle bumper on the front, so it scores reversing
// into Goals and presses Toggles driving forward. With no intake, the claw clamps round whatever it
// takes: a stack, a loaded stack in a Loader's opening, or just the Pin out of a Cup (closing above
// the Cup's rim, so the Cup stays where it is).
//
//  1. The Preload into red Goal R1, then the Cup + yellow Pin at (-47, -47) stacked on it.
//  2. The Red 1 Toggle pressed twice to red: R1's yellow halves are Owned.
//  3. A Match Load (a red/yellow Pin under a Cup) from the south red Loader onto red Goal R2.
//  4. The yellow/yellow Pin out of the Cup at (-23.5, -23.5) on top of it, and the Red 2 Toggle
//     pressed to red: both its halves are Owned.
//  5. The yellow/yellow Pin out of the Cup at (23.5, 23.5) onto the center Goal C, and the robot
//     stays beside it, in the Midfield: both its halves score.
//
// 4-bar heights (bar degrees, 1:5 from the motor): the claw is 3" up and 11" behind with the bar
// down, z = 3 + 12 (sin(bar - 30) + 0.5), reach = 11 + 12 (cos(bar - 30) - 0.866).
//
// setPose() puts LemLib's odometry in field coordinates (inches, origin at the center, +y toward
// the top wall, headings clockwise from +y).

pros::MotorGroup leftMotors({-1, -2, -3}, pros::MotorGearset::blue);
pros::MotorGroup rightMotors({4, 5, 6}, pros::MotorGearset::blue);
pros::Imu imu(11);
pros::Motor lift(7, pros::MotorGearset::green, pros::MotorUnits::degrees);  // 4-bar, 1:5, out the back
pros::adi::Pneumatics claw('A', true);  // extended = closed, holding the Preload

lemlib::Drivetrain drivetrain(&leftMotors, &rightMotors, 11.5, lemlib::Omniwheel::NEW_325, 450, 2);
lemlib::ControllerSettings linearController(10, 0, 3, 3, 1, 100, 3, 500, 20);
lemlib::ControllerSettings angularController(2, 0, 10, 3, 1, 100, 3, 500, 0);
lemlib::OdomSensors sensors(nullptr, nullptr, nullptr, nullptr, &imu);
lemlib::Chassis chassis(drivetrain, linearController, angularController, sensors);

void liftTo(double barDegrees) { lift.move_absolute(barDegrees * 5, 200); }

// Turn to face (x, y) (or turn the back to it) and drive straight there.
void goTo(double x, double y, bool reverse = false, float maxSpeed = 127) {
  chassis.turnToPoint(x, y, 800, {.forwards = !reverse});
  chassis.moveToPoint(x, y, 2000, {.forwards = !reverse, .maxSpeed = maxSpeed});
  chassis.waitUntilDone();
}

// Face `heading`, then drive straight (back) to (x, y): to line the claw up exactly.
void along(double heading, double x, double y, bool reverse, float maxSpeed = 60) {
  chassis.turnToHeading(heading, 800);
  chassis.moveToPoint(x, y, 1500, {.forwards = !reverse, .maxSpeed = maxSpeed});
  chassis.waitUntilDone();
}

void grab() {
  claw.extend();
  pros::delay(200);
}

void letGo() {
  claw.retract();
  pros::delay(200);
}

// Press the Toggle ahead twice with the front bumper (yellow -> blue -> red). The wall stops the
// robot, so plain power for a set time; power 58 is about 35 in/s, one face per press.
void pressToggle() {
  for (int i = 0; i < 2; i++) {
    leftMotors.move(58);
    rightMotors.move(58);
    pros::delay(700);
    leftMotors.move(-60);  // let go: a Toggle a robot still touches does not count
    rightMotors.move(-60);
    pros::delay(250);
  }
  leftMotors.brake();
  rightMotors.brake();
}

void initialize() {
  pros::lcd::initialize();
  lift.set_brake_mode(pros::MotorBrake::hold);
  chassis.calibrate();
}

void disabled() {}
void competition_initialize() {}

void autonomous() {
  chassis.setPose(-57.6, -37, 90);

  // 1. Preload into R1 (-47.1, -23.5): out along y = -37 to a spot on R1's diagonal, the back toward
  //    R1, and reverse until the claw (12.35" behind with the bar at 18) is over it. At 18 the Pin's
  //    bottom is 3.5" up, clear of the 3.25" Goal.
  liftTo(18);
  chassis.moveToPoint(-33.64, -37, 1500);
  along(135, -38.36, -32.28, true, 70);
  letGo();
  liftTo(0);
  chassis.moveToPoint(-33.64, -37, 1000);
  // The Cup + yellow Pin at (-47.1, -47.1): reverse onto it along the diagonal, raise it (bar 36: the
  // Cup's bottom 7.25" up, over the Preload's 6.8" top) and reverse it onto R1 along its other diagonal.
  goTo(-59.11, -35.07);
  along(315, -54.87, -39.31, true);
  grab();
  liftTo(36);
  goTo(-58.4, -34.86);
  along(225, -55.93, -32.39, true);
  pros::delay(200);
  letGo();
  chassis.moveToPoint(-58.4, -34.86, 1000);
  liftTo(0);

  // 2. Up the lane x = -58.5 to the Red 1 Toggle (left wall, y = 0) and press it twice.
  goTo(-58.5, -5);
  chassis.turnToHeading(270, 800);
  chassis.waitUntilDone();
  pressToggle();

  // 3. Back off east, down the lane to the south Loader, face east and reverse until the claw (11"
  //    behind with the bar down) is in its bottom opening (-64.96, -58.76); the claw takes the loaded
  //    stack. Then up the row of R2 (-23.55, -47.09), facing west, and reverse it on (bar 18).
  chassis.moveToPoint(-54, -5, 800, {.forwards = false});
  goTo(-59, -9);  // (straight from the Toggle the robot would clip R1)
  goTo(-59, -36);
  goTo(-50, -58.76);
  along(90, -53.2, -58.76, true, 50);
  grab();
  liftTo(18);
  goTo(-46, -47.09);
  along(270, -35.9, -47.09, true);
  letGo();

  // 4. The yellow/yellow Pin out of the Cup at (-23.55, -23.55) on top of it: the claw closing above
  //    the Cup's rim (bar 25.2: 8" up, 12.56" behind), so the Cup stays put. Round by the north of R2
  //    to the Midfield side of that Cup, face north-east and reverse the claw onto the Pin. Then back
  //    round and reverse onto R2 from the west, the Pin carried over the Cup there (bar 62.6: its
  //    bottom 10.7" up, the claw 10.7" behind) and lowered into it (bar 56).
  liftTo(0);
  chassis.moveToPoint(-44, -47.09, 1000);
  goTo(-36, -34);
  goTo(-12, -34);
  goTo(-12, -12);
  liftTo(25.2);
  along(45, -14.67, -14.67, true, 50);
  grab();
  liftTo(62.6);
  pros::delay(500);  // up and clear of the Cup before turning
  goTo(-12, -34);
  goTo(-36, -34);
  goTo(-46, -47.09);
  along(270, -34.26, -47.09, true, 50);
  liftTo(56);
  pros::delay(400);
  letGo();

  // The Red 2 Toggle (bottom wall, x = 0) pressed twice to red: the yellow halves on R2 are Owned.
  liftTo(0);
  chassis.moveToPoint(-44, -47.09, 1000);
  goTo(-36, -34);
  goTo(-12, -34);
  goTo(0, -52);
  chassis.turnToHeading(180, 800);
  chassis.waitUntilDone();
  pressToggle();

  // 5. The yellow/yellow Pin out of the Cup at (23.55, 23.55) onto the center Goal C. Round the west
  //    and north of C (every other way passes a stack in the Midfield's corners or a cross), face
  //    south-west and reverse the claw onto the Pin (bar 25.2); turn round (facing north-east, away
  //    from C), raise it over C's 8.77" top (bar 53.9: its bottom 9.1" up, the claw 11.58" behind) and
  //    reverse the claw over C.
  chassis.moveToPoint(0, -46, 800, {.forwards = false});
  goTo(-12, -40);
  goTo(-12, -12);
  goTo(-12, 12);
  goTo(11.5, 11.5);
  liftTo(25.2);
  along(225, 14.67, 14.67, true, 50);
  grab();
  liftTo(53.9);
  pros::delay(500);  // up and clear of the Cup before turning
  along(45, 8.19, 8.19, true, 50);
  letGo();
  // It stays here, inside the Midfield.
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
