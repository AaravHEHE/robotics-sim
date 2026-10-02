// Idealized LemLib 0.5 motions (replace src/lemlib/chassis/motions/*.cpp).
//
// Queueing, async tasks, waitUntil and cancellation follow LemLib exactly (same
// requestMotionStart / endMotion / distTraveled protocol, same 10 ms loop period).
// The PID loop is replaced by the simulator's motion planner: tuning constants are
// accepted and ignored, and motion is limited only by the robot profile's real
// drivetrain speed and acceleration.
#include <cmath>
#include <initializer_list>
#include "lemlib/chassis/chassis.hpp"
#include "pros/rtos.hpp"
#include "sim/abi.h"

namespace {
double dirCode(lemlib::AngularDirection d) {
  switch (d) {
    case lemlib::AngularDirection::CW_CLOCKWISE: return 1;
    case lemlib::AngularDirection::CCW_COUNTERCLOCKWISE: return -1;
    default: return 0;
  }
}
double sideCode(lemlib::DriveSide s) { return s == lemlib::DriveSide::LEFT ? 0 : 1; }
}  // namespace

// Shared body of every synchronous motion: hand the motion to the simulator and
// poll it every 10 ms, exactly like LemLib's control loops.
#define SIM_RUN_MOTION(KIND, ...)                                      \
  do {                                                                 \
    const double simParams[] = {__VA_ARGS__};                          \
    distTraveled = 0;                                                  \
    sim_motion_start(KIND, simParams, sizeof(simParams) / sizeof(double)); \
    while (true) {                                                     \
      pros::delay(10);                                                 \
      if (!this->motionRunning) {                                      \
        sim_motion_cancel();                                           \
        break;                                                         \
      }                                                                \
      const double progress = sim_motion_poll();                       \
      if (progress < 0) break;                                         \
      distTraveled = static_cast<float>(progress);                     \
    }                                                                  \
    drivetrain.leftMotors->move(0);                                    \
    drivetrain.rightMotors->move(0);                                   \
    distTraveled = -1;                                                 \
    this->endMotion();                                                 \
  } while (0)

void lemlib::Chassis::moveToPoint(float x, float y, int timeout, MoveToPointParams params, bool async) {
  params.earlyExitRange = std::fabs(params.earlyExitRange);
  this->requestMotionStart();
  if (!this->motionRunning) return;
  if (async) {
    pros::Task task([&]() { moveToPoint(x, y, timeout, params, false); });
    this->endMotion();
    pros::delay(10);
    return;
  }
  SIM_RUN_MOTION(SIM_MOTION_MOVE_TO_POINT, x, y, static_cast<double>(timeout), params.forwards ? 1.0 : 0.0,
                 params.maxSpeed, params.minSpeed, params.earlyExitRange);
}

void lemlib::Chassis::moveToPose(float x, float y, float theta, int timeout, MoveToPoseParams params, bool async) {
  params.earlyExitRange = std::fabs(params.earlyExitRange);
  this->requestMotionStart();
  if (!this->motionRunning) return;
  if (async) {
    pros::Task task([&]() { moveToPose(x, y, theta, timeout, params, false); });
    this->endMotion();
    pros::delay(10);
    return;
  }
  SIM_RUN_MOTION(SIM_MOTION_MOVE_TO_POSE, x, y, theta, static_cast<double>(timeout), params.forwards ? 1.0 : 0.0,
                 params.maxSpeed, params.minSpeed, params.earlyExitRange, params.lead);
}

void lemlib::Chassis::turnToHeading(float theta, int timeout, TurnToHeadingParams params, bool async) {
  params.earlyExitRange = std::fabs(params.earlyExitRange);
  this->requestMotionStart();
  if (!this->motionRunning) return;
  if (async) {
    pros::Task task([&]() { turnToHeading(theta, timeout, params, false); });
    this->endMotion();
    pros::delay(10);
    return;
  }
  SIM_RUN_MOTION(SIM_MOTION_TURN_TO_HEADING, theta, static_cast<double>(timeout), dirCode(params.direction),
                 static_cast<double>(params.maxSpeed), static_cast<double>(params.minSpeed), params.earlyExitRange);
}

void lemlib::Chassis::turnToPoint(float x, float y, int timeout, TurnToPointParams params, bool async) {
  params.earlyExitRange = std::fabs(params.earlyExitRange);
  this->requestMotionStart();
  if (!this->motionRunning) return;
  if (async) {
    pros::Task task([&]() { turnToPoint(x, y, timeout, params, false); });
    this->endMotion();
    pros::delay(10);
    return;
  }
  SIM_RUN_MOTION(SIM_MOTION_TURN_TO_POINT, x, y, static_cast<double>(timeout), params.forwards ? 1.0 : 0.0,
                 dirCode(params.direction), static_cast<double>(params.maxSpeed),
                 static_cast<double>(params.minSpeed), params.earlyExitRange);
}

void lemlib::Chassis::swingToHeading(float theta, DriveSide lockedSide, int timeout, SwingToHeadingParams params,
                                     bool async) {
  params.earlyExitRange = std::fabs(params.earlyExitRange);
  this->requestMotionStart();
  if (!this->motionRunning) return;
  if (async) {
    pros::Task task([&]() { swingToHeading(theta, lockedSide, timeout, params, false); });
    this->endMotion();
    pros::delay(10);
    return;
  }
  SIM_RUN_MOTION(SIM_MOTION_SWING_TO_HEADING, theta, sideCode(lockedSide), static_cast<double>(timeout),
                 dirCode(params.direction), params.maxSpeed, params.minSpeed, params.earlyExitRange);
}

void lemlib::Chassis::swingToPoint(float x, float y, DriveSide lockedSide, int timeout, SwingToPointParams params,
                                   bool async) {
  params.earlyExitRange = std::fabs(params.earlyExitRange);
  this->requestMotionStart();
  if (!this->motionRunning) return;
  if (async) {
    pros::Task task([&]() { swingToPoint(x, y, lockedSide, timeout, params, false); });
    this->endMotion();
    pros::delay(10);
    return;
  }
  SIM_RUN_MOTION(SIM_MOTION_SWING_TO_POINT, x, y, sideCode(lockedSide), static_cast<double>(timeout),
                 params.forwards ? 1.0 : 0.0, dirCode(params.direction), params.maxSpeed, params.minSpeed,
                 params.earlyExitRange);
}

void lemlib::Chassis::follow(const asset& path, float lookahead, int timeout, bool forwards, bool async) {
  this->requestMotionStart();
  if (!this->motionRunning) return;
  if (async) {
    pros::Task task([&]() { follow(path, lookahead, timeout, forwards, false); });
    this->endMotion();
    pros::delay(10);
    return;
  }
  sim_motion_path(path.buf, path.size);
  SIM_RUN_MOTION(SIM_MOTION_FOLLOW, lookahead, static_cast<double>(timeout), forwards ? 1.0 : 0.0);
}
