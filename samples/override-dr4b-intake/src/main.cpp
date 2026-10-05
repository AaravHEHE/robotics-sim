#include "main.h"
#include "lemlib/api.hpp" // IWYU pragma: keep

// V5RC Override: DR4B + intake chamber, 8059A-style (LemLib).
// Robot: "Override: DR4B + intake chamber". Start: Red 1 (left wall, south).
//
// The front intake carries a whole standing stack (a Cup with a Pin in it) over the robot
// into the chamber on the DR4B at the back; the clamp holds it and the DR4B lifts it
// straight up, so this robot scores backing into a Goal. The odometry starts from a GPS
// reading instead of a hard-coded pose.
//
//  1. Back into red Goal R1 and drop the Preload (red half down) into it.
//  2. Intake the Cup + yellow Pin at (-47, -47), lift it and back it onto the Preload.
//  3. Intake the Cup + yellow Pin at (-23.5, -23.5), lift it higher and back it on top:
//     a 3-Pin stack.
//  4. Hit the Red 1 Toggle at full speed with the passive toggler: two faces, yellow -> red.
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

// DR4B heights (bar degrees; the chamber is 11" behind the robot center): 5 sets a Pin
// into an empty Goal, 15 a stack onto 1 Pin, 37 onto 2 Pins.
constexpr double ONE_PIN = 5, ON_ONE = 15, ON_TWO = 37;
void liftTo(double barDegrees) { lift.move_absolute(barDegrees * 7, 100); }

// Turn the back of the robot to (x, y) and back up until the chamber is over it.
void backInto(double x, double y) {
  chassis.turnToPoint(x, y, 800, {.forwards = false});
  chassis.waitUntilDone();
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

void initialize() {
  pros::lcd::initialize();
  lift.set_brake_mode_all(pros::MotorBrake::hold);
  chassis.calibrate();
}

void disabled() {}
void competition_initialize() {}

void autonomous() {
  // Start from the GPS: its reading is the sensor's position, converted to the robot center.
  const pros::gps_status_s_t g = gps.get_position_and_orientation();
  // it faces backward, so the robot faces the opposite way
  const double heading = std::fmod(g.yaw + 180 + 360, 360);
  chassis.setPose(g.x / 0.0254, g.y / 0.0254, heading);
  printf("GPS start: (%.1f, %.1f) facing %.0f\n", g.x / 0.0254, g.y / 0.0254, heading);
  // 3" out from the wall first: turning in place right against it swings a corner into it
  pullAway(3);

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
  leftMotors.move(127);
  rightMotors.move(127);
  pros::delay(700);
  leftMotors.move(-60);  // let go: a Toggle a robot still touches doesn't count
  rightMotors.move(-60);
  pros::delay(250);
  leftMotors.brake();
  rightMotors.brake();
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
