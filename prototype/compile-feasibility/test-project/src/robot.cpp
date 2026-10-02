#include "robot.hpp"

// Drivetrain: 3 blue motors per side, 450 rpm on 3.25" omnis
pros::MotorGroup leftMotors({-1, -2, -3}, pros::MotorGearset::blue);
pros::MotorGroup rightMotors({4, 5, 6}, pros::MotorGearset::blue);
pros::Motor intake(10, pros::MotorGearset::blue);
pros::Imu imu(11);

lemlib::Drivetrain drivetrain(&leftMotors,                 // left motor group
                              &rightMotors,                // right motor group
                              11.5,                        // track width (in)
                              lemlib::Omniwheel::NEW_325,  // wheel diameter
                              450,                         // drivetrain rpm
                              2                            // horizontal drift
);

lemlib::ControllerSettings linearController(10,   // kP
                                            0,    // kI
                                            3,    // kD
                                            3,    // anti windup
                                            1,    // small error range (in)
                                            100,  // small error timeout (ms)
                                            3,    // large error range (in)
                                            500,  // large error timeout (ms)
                                            20    // slew
);

lemlib::ControllerSettings angularController(2, 0, 10, 3, 1, 100, 3, 500, 0);

lemlib::OdomSensors sensors(nullptr, nullptr, nullptr, nullptr, &imu);

lemlib::Chassis chassis(drivetrain, linearController, angularController, sensors);

// ---------------- intake state machine running in its own task ----------------
namespace {
IntakeMode g_mode = IntakeMode::Off;
int g_jamTicks = 0;
}  // namespace

void setIntake(IntakeMode mode) { g_mode = mode; }

void startIntakeTask() {
  pros::Task intakeTask([] {
    while (true) {
      switch (g_mode) {
        case IntakeMode::Off: intake.move(0); break;
        case IntakeMode::In: intake.move(127); break;
        case IntakeMode::Out: intake.move(-127); break;
      }
      // pretend jam detection: reverse briefly every 1.5 s while intaking
      if (g_mode == IntakeMode::In && ++g_jamTicks % 150 == 0) {
        intake.move(-127);
        pros::delay(100);
      }
      pros::delay(10);
    }
  }, "intake");
}
