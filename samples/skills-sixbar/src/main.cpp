#include "main.h"
#include "lemlib/api.hpp" // IWYU pragma: keep

// V5RC Override: Autonomous Coding Skills, 60 s (LemLib).
// Robot: "Override: 6-bar + wrist claw". Start: Red 1 (left wall, south).
//
// Skills field: every Goal starts empty; Match Loads come in only through the red Loaders, as loaded
// stacks (a Pin with a Cup over it). Red halves score in red Quadrants, yellow halves where that
// Quadrant's Toggle is red, every half on the center Goal while the robot is in the Midfield.
//
// The claw is on the front, on a 6-bar that keeps it level, with a wrist that can turn what it holds
// over. With no intake, the claw clamps round whatever it takes: a stack, a loaded stack in a Loader's
// opening, or just the Pin out of a Cup (closing above the Cup's rim, so the Cup stays where it is).
//
//  1. The Preload turned red-end-down into red Goal R1, then the Cup + yellow Pin at (-47, -47)
//     stacked on it.
//  2. The Red 1 Toggle hit at full speed (two faces) to red: R1's yellow halves are Owned.
//  3. A Match Load (a red/yellow Pin under a Cup) from the south red Loader onto red Goal R2.
//  4. The yellow/yellow Pin out of the Cup at (-23.5, -23.5) on top of it, and the Red 2 Toggle hit
//     to red: both its halves are Owned.
//  5. The yellow/yellow Pin out of the Cup at (23.5, 23.5) onto the center Goal C, and the robot
//     stays beside it, in the Midfield: both its halves score.
//
// 6-bar heights (bar degrees, 1:5 from the motor): the claw is 3" up and 10" ahead with the bar down,
// z = 3 + 16 (sin(bar - 30) + 0.5), reach = 10 + 8 (cos(bar - 30) - 0.866).
//
// setPose() puts LemLib's odometry in field coordinates (inches, origin at the center, +y toward
// the top wall, headings clockwise from +y).

pros::MotorGroup leftMotors({-1, -2, -3}, pros::MotorGearset::blue);
pros::MotorGroup rightMotors({4, 5, 6}, pros::MotorGearset::blue);
pros::Imu imu(11);
pros::Motor sixBar(7, pros::MotorGearset::green, pros::MotorUnits::degrees);  // 1:5
pros::Motor wrist(8, pros::MotorGearset::green, pros::MotorUnits::degrees);   // 1:2
pros::adi::Pneumatics claw('A', true);                                         // extended = closed

lemlib::Drivetrain drivetrain(&leftMotors, &rightMotors, 11.5, lemlib::Omniwheel::NEW_325, 450, 2);
lemlib::ControllerSettings linearController(10, 0, 3, 3, 1, 100, 3, 500, 20);
lemlib::ControllerSettings angularController(2, 0, 10, 3, 1, 100, 3, 500, 0);
lemlib::OdomSensors sensors(nullptr, nullptr, nullptr, nullptr, &imu);
lemlib::Chassis chassis(drivetrain, linearController, angularController, sensors);

void liftTo(double barDegrees) { sixBar.move_absolute(barDegrees * 5, 200); }
void wristTo(double degrees) { wrist.move_absolute(degrees * 2, 200); }

// Turn to face (x, y) (or turn the back to it) and drive straight there.
void goTo(double x, double y, bool reverse = false, float maxSpeed = 127) {
  chassis.turnToPoint(x, y, 800, {.forwards = !reverse});
  chassis.moveToPoint(x, y, 2000, {.forwards = !reverse, .maxSpeed = maxSpeed});
  chassis.waitUntilDone();
}

// Face (x, y), drive straight at it and stop `standoff` inches short.
void approach(double x, double y, double standoff, float maxSpeed = 127) {
  chassis.turnToPoint(x, y, 800);
  chassis.waitUntilDone();
  const lemlib::Pose p = chassis.getPose();
  const double dx = x - p.x, dy = y - p.y, d = std::hypot(dx, dy);
  chassis.moveToPoint(x - dx / d * standoff, y - dy / d * standoff, 1500, {.maxSpeed = maxSpeed});
  chassis.waitUntilDone();
}

// Face `heading`, then drive straight to (x, y): to line the claw up exactly.
void along(double heading, double x, double y, bool reverse = false, float maxSpeed = 60) {
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

// Hit the Toggle ahead at full speed (two faces), the 6-bar folded up over the robot (out in front,
// the claw would hit the wall first), after a 14" run-up.
void ramToggle() {
  liftTo(110);
  const lemlib::Pose p = chassis.getPose();
  const double h = p.theta * M_PI / 180;
  chassis.moveToPoint(p.x - 14 * std::sin(h), p.y - 14 * std::cos(h), 1000, {.forwards = false});
  chassis.waitUntilDone();
  leftMotors.move(127);
  rightMotors.move(127);
  pros::delay(600);
  leftMotors.move(-60);  // let go: a Toggle a robot still touches does not count
  rightMotors.move(-60);
  pros::delay(250);
  leftMotors.brake();
  rightMotors.brake();
}

void initialize() {
  pros::lcd::initialize();
  sixBar.set_brake_mode(pros::MotorBrake::hold);
  wrist.set_brake_mode(pros::MotorBrake::hold);
  chassis.calibrate();
}

void disabled() {}
void competition_initialize() {}

void autonomous() {
  chassis.setPose(-60.7, -37, 90);  // Red 1 (south) start

  // 1. Flip the Preload red end down and raise it (bar 16: the flipped Pin hangs 3.5" below the claw,
  //    its bottom 3.6" up, clear of the 3.25" Goal), 2" out from the wall, then straight at R1, stopping
  //    11.1" short (the raised claw reaches ~10.8" ahead).
  wristTo(180);
  liftTo(16);
  chassis.moveToPoint(-58.7, -37, 600);
  chassis.waitUntilDone();
  approach(-47.09, -23.55, 11.1);
  letGo();
  // The Cup + yellow Pin at (-47, -47): wrist upright, claw at the floor, clamp round the Cup, raise
  // it just over the Preload (bar 27: the Cup's bottom 7.2" up, over the Preload's 6.8" top), set it on.
  liftTo(0);
  wristTo(0);
  chassis.moveToPoint(-58.5, -35, 1000, {.forwards = false});
  approach(-47.09, -47.09, 10);
  grab();
  liftTo(27);
  // square-on from the south (coming in at an angle, a front corner catches R1's base)
  goTo(-47.09, -38);
  along(0, -47.09, -34.5, false, 60);
  letGo();

  // 2. Up the lane x = -58.5 (between the wall-group Cups and R1) to the Red 1 Toggle.
  liftTo(110);
  chassis.moveToPoint(-47.09, -40, 800, {.forwards = false});  // straight back off R1
  goTo(-58.5, -36);
  goTo(-58.5, -5);
  chassis.turnToHeading(270, 800);
  chassis.waitUntilDone();
  ramToggle();

  // 3. Back off east, down the lane to the south Loader, facing west; the claw (10" ahead with the bar
  //    down) clamps the loaded stack in its bottom opening (-64.96, -58.76). Raise it (bar 14: the
  //    Pin's bottom 3.6" up) and set it on R2 (-23.55, -47.09) from the west (the claw 10.76" ahead).
  chassis.moveToPoint(-54, -5, 800, {.forwards = false});
  liftTo(0);
  goTo(-59, -9);  // (straight from the Toggle the robot would clip R1)
  goTo(-59, -36);
  goTo(-45, -58.76);
  along(270, -54.6, -58.76, false, 50);
  grab();
  liftTo(14);
  chassis.moveToPoint(-46, -58.76, 800, {.forwards = false});
  goTo(-46, -47.09);
  along(90, -34.31, -47.09, false, 50);
  letGo();

  // 4. The yellow/yellow Pin out of the Cup at (-23.55, -23.55) on top of it: the claw closing above
  //    the Cup's rim (bar 19.2: 8" up, 10.93" ahead), so the Cup stays put. Round by the north of R2 to
  //    the Midfield side of that Cup, face south-west and drive the claw onto the Pin. Then back round
  //    and at R2 again from the west, the Pin carried over the Cup there (bar 46.2: its bottom 10.7"
  //    up, the claw 10.75" ahead) and lowered into it (bar 41.8).
  liftTo(0);
  chassis.moveToPoint(-44, -47.09, 1000, {.forwards = false});
  goTo(-36, -34);
  goTo(-12, -34);
  goTo(-12, -12);
  liftTo(19.2);
  along(225, -15.82, -15.82, false, 50);
  grab();
  liftTo(46.2);
  pros::delay(500);  // up and clear of the Cup before moving
  chassis.moveToPoint(-12, -12, 800, {.forwards = false});
  goTo(-12, -34);
  goTo(-36, -34);
  goTo(-46, -47.09);
  along(90, -34.6, -47.09, false, 50);
  liftTo(41.8);
  pros::delay(400);
  letGo();

  // The Red 2 Toggle (bottom wall, x = 0) hit to red: the yellow halves on R2 are Owned.
  chassis.moveToPoint(-44, -47.09, 1000, {.forwards = false});
  goTo(-36, -34);
  goTo(-12, -34);
  goTo(0, -50);
  chassis.turnToHeading(180, 800);
  chassis.waitUntilDone();
  ramToggle();

  // 5. The yellow/yellow Pin out of the Cup at (23.55, 23.55) onto the center Goal C. Round the west
  //    and north of C (every other way passes a stack in the Midfield's corners or a cross), face
  //    north-east and drive the claw onto the Pin (bar 19.2); back off, raise it over C's 8.77" top
  //    (bar 40.3: its bottom 9.1" up, the claw 10.92" ahead), face C and set it on.
  liftTo(0);
  chassis.moveToPoint(0, -48, 800, {.forwards = false});
  goTo(-12, -40);
  goTo(-12, -12);
  goTo(-12, 12);
  goTo(12, 12);
  liftTo(19.2);
  along(45, 15.82, 15.82, false, 50);
  grab();
  liftTo(40.3);
  pros::delay(500);
  chassis.moveToPoint(12, 12, 800, {.forwards = false});
  approach(0, 0, 10.92, 50);
  letGo();
  // It stays here, inside the Midfield.
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
