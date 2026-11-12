#include "main.h"

// V5RC Override: 6-bar + wrist claw (EZ-Template).
// Robot: "Override: 6-bar + wrist claw". Start: Red 1 (left wall, south).
//
//  1. The Preload starts in the claw yellow end down. Turn the wrist over so the red end
//     is down (the claw now holds the Pin by its top end), raise the 6-bar so the Pin's
//     bottom clears the Goal, and drop it into red Goal R1: red half visible, 5 points.
//  2. Turn the wrist back upright, clamp the Cup + yellow Pin standing at (-47, -47) and
//     set it on the Preload: the Cup nests over the Pin's top.
//  3. Hit the Red 1 Toggle at full speed with the front of the chassis (13" tall, so it
//     reaches a Toggle on top of the wall): it turns two faces, yellow -> red. Now the
//     yellow halves in Red 1 are Owned by red, including the Pin on neutral Goal N_R1.
//
// Positions are field coordinates in inches; odom_xyt_set() tells EZ-Template where the
// robot starts.

ez::Drive chassis(
    {-1, -2, -3},  // left drive ports (negative = reversed)
    {4, 5, 6},     // right drive ports
    11,            // IMU port
    3.25,          // wheel diameter
    450);          // wheel rpm (600 rpm motors geared 36:48)

pros::Motor sixBar(7, pros::MotorGears::green, pros::MotorUnits::degrees);  // 1:5
pros::Motor wrist(8, pros::MotorGears::green, pros::MotorUnits::degrees);   // 1:2
pros::adi::Pneumatics claw('A', true);                                      // extended = closed

const int DRIVE_SPEED = 110;
const int TURN_SPEED = 90;

void liftTo(double barDegrees) { sixBar.move_absolute(barDegrees * 5, 200); }
void wristTo(double degrees) { wrist.move_absolute(degrees * 2, 200); }

// Turn to face (x, y), then drive straight at it and stop `standoff` inches short.
void approach(double x, double y, double standoff) {
  const double px = chassis.odom_x_get(), py = chassis.odom_y_get();
  const double dx = x - px, dy = y - py, d = std::hypot(dx, dy);
  chassis.pid_turn_set(std::atan2(dx, dy) * 180 / M_PI, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{(x - dx / d * standoff) * okapi::inch, (y - dy / d * standoff) * okapi::inch}, fwd, DRIVE_SPEED});
  chassis.pid_wait();
}

void default_constants() {
  chassis.pid_drive_constants_set(20.0, 0.0, 100.0);
  chassis.pid_heading_constants_set(11.0, 0.0, 20.0);
  chassis.pid_turn_constants_set(3.0, 0.05, 20.0, 15.0);
  chassis.pid_swing_constants_set(6.0, 0.0, 65.0);
  chassis.pid_odom_angular_constants_set(6.5, 0.0, 52.5);
  chassis.pid_odom_boomerang_constants_set(5.8, 0.0, 32.5);
  chassis.pid_turn_exit_condition_set(90_ms, 3_deg, 250_ms, 7_deg, 500_ms, 500_ms);
  chassis.pid_drive_exit_condition_set(90_ms, 1_in, 250_ms, 3_in, 500_ms, 500_ms);
  chassis.pid_odom_turn_exit_condition_set(90_ms, 3_deg, 250_ms, 7_deg, 500_ms, 750_ms);
  chassis.pid_odom_drive_exit_condition_set(90_ms, 1_in, 250_ms, 3_in, 500_ms, 750_ms);
  chassis.slew_drive_constants_set(3_in, 70);
  chassis.odom_look_ahead_set(7_in);
  chassis.pid_angle_behavior_set(ez::shortest);
}

// Against the Toggle, where odometry starts again (the robot center x that keeps the routes after it
// clear of the Goals and the Cups along the wall; measured in the simulator).
constexpr double PRESSED_X = -62;

// Round to a spot east of the south Loader, face west and drive until the claw (10" ahead with
// the 6-bar down) is in the Loader's bottom opening (-64.96, -58.76); clamp the loaded stack.
void takeMatchLoad() {
  liftTo(0);
  wristTo(0);
  claw.retract();
  if (chassis.odom_y_get() > -36) {
    // from the Toggle: back away from it first (turning beside it, a corner would knock it on),
    // then down the lane x = -59 (straight would clip R1)
    chassis.pid_drive_set(-8_in, DRIVE_SPEED);
    chassis.pid_wait();
    approach(-58, -12, 0);
    approach(-59, -36, 0);
  }
  approach(-45, -58.76, 0);
  approach(-64.96, -58.76, 10.6);  // (10.6: the jaws stop short of the Loader itself)
  claw.extend();
  pros::delay(250);
  chassis.pid_drive_set(-4_in, DRIVE_SPEED);
  chassis.pid_wait();
}

void initialize() {
  pros::delay(500);
  default_constants();
  chassis.initialize();
}

void disabled() {}
void competition_initialize() {}

void autonomous() {
  chassis.pid_targets_reset();
  chassis.drive_imu_reset();
  chassis.drive_sensor_reset();
  chassis.odom_xyt_set(-60.7_in, -37_in, 90_deg);  // Red 1 (south) start
  chassis.drive_brake_set(MOTOR_BRAKE_HOLD);

  // 1. Flip the Preload red end down and raise it while turning toward R1 (-47.1, -23.5).
  wristTo(180);
  liftTo(16);  // the flipped Pin hangs 3.5" below the claw: its bottom 3.6" up, clear of the 3.25" Goal
  // 2" out from the wall first: turning in place right against it would swing a corner into it
  chassis.pid_drive_set(2_in, DRIVE_SPEED);
  chassis.pid_wait();
  chassis.pid_turn_set(40.8_deg, TURN_SPEED);  // straight at R1 from (-58.7, -37)
  chassis.pid_wait();
  // stop 11.1" from the Goal's center: the raised claw reaches ~10.8" ahead
  chassis.pid_odom_set({{-54.35_in, -31.95_in}, fwd, DRIVE_SPEED});
  chassis.pid_wait();
  claw.retract();  // the Pin drops into the Goal
  pros::delay(200);

  // 2. Wrist back upright and the claw down at the floor: clamp the Cup + yellow Pin standing
  //    at (-47, -47) around the Cup, raise it just over the Preload and set it on.
  liftTo(0);
  wristTo(0);
  chassis.pid_odom_set({{-58.5_in, -35.0_in}, rev, DRIVE_SPEED});
  chassis.pid_wait();
  approach(-47.09, -47.09, 10);
  claw.extend();
  pros::delay(150);
  liftTo(27);  // the claw 10.2" up and 11.1" ahead: the Cup's bottom 7.2" up, over the Preload's 6.8" top
  approach(-47.09, -23.55, 11.06);
  claw.retract();
  pros::delay(150);
  // 2b. The Cup + yellow Pin at (-23.5, -23.5) stands on the only clear way to the center Goal
  //     (every other line to it passes a stack in the Midfield's corners). The claw takes it,
  //     facing north-east, turns to face north-west and sets it down standing, clear of every
  //     route still to come.
  chassis.pid_drive_set(-6_in, DRIVE_SPEED);
  chassis.pid_wait();
  liftTo(0);
  approach(-40, -40, 0);
  approach(-23.55, -23.55, 10);
  claw.extend();
  pros::delay(150);
  liftTo(5);
  chassis.pid_turn_set(315_deg, TURN_SPEED);
  chassis.pid_wait();
  liftTo(0);
  pros::delay(250);
  claw.retract();
  pros::delay(150);

  // 3. Back round the south of R1 and up the lane x = -58.5 (between the wall-group Cups and R1)
  //    to the Red 1 Toggle, with the 6-bar folded up over the robot: the claw out in front would
  //    hit the wall before the chassis reaches the Toggle.
  liftTo(110);
  chassis.pid_drive_set(-4_in, DRIVE_SPEED);
  chassis.pid_wait();
  approach(-40, -40, 0);
  approach(-58.5, -36, 0);
  chassis.pid_turn_set(0_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{-58.5_in, -5_in}, fwd, DRIVE_SPEED});
  chassis.pid_wait();
  chassis.pid_turn_set(270_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_drive_set(-14_in, DRIVE_SPEED);  // a run-up
  chassis.pid_wait();
  chassis.drive_mode_set(ez::DISABLE);
  // hit it at full speed: it turns two faces, yellow -> red
  chassis.drive_set(127, 127);  // the wall stops the robot: plain power, not a PID drive
  pros::delay(600);
  // The wall stopped the wheels while they still turned, so odometry drifted. Against the Toggle
  // the robot's center is always the same distance off the wall, on y = -5: start odometry again
  // from there (the heading, from the IMU, is still right), then back off.
  chassis.odom_x_set(PRESSED_X * okapi::inch);
  chassis.odom_y_set(-5_in);
  chassis.drive_set(-60, -60);  // let go: a Toggle a robot still touches doesn't count
  pros::delay(250);
  chassis.drive_set(0, 0);
  pros::delay(200);
  chassis.drive_mode_set(ez::DRIVE);

  // 4. Match Loads from the south red Loader: the claw (no intake) clamps round the loaded stack
  //    in the Loader's bottom opening. The first (a red/yellow Pin) goes onto red Goal R2, the
  //    next onto the center Goal C, where every visible half scores while the robot is in the
  //    Midfield. (A third would have to go onto the Cup on C, 15.9" up: there the 6-bar holds the
  //    claw only 9.9" ahead, and the robot's front would hit C first.)
  takeMatchLoad();
  liftTo(14);  // the Pin's bottom 3.6" up, clear of R2's 3.25" top; the claw 10.7" ahead
  approach(-36, -58.76, 0);
  approach(-23.55, -47.09, 10.7);
  claw.retract();
  pros::delay(200);
  chassis.pid_drive_set(-6_in, DRIVE_SPEED);
  chassis.pid_wait();
  takeMatchLoad();
  liftTo(36);  // the Pin's bottom 9.1" up, over C's 8.77" top; the claw 11" ahead
  // east below R2 (the held stack would hit it), north up x = -12, then onto the diagonal (now
  // clear) and straight up it at C
  approach(-36, -58.76, 0);
  approach(-12, -58, 0);
  approach(-12, -30, 0);
  approach(-16, -16, 0);
  approach(0, 0, 11);
  pros::delay(200);
  claw.retract();
  pros::delay(200);
  // 5. Finish here, inside the Midfield.
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
