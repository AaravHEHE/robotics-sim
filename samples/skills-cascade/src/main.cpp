#include "main.h"
#include "lemlib/api.hpp" // IWYU pragma: keep

// V5RC Override: Autonomous Coding Skills, 60 s (LemLib). Robot: "Override: Cascade + chain-bar
// claw + intake". Start: Red 1 (left wall, south).
//
// Skills field: every Goal starts empty; the Match Loads (3 red/yellow Pins, 4 blue/yellow Pins,
// 7 Cups) come in only through the red Loaders, where the drive team keeps them stocked as
// "loaded stacks" (a Pin with a Cup over it). Red halves score in red Quadrants, yellow halves
// where that Quadrant's Toggle is red, and every half in the Midfield while the robot is in it.
//
// The claw sits inside the robot: everything goes in through the funnel intake, up into the
// claw while the chain bar holds it down in front.
//
//  1. A 3-Pin stack on red Goal R1: the Preload, then the Cup + yellow Pin stacks at
//     (-47, -47) and (-23.5, -23.5).
//  2. The Red 1 Toggle to red: R1's yellow halves score.
//  3. A lone red/yellow Pin off the floor onto neutral Goal N_R1 (both halves score).
//  4. Match Loads from the south red Loader: the first (a red/yellow Pin) onto red Goal R2, two
//     onto the center Goal.
//  5. A lone red/yellow Pin off the floor on top of the center Goal, then stay beside it in the
//     Midfield: everything on it scores.
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

constexpr double R1_X = -47.09, R1_Y = -23.55;  // red Goal R1
constexpr double R2_X = -23.55, R2_Y = -47.09;  // red Goal R2
constexpr double NR1_X = -47.09, NR1_Y = 23.55;  // neutral Goal N_R1 (2.5" taller)
constexpr double LOADER_X = -64.96, LOADER_Y = -58.76;  // the south red Loader's bottom opening

// Cascade spool degrees for a held stack to clear what is on the Goal (each 100 deg raises the
// carriage ~3.6"): 90 a Pin over an empty Goal, 70 a Cup + Pin over 1 Pin, 275 over 2 Pins.
constexpr double EMPTY = 90, ON_ONE = 70, ON_TWO = 275;
// The center Goal is 5.5" taller (153 spool deg) and each loaded stack adds 7.1" (197): one onto
// loaded stacks already there is carried in 95 deg higher still, its Pin over the Cup on top, then
// lowered 150 deg into that Cup before the claw lets go.
constexpr double C_EMPTY = EMPTY + 153, LAYER = 197;
// A lone Pin over the empty 5.77" neutral Goal.
constexpr double N_EMPTY = EMPTY + 25;

// Chain bar: 0 = straight out front (the claw 11" ahead, 6" up), -25 = down in front of
// the intake where it takes stacks, 90 = straight up (out of the way).
void chainBarTo(double deg) { chainBar.move_absolute(deg * 3, 200); }
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

// The claw down and open at the intake's hand-off.
void ready() {
  cascadeTo(0);
  chainBarTo(-25);
  claw.retract();
}

// Intake the stack at (x, y) into the lowered claw and clamp it.
void intakeStack(double x, double y) {
  ready();
  intake.move(127);
  approach(x, y, 9.5, 90);
  pros::delay(350);  // up the funnel into the claw
  claw.extend();
  intake.brake();
}

// Take one loaded stack out of the bottom of the Loader ahead: a short burst of the intake, so
// the next one (which drops down 0.2 s later) stays put. The claw lowered in front would run into
// the Loader, so the chain bar stays up and the stack waits in the intake; once the robot has
// backed off, the claw comes down and the intake hands it up.
void takeMatchLoad() {
  cascadeTo(0);
  chainBarTo(90);
  claw.retract();
  approach(LOADER_X, LOADER_Y, 8.5, 90);
  intake.move(127);
  pros::delay(150);
  intake.brake();
  backOff(4);
  chainBarTo(-25);
  for (int t = 0; t < 700 && std::fabs(chainBar.get_position() + 75) > 9; t += 10) pros::delay(10);
  pros::delay(500);  // up the funnel into the claw
  claw.extend();
  pros::delay(200);  // the cylinder closing: a claw still open lets go as it rises
}

// Carry what the claw holds to (x, y) at cascade height `spool` and let go over it; `lowerTo`
// (if given) sets it down first: a loaded stack's Pin has to be lowered into the Cup on the Goal.
void placeOn(double x, double y, double spool, double lowerTo = -1) {
  chainBarTo(0);
  cascadeTo(spool);
  chassis.turnToPoint(x, y, 700);
  chassis.waitUntilDone();
  // the stack must be up before it reaches the Goal: wait for the cascade
  for (int t = 0; t < 1200 && std::fabs(cascade.get_position() - spool * 3) > 30; t += 10) pros::delay(10);
  approach(x, y, 11);
  if (lowerTo >= 0) {
    cascadeTo(lowerTo);
    for (int t = 0; t < 600 && std::fabs(cascade.get_position() - lowerTo * 3) > 30; t += 10) pros::delay(10);
  }
  claw.retract();
  pros::delay(150);
}

// Drive the intake onto a Pin lying on the floor: the robot ends at (rx, ry) facing `heading`, the
// intake's mouth on the Pin's near end; a short straight run in with the intake going, then the
// intake hands it up into the lowered claw.
void intakeLying(double rx, double ry, double heading, double runIn = 6) {
  ready();
  const double h = heading * M_PI / 180;
  const double sx = rx - std::sin(h) * runIn, sy = ry - std::cos(h) * runIn;
  const lemlib::Pose at = chassis.getPose();
  if (std::hypot(sx - at.x, sy - at.y) > 1.5) approach(sx, sy, 0);  // (already there: just turn)
  chassis.turnToHeading(heading, 700);
  chassis.waitUntilDone();
  intake.move(127);
  chassis.moveToPoint(rx, ry, 1200, {.maxSpeed = 60});
  chassis.waitUntilDone();
  pros::delay(450);  // up the funnel into the claw
  claw.extend();
  pros::delay(200);
  intake.brake();
}

// Hit the Toggle ahead at full speed (two faces), then let go of it.
void ramToggle() {
  leftMotors.move(127);
  rightMotors.move(127);
  pros::delay(600);
  leftMotors.move(-60);  // a Toggle a robot still touches doesn't count
  rightMotors.move(-60);
  pros::delay(250);
  leftMotors.brake();
  rightMotors.brake();
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

  // 1. The 3-Pin stack on R1.
  placeOn(R1_X, R1_Y, EMPTY);  // the Preload
  backOff(6);
  intakeStack(-47.09, -47.09);
  placeOn(R1_X, R1_Y, ON_ONE);
  backOff(6);
  approach(-40, -40, 0);  // round the south side of R1: the straight line clips it
  intakeStack(-23.55, -23.55);
  backOff(4);
  placeOn(R1_X, R1_Y, ON_TWO);
  backOff(6);

  // 2. Up the field to the Red 1 Toggle and hit it at full speed.
  chainBarTo(90);
  cascadeTo(0);
  approach(-40, -2, 0);
  chassis.turnToHeading(270, 700);
  chassis.waitUntilDone();
  ramToggle();

  // 3. A lone red/yellow Pin onto the empty neutral Goal N_R1: alone, both its halves show (red in a
  //    red Quadrant, yellow Owned through the red Toggle). It comes from the cross at (-47, 47):
  //    up the lane x = -59 past N_R1, then in on the south Pin from the west-south-west.
  chassis.moveToPoint(-58.3, 5, 900, {.forwards = false});
  approach(-58, 33.5, 0);  // straight up the 17" gap between the wall Cups and N_R1, to where it can turn
  intakeLying(-54.5, 35.5, 60, 4);
  backOff(4);
  placeOn(NR1_X, NR1_Y, N_EMPTY, EMPTY + 10);  // in just over its top, then down onto it
  backOff(5);

  // 4. Down the lane to the south Loader. The first loaded stack holds a red/yellow Pin: onto R2
  //    (its red half scores in Red 2). The next ones (as many as time allows, up to three) go onto the center Goal C, where every visible
  //    half scores while the robot is in the Midfield.
  chainBarTo(90);
  cascadeTo(0);
  approach(-58.3, 33.5, 0);
  approach(-58.3, -2, 0);
  approach(-58.3, -40, 0);
  approach(-50, -58.76, 0);
  takeMatchLoad();
  placeOn(R2_X, R2_Y, EMPTY);
  backOff(5);
  int loads = 0;
  for (; loads < 3 && pros::millis() < 40000; loads++) {
    const int n = loads;
    approach(-50, -58.76, 0);
    takeMatchLoad();
    // over the Goal and n loaded stacks already on it, then lowered into the Cup on top
    const double over = C_EMPTY + LAYER * n + (n > 0 ? 95 : 0);
    placeOn(0, 0, over, n > 0 ? over - 150 : -1);
    backOff(5);
  }

  // 5. A lone red/yellow Pin on top of C (both halves score in the Midfield): the west Pin of the
  //    cross at (23.5, -23.5), taken from the north-west, then carried in over the Cup on top of C
  //    and lowered into it.
  intakeLying(10.07, -17.17, 135);
  backOff(3);
  placeOn(0, 0, C_EMPTY + loads * LAYER + 95, C_EMPTY + loads * LAYER - 55);

  // 6. Stay beside C, in the Midfield.
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
