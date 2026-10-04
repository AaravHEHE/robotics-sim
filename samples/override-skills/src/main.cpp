#include "main.h"
#include "lemlib/api.hpp" // IWYU pragma: keep

// V5RC Override: Autonomous Coding Skills, 60 s (LemLib).
// Robot: "Override: intake -> rear staging -> rear DR4B". Start: Red 1 (left wall, south).
//
// In Skills the drive team keeps both red Loaders stocked with Match Loads (Pins and Cups
// alternate in each chute), and the GPS code strip is up: the robot starts from a GPS
// reading. The front intake carries pieces over the robot into a tray at the back, which
// assembles a Pin + Cup combo; the rear DR4B claw picks the combo up and stacks it out of
// the back of the robot. It builds a tower on Goal R1:
//  1. Takes a Cup from the south red Loader; in the tray it lands over the Preload Pin.
//     The combo goes on Goal R1 (the Pin nests in the Goal, the Cup over the Pin).
//  2. Twice: takes a Pin and a Cup and stacks the combo on the tower (each Pin nests in
//     the Cup below it). Red Pin halves score in red Quadrants; the Cups' gray lower halves
//     hide the yellow halves.
//  3. Parks partly in the Midfield (+8).
//
// setPose() puts LemLib's odometry in field coordinates (inches, origin at the center,
// +y toward the top wall, headings clockwise from +y).

pros::MotorGroup leftMotors({-1, -2, -3}, pros::MotorGearset::blue);
pros::MotorGroup rightMotors({4, 5, 6}, pros::MotorGearset::blue);
pros::Imu imu(11);
pros::Motor lift(7, pros::MotorGearset::green, pros::MotorUnits::degrees);  // DR4B, 1:5
pros::Motor intake(10, pros::MotorGearset::blue);
pros::adi::Pneumatics claw('A', false);  // extended = closed
pros::Optical trayEye(9);                // looks down into the tray from above
// GPS 6" behind the turning center, facing backward: tell it the offset (meters)
pros::Gps gps(12, 0, -6 * 0.0254);

lemlib::Drivetrain drivetrain(&leftMotors, &rightMotors, 11.5, lemlib::Omniwheel::NEW_325, 450, 2);
lemlib::ControllerSettings linearController(10, 0, 3, 3, 1, 100, 3, 500, 20);
lemlib::ControllerSettings angularController(2, 0, 10, 3, 1, 100, 3, 500, 0);
lemlib::OdomSensors sensors(nullptr, nullptr, nullptr, nullptr, &imu);
lemlib::Chassis chassis(drivetrain, linearController, angularController, sensors);

// The DR4B is geared 1:5: its bars turn a fifth of the motor.
void liftTo(double barDegrees) { lift.move_absolute(barDegrees * 5, 200); }

// Back up to (x, y): turn the back of the robot toward it, then reverse until the robot's
// center is `standoff` inches from it. The rear claw (11" behind the center) is then right
// over it, at any lift height (a DR4B keeps the same reach).
void backInto(double x, double y, double standoff, float maxSpeed = 100) {
  chassis.turnToPoint(x, y, 700, {.forwards = false});
  chassis.waitUntilDone();
  const lemlib::Pose p = chassis.getPose();
  const double dx = x - p.x, dy = y - p.y, d = std::hypot(dx, dy);
  chassis.moveToPoint(x - dx / d * standoff, y - dy / d * standoff, 1500, {.forwards = false, .maxSpeed = maxSpeed});
  chassis.turnToPoint(x, y, 500, {.forwards = false});
  chassis.waitUntilDone();
}

// Face a waypoint, then drive to it (forwards or backwards): ends close to it with
// little sideways error, unlike a moveToPoint started at an angle.
void goTo(double x, double y, bool forwards = true) {
  chassis.turnToPoint(x, y, 700, {.forwards = forwards});
  chassis.moveToPoint(x, y, 1500, {.forwards = forwards});
}

// Is there a Cup in the tray? The sensor looks down at the top of what's there: a Pin
// shows its colored top half, a Cup is gray or clear (hardly any color saturation).
bool cupInTray() { return trayEye.get_proximity() > 50 && trayEye.get_saturation() < 0.3; }

// Goal R1 and the spot in front of the south red Loader where the intake reaches its
// bottom opening.
constexpr double R1_X = -47.09, R1_Y = -23.55;
constexpr double LOADER_X = -55.5, LOADER_Y = -58.76;  // front bumper ~2" from the Loader
// The lane between Goal R1 / the diagonal stack (west) and Goal R2 (east)
constexpr double LANE_X = -36;
// The rear claw's distance behind the robot's center
constexpr double CLAW_BEHIND = 11;

// From the lane east of R1 down to the Loader (around the diagonal stack at (-47, -47)),
// take `pieces` pieces, wait until the tray has assembled the combo, grab it, and come
// back up the lane. (Turning in place sweeps the robot's corners 10.6" around its center:
// it only turns where that circle is clear of Goal R1.)
void fetchFromLoader(int pieces) {
  goTo(LANE_X, LOADER_Y);
  goTo(LOADER_X, LOADER_Y);
  chassis.turnToHeading(270, 500);  // square to the Loader
  chassis.waitUntilDone();
  // The intake pulls in the Loader's bottom piece at once; the next one takes ~200 ms to
  // drop into the opening. Stop (brake mode: at once) before one piece too many (SG6).
  intake.move(127);
  pros::delay(pieces == 1 ? 100 : 300);
  intake.brake();
  // the pieces ride over the robot into the tray; the Cup lands last, over the Pin
  const std::uint32_t giveUp = pros::millis() + 1500;
  while (!cupInTray() && pros::millis() < giveUp) pros::delay(10);
  claw.extend();  // the claw sits at the tray: grab the combo
  pros::delay(200);
  goTo(LANE_X, LOADER_Y, false);
  goTo(LANE_X, -35);
}

// Back into R1 from the lane, put the combo down, and drive straight back out.
void placeOnR1() {
  backInto(R1_X, R1_Y, CLAW_BEHIND, 70);
  pros::delay(300);  // let the lift reach its height
  claw.retract();
  pros::delay(250);
  chassis.moveToPoint(LANE_X, -35, 1000);  // facing away from R1: straight out, no turn
  chassis.waitUntilDone();
}

void initialize() {
  pros::lcd::initialize();
  chassis.calibrate();
  intake.set_brake_mode(pros::MotorBrake::brake);
  lift.set_brake_mode(pros::MotorBrake::hold);
}

void disabled() {}
void competition_initialize() {}

void autonomous() {
  // The GPS code strip is installed for Skills: start from where the GPS says the robot
  // is (meters -> inches) instead of trusting the start position by hand.
  const pros::gps_status_s_t g = gps.get_position_and_orientation();
  chassis.setPose(g.x / 0.0254, g.y / 0.0254, gps.get_heading() - 180);  // the GPS faces backward
  printf("GPS start (%.1f, %.1f) facing %.0f\n", g.x / 0.0254, g.y / 0.0254, gps.get_heading() - 180);

  // 1. Preload + Cup combo onto R1, lift down (the Pin's bottom drops into the Goal)
  goTo(LANE_X, -37.5);  // into the lane
  fetchFromLoader(1);
  placeOnR1();

  // 2. Two Pin + Cup combos on top; each sits 7.1" higher, so the DR4B rises further
  const double barAngle[] = {20, 39};
  for (int i = 0; i < 2; i++) {
    fetchFromLoader(2);
    liftTo(barAngle[i]);
    placeOnR1();
    liftTo(0);
  }

  // 3. Park with the front of the robot inside the Midfield.
  goTo(LANE_X, -10);
  goTo(-26, -10);
  chassis.waitUntilDone();
  printf("Skills run finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
