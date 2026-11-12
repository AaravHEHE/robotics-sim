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
    id: 'override-twobar',
    name: 'Override: 2-bar arm + claw (PROS)',
    description: 'Plain PROS with simple dead-reckoning. Lifts the Preload over Goal R1 and drops it in with the motor claw, then presses the Red 1 Toggle twice with the chassis. (Its tilting arm claw can\'t lift a Cup over a Placed Pin, so it doesn\'t stack.)',
    robot: 'override-twobar',
    field: 'override',
    start: 'red1_s',
    autonMs: 15000,
  },
  {
    id: 'override-dr4b',
    name: 'Override: DR4B out the back, 3-Pin stack (LemLib + GPS)',
    description: 'LemLib, starting from a GPS reading. Backs the Preload into Goal R1, intakes two standing stacks over the robot into the DR4B chamber and backs each onto it (a 3-Pin stack), then hits the Red 1 Toggle at speed to turn it to red.',
    robot: 'override-dr4b',
    field: 'override',
    start: 'red1_s',
    startAt: { x: -57.6, y: -37, theta: 90 }, // the Preload in the rear chamber must be inside the wall
    autonMs: 15000,
  },
  {
    id: 'override-cascade',
    name: 'Override: Cascade + claw, two Goals (LemLib)',
    description: 'LemLib. Drops the Preload into Goal R1 and stacks an intaken Cup + Pin on it, rams the Red 1 Toggle to red, then lifts a second intaken stack onto neutral Goal N_R1 with the cascade.',
    robot: 'override-cascade',
    field: 'override',
    start: 'red1_s',
    autonMs: 15000,
  },
  {
    id: 'override-sixbar',
    name: 'Override: 6-bar + wrist claw (EZ-Template)',
    description: 'EZ-Template. Turns the Preload over with the wrist and drops it red-end-down into Goal R1, clamps a standing Cup + Pin off the floor and stacks it on, then hits the Red 1 Toggle to red.',
    robot: 'override-sixbar',
    field: 'override',
    start: 'red1_s',
    autonMs: 15000,
  },
  {
    id: 'override-workhorse-toggle',
    name: 'Override: 4-bar + rear claw (EZ-Template)',
    description: 'EZ-Template odometry. Backs up to Goal R1 and drops the Preload in with the rear claw, backs onto a Cup + yellow Pin and stacks it on the Preload, then presses the Red 1 Toggle twice to red with the front bumper.',
    robot: 'override-fourbar',
    field: 'override',
    start: 'red1_s',
    startAt: { x: -57.6, y: -37, theta: 90 }, // the Preload in the rear claw must be inside the wall
    autonMs: 15000,
  },
  // 60 s Autonomous Coding Skills, one per robot: Match Loads come in through the red Loaders
  {
    id: 'skills-twobar',
    name: 'Override Skills: 2-bar (PROS)',
    description: 'Plain PROS, 60 s Autonomous Coding Skills. The Preload into Goal R1 and the Red 1 Toggle pressed to red, then the claw clamps a Match Load straight out of the south red Loader and sets it on Goal R2, and the robot parks in the Midfield. (Its claw tilts with the arm, so it can only set a Pin on an empty Goal.)',
    robot: 'override-twobar',
    field: 'override',
    start: 'red1_s',
    autonMs: 60000,
  },
  {
    id: 'skills-fourbar',
    name: 'Override Skills: 4-bar + rear claw (EZ-Template)',
    description: 'EZ-Template, 60 s Autonomous Coding Skills. A 2-Pin stack on Goal R1, the Red 1 Toggle to red, then the rear claw takes Match Loads from the south red Loader: one onto Goal R2, one onto the center Goal, where it scores while the robot is parked in the Midfield beside it.',
    robot: 'override-fourbar',
    field: 'override',
    start: 'red1_s',
    startAt: { x: -57.6, y: -37, theta: 90 }, // the Preload in the rear claw must be inside the wall
    autonMs: 60000,
  },
  {
    id: 'skills-sixbar',
    name: 'Override Skills: 6-bar + wrist claw (EZ-Template)',
    description: 'EZ-Template, 60 s Autonomous Coding Skills. The Preload flipped into Goal R1 and a Cup + Pin stacked on it, the Red 1 Toggle to red, then the claw takes Match Loads from the south red Loader: one onto Goal R2, one onto the center Goal, where it scores while the robot is parked in the Midfield beside it.',
    robot: 'override-sixbar',
    field: 'override',
    start: 'red1_s',
    autonMs: 60000,
  },
  {
    id: 'skills-cascade',
    name: 'Override Skills: Cascade (LemLib)',
    description: 'LemLib, 60 s Autonomous Coding Skills. A 3-Pin stack on Goal R1 and the Red 1 Toggle to red, then Match Loads through the intake from the south red Loader: the red one onto Goal R2, the rest stacked on the center Goal, and it parks in the Midfield beside it.',
    robot: 'override-cascade',
    field: 'override',
    start: 'red1_s',
    autonMs: 60000,
  },
  {
    id: 'skills-continuous',
    name: 'Override Skills: Continuous lift (LemLib)',
    description: 'LemLib, 60 s Autonomous Coding Skills. The cascade route on the four-stage continuous lift: a 3-Pin stack on Goal R1, the Red 1 Toggle to red, then Match Loads through the intake from the south red Loader onto Goal R2 and the center Goal, parked in the Midfield.',
    robot: 'override-continuous',
    field: 'override',
    start: 'red1_s',
    autonMs: 60000,
  },
  {
    id: 'skills-dr6b',
    name: 'Override Skills: DR6B (LemLib + GPS)',
    description: 'LemLib, 60 s Autonomous Coding Skills, starting from a GPS reading. A 3-Pin stack on Goal R1, the Red 1 Toggle to red, then Match Loads up the intake into the DR6B chamber from the south red Loader: the red one backed onto Goal R2, the rest stacked on the center Goal, parked in the Midfield.',
    robot: 'override-dr6b',
    field: 'override',
    start: 'red1_s',
    startAt: { x: -57.6, y: -37, theta: 90 }, // the Preload in the rear chamber must be inside the wall
    autonMs: 60000,
  },
  {
    id: 'override-skills',
    name: 'Override Skills: DR4B (LemLib + GPS)',
    description: 'LemLib, 60 s Autonomous Coding Skills, starting from a GPS reading. A 3-Pin stack on Goal R1 and the Red 1 Toggle to red, then Match Loads up the intake into the DR4B chamber from the south red Loader: the red one backed onto Goal R2, the rest stacked on the center Goal, parked in the Midfield.',
    robot: 'override-dr4b',
    field: 'override',
    start: 'red1_s',
    startAt: { x: -57.6, y: -37, theta: 90 }, // the Preload in the rear chamber must be inside the wall
    autonMs: 60000,
  },
  test('test-twobar', 'override-twobar', '2-bar', 'moves the arm to three heights and drops and re-grabs the Preload with the claw'),
  {
    ...test('test-dr4b', 'override-dr4b', 'DR4B + intake chamber', 'reads the GPS and chamber sensor, lifts the Preload to three heights, spins the intake both ways and lets go of the Preload'),
    // its checks take longer than 15 s (turning the back up the lane before it drops the Preload)
    autonMs: 20000,
    // the Preload in the rear claw must be inside the wall: 3" north of the preset
    startAt: { x: -37, y: -57.6, theta: 0 },
  },
  test('test-cascade', 'override-cascade', 'Cascade', 'moves the cascade to three heights, swings the chain bar over the top, drops the Preload and runs the intake to bring it back up into the claw'),
  test('test-sixbar', 'override-sixbar', '6-bar + wrist', 'moves the 6-bar to three heights, turns the Preload over with the wrist and back, and drops and re-grabs it'),
  {
    ...test('test-workhorse', 'override-fourbar', '4-bar', 'moves the rear 4-bar to three heights and drops and re-grabs the Preload behind the robot'),
    // the Preload in the rear claw must be inside the wall: 3" north of the preset
    startAt: { x: -37, y: -57.6, theta: 0 },
  },
];
