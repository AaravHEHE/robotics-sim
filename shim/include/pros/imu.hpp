// PROS inertial sensor subset for the simulator (PROS 4 signatures). Prototype only.
#ifndef _PROS_IMU_HPP_
#define _PROS_IMU_HPP_
#include <cstdint>

namespace pros {
inline namespace v5 {
class Imu {
 public:
  explicit Imu(const std::uint8_t port) : port_(port) {}
  std::int32_t reset(bool blocking = false) const;
  bool is_calibrating() const { return false; }
  double get_heading() const;
  double get_rotation() const;
  std::int32_t set_heading(const double target) const;
  std::int32_t set_rotation(const double target) const;
  std::int32_t tare() const;
  std::uint8_t get_port() const { return port_; }

 private:
  std::uint8_t port_;
};
}  // namespace v5
}  // namespace pros

#endif  // _PROS_IMU_HPP_
