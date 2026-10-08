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
| The field was drawn from the manual's drawings only. | The official field CAD can be loaded for the look (Field › Model…). The simulation still uses the manual's measurements; the CAD's Goals and Loaders line up with them. Its colors come from part numbers (the CAD has none), and screws and other hardware under 1″ are left out. |

## Fixed: pieces passing through each other

Found with `scripts/check-phasing.ts` (every shipped sample, checked after every step) and
`scripts/fuzz-phasing.ts` (every robot preset driven, turned, lifted and clawed at random).

| Used to happen in the simulator | Now |
|---|---|
| What a claw held had no body: the claw sits outside the frame, so a held Pin passed straight through standing stacks and Goal bases, and opening the claw inside a Goal's base Placed it. | A held stack is solid wherever it is below what it meets. It shoves floor pieces it is level with, and a Goal, Loader, wall or trapped piece stops the robot. It goes over anything it is carried above, and can be lowered onto a Goal or stack it is over. |
| Pieces already on a Goal had no body either, so a Cup carried below a Placed Pin's top swept through the Pin and was "stacked" on it. | A Goal is as tall as its stack. To stack, carry the piece over the top of what is there first. |
| Rear claws (the 4-bar and the DR4B) held the Preload through the perimeter wall at the start positions. | The robot is placed far enough in that the Preload is inside the field (with a note). Their samples start at x = −57.6 instead. |
| A robot corner grazing a piece at speed left it up to 2″ inside the robot for a tenth of a second. | The floor physics works at the pieces' scale (Rapier's length unit), so pieces are pushed out at once. |
| A robot pressing a piece against a wall slowly could drive it into the wall: the piece only counted as stuck once the robot was 0.1″ into it, and the wall gave way first. | A piece is stuck as soon as the robot touches it while it is against something fixed. |
| An empty claw had no body: low and out in front, it reached into a Goal's base (and could pick up a piece there) or through the wall. | A claw's jaws run into Goal bodies, Loaders and walls below their tops. They still close around floor pieces and Placed pieces. Autons fold their claw up before pressing a wall Toggle with the bumper. |
| Lowering a lift over a Goal sank the claw, or what it held, into the Goal. | A lift lowering something onto a Goal, Loader or stuck piece from above stops on it, as a real lift stalls. |
| A lone Pin dropped next to a Goal lay down through the Goal, and one dropped between the robot and a Goal, or where another dropped piece already lay, could land inside them. | Drops are placed by their real outline (a lying Pin is 6.5″ long) in the nearest free spot: clear of the robot (and where it is about to drive), what its claws hold, Goals, Loaders, the walls and other pieces. A lone Pin falls across a gap it doesn't fit along. |
| A robot started (or placed with `setPose()`) on top of floor pieces squeezed them out, sometimes through the wall, without a word. | A note says how many pieces the start position covers. |
| Opening a claw anywhere from 2″ below to 4″ above where its piece would sit on a Goal or stack Placed it there at once. A Cup carried through a Pin was "auto-corrected" on top, and a stack let go above one teleported down. | Pieces nest as real ones do. Centred on a stack within 0.4″, a Cup slides down over a Pin's end (and a Pin's end into a Cup or a Goal's socket) until it sits, and the lift stalls there. Off-centre, the rim hits the top and the lift stalls on it. Let go above a stack (within 1″ of its centre and 3″ of its top), a piece falls onto it under gravity, and you see it fall. Anything else falls off. |
| A held stack lowered onto a loose floor stack sank into it. | Floor stacks stall a lift like a Goal does. |
| For a moment after a roller claw spat a piece out, a wrist flipped, or an intake handed pieces to the claw, the claw passed through anything. The Pin left in a roller claw jumped 3.5″ down into the Cup it had just spat out. | What a claw was touching carries over whatever it holds. What stays in a roller claw stays where it is, and a Pin resting in the spat Cup goes with it. |

When a piece let go at a Goal doesn't land on it, the run's Notes say why: too low, off-centre, too high, tilted, or a Pin on a Pin or Cup on a Cup. When what a claw holds runs into a Goal below its top, the Events say so. A project saved in the browser that is an unedited copy of an older sample is replaced by the current sample when the app opens; an edited copy is kept, with a note.

The sample autons used to carry pieces too low and relied on this. They now lift over each
Goal and stack first; Flex no longer stacks, because its tilting arm claw can't lift a Cup
over a Placed Pin and still set it down level ([robots.md](robots.md)).

## Fixed in the deep search

| Used to happen in the simulator | Now |
|---|---|
| The filter that lets a held stack pass over pieces it is above (or was lifted out of) never ran, because the physics engine only calls it when stepped with an event queue. Held stacks shoved such pieces aside. | It runs: a Pin lifted out of a Cup against the wall leaves the Cup where it is. |
| A wrist set to cancel an arm's tilt (Banshee) turned the held stack upside down past 90° of wrist. | The stack's orientation follows the arm and wrist together. |
| A claw could hold two Pins stacked directly, and a Pin added under a held Cup left the grip point on the wrong piece. | Claws only hold stacks that alternate Pin, Cup, Pin…; adding underneath keeps the grip where it was. |
| A Toggle slid past along the wall at speed turned two faces, and claws couldn't touch Toggles. | Only speed into the wall counts as a hard hit; claws and held stacks press Toggles too. |
| Distance and optical sensors missed a lying Pin at its collar, saw a Goal's base at any height, and didn't see pieces on Goals. | They see the collar, the Goal's shape at the beam's height, and Goal stacks. |
| A rear intake run in reverse spat pieces into the robot, and Loaders could be stocked past their capacity. | Pieces come out of the intake's own mouth; a Loader is only restocked when a whole loaded stack fits. |

## Still different

### Driving and turning

| Severity | In the simulator | On a real robot |
|---|---|---|
| **High** | **No PID.** LemLib and EZ-Template motions follow their intended path as fast as the drivetrain allows. Tuning constants (`kP`, `kD`, settle times, slew) are ignored. | Your constants decide everything: a badly tuned robot oscillates, overshoots or crawls. Expect real motions to take longer than here, and tune `kP` / `kD` until they look like the simulation. |
| **Medium** | Sensors are exact. The IMU never drifts, encoders never slip, and LemLib / EZ odometry tracks perfectly. | The IMU drifts about 1–2° per minute and can be bumped off; tracking wheels slip on impacts. Long routines (Skills) drift, so re-zero against walls, or use the GPS or distance sensors. |
| **Medium** | The battery is full at the start and only sags with the current the motors draw; it never drains over the match. Motor heat and the V5's current derating are modelled from estimated thermal constants, not measured ones. | The battery drains and ages, and motors differ. Test with a charged battery, and give routines some time margin. |
| **Low** | Real-robot numbers are estimates: the V5 motor constants come from VEX's ratings, and mass, center of mass, inertia and wheel friction default to a 12 lb box with grip 0.9. No real robot was measured. | Your robot's real weight, wheel wear and gearing decide how fast it really speeds up. Set `mass` and `dynamics` in the profile to your robot's. |
| **Medium** | The drive is a physical model (`src/sim/drive-dynamics.ts`): V5 motor torque from winding current with back-EMF and the 2.5 A limit, battery sag, grip-limited push per side (friction × weight), the robot's mass and inertia, and sideways scrub in turns. Motor constants are estimates from VEX's published ratings. Weight transfer, tipping, wheel flex and tile wear are not modelled, and a stiff motor velocity loop is assumed. | Weight transfer, tipping under acceleration, omni-wheel drift in fast turns and slipping on worn tiles all happen. Profiles can set `dynamics.model` to `"idealized"` for the old fixed `maxAccel`. |
| **Medium** | Pieces the robot pushes along the floor resist it (their mass × floor friction 0.4), but a stack never tips or topples when pushed or hit, and Goals never tip. There are no other robots. | Pushing a pile slows the robot; a tall stack hit hard high up tips over; a Goal loaded off-center can tip. Partner and opponent robots block, push and steal pieces. |
| **Medium** | Hitting a wall or field element gives an impulse at the corner that touched (a little bounce, 0.15, none when the touch is slow), limited by the robot's mass and moment of inertia, so an off-center hit spins the robot; a hit that would overturn it (by its center-of-mass height and wheelbase) is reported as a warning, but the robot does not actually tip. Friction at the contact and the robot's wheels sliding sideways after a hit are not modelled. | A hard hit can tip a tall robot, the wheels scrub sideways, and a bumper flexes. |
| **Low** | One task scheduler step is 1 ms, and `pros::delay()` is exact. | Real task timing jitters by a millisecond or two. |

### Pieces, claws and intakes

| Severity | In the simulator | On a real robot |
|---|---|---|
| **High** | **Snap pickup.** A claw that closes on a piece takes it. **Placement nests:** lowered centred (within 0.4″) onto a Goal or stack, what a claw holds slides on until it sits; let go up to 3″ above the top and within 1″ of the centre, it falls on. | A real piece can catch on a rim or bounce off a fall, and lining up within 0.4″ takes care. Lower onto the stack rather than dropping from high up, and slow down near Goals. |
| **Medium** | Intakes never jam. Everything that touches the zone while it spins is pulled in, and a lying Pin comes up with the end nearer the robot at the bottom. | Pieces jam, come in sideways or bounce out, and the orientation of a lying Pin depends on the intake's design. |
| **Medium** | Floor physics is 2D. Pieces slide and spin on the floor, but stacks never tip over and pieces never bounce or roll. | A stack knocked hard falls over; a Pin can roll away. |
| **Medium** | A held stack collides as an upright cylinder as wide as its widest piece, from its bottom up, and a claw's jaws as a 2.5″ cylinder. Lift bars and arms are not solid. Lifts (and motor wrists) stall on Goals, Loaders, stuck pieces and floor stacks they lower something onto, and on a Goal or Loader they swing something into. A piece picked up next to another is held at the grip point and nudges the other aside over a few hundredths of a second. | A narrow Pin tip can slip into a gap the cylinder can't, and arms and lift bars hit pieces and field elements too. |
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
  the profile's size only, and shown as notes: they don't cost the Autonomous Bonus or the
  AWP. SG6 (possession); SG7 (crossing the Autonomous Line, which is interrupted by the
  Midfield, or touching, taking from or adding to objects on the other side, with the robot or
  what it holds); SG9 (touching opponent Goals, claws and held stacks included); SG10
  (removing Placed objects from neutral Goals: pieces above a break aren't Placed).
- The perimeter (AWP) and Midfield checks count claws and held stacks as part of the robot.
  The live score while scrubbing a replay uses the chassis only; the final score is exact.
- **Not checked:** how far lifts and other mechanisms reach out (expansion during the run),
  entanglement and the other rules. Read the manual ([override-research.md](override-research.md)).
- **Scoring** follows the manual exactly. Placement itself is the idealized part (see above).

### Your code

- Your code is compiled to WebAssembly, not to the V5 Brain's ARM processor.
- Correct code behaves the same on both. Undefined behavior (reading uninitialized
  memory, overflowing arrays) can behave differently.
- Calls the simulator doesn't support are listed in [supported-api.md](supported-api.md).
  They show a note instead of doing anything.
