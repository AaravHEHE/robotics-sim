#include "main.h"
#include "lemlib/api.hpp" // IWYU pragma: keep

// V5RC Override: Autonomous Coding Skills, 60 s (LemLib). Robot: "Override: 2-bar arm + wrist +
// roller claw" (Banshee-style). Start: Red 1 (left wall, south).
//
// Skills field: every Goal starts empty; Match Loads come in only through the red Loaders, as loaded
// stacks (a Pin with a Cup over it). Red halves score in red Quadrants, yellow halves where that
// Quadrant's Toggle is red, every half on the center Goal while the robot is in the Midfield.
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
//     every visible yellow half in Red 1.
//  5. A lone red/yellow Pin off the floor (the cross at (-47, 47)) onto the empty neutral Goal N_R1:
//     alone, both its halves score.
//  6. A Match Load from the south red Loader, through the intake, onto red Goal R2 (its red half).
//  7. A lone red/yellow Pin off the floor (the cross at (23.5, -23.5)) onto the empty center Goal,
//     and the robot stays beside it, in the Midfield: both its halves score.
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
// intake at 0; at 25 it carries a Pin just over an empty Goal (its bottom 3.5" up), at 45 a
// Cup just over a 1-Pin stack (7.1" up, over the Pin's 6.8" top), at 83 a Cup just over a
// 2-Pin stack (14.2" up, over its 13.9" top). The claw is then 10.5", 10.8" and 9.7" ahead of
// the robot center: carried any lower, the stack would hit what is already on the Goal.
constexpr double FOLDED = 0, ONE_PIN = 25, ON_ONE = 45, ON_TWO = 83;

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

// Run a Pin lying on the floor up the intake into the folded claw: the robot ends at (rx, ry) facing
// `heading`, the intake's mouth on the Pin's near end, after a short straight run in.
void intakeLying(double rx, double ry, double heading, double runIn = 6) {
  armTo(FOLDED);
  const double h = heading * M_PI / 180;
  const double sx = rx - std::sin(h) * runIn, sy = ry - std::cos(h) * runIn;
  const lemlib::Pose at = chassis.getPose();
  if (std::hypot(sx - at.x, sy - at.y) > 1.5) approach(sx, sy, 0);  // (already there: just turn)
  chassis.turnToHeading(heading, 700);
  chassis.waitUntilDone();
  intake.move(127);
  chassis.moveToPoint(rx, ry, 1200, {.maxSpeed = 60});
  chassis.waitUntilDone();
  pros::delay(450);  // up the intake and into the claw
  intake.brake();
}

// Carry what the claw holds in at arm angle `over`, stopping `reach` short of (x, y); lower it to
// `down` (if given) and roll it out onto the Goal.
void setOn(double x, double y, double over, double reach, double down = -1) {
  armTo(over);
  pros::delay(250);
  approach(x, y, reach, 80);
  if (down >= 0) {
    armTo(down);
    pros::delay(350);
  }
  rollOut(400);
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
  approach(R1_X, R1_Y, 10.82);
  rollOut(500);      // the Cup, then its Pin

  // 3. Same with the stack at (-23.5, -23.5), east of R1, then onto the top of the stack.
  backOff(6);
  armTo(FOLDED);
  approach(-23.55, -23.55, 9.5, 90);
  pros::delay(450);
  intake.brake();
  armTo(ON_TWO);
  // the chassis can't get much closer than 10.6" (the corners of the Goal's base): the claw
  // stops 1" short of the Goal's center, close enough for the Cup to drop over the Pin
  approach(R1_X, R1_Y, 10.65);
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

  // 5. The south Pin of the cross at (-47, 47) (red/yellow, lying north-south) onto N_R1: back off the
  //    Toggle, up the lane x = -59 past N_R1, in on the Pin from the west-south-west. Then the arm at 39.7
  //    (the Pin's bottom 6.1" up, over N_R1's 5.77" top, the claw 10.6" ahead) and down to 33.6 on it.
  chassis.moveToPoint(-58.45, 5, 900, {.forwards = false});
  approach(-58.45, 33.5, 0);  // straight up the 17" gap between the wall Cups and N_R1, to where it can turn
  intakeLying(-54.5, 35.5, 60, 4);
  backOff(4);
  setOn(-47.09, 23.55, 39.7, 10.6, 33.6);

  // 6. Down the lane x = -59 to the south Loader, facing west; a short burst of the intake takes one
  //    loaded stack (the claw folded inside the robot, at the intake's hand-off) and it goes onto R2.
  backOff(5);
  armTo(FOLDED);
  approach(-58.45, 33.5, 0);
  approach(-58.45, -2, 0);
  approach(-58.3, -40, 0);
  approach(-50, -58.76, 0);
  chassis.turnToHeading(270, 700);
  chassis.waitUntilDone();
  approach(-64.96, -58.76, 8.5, 80);
  intake.move(127);
  pros::delay(150);
  intake.brake();
  backOff(4);
  pros::delay(400);  // up into the claw
  // onto R2 square-on from the west (the robot's flat front can get to 10.3" from it; the claw ends
  // 0.75" short of its center, close enough)
  armTo(ONE_PIN);
  approach(-46, -47.09, 0);
  chassis.turnToHeading(90, 700);
  chassis.moveToPoint(-33.87, -47.09, 1200, {.maxSpeed = 60});
  chassis.waitUntilDone();
  rollOut(400);

  // 7. The west Pin of the cross at (23.5, -23.5) (red/yellow), taken from the north-west, onto the
  //    empty center Goal (8.77" tall: the arm at 55.5, the Pin's bottom 9.1" up, the claw 10.98"
  //    ahead). It stays there, in the Midfield.
  backOff(5);
  // round R2 and the Cup at (0, -23.5): back west, up past R2, then east just south of C
  approach(-40, -36, 0);
  approach(-14, -34, 0);
  approach(-8, -12, 0);
  intakeLying(10.07, -17.17, 135);
  backOff(3);
  setOn(0, 0, 55.5, 10.98);
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
