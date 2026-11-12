#include "main.h"

// V5RC Override: Autonomous Coding Skills, 60 s (EZ-Template).
// Robot: "Override: 4-bar + rear piston claw + front Toggle bumper". Start: Red 1 (left wall,
// south). The claw is on the back of the robot and the Toggle bumper on the front, so it
// scores reversing into Goals and presses Toggles driving forward:
//  1. Back up to red Goal R1 and drop the Preload (red half down) in.
//  2. Back onto the Cup + yellow Pin standing at (-47, -47), grab it, and stack it on the
//     Preload.
//  3. Press the Red 1 Toggle twice with the front bumper: yellow -> blue -> red. Now every
//     visible yellow half in Red 1 is Owned by red.
//  4. Match Loads from the south red Loader: the rear claw (no intake) clamps round the loaded
//     stack in the Loader's bottom opening. The first (a red/yellow Pin) goes onto red Goal R2,
//     the next onto the center Goal C, where every visible half scores while the robot is in the
//     Midfield. A third would have to go 15.9" up, onto the Cup on C: the 4-bar only gets there
//     with the claw pulled in 6" closer, so it stops at two.
//  5. It finishes beside C, in the Midfield (+8).
//
// Skills field: every Goal starts empty; Match Loads come in only through the red Loaders, as
// loaded stacks (a Pin with a Cup over it).
//
// Turning in place sweeps the robot's corners 10.6" around its center, so it only turns
// where that circle is clear of the Goals and the diagonal stack.
//
// Positions are field coordinates in inches (origin at the center, +y toward the top wall);
// odom_xyt_set() tells EZ-Template where the robot starts.

ez::Drive chassis(
    {-1, -2, -3},  // left drive ports (negative = reversed)
    {4, 5, 6},     // right drive ports
    11,            // IMU port
    3.25,          // wheel diameter
    450);          // wheel rpm (600 rpm motors geared 36:48)

pros::Motor lift(7, pros::MotorGears::green, pros::MotorUnits::degrees);  // 4-bar, 1:5, reaching out the back
pros::adi::Pneumatics claw('A', true);  // extended = closed, holding the Preload

const int DRIVE_SPEED = 110;
const int TURN_SPEED = 90;

// The 4-bar is geared 1:5, so the bar turns a fifth of the motor.
void liftTo(double barDegrees) { lift.move_absolute(barDegrees * 5, 200); }

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

// Turn to face (x, y) (or turn the back to it) and drive straight there: EZ-Template's own
// odometry gives where the robot is.
void goTo(double x, double y, bool reverse, int speed) {
  const double dx = x - chassis.odom_x_get(), dy = y - chassis.odom_y_get();
  const double heading = std::atan2(dx, dy) * 180 / M_PI + (reverse ? 180 : 0);
  chassis.pid_turn_set(heading, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_drive_set((reverse ? -1 : 1) * std::hypot(dx, dy), speed);
  chassis.pid_wait();
}

// From the Toggle (or a Goal), round to a spot east of the south Loader, face east and reverse
// until the rear claw is in the Loader's bottom opening; clamp the loaded stack there.
void takeMatchLoad() {
  liftTo(0);
  claw.retract();
  // from the north, down the lane x = -59 first (between R1 and the Cups on the wall): straight from the Toggle would clip R1
  if (chassis.odom_y_get() > -36) {
    goTo(-59, -8, false, DRIVE_SPEED);
    goTo(-59, -36, false, DRIVE_SPEED);
  }
  goTo(-50, -58.76, false, DRIVE_SPEED);
  chassis.pid_turn_set(90_deg, TURN_SPEED);
  chassis.pid_wait();
  goTo(-53.2, -58.76, true, 50);
  claw.extend();
  pros::delay(250);
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
  // Red 1 (south), 3.1" off the wall: the Preload standing in the rear claw must be inside the field
  chassis.odom_xyt_set(-57.6_in, -37_in, 90_deg);
  chassis.drive_brake_set(MOTOR_BRAKE_HOLD);

  // 1. Preload into R1 (-47.1, -23.5). Out along y = -37 to a spot on R1's diagonal, turn
  //    the back toward R1 and reverse until the claw (12.35" behind with the bar at 18°) is
  //    over it, without touching it. At 18° the Pin's bottom is 3.5" up, clear of the 3.25"
  //    Goal: any lower and it would hit the Goal instead of going over it.
  liftTo(18);
  chassis.pid_odom_set({{-33.64_in, -37_in}, fwd, DRIVE_SPEED});
  chassis.pid_wait();
  chassis.pid_turn_set(135_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{-38.36_in, -32.28_in}, rev, 70});
  chassis.pid_wait();
  claw.retract();  // let go: the Pin drops into the Goal
  pros::delay(200);
  liftTo(0);
  chassis.pid_odom_set({{-33.64_in, -37_in}, fwd, DRIVE_SPEED});  // straight back out
  chassis.pid_wait();

  // 2. Across to the line through the diagonal stack at (-47.1, -47.1), turn the back
  //    toward it, and reverse onto it. (Face each waypoint before driving to it.)
  chassis.pid_turn_set(274.3_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{-59.11_in, -35.07_in}, fwd, DRIVE_SPEED});
  chassis.pid_wait();
  chassis.pid_turn_set(315_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{-54.87_in, -39.31_in}, rev, 60});
  chassis.pid_wait();
  claw.extend();  // closes around the Cup (and the Pin standing in it)
  pros::delay(200);

  // Raise it and stack it on the Preload, reversing into R1 along its other diagonal: the
  // Cup nests over the Pin's top. At 36° the Cup's bottom is 7.25" up, over the Preload's
  // 6.8" top, and the bar reaches a little further back (12.5").
  liftTo(36);
  chassis.pid_turn_set(321.6_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{-58.4_in, -34.86_in}, fwd, DRIVE_SPEED});
  chassis.pid_wait();
  chassis.pid_turn_set(225_deg, TURN_SPEED);
  chassis.pid_wait();
  chassis.pid_odom_set({{-55.93_in, -32.39_in}, rev, 60});
  chassis.pid_wait();
  pros::delay(200);
  claw.retract();
  pros::delay(200);
  chassis.pid_odom_set({{-58.4_in, -34.86_in}, fwd, DRIVE_SPEED});
  chassis.pid_wait();
  liftTo(0);

  // 2b. The Cup + yellow Pin at (-23.5, -23.5) stands on the only clear way to the center Goal
  //     (every other line to it passes a stack in the Midfield's corners). It can't go on R1 as a
  //     third Pin: 14.3" up, the 4-bar pulls the claw in to 9.3" behind the robot, so the robot's back
  //     would hit R1 first. So the claw takes it (backing onto it along the diagonal, facing
  //     south-west, the claw 11" behind), turns to face south-east (the claw swinging round to the
  //     north-west of where it stood, clear of every route still to come) and sets it down standing.
  goTo(-40, -40, false, DRIVE_SPEED);
  chassis.pid_turn_set(225_deg, TURN_SPEED);
  chassis.pid_wait();
  goTo(-31.33, -31.33, true, 60);
  claw.extend();
  pros::delay(200);
  liftTo(5);
  chassis.pid_turn_set(135_deg, TURN_SPEED);
  chassis.pid_wait();
  liftTo(0);
  pros::delay(250);
  claw.retract();
  pros::delay(200);

  // 3. Back round the south of R1 and up the lane x = -59 to the Red 1 Toggle on the left wall
  //    (centered on y = 0).
  goTo(-40, -40, false, DRIVE_SPEED);
  goTo(-59, -36, false, DRIVE_SPEED);
  goTo(-59, -5, false, DRIVE_SPEED);
  chassis.pid_turn_set(270_deg, TURN_SPEED);
  chassis.pid_wait();

  // Two presses with the front bumper. The wall stops the robot, so these use plain power
  // for a set time rather than a PID drive (which would never reach its target). Power 58
  // is about 35 in/s: a Toggle hit faster than 40 in/s turns two faces at once.
  chassis.drive_mode_set(ez::DISABLE);
  for (int i = 0; i < 2; i++) {
    chassis.drive_set(58, 58);
    pros::delay(700);
    // The wall stops the wheels while they still turn, so odometry drifts here. Pressed against
    // the Toggle the robot's center is always 8.2" off the wall's face, on y = -5: start odometry
    // again from there (the heading, from the IMU, is still right), then back off.
    if (i == 1) {
      chassis.odom_x_set(-62_in);
      chassis.odom_y_set(-5_in);
    }
    chassis.drive_set(-60, -60);
    pros::delay(250);
  }
  chassis.drive_set(0, 0);
  pros::delay(200);

  // 4. Back down the lane to the south Loader. The rear claw takes a loaded stack from its bottom
  //    opening (-64.96, -58.76): facing east, reversing until the claw (11" behind with the bar
  //    down) is in it.
  takeMatchLoad();
  liftTo(18);  // the Pin's bottom 3.5" up, clear of R2's 3.25" top
  // Up to a spot 22" west of R2 on its row, face west and reverse until the claw (12.35" behind)
  // is over R2 (-23.55, -47.09).
  goTo(-46, -47.09, false, DRIVE_SPEED);
  chassis.pid_turn_set(270_deg, TURN_SPEED);
  chassis.pid_wait();
  goTo(-35.9, -47.09, true, 60);
  claw.retract();
  pros::delay(200);
  goTo(-46, -47.09, false, DRIVE_SPEED);

  // The next loaded stack onto the center Goal C (8.77" tall): bar at 44.5 (the Pin's bottom 9"
  // up, the claw 12.2" behind). Along the diagonal the stack at (-23.5, -23.5) used to block:
  // facing south-west, reverse until the claw is over C.
  takeMatchLoad();
  liftTo(44.5);
  goTo(-20, -20, false, DRIVE_SPEED);
  chassis.pid_turn_set(225_deg, TURN_SPEED);
  chassis.pid_wait();
  goTo(-8.63, -8.63, true, 50);
  claw.retract();
  pros::delay(200);
  // 5. Stays here, inside the Midfield.
  printf("Autonomous finished at %u ms\n", static_cast<unsigned>(pros::millis()));
}

void opcontrol() {
  while (true) pros::delay(20);
}
