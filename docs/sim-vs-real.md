# Simulator vs. real life

The simulator is meant to show what a real robot running the same code would do. It
is idealized on purpose: no PID tuning is simulated (see [CLAUDE.md](../CLAUDE.md)),
and scoring objects use rule-based "snap" pickup and placement. This page has two
parts:

- what used to happen in the simulator but not in real life (fixed in Milestone 3);
- what is still different, with what to expect when you run the code on a real robot.

Severity says how much a difference can change the outcome of an autonomous routine:

| Severity | Meaning |
|---|---|
| **High** | It can make a routine that works here fail on the field, or the reverse. |
| **Medium** | Timings or positions differ by a noticeable amount. |
| **Low** | Cosmetic, or rarely matters. |

## Fixed in Milestone 3

### Motion

| Used to happen in the simulator | Now |
|---|---|
| Robots turned past the target heading, then swung back. The sample helpers were P loops, LemLib/EZ heading control turned faster than the robot could stop, and drive motors in position mode spun up unrealistically. | The sample `turnTo` helpers are PD loops on the IMU gyro rate, and a turn ends only once the robot is on target **and** stopped. Library motions never command a turn rate the robot couldn't stop from in the angle left. Turns overshoot less than 1° on every preset (tested). |
| A turn's leftover spin bent the next drive by up to 17°, because both sides sped up at the same rate whatever they were told. | Each side's torque follows its own command. When both sides are flat out, the one asked for less speeds up less, so a leftover spin dies out at once. |
| `moveToPose` swung its heading 33° past the final pose, overshot the target by 2″ and backed up. | It plans braking with the same budget as its settle phase, slows in curves to what the wheels' grip allows, and keeps aiming at the target point while settling. It arrives without reversing (tested on every preset). |
| Wheels kept spinning while the robot was pinned against a wall, and a robot driven into a wall at an angle stayed crooked. | The wheels stall when blocked, and driving into a wall at a small angle squares the robot against it, as teams do on purpose. |
| A Pin or Cup jammed between the robot and a wall or Goal was driven straight through, and a robot driving past a loose stack could sit inches inside it. | A piece trapped against a wall, Goal or Loader (directly or through other pieces) blocks the robot; a loose one is shoved out of the way at once. |
| Motors stopped the same way in every brake mode, and a coasting robot rolled on about 5 ft. | Coast rolls on about a foot, brake stops sooner, and hold stops sooner still (tested, and in the Midfield pusher's mechanism test). |
| Pistons moved instantly, and lifts held any load at full speed with the power off. | Pistons take 150 ms to stroke. Unpowered lifts sag (coast) or creep down (brake), and lifts slow down when lifting. |

### Game objects and mechanisms

| Used to happen in the simulator | Now |
|---|---|
| A claw grabbed anything within 2″ of its grip point, including a Pin already Placed on a nearby Goal (an accidental SG10). | Only what is between the jaws is grabbed (1.25″ to the side at most). Loose pieces are taken before Placed ones, and a Goal's pieces only when the claw is centered on them. |
| A Pin could be stacked on a Pin, and a Cup on a Cup. | A stack alternates Pin, Cup, Pin…; anything else falls off. |
| A motor claw's Preload fell out at power-on, because the claw read "open" at encoder 0. Preloaded, staged and intake-fed pieces were held by their very tip, floating above the tiles. | A claw starts closed on the Preload, as when it's loaded by hand, and holds every piece where it actually closed on it. |
| An open claw kept holding a stack it had gripped. | An open claw holds nothing it gripped. Pieces an intake feeds into an open claw rest there until it closes, and fall out if it is raised first. |
| An intake swallowed one piece every 350 ms at any roller speed, Loaders refilled their opening instantly, and a closed claw still accepted pieces. | Pieces come in one piece-length apart at the rollers' surface speed. A Loader's next piece needs 0.2 s to drop into the opening, and a closed claw blocks the hand-off. |
| A piece pressed against the bumper in front of an intake wasn't picked up. | Pieces that touch the capture zone are picked up. |
| Dropped pieces could appear inside the robot or a Loader. | They land beside it. |
| A motor wrist flipped back and forth while hovering around 90°. | It has ±5° hysteresis. |
| An arm's claw stayed level at any arm angle. | A claw on a single-pivot arm tilts with the arm, so it only grabs and places near the bottom (Flex). A 6-bar's wrist must be upright to place. |
| Pieces teleported into intakes, claws and the floor. | They are animated: a picked-up piece rises from the floor (a lying Pin turns upright), rides through the robot to its tray or claw, and arrives when the simulator hands it over. A claw draws in what it closes on, and dropped pieces fall. |

### The app

The app also had reliability problems, fixed in 3.1:

- a run's results mixed with settings changed while it ran;
- a sample opened on the wrong field;
- one bad saved robot blanked the page;
- the compiler hung after an update;
- tabs overwrote each other's project.

Runs now freeze their settings, and stale results are dropped. Errors are reported instead of breaking the page.

## Changed in Milestone 4

| Before | Now |
|---|---|
| The field kept the last run's pieces until the next run finished. | The field shows its starting layout again whenever the code, robot, start or field changes, and at the start of every run. |
| Picking a robot kept the code in the editor, so one program ran on every robot (with the wrong ports). | Picking a robot opens its own auton (after asking, if you edited the code), and a run whose code uses ports the robot doesn't have says so in the status bar. |
| Robot presets were generic. | Nine presets are modelled on real robots from reveal videos ([robots.md](robots.md)), with chain bars on cascades, intakes that hand off to an arm folded over them, and roller claws. |
| A dropped piece inside the robot's outline could be pushed out sideways, out of a claw's reach. | It is pushed out the shortest way. |

## Still different

### Driving and turning

| Severity | In the simulator | On a real robot |
|---|---|---|
| **High** | **No PID.** LemLib and EZ-Template motions follow their intended path as fast as the drivetrain allows. Tuning constants (`kP`, `kD`, settle times, slew) are ignored. | Your constants decide everything: a badly tuned robot oscillates, overshoots or crawls. Expect real motions to take longer than here, and tune `kP` / `kD` until they look like the simulation. |
| **Medium** | Sensors are exact. The IMU never drifts, encoders never slip, and LemLib / EZ odometry tracks perfectly. | The IMU drifts about 1–2° per minute and can be bumped off; tracking wheels slip on impacts. Long routines (Skills) drift, so re-zero against walls, or use the GPS or distance sensors. |
| **Medium** | Full battery all the time. Motors make the same speed and torque for the whole run. | Speed drops as the battery drains, and motors slow down (and eventually cut out) when hot. Test with a charged battery, and give routines some time margin. |
| **Medium** | Grip is a single number (the profile's `maxAccel`). The robot never tips, wheelies or slides sideways when hit. | Weight transfer, tipping under acceleration, omni-wheel drift in fast turns and slipping on worn tiles all happen. |
| **Medium** | Pushing pieces doesn't slow the robot (they are much lighter than the robot), and there are no other robots. | Pushing a pile of pieces does slow the robot a little. Partner and opponent robots block, push and steal pieces. |
| **Low** | One task scheduler step is 1 ms, and `pros::delay()` is exact. | Real task timing jitters by a millisecond or two. |

### Pieces, claws and intakes

| Severity | In the simulator | On a real robot |
|---|---|---|
| **High** | **Snap pickup and placement.** A claw that closes on a piece takes it. Opening within 1.5″ of a Goal or stack, with the bottom between 2″ below and 4″ above its resting height, Places what it holds. | A real Pin has to go into a socket or Cup: it can catch on the rim, and you need to line up to about ½″. Leave margin, and slow down near Goals. |
| **Medium** | Intakes never jam. Everything that touches the zone while it spins is pulled in, and a lying Pin comes up with the end nearer the robot at the bottom. | Pieces jam, come in sideways or bounce out, and the orientation of a lying Pin depends on the intake's design. |
| **Medium** | Floor physics is 2D. Pieces slide and spin on the floor, but stacks never tip over and pieces never bounce or roll. | A stack knocked hard falls over; a Pin can roll away. |
| **Low** | Grip strength isn't modelled. A closed claw holds whatever it closed on, and a motor claw is "closed" past an angle, whatever the force. | A weak claw drops pieces when the robot jolts. |
| **Low** | The drive team restocks the Skills Loaders about once a second, each time with a loaded stack (a Pin with a Cup nested over it), up to two per Loader; a robot takes one loaded stack at a time from the bottom. | A person loads them, as fast as they can, separately or nested. |
| **Medium** | Toggles move one face per press, or two when hit faster than 40 in/s (as 8059's passive toggler does in autonomous); a roller can turn them either way, and a jammer locks them completely. | The real mechanism's feel, and the speed at which a hit carries a Toggle two faces, may differ. |

### Sensors

| Severity | In the simulator | On a real robot |
|---|---|---|
| **Low** | The optical sensor sees idealized colors (red, blue, yellow, Cup gray / clear, black Goals) up to 6″ away. | Lighting changes the readings. Calibrate hue and saturation thresholds on the field. |
| **Low** | Distance sensors and the GPS are exact. | The distance sensor has about ±15 mm of error. The GPS needs the field code strip in view and is off by an inch or so. |

### Rules

- **Checked:** SG1 (18″ starting size) and SG2 (24″ / 50″ expansion limits), both from
  the profile's size only; SG6 (possession); SG7 (crossing the Autonomous Line, or touching
  objects on the other side); SG9 (touching opponent Goals); SG10 (removing Placed objects
  from neutral Goals).
- **Not checked:** how far lifts and other mechanisms reach out (expansion during the run),
  entanglement and the other rules. Read the manual ([override-research.md](override-research.md)).
- **Scoring** follows the manual exactly. Placement itself is the idealized part (see above).

### Your code

- Your code is compiled to WebAssembly, not to the V5 Brain's ARM processor.
- Correct code behaves the same on both. Undefined behavior (reading uninitialized
  memory, overflowing arrays) can behave differently.
- Calls the simulator doesn't support are listed in [supported-api.md](supported-api.md).
  They show a note instead of doing anything.
