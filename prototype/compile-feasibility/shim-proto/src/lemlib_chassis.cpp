// Idealized LemLib Chassis: motions are executed by the simulator's motion
// planner. LemLib 0.5 semantics: a new motion waits for the previous one to
// finish; async=false additionally waits for the new motion to finish.
#include <cmath>
#include <vector>
#include "lemlib/api.hpp"
#include "sim/abi.h"

namespace lemlib {
Chassis::Chassis(Drivetrain drivetrain, ControllerSettings, ControllerSettings, OdomSensors sensors)
    : drivetrain_(drivetrain), sensors_(sensors) {
  std::vector<std::int8_t> l = drivetrain.leftMotors->get_port_all();
  std::vector<std::int8_t> r = drivetrain.rightMotors->get_port_all();
  sim_chassis_config(l.data(), static_cast<std::int32_t>(l.size()), r.data(), static_cast<std::int32_t>(r.size()),
                     drivetrain.trackWidth, drivetrain.wheelDiameter, drivetrain.rpm,
                     sensors.imu ? sensors.imu->get_port() : 0);
}

void Chassis::calibrate(bool calibrateIMU) {
  if (calibrateIMU && sensors_.imu) sensors_.imu->reset(true);
}

void Chassis::setPose(float x, float y, float theta, bool radians) {
  sim_pose_set(x, y, radians ? theta * 180.0 / M_PI : theta);
}
void Chassis::setPose(Pose pose, bool radians) { setPose(pose.x, pose.y, pose.theta, radians); }

Pose Chassis::getPose(bool radians, bool standardPos) {
  double p[3];
  sim_pose_get(p);
  double theta = standardPos ? 90.0 - p[2] : p[2];
  return Pose(static_cast<float>(p[0]), static_cast<float>(p[1]),
              static_cast<float>(radians ? theta * M_PI / 180.0 : theta));
}

void Chassis::waitUntil(float dist) { sim_motion_wait(dist); }
void Chassis::waitUntilDone() { sim_motion_wait(-1); }
void Chassis::cancelMotion() { sim_motion_cancel(); }
void Chassis::cancelAllMotions() { sim_motion_cancel(); }
bool Chassis::isInMotion() const { return sim_motion_is_active() != 0; }

void Chassis::moveToPoint(float x, float y, int timeout, MoveToPointParams params, bool async) {
  sim_motion_wait(-1);
  sim_motion_move_to_point(x, y, timeout, params.forwards, params.maxSpeed);
  if (!async) sim_motion_wait(-1);
}

void Chassis::turnToHeading(float theta, int timeout, TurnToHeadingParams params, bool async) {
  sim_motion_wait(-1);
  sim_motion_turn_to_heading(theta, timeout, static_cast<std::int32_t>(params.direction), params.maxSpeed);
  if (!async) sim_motion_wait(-1);
}
}  // namespace lemlib
