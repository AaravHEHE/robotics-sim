// Simulator-only imports used by the shim's C++ code (LemLib / EZ-Template
// re-implementations, LLEMU). The PROS C API itself (motor_move, delay, task_create,
// ...) is implemented directly by the JavaScript runtime as "env" imports.
#ifndef _SIM_ABI_H_
#define _SIM_ABI_H_

#include <stddef.h>
#include <stdint.h>

#define SIM_IMPORT(name) __attribute__((import_module("sim"), import_name(#name)))

#ifdef __cplusplus
extern "C" {
#endif

// Motion kinds understood by the JS motion planner (src/sim/motion/).
enum sim_motion_kind {
  SIM_MOTION_MOVE_TO_POINT = 1,   // x, y, timeout, forwards, maxSpeed, minSpeed, earlyExitRange
  SIM_MOTION_MOVE_TO_POSE = 2,    // x, y, theta, timeout, forwards, maxSpeed, minSpeed, earlyExitRange, lead
  SIM_MOTION_TURN_TO_HEADING = 3, // theta, timeout, direction, maxSpeed, minSpeed, earlyExitRange
  SIM_MOTION_TURN_TO_POINT = 4,   // x, y, timeout, forwards, direction, maxSpeed, minSpeed, earlyExitRange
  SIM_MOTION_SWING_TO_HEADING = 5,// theta, lockedSide, timeout, direction, maxSpeed, minSpeed, earlyExitRange
  SIM_MOTION_SWING_TO_POINT = 6,  // x, y, lockedSide, timeout, forwards, direction, maxSpeed, minSpeed, earlyExitRange
  SIM_MOTION_FOLLOW = 7,          // lookahead, timeout, forwards   (+ path text via sim_motion_path)
  // EZ-Template motions are given relative to the robot's current pose:
  SIM_MOTION_EZ_DRIVE = 10,       // distance (in), headingError (deg), maxSpeed
  SIM_MOTION_EZ_TURN = 11,        // angleError (deg, signed, unwrapped), maxSpeed
  SIM_MOTION_EZ_SWING = 12,       // angleError, side (0 LEFT_SWING, 1 RIGHT_SWING), maxSpeed, oppositeSpeed
  SIM_MOTION_EZ_POINT = 13,       // localX (right), localY (forward), forwards, maxSpeed
  SIM_MOTION_EZ_POSE = 14,        // localX, localY, headingError (deg), forwards, maxSpeed, lead
};

// Describe the drivetrain a motion library controls (ports as written in code).
SIM_IMPORT(chassis_config)
void sim_chassis_config(const int8_t* left, int32_t nleft, const int8_t* right, int32_t nright, double track_width,
                        double wheel_diameter, double wheel_rpm, int32_t imu_port);

// Provide path text for the next SIM_MOTION_FOLLOW.
SIM_IMPORT(motion_path) void sim_motion_path(const uint8_t* text, size_t len);
// Start an idealized motion. Coordinates are in the odometry frame (inches, degrees,
// LemLib convention: 0 deg = +y, clockwise positive).
SIM_IMPORT(motion_start) void sim_motion_start(int32_t kind, const double* params, int32_t nparams);
// Progress of the current motion: distance (in) or angle (deg) traveled, or -1 when done.
SIM_IMPORT(motion_poll) double sim_motion_poll(void);
SIM_IMPORT(motion_cancel) void sim_motion_cancel(void);

// Odometry frame pose. Odometry is ideal (equal to the simulated truth, re-based by setPose).
SIM_IMPORT(odom_set) void sim_odom_set(double x, double y, double theta_deg);
SIM_IMPORT(odom_get) void sim_odom_get(double* out_x_y_theta_deg);
SIM_IMPORT(odom_speed) void sim_odom_speed(int32_t local, double* out_x_y_theta_deg);

// LLEMU (pros::lcd) emulation.
SIM_IMPORT(lcd_set_text) void sim_lcd_set_text(int32_t line, const char* text);
SIM_IMPORT(lcd_clear) void sim_lcd_clear(int32_t line);  // -1 clears all

// Diagnostics shown in the simulator console.
SIM_IMPORT(warn) void sim_warn(const char* message);

#ifdef __cplusplus
}
#endif

#endif  // _SIM_ABI_H_
