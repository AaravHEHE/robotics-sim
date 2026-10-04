#include "main.h"

// Mechanism test for the "Override: Banshee (intake + arm + roller claw)" robot (plain PROS). Start: Red 2 (bottom wall, west).
//
// Run this first whenever you change the robot (ports, gearing, profile): it drives up the
// lane to an open spot, turns a full circle in 90° steps, then works every mechanism through
// its range: the arm to three angles with the wrist keeping the claw upright, the roller claw rolls the Preload out and back in, and the intake spins. Each check prints PASS or FAIL with what it measured
// in the Console; the last line adds them up. Everything should PASS.

pros::MotorGroup leftDrive({-1, -2, -3}, pros::MotorGears::blue, pros::MotorUnits::degrees);
pros::MotorGroup rightDrive({4, 5, 6}, pros::MotorGears::blue, pros::MotorUnits::degrees);
pros::Imu imu(11);
pros::Motor arm(7, pros::MotorGears::green, pros::MotorUnits::degrees);     // 1:5 to the arm
pros::Motor wrist(8, pros::MotorGears::green, pros::MotorUnits::degrees);   // 12:48 to the claw
pros::Motor rollers(9, pros::MotorGears::green);                            // roller claw
pros::Motor intake(10, pros::MotorGears::green);

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
// 3.25" wheels geared 36:48 (450 rpm from 600 rpm motors)
constexpr double IN_PER_DEG = 3.25 * M_PI / 360.0 * (450.0 / 600.0);
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
// The claw turns with the arm, so the wrist turns back by the same angle to keep it upright.
void armTo(double deg) {
  arm.move_absolute(deg * 5, 200);
  wrist.move_absolute(-deg * 4, 200);
}

void mechanismTest() {
  printf("-- arm (1:5) with the wrist (12:48) keeping the claw upright --\n");
  for (double deg : {30.0, 60.0, 90.0, 0.0}) {
    armTo(deg);
    checkNear("arm to %g deg", deg, settle(arm, deg * 5, 15) / 5, 3);
    checkNear("wrist at %g deg (claw upright)", -deg, settle(wrist, -deg * 4, 12) / 4, 3);
  }
  printf("-- roller claw: out, then back in --\n");
  rollers.move(-127);  // spit the Preload out
  pros::delay(300);
  check("rollers spinning out (rpm)", rollers.get_actual_velocity() < -150, rollers.get_actual_velocity());
  pros::delay(300);
  rollers.brake();
  pros::delay(300);
  rollers.move(127);   // pull it back in from the floor in front
  pros::delay(300);
  check("rollers spinning in (rpm)", rollers.get_actual_velocity() > 150, rollers.get_actual_velocity());
  pros::delay(500);
  rollers.brake();
  printf("-- intake --\n");
  intake.move(127);
  pros::delay(400);
  check("intake spinning in (rpm)", intake.get_actual_velocity() > 150, intake.get_actual_velocity());
  intake.brake();
}

void initialize() {
  pros::lcd::initialize();
  imu.reset(true);  // blocks ~2 s while the IMU calibrates
  leftDrive.set_brake_mode_all(pros::MotorBrake::hold);
  rightDrive.set_brake_mode_all(pros::MotorBrake::hold);
  arm.set_brake_mode(pros::MotorBrake::hold);
  wrist.set_brake_mode(pros::MotorBrake::hold);
}

void autonomous() {
  printf("Mechanism test: Override: Banshee (intake + arm + roller claw)\n");
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
