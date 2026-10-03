#include "main.h"
#include "lemlib/api.hpp" // IWYU pragma: keep

// V5RC Override: Autonomous Coding Skills, 60 s (LemLib).
// Robot: "Override: intake -> staging -> claw". Start: Red 1 (left wall, south).
//
// In Skills the drive team keeps both red Loaders stocked with Match Loads (Pins and Cups
// alternate in each chute), and the GPS code strip is up: the robot starts from a GPS
// reading. It builds a tower on Goal R1 out of Pin + Cup combos:
//  1. Takes a Cup from the south red Loader. The intake drops it into the staging tray,
//     where it sits over the Preload Pin: a combo. The claw picks the combo up and sets it
//     on Goal R1 (the Pin nests in the Goal, the Cup over the Pin).
//  2. Twice: takes a Pin and a Cup, which the tray assembles into a combo, and stacks it on
//     the tower (each Pin nests in the Cup below it). Red Pin halves score in red
//     Quadrants; the Cups' gray lower halves hide the yellow halves.
//  3. Parks partly in the Midfield (+8).
//
// setPose() puts LemLib's odometry in field coordinates (inches, origin at the center,
// +y toward the top wall, headings clockwise from +y).

pros::MotorGroup leftMotors({-1, -2, -3}, pros::MotorGearset::blue);
pros::MotorGroup rightMotors({4, 5, 6}, pros::MotorGearset::blue);
pros::Imu imu(11);
pros::Motor lift(7, pros::MotorGearset::green, pros::MotorUnits::degrees);  // 4-bar, 1:5
pros::Motor intake(10, pros::MotorGearset::blue);
pros::adi::Pneumatics claw('A', false);  // extended = closed
// GPS 6" behind the turning center, facing backward: tell it the offset (meters)
pros::Gps gps(12, 0, -6 * 0.0254);

lemlib::Drivetrain drivetrain(&leftMotors, &rightMotors, 11.5, lemlib::Omniwheel::NEW_325, 450, 2);
lemlib::ControllerSettings linearController(10, 0, 3, 3, 1, 100, 3, 500, 20);
lemlib::ControllerSettings angularController(2, 0, 10, 3, 1, 100, 3, 500, 0);
lemlib::OdomSensors sensors(nullptr, nullptr, nullptr, nullptr, &imu);
lemlib::Chassis chassis(drivetrain, linearController, angularController, sensors);

// The 4-bar is geared 1:5: the bar turns a fifth of the motor.
void liftTo(double barDegrees) { lift.move_absolute(barDegrees * 5, 200); }

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

// Face a waypoint, then drive to it (forwards or backwards): ends close to it with
// little sideways error, unlike a moveToPoint started at an angle.
void goTo(double x, double y, bool forwards = true) {
  chassis.turnToPoint(x, y, 700, {.forwards = forwards});
  chassis.moveToPoint(x, y, 1500, {.forwards = forwards});
}

// Goal R1 and the spot in front of the south red Loader where the intake reaches its
// bottom opening.
constexpr double R1_X = -47.09, R1_Y = -23.55;
constexpr double LOADER_X = -52.47, LOADER_Y = -58.76;
// The lane between Goal R1 / the diagonal stack (west) and Goal R2 (east)
constexpr double LANE_X = -37;

// From the lane east of R1 down to the Loader (around the diagonal stack at (-47, -47)),
// take one piece, and come back up the lane. The staging tray assembles the combo.
void fetchFromLoader(int pieces) {
  goTo(LANE_X, -37.5);
  goTo(LANE_X, LOADER_Y);
  goTo(LOADER_X, LOADER_Y);
  chassis.turnToHeading(270, 500);  // square to the Loader
  chassis.waitUntilDone();
  intake.move(127);  // the intake swallows one piece about every 350 ms
  pros::delay(pieces == 1 ? 150 : 500);
  intake.brake();
  pros::delay(350);  // through the intake into the staging tray
  claw.extend();     // the claw sits at the tray: grab what's there
  pros::delay(150);
  goTo(LANE_X, LOADER_Y, false);
  goTo(LANE_X, -35);
}

void initialize() {
  pros::lcd::initialize();
  chassis.calibrate();
}

void disabled() {}
void competition_initialize() {}

void autonomous() {
  // The GPS code strip is installed for Skills: start from where the GPS says the robot
  // is (meters -> inches) instead of trusting the start position by hand.
  const pros::gps_status_s_t g = gps.get_position_and_orientation();
  chassis.setPose(g.x / 0.0254, g.y / 0.0254, gps.get_heading() - 180);  // the GPS faces backward
  printf("GPS start (%.1f, %.1f) facing %.0f\n", g.x / 0.0254, g.y / 0.0254, gps.get_heading() - 180);

  // 1. Preload + Cup combo onto R1 (claw low: the Pin's bottom drops into the Goal)
  fetchFromLoader(1);
  approach(R1_X, R1_Y, 10.6, 70);
  claw.retract();
  pros::delay(200);

  // 2. Two Pin + Cup combos on top; each sits higher, so the 4-bar rises further
  const double barAngle[] = {32, 58};
  const double standoff[] = {11.3, 10.4};
  for (int i = 0; i < 2; i++) {
    goTo(LANE_X, -35, false);
    fetchFromLoader(2);
    liftTo(barAngle[i]);
    approach(R1_X, R1_Y, standoff[i], 70);
    claw.retract();
    pros::delay(250);
    liftTo(0);
  }

  // 3. Park with the front of the robot inside the Midfield.
  goTo(LANE_X, -35, false);
  goTo(LANE_X, -10);
  goTo(-26, -10);
  chassis.waitUntilDone();
  printf("Skills run finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
