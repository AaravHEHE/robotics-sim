#include "main.h"
#include "lemlib/api.hpp" // IWYU pragma: keep

// V5RC Override: Autonomous Coding Skills, 60 s (LemLib + GPS).
// Robot: "Override: DR4B + intake chamber". Start: Red 1 (left wall, south).
//
// In Skills the drive team keeps both red Loaders stocked with Match Loads as "loaded
// stacks" (a Pin with a Cup nested over it), and the GPS code strip is up. Red Pin halves
// score in red Quadrants; yellow halves score where that Quadrant's Toggle is red; in the
// Midfield they score while the robot is in it.
//
//  1. The 3-Pin stack on Goal R1 from the Preload and two floor stacks (as in the 15 s
//     auton), then the Red 1 Toggle to red at speed.
//  2. A loaded stack from the south red Loader, straight up the intake into the chamber,
//     backed onto Goal R2.
//  3. The Red 2 Toggle to red: the yellow Pin on neutral Goal N_R2 scores.
//  4. Park in the Midfield: the yellow Pin on the center Goal scores.
//
// setPose() puts LemLib's odometry in field coordinates (inches, origin at the center,
// +y toward the top wall, headings clockwise from +y).

pros::MotorGroup leftMotors({-1, -2, -3}, pros::MotorGearset::blue);
pros::MotorGroup rightMotors({4, 5, 6}, pros::MotorGearset::blue);
pros::Imu imu(11);
pros::MotorGroup lift({7, 8}, pros::MotorGearset::red, pros::MotorUnits::degrees);  // DR4B, 12:84
pros::Motor intake(10, pros::MotorGearset::blue);
pros::adi::Pneumatics clamp('A', true);  // extended = closed (on the Preload)
pros::Optical chamberEye(9);             // looks down into the chamber
pros::Gps gps(12, 0, -6 * 0.0254);       // 6" behind the center, facing backward

// 3.25" traction wheels geared to 360 rpm.
lemlib::Drivetrain drivetrain(&leftMotors, &rightMotors, 11.5, lemlib::Omniwheel::NEW_325, 360, 2);
lemlib::ControllerSettings linearController(10, 0, 3, 3, 1, 100, 3, 500, 20);
lemlib::ControllerSettings angularController(2, 0, 10, 3, 1, 100, 3, 500, 0);
lemlib::OdomSensors sensors(nullptr, nullptr, nullptr, nullptr, &imu);
lemlib::Chassis chassis(drivetrain, linearController, angularController, sensors);

constexpr double R1_X = -47.09, R1_Y = -23.55;  // red Goal R1

// DR4B heights (bar degrees; the chamber is 11" behind the robot center), each carrying the
// bottom just over what is already there: 13 a Pin over an empty Goal (3.5" up, Goal top
// 3.25"), 25 a stack over 1 Pin (7.3" up, Pin top 6.8"), 45.5 over 2 Pins (14.3" up, stack
// top 13.9"). Any lower and the stack would hit the Goal or the Pins on it.
constexpr double ONE_PIN = 13, ON_ONE = 25, ON_TWO = 45.5;
void liftTo(double barDegrees) { lift.move_absolute(barDegrees * 7, 100); }

// Turn the back of the robot to (x, y) and back up until the chamber is over it. The DR4B
// must be up first: a stack still rising would hit the Goal or the Pins on it from the side.
void backInto(double x, double y) {
  chassis.turnToPoint(x, y, 800, {.forwards = false});
  chassis.waitUntilDone();
  for (int t = 0; t < 1000 && std::fabs(lift.get_position(0) - lift.get_target_position(0)) > 7; t += 10) pros::delay(10);
  const lemlib::Pose p = chassis.getPose();
  const double dx = x - p.x, dy = y - p.y, d = std::hypot(dx, dy);
  chassis.moveToPoint(x - dx / d * 11, y - dy / d * 11, 1500, {.forwards = false});
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

// Pull straight ahead, away from the Goal behind.
void pullAway(double inches) {
  const lemlib::Pose p = chassis.getPose();
  const double h = p.theta * M_PI / 180;
  chassis.moveToPoint(p.x + std::sin(h) * inches, p.y + std::cos(h) * inches, 800);
  chassis.waitUntilDone();
}

// Run the stack at (x, y) through the intake into the open chamber, then clamp it.
void intakeStack(double x, double y) {
  liftTo(0);
  clamp.retract();
  intake.move(127);
  approach(x, y, 9.5, 90);
  // wait (up to a second) for the chamber eye to see the stack arrive
  for (int t = 0; t < 1000 && chamberEye.get_proximity() < 50; t += 10) pros::delay(10);
  clamp.extend();
  intake.brake();
}

// Take one loaded stack out of the bottom of the Loader ahead (its opening at (x, y)):
// a short burst of the intake, so the next one (which drops down 0.2 s later) stays put.
void takeMatchLoad(double x, double y) {
  liftTo(0);
  clamp.retract();
  approach(x, y, 9, 90);
  intake.move(127);
  pros::delay(120);
  intake.brake();
  for (int t = 0; t < 1000 && chamberEye.get_proximity() < 50; t += 10) pros::delay(10);
  clamp.extend();
}

void initialize() {
  pros::lcd::initialize();
  lift.set_brake_mode_all(pros::MotorBrake::hold);
  chassis.calibrate();
}

void disabled() {}
void competition_initialize() {}

// Back up to (x, y): turn the back of the robot to it, then reverse straight there.
void backTo(double x, double y) {
  chassis.turnToPoint(x, y, 800, {.forwards = false});
  chassis.moveToPoint(x, y, 2000, {.forwards = false});
  chassis.waitUntilDone();
}

// Hit the Toggle ahead at full speed (two faces), then let go of it.
void ramToggle() {
  leftMotors.move(127);
  rightMotors.move(127);
  pros::delay(700);
  leftMotors.move(-60);  // a Toggle a robot still touches doesn't count
  rightMotors.move(-60);
  pros::delay(250);
  leftMotors.brake();
  rightMotors.brake();
}

void autonomous() {
  // Start from the GPS: its reading is the sensor's position, converted to the robot center.
  const pros::gps_status_s_t g = gps.get_position_and_orientation();
  // it faces backward, so the robot faces the opposite way
  const double heading = std::fmod(g.yaw + 180 + 360, 360);
  chassis.setPose(g.x / 0.0254, g.y / 0.0254, heading);
  printf("GPS start: (%.1f, %.1f) facing %.0f\n", g.x / 0.0254, g.y / 0.0254, heading);
  // The start is 3" out from the wall (the Preload standing in the rear chamber has to be
  // inside the field), so it can turn in place right away: any further out and turning
  // would swing a corner into the stack at (-47, -47).

  // 1. Preload into R1, out of the back.
  liftTo(ONE_PIN);
  backInto(R1_X, R1_Y);
  clamp.retract();
  pros::delay(150);

  // 2. The stack at (-47, -47), onto the Preload.
  pullAway(4);
  intakeStack(-47.09, -47.09);
  liftTo(ON_ONE);
  backInto(R1_X, R1_Y);
  clamp.retract();
  pros::delay(150);

  // 3. The stack at (-23.5, -23.5), round the south side of R1, onto the top.
  pullAway(4);
  approach(-40, -40, 0);
  intakeStack(-23.55, -23.55);
  liftTo(ON_TWO);
  backInto(R1_X, R1_Y);
  clamp.retract();
  pros::delay(150);

  // 4. Up the field to the Red 1 Toggle and hit it at full speed.
  pullAway(4);
  liftTo(0);
  approach(-38, -2, 0);
  chassis.turnToHeading(270, 800);
  chassis.waitUntilDone();
  ramToggle();

  // 5. Down the lane x = -58.3 (between R1 and the Cups along the wall) to the south red
  //    Loader, intake running.
  backTo(-58.3, -2);
  chassis.turnToHeading(180, 800);
  chassis.moveToPoint(-58.3, -40, 1500);
  approach(-50, -58.76, 0);
  chassis.turnToHeading(270, 800);
  chassis.waitUntilDone();
  takeMatchLoad(-64.96, -58.76);  // the Loader's bottom opening
  liftTo(ONE_PIN);
  pullAway(-3);
  backInto(-23.55, -47.09);     // R2
  clamp.retract();
  pros::delay(150);

  // 6. North round the west side of R2, east along y = -36, then hit the Red 2 Toggle
  //    (bottom wall, x = 0) after a run-up.
  pullAway(4);
  liftTo(0);
  approach(-38, -36, 0);
  approach(-4, -36, 0);
  chassis.turnToHeading(180, 800);
  chassis.waitUntilDone();
  ramToggle();

  // 7. Park in the Midfield, clear of the stack at (0, -23.5).
  chassis.moveToPoint(-4, -46, 1500, {.forwards = false});
  approach(-12, -12, 0);
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
