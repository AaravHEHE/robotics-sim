#include "main.h"

// Plain PROS (no motion library). Matches the "6-motor tank, 450 rpm" robot preset:
// left drive 1-3 (reversed), right drive 4-6, intake on 10, IMU on 11, clamp on ADI A.
pros::MotorGroup leftDrive({-1, -2, -3}, pros::MotorGears::blue, pros::MotorUnits::degrees);
pros::MotorGroup rightDrive({4, 5, 6}, pros::MotorGears::blue, pros::MotorUnits::degrees);
pros::Motor intake(10, pros::MotorGears::blue);
pros::Imu imu(11);
pros::adi::Pneumatics clamp('A', false);

// 3.25" wheels geared 36:48 (450 rpm from 600 rpm motors)
constexpr double WHEEL_IN_PER_MOTOR_DEG = 3.25 * M_PI / 360.0 * (450.0 / 600.0);

// Drive straight using motor encoders, holding the starting heading with the IMU.
void drive(double inches, int speed = 100) {
  leftDrive.tare_position_all();
  rightDrive.tare_position_all();
  const double heading = imu.get_rotation();
  const int dir = inches > 0 ? 1 : -1;
  while (std::fabs(leftDrive.get_position() * WHEEL_IN_PER_MOTOR_DEG) < std::fabs(inches)) {
    const double correction = (heading - imu.get_rotation()) * 2.0;
    leftDrive.move(speed * dir + correction);
    rightDrive.move(speed * dir - correction);
    pros::delay(10);
  }
  leftDrive.brake();
  rightDrive.brake();
  pros::delay(250);
}

// Turn in place to an absolute IMU heading (degrees, clockwise positive): a PD loop.
// The D term uses the IMU's gyro rate so the robot eases into the target instead of
// swinging past it; the turn ends once it is on target and has stopped (or after 2 s).
void turnTo(double target) {
  const std::uint32_t end = pros::millis() + 2000;
  while (pros::millis() < end) {
    const double error = target - imu.get_rotation();
    const double rate = -imu.get_gyro_rate().z;  // deg/s, clockwise positive
    if (std::fabs(error) < 1.0 && std::fabs(rate) < 5.0) break;
    const double power = std::clamp(error * 2.0 - rate * 0.2, -80.0, 80.0);
    leftDrive.move(power);
    rightDrive.move(-power);
    pros::delay(10);
  }
  leftDrive.brake();
  rightDrive.brake();
  pros::delay(200);
}

void initialize() {
  pros::lcd::initialize();
  imu.reset(true);  // blocks ~2 s while the IMU calibrates
  leftDrive.set_brake_mode_all(pros::MotorBrake::hold);
  rightDrive.set_brake_mode_all(pros::MotorBrake::hold);

  // Show the heading on the brain screen from a background task.
  pros::Task screen([] {
    while (true) {
      pros::lcd::print(0, "Heading: %.1f", imu.get_heading());
      pros::delay(100);
    }
  });
}

void disabled() {}
void competition_initialize() {}

void autonomous() {
  intake.move(127);       // start intaking
  drive(30);              // drive to a game element
  clamp.extend();         // grab it
  turnTo(90);
  drive(24);
  intake.move(-127);      // score
  pros::delay(500);
  intake.brake();
  clamp.retract();
  drive(-12, 60);
  turnTo(0);
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
