#include <cstdio>
#include <vector>
#include "robot.hpp"

namespace {
struct Waypoint {
  float x, y;
  bool intake;
};

void logPose(const char* tag) {
  lemlib::Pose p = chassis.getPose();
  std::printf("[%6u ms] %-10s x=%7.2f y=%7.2f theta=%7.2f\n", static_cast<unsigned>(pros::millis()), tag, p.x, p.y,
              p.theta);
}

void runPath(const std::vector<Waypoint>& path, float maxSpeed) {
  for (const auto& wp : path) {
    setIntake(wp.intake ? IntakeMode::In : IntakeMode::Off);
    chassis.moveToPoint(wp.x, wp.y, 2000, {.maxSpeed = maxSpeed});
    chassis.waitUntilDone();
    logPose("waypoint");
  }
}
}  // namespace

void driveSquare(float side) {
  lemlib::Pose start = chassis.getPose();
  float corners[4][2] = {{0, side}, {side, side}, {side, 0}, {0, 0}};
  for (auto& c : corners) {
    chassis.moveToPoint(start.x + c[0], start.y + c[1], 1500);
    chassis.waitUntilDone();
  }
  chassis.turnToHeading(0, 1000);
  chassis.waitUntilDone();
  logPose("square");
}

void autonRight() {
  chassis.setPose(0, 0, 0);
  logPose("start");

  // Drive forward while intaking, then back up and turn toward goal.
  setIntake(IntakeMode::In);
  chassis.moveToPoint(0, 24, 2000);
  chassis.waitUntil(12);
  logPose("halfway");
  chassis.waitUntilDone();
  logPose("pickup");

  chassis.moveToPoint(0, 12, 1500, {.forwards = false, .maxSpeed = 90});
  chassis.turnToHeading(90, 1000);
  chassis.waitUntilDone();
  logPose("turned");

  // Raw PROS motor control: drive forward open-loop for 400 ms.
  chassis.cancelAllMotions();
  leftMotors.move(80);
  rightMotors.move(80);
  pros::delay(400);
  leftMotors.move(0);
  rightMotors.move(0);
  logPose("openloop");

  setIntake(IntakeMode::Out);
  pros::delay(500);
  setIntake(IntakeMode::Off);

  // Turn using the IMU directly (bang-bang), as many teams do without a library.
  while (imu.get_heading() < 175 || imu.get_heading() > 185) {
    leftMotors.move(50);
    rightMotors.move(-50);
    pros::delay(10);
  }
  leftMotors.move(0);
  rightMotors.move(0);
  logPose("imuturn");

  runPath({{24, 0, true}, {24, -24, true}, {0, -24, false}}, 100);
}

void autonSkillsStart() {
  chassis.setPose(-48, -60, 0);
  driveSquare(24);
}
