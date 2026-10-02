// LemLib 0.5.x public API subset, re-implemented with idealized motion.
// PID / tuning values are accepted and ignored. Prototype only.
#ifndef _LEMLIB_API_HPP_
#define _LEMLIB_API_HPP_
#include <cstdint>
#include "pros/motors.hpp"
#include "pros/imu.hpp"

namespace lemlib {
namespace Omniwheel {
constexpr float NEW_2 = 2.125, NEW_275 = 2.75, OLD_275 = 2.75, NEW_275_HALF = 2.744, OLD_275_HALF = 2.74,
                NEW_325 = 3.25, OLD_325 = 3.25, NEW_325_HALF = 3.246, OLD_325_HALF = 3.246, NEW_4 = 4, OLD_4 = 4.18,
                NEW_4_HALF = 3.995, OLD_4_HALF = 4.175;
}

class Pose {
 public:
  float x, y, theta;
  Pose(float x, float y, float theta = 0) : x(x), y(y), theta(theta) {}
};

class TrackingWheel {
 public:
  TrackingWheel(pros::Motor*, float, float, float = 0) {}
  TrackingWheel(pros::MotorGroup*, float, float, float) {}
};

class Drivetrain {
 public:
  Drivetrain(pros::MotorGroup* leftMotors, pros::MotorGroup* rightMotors, float trackWidth, float wheelDiameter,
             float rpm, float horizontalDrift)
      : leftMotors(leftMotors), rightMotors(rightMotors), trackWidth(trackWidth), wheelDiameter(wheelDiameter),
        rpm(rpm), horizontalDrift(horizontalDrift) {}
  pros::MotorGroup* leftMotors;
  pros::MotorGroup* rightMotors;
  float trackWidth, wheelDiameter, rpm, horizontalDrift;
};

class ControllerSettings {
 public:
  ControllerSettings(float kP, float kI, float kD, float windupRange, float smallError, float smallErrorTimeout,
                     float largeError, float largeErrorTimeout, float slew) {}
};

class OdomSensors {
 public:
  OdomSensors(TrackingWheel* vertical1, TrackingWheel* vertical2, TrackingWheel* horizontal1,
              TrackingWheel* horizontal2, pros::Imu* imu)
      : imu(imu) {}
  pros::Imu* imu;
};

enum class AngularDirection { CW_CLOCKWISE, CCW_COUNTERCLOCKWISE, AUTO };

struct MoveToPointParams {
  bool forwards = true;
  float maxSpeed = 127;
  float minSpeed = 0;
  float earlyExitRange = 0;
};

struct TurnToHeadingParams {
  AngularDirection direction = AngularDirection::AUTO;
  int maxSpeed = 127;
  int minSpeed = 0;
  float earlyExitRange = 0;
};

class Chassis {
 public:
  Chassis(Drivetrain drivetrain, ControllerSettings linearSettings, ControllerSettings angularSettings,
          OdomSensors sensors);
  void calibrate(bool calibrateIMU = true);
  void setPose(float x, float y, float theta, bool radians = false);
  void setPose(Pose pose, bool radians = false);
  Pose getPose(bool radians = false, bool standardPos = false);
  void waitUntil(float dist);
  void waitUntilDone();
  void cancelMotion();
  void cancelAllMotions();
  bool isInMotion() const;
  void moveToPoint(float x, float y, int timeout, MoveToPointParams params = {}, bool async = true);
  void turnToHeading(float theta, int timeout, TurnToHeadingParams params = {}, bool async = true);

 private:
  Drivetrain drivetrain_;
  OdomSensors sensors_;
};
}  // namespace lemlib

#endif  // _LEMLIB_API_HPP_
