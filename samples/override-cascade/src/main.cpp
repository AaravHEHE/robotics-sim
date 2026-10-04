#include "main.h"
#include "lemlib/api.hpp" // IWYU pragma: keep

// V5RC Override: cascade lift + claw fed by a ground intake (LemLib).
// Robot: "Override: cascade lift + claw + intake". Start: Red 1 (left wall, south).
//
//  1. Drop the Preload (red half down) into red Goal R1.
//  2. Drive the intake over the Cup + yellow Pin standing at (-47, -47): the intake hands
//     the whole stack up to the claw. Raise the cascade 2" and set it on the Preload: the
//     Cup nests over the Pin's top.
//  3. Press the Red 1 Toggle twice with the front of the chassis (16" tall, so it reaches
//     a Toggle on top of the wall): yellow -> blue -> red. Every visible yellow half in
//     Red 1 is then Owned by red, including the yellow Pin on neutral Goal N_R1.
//
// setPose() puts LemLib's odometry in field coordinates (inches, origin at the center,
// +y toward the top wall, headings clockwise from +y).

pros::MotorGroup leftMotors({-1, -2, -3}, pros::MotorGearset::blue);
pros::MotorGroup rightMotors({4, 5, 6}, pros::MotorGearset::blue);
pros::Imu imu(11);
pros::Motor cascade(7, pros::MotorGearset::blue, pros::MotorUnits::degrees);  // 1:6 onto a 1.375" sprocket
pros::Motor intake(10, pros::MotorGearset::blue);
pros::adi::Pneumatics claw('A', true);  // extended = closed, holding the Preload

lemlib::Drivetrain drivetrain(&leftMotors, &rightMotors, 11.5, lemlib::Omniwheel::NEW_325, 450, 2);
lemlib::ControllerSettings linearController(10, 0, 3, 3, 1, 100, 3, 500, 20);
lemlib::ControllerSettings angularController(2, 0, 10, 3, 1, 100, 3, 500, 0);
lemlib::OdomSensors sensors(nullptr, nullptr, nullptr, nullptr, &imu);
lemlib::Chassis chassis(drivetrain, linearController, angularController, sensors);

// A 2-stage cascade rises 2 x the chain travel: pi x 1.375" per sprocket turn, x 2 stages.
constexpr double CARRIAGE_IN_PER_MOTOR_DEG = M_PI * 1.375 * 2 / 360.0 / 6.0;
void liftTo(double inches) { cascade.move_absolute(inches / CARRIAGE_IN_PER_MOTOR_DEG, 600); }

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

// Push into the wall ahead at a fixed power, then back off.
void press() {
  leftMotors.move(80);
  rightMotors.move(80);
  pros::delay(700);
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
  // 2" out from the wall first: turning in place right against it would swing a corner into it
  chassis.moveToPoint(-58.7, -37, 800);

  // 1. Preload into R1 (-47.1, -23.5); the claw is 9.5" ahead of the robot's center.
  approach(-47.09, -23.55, 10.6);  // the bumper just clear of the Goal, the claw over it
  claw.retract();  // open: the Pin drops into the Goal
  pros::delay(200);

  // 2. Intake the diagonal stack at (-47.1, -47.1) straight into the claw.
  chassis.moveToPoint(-58.86, -35.32, 1000, {.forwards = false});
  intake.move(127);
  approach(-47.09, -47.09, 10.5, 50);  // the stack ends up in the middle of the intake
  pros::delay(400);                    // ... and travels up into the claw
  intake.brake();
  claw.extend();  // grip it
  liftTo(2);      // the Cup's bottom 2" above the Preload's collar
  approach(-47.09, -23.55, 10.6, 60);
  claw.retract();
  pros::delay(200);
  liftTo(0);

  // 3. Around the east side of R1 to the Red 1 Toggle (left wall, y = 0) and press it twice.
  chassis.moveToPoint(-53.5, -38.5, 1000, {.forwards = false});
  chassis.turnToHeading(90, 800);
  chassis.moveToPoint(-35, -38.5, 1000);
  chassis.turnToHeading(0, 800);
  chassis.moveToPoint(-35, -5, 1500);
  chassis.turnToHeading(270, 800);
  chassis.moveToPoint(-55, -5, 1500);
  chassis.turnToHeading(270, 500);  // square to the wall
  chassis.waitUntilDone();
  press();  // yellow -> blue
  press();  // blue -> red
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
