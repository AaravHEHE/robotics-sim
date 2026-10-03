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
}

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
    id: 'override-toggle-bot',
    name: 'Override: Toggle control (PROS)',
    description: 'Plain PROS. Turns both red-side Toggles red with a roller, so the yellow Pins already on the neutral Goals score for red.',
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
];
