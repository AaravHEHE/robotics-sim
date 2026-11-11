#include "main.h"

// Mechanism test for the "Override: DR4B + intake chamber (8059A-style)" robot (plain PROS). Start: Red 2 (bottom wall, west).
//
// Run this first whenever you change the robot (ports, gearing, profile): it drives up the
// lane to an open spot, turns a full circle in 90° steps, then works every mechanism through
// its range: the GPS and chamber sensor are read, the DR4B lifts the Preload to three heights, the clamp lets go and grabs again, and the intake spins both ways. Each check prints PASS or FAIL with what it measured
// in the Console; the last line adds them up. Everything should PASS.

pros::MotorGroup leftDrive({-1, -2, -3}, pros::MotorGears::blue, pros::MotorUnits::degrees);
pros::MotorGroup rightDrive({4, 5, 6}, pros::MotorGears::blue, pros::MotorUnits::degrees);
pros::Imu imu(11);
pros::MotorGroup lift({7, 8}, pros::MotorGears::red, pros::MotorUnits::degrees);  // DR4B, 12:84
pros::Motor intake(10, pros::MotorGears::blue);
pros::adi::Pneumatics clamp('A', true);  // extended = closed (on the Preload)
pros::Optical chamberEye(9);             // looks down into the chamber
pros::Gps gps(12, 0, -6 * 0.0254);       // 6" behind the center, facing backward

// ---------------- checks ----------------
int passed = 0, failed = 0;

// Print PASS or FAIL for one check, with the value it measured.
void check(const char* what, bool ok, double value) {
  printf("%s  %-42s %8.1f\n", ok ? "PASS" : "FAIL", what, value);
  if (ok) passed++;
  else failed++;
}

// Check that `got` is within `tol` of `target`; `fmt` names it, with %g for the target.
void checkNear(const char* fmt, double target, double got, double tol) {
  char what[64];
  snprintf(what, sizeof what, fmt, target);
  check(what, std::fabs(got - target) <= tol, got);
}

// Wait until a motor (or group) is within `tol` degrees of `target`, or `ms` pass.
template <class M>
double settle(M& m, double target, double tol, int ms = 2500) {
  const std::uint32_t end = pros::millis() + ms;
  while (std::fabs(m.get_position() - target) > tol && pros::millis() < end) pros::delay(10);
  pros::delay(100);
  return m.get_position();
}

// ---------------- drivetrain ----------------
// 3.25" traction wheels geared to 360 rpm
constexpr double IN_PER_DEG = 3.25 * M_PI / 360.0 * (360.0 / 600.0);
// From the start up the lane to an open spot where the robot can turn a full circle
// (the robot starts 3" off the wall: the Preload standing in the rear claw is inside the
// field; 20" up, the Preload's 12.6" turning circle stays clear of Goal R1)
constexpr double LANE = 20;

// Drive straight `inches` (P loop on the encoders, heading held with the IMU). Returns the
// distance the encoders measured.
double drive(double inches, int maxSpeed = 100) {
  leftDrive.tare_position_all();
  rightDrive.tare_position_all();
  const double heading = imu.get_rotation();
  const std::uint32_t end = pros::millis() + 3000;
  int settled = 0;
  while (pros::millis() < end && settled < 3) {
    const double traveled = (leftDrive.get_position() + rightDrive.get_position()) / 2 * IN_PER_DEG;
    const double error = inches - traveled;
    settled = std::fabs(error) < 0.3 ? settled + 1 : 0;
    const double power = std::clamp(error * 8.0, -double(maxSpeed), double(maxSpeed));
    const double correction = (heading - imu.get_rotation()) * 2.0;
    leftDrive.move(power + correction);
    rightDrive.move(power - correction);
    pros::delay(10);
  }
  leftDrive.brake();
  rightDrive.brake();
  pros::delay(150);
  return (leftDrive.get_position() + rightDrive.get_position()) / 2 * IN_PER_DEG;
}

// Turn in place to an IMU rotation (degrees, clockwise positive): PD on the gyro rate, so it
// eases in instead of swinging past; ends once on target and stopped.
void turnTo(double target) {
  const std::uint32_t end = pros::millis() + 2500;
  while (pros::millis() < end) {
    const double error = target - imu.get_rotation();
    const double rate = -imu.get_gyro_rate().z;  // deg/s, clockwise positive
    if (std::fabs(error) < 1.0 && std::fabs(rate) < 5.0) break;
    const double power = std::clamp(error * 2.5 - rate * 0.2, -100.0, 100.0);
    leftDrive.move(power);
    rightDrive.move(-power);
    pros::delay(10);
  }
  leftDrive.brake();
  rightDrive.brake();
  pros::delay(150);
}

void driveTest() {
  printf("-- drivetrain --\n");
  checkNear("drove %g in up the lane (encoders)", LANE, drive(LANE), 0.75);
  check("kept straight (IMU rotation)", std::fabs(imu.get_rotation()) < 2, imu.get_rotation());
  for (double target = 90; target <= 360; target += 90) {
    turnTo(target);
    checkNear("turned to %g deg (IMU)", target, imu.get_rotation(), 1.5);
  }
}

void driveBack() {
  printf("-- back to the start --\n");
  checkNear("drove %g in back down the lane", -LANE, drive(-LANE), 0.75);
}

// ---------------- mechanisms ----------------
void mechanismTest() {
  printf("-- sensors --\n");
  const pros::gps_status_s_t g = gps.get_position_and_orientation();
  // the start is (-37, -57.6); LANE inches up the lane is (-37, -37.6)
  checkNear("GPS x %g in", -37, g.x / 0.0254, 1.5);
  checkNear("GPS y %g in", -57.6 + LANE, g.y / 0.0254, 1.5);
  check("chamber eye sees the Preload", chamberEye.get_proximity() > 50, chamberEye.get_proximity());
  printf("-- DR4B (12:84) --\n");
  for (double deg : {30.0, 60.0, 90.0, 0.0}) {
    lift.move_absolute(deg * 7, 200);
    checkNear("DR4B to %g deg", deg, settle(lift, deg * 7, 21.0) / 7, 3);
  }
  printf("-- chamber clamp: lets go of the Preload, then grabs it again --\n");
  clamp.retract();
  pros::delay(400);  // it drops out behind the robot
  check("clamp open", !clamp.is_extended(), clamp.is_extended());
  clamp.extend();
  pros::delay(300);
  check("clamp closed", clamp.is_extended(), clamp.is_extended());
  printf("-- intake --\n");
  intake.move(127);
  pros::delay(400);
  check("intake spinning in (rpm)", intake.get_actual_velocity() > 500, intake.get_actual_velocity());
  intake.move(-127);
  pros::delay(400);
  check("intake spinning out (rpm)", intake.get_actual_velocity() < -500, intake.get_actual_velocity());
  intake.brake();
}

void initialize() {
  pros::lcd::initialize();
  imu.reset(true);  // blocks ~2 s while the IMU calibrates
  leftDrive.set_brake_mode_all(pros::MotorBrake::hold);
  rightDrive.set_brake_mode_all(pros::MotorBrake::hold);
  lift.set_brake_mode_all(pros::MotorBrake::hold);
}

void autonomous() {
  printf("Mechanism test: Override: DR4B + intake chamber (8059A-style)\n");
  driveTest();
  mechanismTest();
  driveBack();
  printf("RESULT %d passed, %d failed\n", passed, failed);
}

void disabled() {}
void competition_initialize() {}

void opcontrol() {
  while (true) pros::delay(20);
}
