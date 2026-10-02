// PROS motor subset for the simulator (PROS 4 signatures). Prototype only.
#ifndef _PROS_MOTORS_HPP_
#define _PROS_MOTORS_HPP_
#include <cstdint>
#include <initializer_list>
#include <vector>

namespace pros {
inline namespace v5 {
enum class MotorGears {
  ratio_36_to_1 = 0, red = ratio_36_to_1, rpm_100 = ratio_36_to_1,
  ratio_18_to_1 = 1, green = ratio_18_to_1, rpm_200 = ratio_18_to_1,
  ratio_6_to_1 = 2, blue = ratio_6_to_1, rpm_600 = ratio_6_to_1,
  invalid = INT32_MAX
};
using MotorGearset = MotorGears;
using MotorCart = MotorGears;
using MotorCartridge = MotorGears;

enum class MotorBrake { coast = 0, brake = 1, hold = 2, invalid = INT32_MAX };
enum class MotorUnits { degrees = 0, deg = 0, rotations = 1, counts = 2, invalid = INT32_MAX };
using MotorEncoderUnits = MotorUnits;

class Motor {
 public:
  explicit Motor(const std::int8_t port, const MotorGears gearset = MotorGears::green,
                 const MotorUnits encoder_units = MotorUnits::degrees);
  std::int32_t move(std::int32_t voltage) const;
  std::int32_t move_velocity(const std::int32_t velocity) const;
  std::int32_t move_voltage(const std::int32_t voltage) const;
  std::int32_t brake(void) const;
  double get_position(const std::uint8_t index = 0) const;
  std::int32_t tare_position(const std::uint8_t index = 0) const;
  std::int32_t set_brake_mode(const MotorBrake mode, const std::uint8_t index = 0) const;
  std::int8_t get_port(const std::uint8_t index = 0) const { return port_; }

 private:
  std::int8_t port_;
};

class MotorGroup {
 public:
  MotorGroup(const std::initializer_list<std::int8_t> ports, const MotorGears gearset = MotorGears::green,
             const MotorUnits encoder_units = MotorUnits::degrees);
  std::int32_t move(std::int32_t voltage) const;
  std::int32_t move_velocity(const std::int32_t velocity) const;
  std::int32_t move_voltage(const std::int32_t voltage) const;
  std::int32_t brake(void) const;
  double get_position(const std::uint8_t index = 0) const;
  std::int32_t tare_position(const std::uint8_t index = 0) const;
  std::int32_t set_brake_mode_all(const MotorBrake mode) const;
  std::vector<std::int8_t> get_port_all(void) const { return ports_; }
  std::int8_t size() const { return static_cast<std::int8_t>(ports_.size()); }

 private:
  std::vector<std::int8_t> ports_;
};
}  // namespace v5
}  // namespace pros

#endif  // _PROS_MOTORS_HPP_
