// Boundary between compiled user code and the JavaScript simulator.
// Every function here is a WebAssembly import from module "sim". Imports marked
// SUSPENDING are wrapped with WebAssembly.Suspending (JSPI): the calling task
// yields to the simulator scheduler and resumes when simulated time has advanced.
#ifndef _SIM_ABI_H_
#define _SIM_ABI_H_
#include <stdint.h>

#define SIM_IMPORT(name) __attribute__((import_module("sim"), import_name(#name)))

#ifdef __cplusplus
extern "C" {
#endif

// --- scheduling ---
SIM_IMPORT(delay) void sim_delay(uint32_t ms);                     // SUSPENDING
SIM_IMPORT(millis) uint32_t sim_millis(void);
SIM_IMPORT(task_spawn) void sim_task_spawn(uint32_t id, uint32_t stack_top, const char* name);

// --- devices (port is 1..21; sign carries "reversed") ---
SIM_IMPORT(motor_config) void sim_motor_config(int32_t port, int32_t gearset);
SIM_IMPORT(motor_move) void sim_motor_move(int32_t port, int32_t voltage_127);
SIM_IMPORT(motor_move_velocity) void sim_motor_move_velocity(int32_t port, int32_t rpm);
SIM_IMPORT(motor_get_position) double sim_motor_get_position(int32_t port);
SIM_IMPORT(motor_tare) void sim_motor_tare(int32_t port);
SIM_IMPORT(imu_get_rotation) double sim_imu_get_rotation(int32_t port);
SIM_IMPORT(imu_set_rotation) void sim_imu_set_rotation(int32_t port, double deg);

// --- idealized motion (LemLib / EZ-Template re-implementations) ---
SIM_IMPORT(chassis_config) void sim_chassis_config(const int8_t* left, int32_t nleft, const int8_t* right, int32_t nright,
                                                   double track_width, double wheel_diameter, double rpm, int32_t imu_port);
SIM_IMPORT(motion_move_to_point) void sim_motion_move_to_point(double x, double y, int32_t timeout, int32_t forwards, double max_speed_127);
SIM_IMPORT(motion_turn_to_heading) void sim_motion_turn_to_heading(double theta_deg, int32_t timeout, int32_t direction, double max_speed_127);
SIM_IMPORT(motion_wait) void sim_motion_wait(double until_dist);    // SUSPENDING; until_dist < 0 means until done
SIM_IMPORT(motion_cancel) void sim_motion_cancel(void);
SIM_IMPORT(motion_is_active) int32_t sim_motion_is_active(void);
SIM_IMPORT(pose_set) void sim_pose_set(double x, double y, double theta_deg);
SIM_IMPORT(pose_get) void sim_pose_get(double* out_xyt);

// --- diagnostics ---
SIM_IMPORT(log) void sim_log(const char* msg, uint32_t len);
SIM_IMPORT(unsupported) void sim_unsupported(const char* api_name);

#ifdef __cplusplus
}
#endif

#endif  // _SIM_ABI_H_
