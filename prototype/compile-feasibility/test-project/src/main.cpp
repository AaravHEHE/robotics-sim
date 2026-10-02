#include "main.h"
#include "robot.hpp"

/**
 * Runs initialization code. This occurs as soon as the program is started.
 */
void initialize() {
  chassis.calibrate();  // blocks ~2 s for IMU calibration
  startIntakeTask();
  std::printf("initialized at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void disabled() {}

void competition_initialize() {}

/**
 * Runs the user autonomous code.
 */
void autonomous() {
  std::uint32_t start = pros::millis();
  autonRight();
  std::printf("auton finished in %u ms\n", static_cast<unsigned>(pros::millis() - start));
}

void opcontrol() {
  while (true) {
    pros::delay(20);
  }
}
