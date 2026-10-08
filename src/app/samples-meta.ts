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
  /** An exact start pose inside that preset's zone, for a robot that doesn't fit the preset's spot. */
  startAt?: { x: number; y: number; theta: number };
  /** Auto-stop (ms): 15000 = head-to-head autonomous, 60000 = Skills. */
  autonMs?: number;
  /** 'test': a mechanism test for a robot preset (prints PASS / FAIL); default: an example or auton. */
  kind?: 'test';
}

/** A mechanism test for an Override robot preset: runs from Red 2 (west), head-to-head (15 s). */
const test = (id: string, robot: string, name: string, what: string): SampleMeta => ({
  id,
  name: `Mechanism test: ${name}`,
  description: `Plain PROS mechanism test (prints PASS / FAIL for each check): drives a lane and turns a full circle, then ${what}.`,
  robot,
  field: 'override',
  start: 'red2_w', // a head-to-head start: the tests take under 15 s
  autonMs: 15000,
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
    description: 'Plain PROS with simple dead-reckoning. Lifts the Preload over Goal R1 and drops it in with the motor claw, then presses the Red 1 Toggle twice with the chassis. (Its tilting arm claw can\'t lift a Cup over a Placed Pin, so it doesn\'t stack.)',
    robot: 'override-flex',
    field: 'override',
    start: 'red1_s',
    autonMs: 15000,
  },
  {
    id: 'override-banshee',
    name: 'Override: Banshee 3-Pin stack (LemLib)',
    description: 'LemLib. Rolls the Preload into Goal R1, intakes two standing stacks into the roller claw and swings each onto it with the arm (a 3-Pin stack), then rams the Red 1 Toggle to red.',
    robot: 'override-banshee',
    field: 'override',
    start: 'red1_s',
    autonMs: 15000,
  },
  {
    id: 'override-ace',
    name: 'Override: ACE 3-Pin stack (EZ-Template)',
    description: 'EZ-Template odometry. Drops the Preload into Goal R2, clamps two standing stacks straight off the floor with the lobster claw and sets each on it (the cascade lifts the last one: a 3-Pin stack), then rams the Red 2 Toggle to red.',
    robot: 'override-ace',
    field: 'override',
    start: 'red2_w',
    autonMs: 15000,
  },
  {
    id: 'override-dr4b-intake',
    name: 'Override: DR4B out the back, 3-Pin stack (LemLib + GPS)',
    description: 'LemLib, starting from a GPS reading. Backs the Preload into Goal R1, intakes two standing stacks over the robot into the DR4B chamber and backs each onto it (a 3-Pin stack), then hits the Red 1 Toggle at speed to turn it to red.',
    robot: 'override-dr4b-intake',
    field: 'override',
    start: 'red1_s',
    startAt: { x: -57.6, y: -37, theta: 90 }, // the Preload in the rear chamber must be inside the wall
    autonMs: 15000,
  },
  {
    id: 'override-claw-gate',
    name: 'Override: Claw Gate, two Goals (LemLib)',
    description: 'LemLib. Drops the Preload into Goal R1 and stacks an intaken Cup + Pin on it, rams the Red 1 Toggle to red, then lifts a second intaken stack onto neutral Goal N_R1 with the cascade.',
    robot: 'override-claw-gate',
    field: 'override',
    start: 'red1_s',
    autonMs: 15000,
  },
  {
    id: 'override-sixbar-wrist',
    name: 'Override: 6-bar + wrist (EZ-Template)',
    description: 'EZ-Template. Turns the Preload over with the wrist and drops it red-end-down into Goal R1, clamps a standing Cup + Pin off the floor and stacks it on, then hits the Red 1 Toggle to red.',
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
    description: 'EZ-Template odometry. Backs up to Goal R1 and drops the Preload in with the rear claw, backs onto a Cup + yellow Pin and stacks it on the Preload, then presses the Red 1 Toggle twice to red with the front bumper.',
    robot: 'override-fourbar-claw',
    field: 'override',
    start: 'red1_s',
    startAt: { x: -57.6, y: -37, theta: 90 }, // the Preload in the rear claw must be inside the wall
    autonMs: 15000,
  },
  {
    id: 'override-midfield-pusher',
    name: 'Override Skills: park in the Midfield (PROS)',
    description: 'Plain PROS, 60 s Autonomous Coding Skills. Drives into the Midfield and parks: +8.',
    robot: 'override-midfield-pusher',
    field: 'override',
    start: 'red1_s',
    startAt: { x: -60.705, y: -38, theta: 90 }, // 18" wide: 1" south, clear of the wall Cups
    autonMs: 60000,
  },
  {
    id: 'override-skills',
    name: 'Override Skills: DR4B, both Toggles + Match Loads (LemLib + GPS)',
    description: 'LemLib, 60 s Autonomous Coding Skills, starting from a GPS reading. A 3-Pin stack on Goal R1 and the Red 1 Toggle, a loaded stack from the red Loader onto Goal R2, the Red 2 Toggle, then parks in the Midfield.',
    robot: 'override-dr4b-intake',
    field: 'override',
    start: 'red1_s',
    startAt: { x: -57.6, y: -37, theta: 90 }, // the Preload in the rear chamber must be inside the wall
    autonMs: 60000,
  },
  test('test-flex', 'override-flex', 'Flex (Hero Bot)', 'moves the arm to three heights and drops and re-grabs the Preload with the claw'),
  test('test-banshee', 'override-banshee', 'Banshee', 'swings the arm to three angles with the wrist keeping the claw upright, rolls the Preload out and back in and spins the intake'),
  {
    ...test('test-dr4b-intake', 'override-dr4b-intake', 'DR4B + intake chamber', 'reads the GPS and chamber sensor, lifts the Preload to three heights, drops and re-grabs it and spins the intake'),
    // the Preload in the rear claw must be inside the wall: 3" north of the preset
    startAt: { x: -37, y: -57.6, theta: 0 },
  },
  test('test-claw-gate', 'override-claw-gate', 'Claw Gate', 'moves the cascade to three heights, swings the chain bar over the top, drops the Preload and picks it up off the floor, and spins the intake'),
  test('test-ace', 'override-ace', 'ACE', 'moves the cascade to three heights, swings the chain bar over the top, and drops the Preload and picks it up off the floor'),
  test('test-sixbar-wrist', 'override-sixbar-wrist', '6-bar + wrist', 'moves the 6-bar to three heights, turns the Preload over with the wrist and back, and drops and re-grabs it'),
  {
    ...test('test-workhorse', 'override-fourbar-claw', '4-bar workhorse', 'moves the rear 4-bar to three heights and drops and re-grabs the Preload behind the robot'),
    // the Preload in the rear claw must be inside the wall: 3" north of the preset
    startAt: { x: -37, y: -57.6, theta: 0 },
  },
  test('test-toggle-bot', 'override-toggle-bot', 'Toggle bot', 'spins the Toggle roller both ways, works the plate and the jammer and reads the optical sensor'),
  {
    ...test('test-midfield-pusher', 'override-midfield-pusher', 'Midfield pusher', 'compares how far it rolls on with coast and hold brake modes'),
    // 18" wide: 1" west of the preset, so it starts clear of the wall Cups
    startAt: { x: -38, y: -60.705, theta: 0 },
  },
];
