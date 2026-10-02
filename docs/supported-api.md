# Supported API

What user code can call in the simulator. Anything not listed here is **unsupported**: it fails to compile or link, with a message pointing to this page. Motion functions are idealized: PID and tuning constants are accepted and ignored, and motion is limited only by drivetrain speed and acceleration.

_Status as of the Milestone 0 prototype. Milestone 1 vendors the full PROS 4 headers and expands this list._

## PROS
| API | Status | Notes |
| --- | --- | --- |
| `pros::delay`, `pros::c::delay`, `pros::Task::delay` | ✅ | Advances simulated time |
| `pros::millis`, `pros::c::millis` | ✅ | Simulated time |
| `pros::Task(fn, ...)`, `pros::Task(lambda, name)` | ✅ | Cooperative; each task has its own stack. Priorities are ignored. |
| `pros::Motor(port, gearset, units)` | ✅ | Negative port means reversed |
| `Motor::move / move_velocity / move_voltage / brake / get_position / tare_position / set_brake_mode` | ✅ | Brake modes are ignored |
| `pros::MotorGroup({ports}, gearset, units)` + the same methods, `get_port_all`, `size` | ✅ | |
| `pros::Imu(port)`: `reset / get_heading / get_rotation / set_heading / set_rotation / tare / is_calibrating` | ✅ | `reset(true)` takes 2 s of simulated time |
| Everything else (`Rotation`, `adi`, `Controller`, `lcd`, `Mutex`, ...) | ❌ | Planned for M1+ |

## LemLib (0.5.x)
| API | Status | Notes |
| --- | --- | --- |
| `Drivetrain`, `ControllerSettings`, `OdomSensors`, `TrackingWheel`, `Omniwheel::*` | ✅ | Constants are accepted; drivetrain geometry is used |
| `Chassis::calibrate / setPose / getPose` | ✅ | |
| `Chassis::moveToPoint(x, y, timeout, {forwards, maxSpeed}, async)` | ✅ | `minSpeed` and `earlyExitRange` are ignored |
| `Chassis::turnToHeading(theta, timeout, {direction, maxSpeed}, async)` | ✅ | |
| `Chassis::waitUntil / waitUntilDone / cancelMotion / cancelAllMotions / isInMotion` | ✅ | |
| `moveToPose`, `turnToPoint`, `swingToHeading`, `swingToPoint`, `follow`, `arcade` / `tank` | ❌ | Planned for M1 |

## EZ-Template (3.x)
| API | Status | Notes |
| --- | --- | --- |
| All | ❌ | Planned for M1: `pid_drive_set`, `pid_turn_set`, `pid_swing_set`, `pid_wait`, `pid_wait_until`, `pid_odom_set`, `drive_imu_reset`, `drive_sensor_reset` |
