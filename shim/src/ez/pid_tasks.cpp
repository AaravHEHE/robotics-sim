/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at http://mozilla.org/MPL/2.0/.

Modified for the VEX auton simulator from EZ-Template 3.2.2
src/EZ-Template/drive/pid_tasks.cpp.

Instead of driving the motors with PID outputs, each task hands its current target
to the simulator's idealized motion planner (no PID simulation; tuning constants are
ignored). EZ-Template's own targets, odometry, PID error bookkeeping and exit
conditions (pid_wait, pid_wait_until, ...) are unchanged, so waits behave as on a
real robot: they end once the robot is at the target and the exit timers expire.
*/

#include <cmath>
#include <cstring>
#include "EZ-Template/drive/drive.hpp"
#include "EZ-Template/util.hpp"
#include "pros/misc.hpp"
#include "sim/abi.h"

using namespace ez;

namespace {
// Target signature of the motion currently handed to the simulator.
double g_sig[8];
int g_sig_mode = -1;
bool g_configured = false;

bool targetChanged(int mode, std::initializer_list<double> sig) {
  bool changed = mode != g_sig_mode;
  int i = 0;
  for (double v : sig) {
    if (i < 8 && g_sig[i] != v) changed = true;
    if (i < 8) g_sig[i] = v;
    i++;
  }
  g_sig_mode = mode;
  return changed;
}
}  // namespace

// Start (or restart) the idealized motion when EZ-Template's target changes.
static void simStart(int kind, std::initializer_list<double> params) {
  double p[12];
  int n = 0;
  for (double v : params) p[n++] = v;
  sim_motion_start(kind, p, n);
}

void Drive::ez_auto_task() {
  while (true) {
    if (!g_configured) {
      g_configured = true;
      std::vector<std::int8_t> l, r;
      for (auto& m : left_motors) l.push_back(m.get_port());
      for (auto& m : right_motors) r.push_back(m.get_port());
      sim_chassis_config(l.data(), static_cast<std::int32_t>(l.size()), r.data(), static_cast<std::int32_t>(r.size()),
                         global_track_width, WHEEL_DIAMETER, CARTRIDGE * RATIO, imu.get_port());
    }

    // Run odom (EZ-Template's own odometry, fed by ideal simulated sensors)
    ez_tracking_task();

    switch (drive_mode_get()) {
      case DRIVE:
        drive_pid_task();
        break;
      case TURN ... TURN_TO_POINT:
        turn_pid_task();
        break;
      case SWING:
        swing_pid_task();
        break;
      case POINT_TO_POINT:
        ptp_task();
        break;
      case PURE_PURSUIT:
        pp_task();
        break;
      case DISABLE:
      default:
        if (g_sig_mode != DISABLE) {
          sim_motion_cancel();
          g_sig_mode = DISABLE;
        }
        break;
    }

    util::AUTON_RAN = drive_mode_get() != DISABLE ? true : false;
    pros::delay(ez::util::DELAY_TIME);
  }
}

void Drive::drive_pid_task() {
  // Keep EZ-Template's error bookkeeping (used by pid_wait / exit conditions)
  leftPID.compute(drive_sensor_left());
  rightPID.compute(drive_sensor_right());
  headingPID.compute(drive_imu_get());
  slew_left.iterate(drive_sensor_left());
  slew_right.iterate(drive_sensor_right());

  if (!drive_toggle) return;
  if (targetChanged(DRIVE, {leftPID.target_get(), rightPID.target_get(), headingPID.target_get(), (double)max_speed})) {
    const double remaining = ((leftPID.target_get() - drive_sensor_left()) + (rightPID.target_get() - drive_sensor_right())) / 2.0;
    const double headingError = heading_on ? (headingPID.target_get() - drive_imu_get()) / IMU_SCALER : 0.0;
    simStart(SIM_MOTION_EZ_DRIVE, {remaining, headingError, (double)max_speed});
  }
}

void Drive::turn_pid_task() {
  double error;
  if (mode == TURN) {
    turnPID.compute(drive_imu_get());
    error = (turnPID.target_get() - drive_imu_get()) / IMU_SCALER;
  } else {
    double a_target = util::absolute_angle_to_point(point_to_face[!ptf1_running], odom_pose_get());
    a_target = new_turn_target_compute(a_target, odom_imu_start, current_angle_behavior);
    error = a_target - odom_theta_get();
    turnPID.compute_error(error, odom_theta_get());
  }
  slew_turn.iterate(drive_imu_get());

  if (!drive_toggle) return;
  const pose ptf = point_to_face[!ptf1_running];
  const bool changed = mode == TURN ? targetChanged(TURN, {turnPID.target_get(), (double)max_speed})
                                    : targetChanged(TURN_TO_POINT, {ptf.x, ptf.y, (double)max_speed});
  if (changed) simStart(SIM_MOTION_EZ_TURN, {error, (double)max_speed});
}

void Drive::swing_pid_task() {
  swingPID.compute(drive_imu_get());
  leftPID.compute(drive_sensor_left());
  rightPID.compute(drive_sensor_right());
  double current = slew_swing_using_angle ? drive_imu_get() : (current_swing == LEFT_SWING ? drive_sensor_left() : drive_sensor_right());
  slew_swing.iterate(current);

  if (!drive_toggle) return;
  if (targetChanged(SWING, {swingPID.target_get(), (double)current_swing, (double)max_speed, (double)swing_opposite_speed})) {
    const double error = (swingPID.target_get() - drive_imu_get()) / IMU_SCALER;
    simStart(SIM_MOTION_EZ_SWING, {error, current_swing == LEFT_SWING ? 0.0 : 1.0, (double)max_speed, (double)swing_opposite_speed});
  }
}

// Odom To Point Task
void Drive::ptp_task() {
  slew_left.iterate(drive_sensor_left());
  slew_right.iterate(drive_sensor_right());

  // EZ-Template's own error bookkeeping, unchanged (feeds pid_wait / exit conditions)
  double temp_target = is_past_target(odom_target, odom_pose_get());
  int dir = (current_drive_direction == REV ? -1 : 1);
  int flipped = util::sgn(temp_target) != util::sgn(past_target) ? -1 : 1;
  new_current_fake += xy_delta_fake * ((dir * flipped));
  xyPID.compute_error(fabs(temp_target) * dir * flipped, new_current_fake);
  pose ptf = point_to_face[!ptf1_running];
  double a_target = util::absolute_angle_to_point(ptf, odom_pose_get());
  a_target = new_turn_target_compute(a_target, odom_imu_start, current_angle_behavior);
  double wrapped_a_target = a_target - odom_theta_get();
  current_a_odomPID.compute_error(wrapped_a_target, odom_theta_get());
  leftPID.compute(drive_sensor_left());
  rightPID.compute(drive_sensor_right());

  if (!drive_toggle) return;
  if (targetChanged(POINT_TO_POINT, {odom_target.x, odom_target.y, (double)dir, (double)max_speed})) {
    // target relative to the robot (x right, y forward), from EZ-Template's odometry
    const pose cur = odom_pose_get();
    const double th = util::to_rad(odom_theta_get());
    const double dx = odom_target.x - cur.x, dy = odom_target.y - cur.y;
    const double localX = dx * std::cos(th) - dy * std::sin(th);
    const double localY = dx * std::sin(th) + dy * std::cos(th);
    simStart(SIM_MOTION_EZ_POINT, {localX, localY, dir > 0 ? 1.0 : 0.0, (double)max_speed});
  }
}

void Drive::boomerang_task() {
  int target_index = pp_index;
  pose target = pp_movements[target_index].target;
  int dir = current_drive_direction == REV ? -1 : 1;

  double h = util::distance_to_point(target, odom_pose_get()) * odom_boomerang_dlead_get();
  double max = max_boomerang_distance;
  h = h > max ? max : h;
  h *= dir;

  pose temp = util::vector_off_point(-h, pp_movements[target_index].target);
  temp.theta = target.theta;

  if (util::distance_to_point(target, odom_pose_get()) < odom_look_ahead_get() / 2.0) {
    temp = target;
  }

  if (odom_target.x != temp.x || odom_target.y != temp.y) {
    bool slew_on = slew_left.enabled() || slew_right.enabled() ? true : false;
    raw_pid_odom_ptp_set({temp, pp_movements[target_index].drive_direction, pp_movements[target_index].max_xy_speed}, slew_on);
  }

  ptp_task();
}

void Drive::pp_task() {
  if (fabs(util::distance_to_point(pp_movements[pp_index].target, odom_pose_get())) < odom_look_ahead_get()) {
    if (pp_index < (int)pp_movements.size() - 1) {
      pp_index = pp_index >= (int)pp_movements.size() - 1 ? pp_index : pp_index + 1;
      bool slew_on = slew_left.enabled() || slew_right.enabled() ? true : false;
      if (!current_slew_on) slew_on = false;
      raw_pid_odom_ptp_set(pp_movements[pp_index], slew_on);
    }
  }

  if (pp_movements[pp_index].target.theta != ANGLE_NOT_SET) {
    boomerang_task();
  } else {
    ptp_task();
  }
}
