// Generates the mechanism-test samples, samples/test-<robot>/ (plain PROS), one per Override
// robot preset. Run from the repo root after changing a preset:  node scripts/gen-mechanism-tests.cjs
const fs = require('fs');
const path = require('path');

const mainH = fs.readFileSync('samples/override-flex/include/main.h', 'utf8');

const header = (name, intro) => `#include "main.h"

// Mechanism test for the "${name}" robot (plain PROS). Start: Red 2 (bottom wall, west).
//
// Run this first whenever you change the robot (ports, gearing, profile): it drives up the
// lane to an open spot, turns a full circle in 90° steps, then works every mechanism through
// its range${intro}. Each check prints PASS or FAIL with what it measured
// in the Console; the last line adds them up. Everything should PASS.
`;

const checks = `
// ---------------- checks ----------------
int passed = 0, failed = 0;

// Print PASS or FAIL for one check, with the value it measured.
void check(const char* what, bool ok, double value) {
  printf("%s  %-42s %8.1f\\n", ok ? "PASS" : "FAIL", what, value);
  if (ok) passed++;
  else failed++;
}

// Check that \`got\` is within \`tol\` of \`target\`; \`fmt\` names it, with %g for the target.
void checkNear(const char* fmt, double target, double got, double tol) {
  char what[64];
  snprintf(what, sizeof what, fmt, target);
  check(what, std::fabs(got - target) <= tol, got);
}

// Wait until a motor (or group) is within \`tol\` degrees of \`target\`, or \`ms\` pass.
template <class M>
double settle(M& m, double target, double tol, int ms = 2500) {
  const std::uint32_t end = pros::millis() + ms;
  while (std::fabs(m.get_position() - target) > tol && pros::millis() < end) pros::delay(10);
  pros::delay(100);
  return m.get_position();
}
`;

const driveCode = (inPerDeg, gearsNote) => `
// ---------------- drivetrain ----------------
// ${gearsNote}
constexpr double IN_PER_DEG = ${inPerDeg};
// From the start up the lane to an open spot where the robot can turn a full circle
constexpr double LANE = 24.5;

// Drive straight \`inches\` (P loop on the encoders, heading held with the IMU). Returns the
// distance the encoders measured.
double drive(double inches, int maxSpeed = 100) {
  leftDrive.tare_position_all();
  rightDrive.tare_position_all();
  const double heading = imu.get_rotation();
  const std::uint32_t end = pros::millis() + 3000;
  int settled = 0;
  while (pros::millis() < end && settled < 3) {
    const double traveled = (leftDrive.get_position() + rightDrive.get_position()) / 2 * IN_PER_DEG;
    const double error = inches - traveled;
    settled = std::fabs(error) < 0.3 ? settled + 1 : 0;
    const double power = std::clamp(error * 8.0, -double(maxSpeed), double(maxSpeed));
    const double correction = (heading - imu.get_rotation()) * 2.0;
    leftDrive.move(power + correction);
    rightDrive.move(power - correction);
    pros::delay(10);
  }
  leftDrive.brake();
  rightDrive.brake();
  pros::delay(150);
  return (leftDrive.get_position() + rightDrive.get_position()) / 2 * IN_PER_DEG;
}

// Turn in place to an IMU rotation (degrees, clockwise positive): PD on the gyro rate, so it
// eases in instead of swinging past; ends once on target and stopped.
void turnTo(double target) {
  const std::uint32_t end = pros::millis() + 2500;
  while (pros::millis() < end) {
    const double error = target - imu.get_rotation();
    const double rate = -imu.get_gyro_rate().z;  // deg/s, clockwise positive
    if (std::fabs(error) < 1.0 && std::fabs(rate) < 5.0) break;
    const double power = std::clamp(error * 2.5 - rate * 0.2, -100.0, 100.0);
    leftDrive.move(power);
    rightDrive.move(-power);
    pros::delay(10);
  }
  leftDrive.brake();
  rightDrive.brake();
  pros::delay(150);
}

void driveTest() {
  printf("-- drivetrain --\\n");
  checkNear("drove %g in up the lane (encoders)", LANE, drive(LANE), 0.75);
  check("kept straight (IMU rotation)", std::fabs(imu.get_rotation()) < 2, imu.get_rotation());
  for (double target = 90; target <= 360; target += 90) {
    turnTo(target);
    checkNear("turned to %g deg (IMU)", target, imu.get_rotation(), 1.5);
  }
}

void driveBack() {
  printf("-- back to the start --\\n");
  checkNear("drove %g in back down the lane", -LANE, drive(-LANE), 0.75);
}
`;

const tail = (name) => `
void autonomous() {
  printf("Mechanism test: ${name}\\n");
  driveTest();
  mechanismTest();
  driveBack();
  printf("RESULT %d passed, %d failed\\n", passed, failed);
}

void disabled() {}
void competition_initialize() {}

void opcontrol() {
  while (true) pros::delay(20);
}
`;

const blueDrive = `pros::MotorGroup leftDrive({-1, -2, -3}, pros::MotorGears::blue, pros::MotorUnits::degrees);
pros::MotorGroup rightDrive({4, 5, 6}, pros::MotorGears::blue, pros::MotorUnits::degrees);
pros::Imu imu(11);`;
const blue325 = ['3.25 * M_PI / 360.0 * (450.0 / 600.0)', '3.25" wheels geared 36:48 (450 rpm from 600 rpm motors)'];

const initDrive = `  pros::lcd::initialize();
  imu.reset(true);  // blocks ~2 s while the IMU calibrates
  leftDrive.set_brake_mode_all(pros::MotorBrake::hold);
  rightDrive.set_brake_mode_all(pros::MotorBrake::hold);`;

// a lift: motor (group), ratio motor->bar, targets in bar degrees
const liftTest = (label, motor, ratio, targets, tol = 3) => `  printf("-- ${label} --\\n");
  for (double deg : {${targets.map((t) => t.toFixed(1)).join(', ')}}) {
    ${motor}.move_absolute(deg * ${ratio}, 200);
    checkNear("${label.split(' ')[0]} to %g deg", deg, settle(${motor}, deg * ${ratio}, ${(tol * ratio).toFixed(1)}) / ${ratio}, ${tol});
  }`;

const robots = {
  'test-flex': {
    robot: 'override-flex',
    name: 'Override: Flex (Hero Bot) arm + claw',
    intro: ': the arm to three heights, then the claw lets go of the Preload and picks it up again',
    devices: `pros::MotorGroup leftDrive({-1}, pros::MotorGears::green, pros::MotorUnits::degrees);
pros::MotorGroup rightDrive({2}, pros::MotorGears::green, pros::MotorUnits::degrees);
pros::Imu imu(11);
pros::Motor arm(7, pros::MotorGears::green, pros::MotorUnits::degrees);   // 1:5 to the arm
pros::Motor claw(8, pros::MotorGears::green, pros::MotorUnits::degrees);  // closed past 60°`,
    gearing: ['4.0 * M_PI / 360.0', '4" wheels, direct drive (200 rpm)'],
    init: `${initDrive}
  arm.set_brake_mode(pros::MotorBrake::hold);
  claw.move_absolute(90, 100);  // squeeze the Preload`,
    mech: `void mechanismTest() {
${liftTest('arm (1:5)', 'arm', 5, [30, 60, 90, 0])}
  // An arm claw tilts with the arm: only near the bottom can it set a Pin down or pick one up.
  printf("-- claw: lets go of the Preload, then picks it up again --\\n");
  claw.move_absolute(0, 100);
  check("claw open (deg)", settle(claw, 0, 5) < 10, claw.get_position());
  pros::delay(300);  // the Preload falls over in front of the robot
  claw.move_absolute(90, 100);
  check("claw closed on the Pin (deg)", settle(claw, 90, 5) > 60, claw.get_position());
}`,
  },
  'test-banshee': {
    robot: 'override-banshee',
    name: 'Override: Banshee (intake + arm + roller claw)',
    intro: ': the arm to three angles with the wrist keeping the claw upright, the roller claw rolls the Preload out and back in, and the intake spins',
    devices: `${blueDrive}
pros::Motor arm(7, pros::MotorGears::green, pros::MotorUnits::degrees);     // 1:5 to the arm
pros::Motor wrist(8, pros::MotorGears::green, pros::MotorUnits::degrees);   // 12:48 to the claw
pros::Motor rollers(9, pros::MotorGears::green);                            // roller claw
pros::Motor intake(10, pros::MotorGears::green);`,
    gearing: blue325,
    init: `${initDrive}
  arm.set_brake_mode(pros::MotorBrake::hold);
  wrist.set_brake_mode(pros::MotorBrake::hold);`,
    mech: `// The claw turns with the arm, so the wrist turns back by the same angle to keep it upright.
void armTo(double deg) {
  arm.move_absolute(deg * 5, 200);
  wrist.move_absolute(-deg * 4, 200);
}

void mechanismTest() {
  printf("-- arm (1:5) with the wrist (12:48) keeping the claw upright --\\n");
  for (double deg : {30.0, 60.0, 90.0, 0.0}) {
    armTo(deg);
    checkNear("arm to %g deg", deg, settle(arm, deg * 5, 15) / 5, 3);
    checkNear("wrist at %g deg (claw upright)", -deg, settle(wrist, -deg * 4, 12) / 4, 3);
  }
  printf("-- roller claw: out, then back in --\\n");
  rollers.move(-127);  // spit the Preload out
  pros::delay(300);
  check("rollers spinning out (rpm)", rollers.get_actual_velocity() < -150, rollers.get_actual_velocity());
  pros::delay(300);
  rollers.brake();
  pros::delay(300);
  rollers.move(127);   // pull it back in from the floor in front
  pros::delay(300);
  check("rollers spinning in (rpm)", rollers.get_actual_velocity() > 150, rollers.get_actual_velocity());
  pros::delay(500);
  rollers.brake();
  printf("-- intake --\\n");
  intake.move(127);
  pros::delay(400);
  check("intake spinning in (rpm)", intake.get_actual_velocity() > 150, intake.get_actual_velocity());
  intake.brake();
}`,
  },
  'test-dr4b-intake': {
    robot: 'override-dr4b-intake',
    name: 'Override: DR4B + intake chamber (8059A-style)',
    intro: ': the GPS and chamber sensor are read, the DR4B lifts the Preload to three heights, the clamp lets go and grabs again, and the intake spins both ways',
    devices: `pros::MotorGroup leftDrive({-1, -2, -3}, pros::MotorGears::blue, pros::MotorUnits::degrees);
pros::MotorGroup rightDrive({4, 5, 6}, pros::MotorGears::blue, pros::MotorUnits::degrees);
pros::Imu imu(11);
pros::MotorGroup lift({7, 8}, pros::MotorGears::red, pros::MotorUnits::degrees);  // DR4B, 12:84
pros::Motor intake(10, pros::MotorGears::blue);
pros::adi::Pneumatics clamp('A', true);  // extended = closed (on the Preload)
pros::Optical chamberEye(9);             // looks down into the chamber
pros::Gps gps(12, 0, -6 * 0.0254);       // 6" behind the center, facing backward`,
    gearing: ['3.25 * M_PI / 360.0 * (360.0 / 600.0)', '3.25" traction wheels geared to 360 rpm'],
    init: `${initDrive}
  lift.set_brake_mode_all(pros::MotorBrake::hold);`,
    mech: `void mechanismTest() {
  printf("-- sensors --\\n");
  const pros::gps_status_s_t g = gps.get_position_and_orientation();
  // the start is (-37, -60.7); LANE inches up the lane is (-37, -36.2)
  checkNear("GPS x %g in", -37, g.x / 0.0254, 1.5);
  checkNear("GPS y %g in", -60.705 + LANE, g.y / 0.0254, 1.5);
  check("chamber eye sees the Preload", chamberEye.get_proximity() > 50, chamberEye.get_proximity());
${liftTest('DR4B (12:84)', 'lift', 7, [30, 60, 90, 0])}
  printf("-- chamber clamp: lets go of the Preload, then grabs it again --\\n");
  clamp.retract();
  pros::delay(400);  // it drops out behind the robot
  check("clamp open", !clamp.is_extended(), clamp.is_extended());
  clamp.extend();
  pros::delay(300);
  check("clamp closed", clamp.is_extended(), clamp.is_extended());
  printf("-- intake --\\n");
  intake.move(127);
  pros::delay(400);
  check("intake spinning in (rpm)", intake.get_actual_velocity() > 500, intake.get_actual_velocity());
  intake.move(-127);
  pros::delay(400);
  check("intake spinning out (rpm)", intake.get_actual_velocity() < -500, intake.get_actual_velocity());
  intake.brake();
}`,
  },
  'test-claw-gate': {
    robot: 'override-claw-gate',
    name: 'Override: Claw Gate (cascade + chain-bar claw + intake)',
    intro: ': the cascade to three heights, the chain bar over the top and back, the claw drops and re-grabs the Preload, and the intake spins',
    devices: `${blueDrive}
pros::MotorGroup cascade({7, 8}, pros::MotorGears::blue, pros::MotorUnits::degrees);  // 1:3 to the spool
pros::Motor chainBar(9, pros::MotorGears::green, pros::MotorUnits::degrees);           // 1:3
pros::Motor intake(10, pros::MotorGears::blue);
pros::adi::Pneumatics claw('A', true);  // extended = closed (on the Preload)`,
    gearing: blue325,
    init: `${initDrive}
  cascade.set_brake_mode_all(pros::MotorBrake::hold);
  chainBar.set_brake_mode(pros::MotorBrake::hold);`,
    mech: `void mechanismTest() {
  printf("-- cascade (1:3 to a 1.375\\" spool, 3 stages) --\\n");
  for (double spool : {300.0, 700.0, 1100.0, 0.0}) {
    cascade.move_absolute(spool * 3, 600);
    checkNear("spool to %g deg", spool, settle(cascade, spool * 3, 15) / 3, 5);
  }
  printf("-- chain bar (1:3): the claw stays level as it swings over the top --\\n");
  for (double deg : {90.0, 180.0, 0.0}) {
    chainBar.move_absolute(deg * 3, 200);
    checkNear("chain bar to %g deg", deg, settle(chainBar, deg * 3, 9) / 3, 3);
  }
  printf("-- claw: lets go of the Preload, then picks it up off the floor --\\n");
  claw.retract();
  pros::delay(400);  // the Preload falls over in front of the robot
  check("claw open", !claw.is_extended(), claw.is_extended());
  chainBar.move_absolute(-25 * 3, 200);  // down to the floor in front
  settle(chainBar, -75, 9);
  claw.extend();
  pros::delay(300);
  check("claw closed on the Pin", claw.is_extended(), claw.is_extended());
  chainBar.move_absolute(0, 200);
  settle(chainBar, 0, 9);
  printf("-- intake --\\n");
  intake.move(127);
  pros::delay(400);
  check("intake spinning in (rpm)", intake.get_actual_velocity() > 500, intake.get_actual_velocity());
  intake.brake();
}`,
  },
  'test-ace': {
    robot: 'override-ace',
    name: 'Override: ACE (cascade + chain bar + lobster claw)',
    intro: ': the cascade to three heights, the chain bar over the top and back, and the lobster claw drops and re-grabs the Preload',
    devices: `${blueDrive}
pros::MotorGroup cascade({7, 8}, pros::MotorGears::blue, pros::MotorUnits::degrees);  // 1:3 to the spool
pros::Motor chainBar(9, pros::MotorGears::green, pros::MotorUnits::degrees);           // 1:3
pros::adi::Pneumatics claw('A', true);  // extended = closed (on the Preload)`,
    gearing: blue325,
    init: `${initDrive}
  cascade.set_brake_mode_all(pros::MotorBrake::hold);
  chainBar.set_brake_mode(pros::MotorBrake::hold);`,
    mech: `void mechanismTest() {
  printf("-- cascade (1:3 to a 1.375\\" spool, 3 stages) --\\n");
  for (double spool : {300.0, 700.0, 1100.0, 0.0}) {
    cascade.move_absolute(spool * 3, 600);
    checkNear("spool to %g deg", spool, settle(cascade, spool * 3, 15) / 3, 5);
  }
  printf("-- chain bar (1:3): the claw stays level as it swings over the top --\\n");
  for (double deg : {90.0, 180.0, 0.0}) {
    chainBar.move_absolute(deg * 3, 200);
    checkNear("chain bar to %g deg", deg, settle(chainBar, deg * 3, 9) / 3, 3);
  }
  printf("-- lobster claw: lets go of the Preload, then picks it up off the floor --\\n");
  claw.retract();
  pros::delay(400);  // the Preload falls over in front of the robot
  check("claw open", !claw.is_extended(), claw.is_extended());
  chainBar.move_absolute(-25 * 3, 200);  // down to the floor in front
  settle(chainBar, -75, 9);
  claw.extend();
  pros::delay(300);
  check("claw closed on the Pin", claw.is_extended(), claw.is_extended());
  chainBar.move_absolute(0, 200);
  settle(chainBar, 0, 9);
}`,
  },
  'test-sixbar-wrist': {
    robot: 'override-sixbar-wrist',
    name: 'Override: 6-bar + wrist + claw',
    intro: ': the 6-bar to three heights, the wrist turns the Preload over and back, and the claw drops and re-grabs it',
    devices: `${blueDrive}
pros::Motor lift(7, pros::MotorGears::green, pros::MotorUnits::degrees);   // 6-bar, 1:5
pros::Motor wrist(8, pros::MotorGears::green, pros::MotorUnits::degrees);  // wrist, 1:2
pros::adi::Pneumatics claw('A', true);  // extended = closed (on the Preload)`,
    gearing: blue325,
    init: `${initDrive}
  lift.set_brake_mode(pros::MotorBrake::hold);
  wrist.set_brake_mode(pros::MotorBrake::hold);`,
    mech: `void mechanismTest() {
${liftTest('6-bar (1:5)', 'lift', 5, [30, 60, 90, 0])}
  printf("-- wrist (1:2): turns the Preload over, then back --\\n");
  for (double deg : {180.0, 0.0}) {
    wrist.move_absolute(deg * 2, 200);
    checkNear("wrist to %g deg", deg, settle(wrist, deg * 2, 6) / 2, 3);
  }
  printf("-- claw: lets go of the Preload, then grabs it again --\\n");
  claw.retract();
  pros::delay(400);
  check("claw open", !claw.is_extended(), claw.is_extended());
  claw.extend();
  pros::delay(300);
  check("claw closed on the Pin", claw.is_extended(), claw.is_extended());
}`,
  },
  'test-workhorse': {
    robot: 'override-fourbar-claw',
    name: 'Override: 4-bar + rear piston claw + front Toggle bumper',
    intro: ': the rear 4-bar to three heights, and the rear claw drops and re-grabs the Preload behind the robot',
    devices: `${blueDrive}
pros::Motor lift(7, pros::MotorGears::green, pros::MotorUnits::degrees);  // 4-bar, 1:5, reaching out the back
pros::adi::Pneumatics claw('A', true);  // rear claw: extended = closed (on the Preload)`,
    gearing: blue325,
    init: `${initDrive}
  lift.set_brake_mode(pros::MotorBrake::hold);`,
    mech: `void mechanismTest() {
${liftTest('4-bar (1:5)', 'lift', 5, [30, 60, 100, 0])}
  printf("-- claw: lets go of the Preload, then grabs it again --\\n");
  claw.retract();
  pros::delay(400);
  check("claw open", !claw.is_extended(), claw.is_extended());
  claw.extend();
  pros::delay(300);
  check("claw closed on the Pin", claw.is_extended(), claw.is_extended());
  // The Toggle bumper is fixed: it is tested by driving into a Toggle (see the auton sample).
}`,
  },
  'test-toggle-bot': {
    robot: 'override-toggle-bot',
    name: 'Override: Toggle control bot',
    intro: ': the Toggle roller spins both ways, the rear plate and the jammer go out and back, and the optical sensor is read',
    devices: `${blueDrive}
pros::Motor toggleRoller(8, pros::MotorGears::green);
pros::adi::Pneumatics plate('B', false);
pros::adi::Pneumatics jammer('C', false);  // C-channel that wedges a Toggle
pros::Optical toggleEye(9);  // at Toggle height, beside the roller`,
    gearing: blue325,
    init: initDrive,
    mech: `void mechanismTest() {
  printf("-- Toggle roller --\\n");
  toggleRoller.move(127);
  pros::delay(400);
  check("roller spinning (rpm)", toggleRoller.get_actual_velocity() > 150, toggleRoller.get_actual_velocity());
  toggleRoller.move(-127);
  pros::delay(400);
  check("roller spinning back (rpm)", toggleRoller.get_actual_velocity() < -150, toggleRoller.get_actual_velocity());
  toggleRoller.brake();
  printf("-- rear plate --\\n");
  plate.extend();
  pros::delay(300);
  check("plate out", plate.is_extended(), plate.is_extended());
  plate.retract();
  pros::delay(300);
  check("plate back in", !plate.is_extended(), plate.is_extended());
  printf("-- jammer (must be back in before the end: a touched Toggle is neutral) --\\n");
  jammer.extend();
  pros::delay(300);
  check("jammer out", jammer.is_extended(), jammer.is_extended());
  jammer.retract();
  pros::delay(300);
  check("jammer back in", !jammer.is_extended(), jammer.is_extended());
  printf("-- optical sensor --\\n");
  // in the open, nothing is within its 6" range at Toggle height
  check("optical: nothing close (proximity)", toggleEye.get_proximity() < 20, toggleEye.get_proximity());
}`,
  },
  'test-midfield-pusher': {
    robot: 'override-midfield-pusher',
    name: 'Override: Midfield pusher',
    intro: ' (it has none: instead the motor brake modes are compared)',
    devices: blueDrive,
    gearing: ['4.0 * M_PI / 360.0 * (333.0 / 600.0)', '4" traction wheels geared 600 -> 333 rpm'],
    init: initDrive,
    mech: `// How far the drive has gone since the encoders were zeroed (in, signed).
double traveled() { return (leftDrive.get_position() + rightDrive.get_position()) / 2 * IN_PER_DEG; }

// Drive at full power for 200 ms, then let go with a brake mode. Sets rolledOn to how far
// the robot kept going after letting go; returns how far it went in all (in, signed).
double rollOn(pros::MotorBrake mode, int dir, double& rolledOn) {
  leftDrive.set_brake_mode_all(mode);
  rightDrive.set_brake_mode_all(mode);
  leftDrive.tare_position_all();
  rightDrive.tare_position_all();
  leftDrive.move(127 * dir);
  rightDrive.move(127 * dir);
  pros::delay(200);
  const double atRelease = traveled();
  leftDrive.brake();
  rightDrive.brake();
  pros::delay(800);
  rolledOn = std::fabs(traveled() - atRelease);
  return traveled();
}

void mechanismTest() {
  printf("-- brake modes: how far it rolls on after letting go --\\n");
  double coast = 0, hold = 0;
  const double down = rollOn(pros::MotorBrake::coast, -1, coast);  // back down the lane...
  const double up = rollOn(pros::MotorBrake::hold, 1, hold);       // ...and up again
  printf("      coast %.1f in, hold %.1f in\\n", coast, hold);
  check("coast rolls on (in)", coast > 2, coast);
  check("hold stops shorter than coast (in)", hold < coast, coast - hold);
  leftDrive.set_brake_mode_all(pros::MotorBrake::hold);
  rightDrive.set_brake_mode_all(pros::MotorBrake::hold);
  drive(-(down + up));  // back to where it turned
  check("still facing up the lane (IMU rotation)", std::fabs(imu.get_rotation() - 360) < 2, imu.get_rotation());
}`,
  },
};

for (const [id, r] of Object.entries(robots)) {
  const dir = path.join('samples', id);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'include'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'include', 'main.h'), mainH);
  const src = `${header(r.name, r.intro)}
${r.devices}
${checks}${driveCode(r.gearing[0], r.gearing[1])}
// ---------------- mechanisms ----------------
${r.mech}

void initialize() {
${r.init}
}
${tail(r.name)}`;
  fs.writeFileSync(path.join(dir, 'src', 'main.cpp'), src);
}
console.log('ok', Object.keys(robots).join(' '));
