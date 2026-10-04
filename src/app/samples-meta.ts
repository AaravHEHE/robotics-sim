// Sample projects shipped with the app (files live in /samples).
export interface SampleMeta {
  id: string;
  name: string;
  description: string;
  /** Robot preset the sample is written for. */
  robot: string;
  /** Field it runs on (default: the empty 12 ft field). */
  field?: string;
  /** Start position preset id on that field. */
  start?: string;
  /** Auto-stop (ms): 15000 = head-to-head autonomous, 60000 = Skills. */
  autonMs?: number;
  /** 'test': a mechanism test for a robot preset (prints PASS / FAIL); default: an example or auton. */
  kind?: 'test';
}

/** A mechanism test for an Override robot preset: runs from Red 2 (west) with a 60 s auto-stop. */
const test = (id: string, robot: string, name: string, what: string): SampleMeta => ({
  id,
  name: `Test: ${name}`,
  description: `Plain PROS mechanism test (prints PASS / FAIL for each check): drives a lane and turns a full circle, then ${what}.`,
  robot,
  field: 'override',
  start: 'red2_w',
  autonMs: 60000,
  kind: 'test',
});

export const SAMPLES: SampleMeta[] = [
  {
    id: 'pros-basic',
    name: 'Plain PROS starter',
    description: 'Motor groups, IMU turns, a background task, an intake and a pneumatic clamp — no motion library.',
    robot: 'tank-6m-450',
  },
  {
    id: 'lemlib-example',
    name: 'LemLib 0.5 example',
    description: "LemLib's own example main.cpp: moveToPose, turnToPoint, turnToHeading and pure pursuit along a path.",
    robot: 'lemlib-template',
  },
  {
    id: 'ez-example',
    name: 'EZ-Template 3.2 example',
    description: "EZ-Template's example project with its auton selector; the first auton (drive forward and back) runs.",
    robot: 'ez-example',
  },
  {
    id: 'override-flex',
    name: 'Override: Flex Hero Bot (PROS)',
    description: 'Plain PROS. Drops the Preload into Goal R1 with the motor claw, then presses the Red 1 Toggle twice with the chassis.',
    robot: 'override-flex',
    field: 'override',
    start: 'red1_s',
    autonMs: 15000,
  },
  {
    id: 'override-dr4b',
    name: 'Override: DR4B + roller claw (LemLib)',
    description: 'LemLib in field coordinates. Rolls the Preload into Goal R1, stacks a Cup + yellow Pin on it with the DR4B, then presses the Red 1 Toggle to red.',
    robot: 'override-dr4b-roller',
    field: 'override',
    start: 'red1_s',
    autonMs: 15000,
  },
  {
    id: 'override-cascade',
    name: 'Override: cascade + intake (LemLib)',
    description: 'LemLib. Drops the Preload into Goal R1, intakes a Cup + yellow Pin straight into the claw, lifts it onto the Preload, then presses the Red 1 Toggle to red.',
    robot: 'override-cascade',
    field: 'override',
    start: 'red1_s',
    autonMs: 15000,
  },
  {
    id: 'override-sixbar-wrist',
    name: 'Override: 6-bar + wrist (EZ-Template)',
    description: 'EZ-Template. Turns the Preload over with the wrist, drops it red-end-down into Goal R1, then presses the Red 1 Toggle to red.',
    robot: 'override-sixbar-wrist',
    field: 'override',
    start: 'red1_s',
    autonMs: 15000,
  },
  {
    id: 'override-toggle-bot',
    name: 'Override: Toggle control (PROS)',
    description: 'Plain PROS. Turns both red-side Toggles red with a roller, stopping when an optical sensor sees the red face, so the yellow Pins already on the neutral Goals score for red.',
    robot: 'override-toggle-bot',
    field: 'override',
    start: 'red1_s',
    autonMs: 15000,
  },
  {
    id: 'override-workhorse-toggle',
    name: 'Override: 4-bar workhorse (EZ-Template)',
    description: 'EZ-Template odometry. Drops the Preload into Goal R1, stacks a Cup + yellow Pin on it, then presses the Red 1 Toggle twice to red.',
    robot: 'override-fourbar-claw',
    field: 'override',
    start: 'red1_s',
    autonMs: 15000,
  },
  {
    id: 'override-midfield-pusher',
    name: 'Override Skills: park in the Midfield (PROS)',
    description: 'Plain PROS, 60 s Autonomous Coding Skills. Drives into the Midfield and parks: +8.',
    robot: 'override-midfield-pusher',
    field: 'override',
    start: 'red1_s',
    autonMs: 60000,
  },
  {
    id: 'override-skills',
    name: 'Override Skills: Match Load tower (LemLib)',
    description: 'LemLib, 60 s Autonomous Coding Skills. Starts from a GPS reading, builds Pin + Cup combos from the red Loader through the intake and staging tray, stacks a tower on Goal R1 and parks in the Midfield.',
    robot: 'override-intake-staging',
    field: 'override',
    start: 'red1_s',
    autonMs: 60000,
  },
  test('test-flex', 'override-flex', 'Flex (Hero Bot)', 'moves the arm to three heights and drops and re-grabs the Preload with the claw'),
  test('test-dr4b-roller', 'override-dr4b-roller', 'DR4B + roller claw', 'moves the DR4B to three heights and rolls the Preload out and back in'),
  test('test-cascade', 'override-cascade', 'cascade + claw + intake', 'moves the cascade to three heights, drops and re-grabs the Preload and spins the intake both ways'),
  test('test-intake-staging', 'override-intake-staging', 'intake -> rear staging -> rear DR4B', 'reads the GPS and tray sensor, takes the Preload from the tray with the rear claw, lifts it to three heights and spins the intake'),
  test('test-sixbar-wrist', 'override-sixbar-wrist', '6-bar + wrist', 'moves the 6-bar to three heights, turns the Preload over with the wrist and back, and drops and re-grabs it'),
  test('test-workhorse', 'override-fourbar-claw', '4-bar workhorse', 'moves the 4-bar to three heights and drops and re-grabs the Preload'),
  test('test-toggle-bot', 'override-toggle-bot', 'Toggle bot', 'spins the Toggle roller both ways, works the plate and reads the optical sensor'),
  test('test-midfield-pusher', 'override-midfield-pusher', 'Midfield pusher', 'compares how far it rolls on with coast and hold brake modes'),
];
