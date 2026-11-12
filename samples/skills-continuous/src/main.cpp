#include "main.h"
#include "lemlib/api.hpp" // IWYU pragma: keep

// V5RC Override: Autonomous Coding Skills, 60 s (LemLib). Robot: "Override: Continuous lift +
// chain-bar claw + intake". Start: Red 1 (left wall, south).
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
//  3. Match Loads from the south red Loader: the first (a red/yellow Pin) onto red Goal R2, the
//     rest onto the center Goal.
//  4. Park in the Midfield beside the center Goal: everything on it scores.
//
// setPose() puts LemLib's odometry in field coordinates (inches, origin at the center,
// +y toward the top wall, headings clockwise from +y).

pros::MotorGroup leftMotors({-1, -2, -3}, pros::MotorGearset::blue);
pros::MotorGroup rightMotors({4, 5, 6}, pros::MotorGearset::blue);
pros::Imu imu(11);
pros::MotorGroup cascade({7, 8}, pros::MotorGearset::blue, pros::MotorUnits::degrees);  // continuous lift, 1:3 to the spool
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
constexpr double LOADER_X = -64.96, LOADER_Y = -58.76;  // the south red Loader's bottom opening

// Spool degrees for a held stack to clear what is on the Goal. The continuous lift has four stages
// on the same 1.375" spool, so each 100 deg raises the carriage ~4.8" (3/4 of the cascade's spool
// angles for the same height): 68 a Pin over an empty Goal, 53 a Cup + Pin over 1 Pin, 206 over 2.
constexpr double EMPTY = 68, ON_ONE = 53, ON_TWO = 206;
// The center Goal is 5.5" taller (115 spool deg) and each loaded stack adds 7.1" (148): one onto
// loaded stacks already there is carried in 71 deg higher still, its Pin over the Cup on top, then
// lowered 112 deg into that Cup before the claw lets go.
constexpr double C_EMPTY = EMPTY + 115, LAYER = 148;

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

  // 3. Down the lane x = -58.3 (between R1 and the Cups along the wall) to the south Loader. The
  //    first loaded stack holds a red/yellow Pin: onto R2 (its red half scores in Red 2). The rest
  //    go onto the center Goal C, where every visible half scores while the robot is in the
  //    Midfield, so the robot finishes parked beside it.
  chassis.moveToPoint(-58.3, -2, 800, {.forwards = false});
  chassis.turnToHeading(180, 700);
  chassis.moveToPoint(-58.3, -40, 1500);
  approach(-50, -58.76, 0);
  takeMatchLoad();
  placeOn(R2_X, R2_Y, EMPTY);
  backOff(5);
  for (int n = 0; n < 5 && pros::millis() < 50000; n++) {
    approach(-50, -58.76, 0);
    takeMatchLoad();
    // over the Goal and n loaded stacks already on it, then lowered into the Cup on top
    const double over = C_EMPTY + LAYER * n + (n > 0 ? 71 : 0);
    placeOn(0, 0, over, n > 0 ? over - 112 : -1);
    backOff(5);
  }
  // 4. Park in the Midfield, beside C.
  chainBarTo(90);
  cascadeTo(0);
  approach(0, 0, 13);
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
