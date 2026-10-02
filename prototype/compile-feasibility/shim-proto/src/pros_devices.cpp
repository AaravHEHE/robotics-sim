#include <cmath>
#include "pros/imu.hpp"
#include "pros/motors.hpp"
#include "sim/abi.h"

namespace pros {
inline namespace v5 {
// ---- Motor ----
Motor::Motor(const std::int8_t port, const MotorGears gearset, const MotorUnits) : port_(port) {
  sim_motor_config(port, static_cast<std::int32_t>(gearset));
}
std::int32_t Motor::move(std::int32_t voltage) const { sim_motor_move(port_, voltage); return 1; }
std::int32_t Motor::move_velocity(const std::int32_t velocity) const { sim_motor_move_velocity(port_, velocity); return 1; }
std::int32_t Motor::move_voltage(const std::int32_t mv) const { sim_motor_move(port_, mv * 127 / 12000); return 1; }
std::int32_t Motor::brake(void) const { sim_motor_move_velocity(port_, 0); return 1; }
double Motor::get_position(const std::uint8_t) const { return sim_motor_get_position(port_); }
std::int32_t Motor::tare_position(const std::uint8_t) const { sim_motor_tare(port_); return 1; }
std::int32_t Motor::set_brake_mode(const MotorBrake, const std::uint8_t) const { return 1; }

// ---- MotorGroup ----
MotorGroup::MotorGroup(const std::initializer_list<std::int8_t> ports, const MotorGears gearset, const MotorUnits)
    : ports_(ports) {
  for (auto p : ports_) sim_motor_config(p, static_cast<std::int32_t>(gearset));
}
std::int32_t MotorGroup::move(std::int32_t voltage) const { for (auto p : ports_) sim_motor_move(p, voltage); return 1; }
std::int32_t MotorGroup::move_velocity(const std::int32_t v) const { for (auto p : ports_) sim_motor_move_velocity(p, v); return 1; }
std::int32_t MotorGroup::move_voltage(const std::int32_t mv) const { return move(mv * 127 / 12000); }
std::int32_t MotorGroup::brake(void) const { return move_velocity(0); }
double MotorGroup::get_position(const std::uint8_t index) const {
  return index < ports_.size() ? sim_motor_get_position(ports_[index]) : INFINITY;
}
std::int32_t MotorGroup::tare_position(const std::uint8_t index) const {
  if (index < ports_.size()) sim_motor_tare(ports_[index]);
  return 1;
}
std::int32_t MotorGroup::set_brake_mode_all(const MotorBrake) const { return 1; }

// ---- Imu ----
std::int32_t Imu::reset(bool blocking) const {
  if (blocking) sim_delay(2000);  // real IMU calibration takes ~2 s
  return 1;
}
double Imu::get_rotation() const { return sim_imu_get_rotation(port_); }
double Imu::get_heading() const {
  double h = std::fmod(get_rotation(), 360.0);
  return h < 0 ? h + 360.0 : h;
}
std::int32_t Imu::set_rotation(const double target) const { sim_imu_set_rotation(port_, target); return 1; }
std::int32_t Imu::set_heading(const double target) const { return set_rotation(target); }
std::int32_t Imu::tare() const { return set_rotation(0); }
}  // namespace v5
}  // namespace pros
