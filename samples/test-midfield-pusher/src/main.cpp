#include "main.h"

// Mechanism test for the "Override: Midfield pusher" robot (plain PROS). Start: Red 2 (bottom wall, west).
//
// Run this first whenever you change the robot (ports, gearing, profile): it drives up the
// lane to an open spot, turns a full circle in 90° steps, then works every mechanism through
// its range (it has none: instead the motor brake modes are compared). Each check prints PASS or FAIL with what it measured
// in the Console; the last line adds them up. Everything should PASS.

pros::MotorGroup leftDrive({-1, -2, -3}, pros::MotorGears::blue, pros::MotorUnits::degrees);
pros::MotorGroup rightDrive({4, 5, 6}, pros::MotorGears::blue, pros::MotorUnits::degrees);
pros::Imu imu(11);

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
// 4" traction wheels geared 600 -> 333 rpm
constexpr double IN_PER_DEG = 4.0 * M_PI / 360.0 * (333.0 / 600.0);
// From the start up the lane to an open spot where the robot can turn a full circle
constexpr double LANE = 24.5;

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
// How far the drive has gone since the encoders were zeroed (in, signed).
double traveled() { return (leftDrive.get_position() + rightDrive.get_position()) / 2 * IN_PER_DEG; }

// Drive at full power for 200 ms, then let go with a brake mode. Sets rolledOn to how far
// the robot kept going after letting go; returns how far it went in all (in, signed).
double rollOn(pros::MotorBrake mode, int dir, double& rolledOn) {
  leftDrive.set_brake_mode_all(mode);
  rightDrive.set_brake_mode_all(mode);
  leftDrive.tare_position_all();
  rightDrive.tare_position_all();
  leftDrive.move(127 * dir);
  rightDrive.move(127 * dir);
  pros::delay(200);
  const double atRelease = traveled();
  leftDrive.brake();
  rightDrive.brake();
  pros::delay(800);
  rolledOn = std::fabs(traveled() - atRelease);
  return traveled();
}

void mechanismTest() {
  printf("-- brake modes: how far it rolls on after letting go --\n");
  double coast = 0, hold = 0;
  const double down = rollOn(pros::MotorBrake::coast, -1, coast);  // back down the lane...
  const double up = rollOn(pros::MotorBrake::hold, 1, hold);       // ...and up again
  printf("      coast %.1f in, hold %.1f in\n", coast, hold);
  check("coast rolls on (in)", coast > 2, coast);
  check("hold stops shorter than coast (in)", hold < coast, coast - hold);
  leftDrive.set_brake_mode_all(pros::MotorBrake::hold);
  rightDrive.set_brake_mode_all(pros::MotorBrake::hold);
  drive(-(down + up));  // back to where it turned
  check("still facing up the lane (IMU rotation)", std::fabs(imu.get_rotation() - 360) < 2, imu.get_rotation());
}

void initialize() {
  pros::lcd::initialize();
  imu.reset(true);  // blocks ~2 s while the IMU calibrates
  leftDrive.set_brake_mode_all(pros::MotorBrake::hold);
  rightDrive.set_brake_mode_all(pros::MotorBrake::hold);
}

void autonomous() {
  printf("Mechanism test: Override: Midfield pusher\n");
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
