// Ideal odometry for LemLib (replaces src/lemlib/chassis/odom.cpp). The simulator
// knows the true pose; LemLib's frame is re-based whenever setPose is called.
#include <cmath>
#include "lemlib/chassis/odom.hpp"
#include "lemlib/util.hpp"
#include "sim/abi.h"

namespace {
lemlib::Pose fromSim(const double* p, bool radians) {
  return lemlib::Pose(static_cast<float>(p[0]), static_cast<float>(p[1]),
                      static_cast<float>(radians ? p[2] * M_PI / 180.0 : p[2]));
}
}  // namespace

void lemlib::setSensors(lemlib::OdomSensors sensors, lemlib::Drivetrain drivetrain) {
  std::vector<std::int8_t> l = drivetrain.leftMotors->get_port_all();
  std::vector<std::int8_t> r = drivetrain.rightMotors->get_port_all();
  sim_chassis_config(l.data(), static_cast<std::int32_t>(l.size()), r.data(), static_cast<std::int32_t>(r.size()),
                     drivetrain.trackWidth, drivetrain.wheelDiameter, drivetrain.rpm,
                     sensors.imu ? sensors.imu->get_port() : 0);
}

lemlib::Pose lemlib::getPose(bool radians) {
  double p[3];
  sim_odom_get(p);
  return fromSim(p, radians);
}

void lemlib::setPose(lemlib::Pose pose, bool radians) {
  sim_odom_set(pose.x, pose.y, radians ? pose.theta * 180.0 / M_PI : pose.theta);
}

lemlib::Pose lemlib::getSpeed(bool radians) {
  double p[3];
  sim_odom_speed(0, p);
  return fromSim(p, radians);
}

lemlib::Pose lemlib::getLocalSpeed(bool radians) {
  double p[3];
  sim_odom_speed(1, p);
  return fromSim(p, radians);
}

lemlib::Pose lemlib::estimatePose(float time, bool radians) {
  lemlib::Pose pose = lemlib::getPose(true);
  lemlib::Pose local = lemlib::getLocalSpeed(true);
  float theta = pose.theta + local.theta * time;
  float dx = local.x * time, dy = local.y * time;
  // rotate the local displacement into the global frame (LemLib uses standard math angles internally)
  pose.x += dy * std::sin(pose.theta) + dx * std::cos(pose.theta);
  pose.y += dy * std::cos(pose.theta) - dx * std::sin(pose.theta);
  pose.theta = theta;
  if (!radians) pose.theta = pose.theta * 180.0f / static_cast<float>(M_PI);
  return pose;
}

void lemlib::update() {}
void lemlib::init() {}
