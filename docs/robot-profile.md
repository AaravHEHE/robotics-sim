# Robot profiles

A robot profile is a JSON file describing your robot's hardware in real units. The
simulator uses **only the profile** for size, collisions and speed. A 3D model (GLB) is
optional and purely cosmetic.

Edit profiles in the app (**Robot → Edit**). Saving a preset makes a copy under "My
robots", stored in your browser. **Export robot** downloads a `.zip` with `robot.json`
and, if attached, `model.glb`, so you can share it or move it to another computer.
JSON schema: [`schemas/robot.schema.json`](../schemas/robot.schema.json).

## Coordinates and units

- Inches, rpm, degrees.
- On the field, the origin is the center. +y points away from the near wall (the one at
  the bottom of the top view). Headings are clockwise from +y, which matches LemLib.
- On the robot, +x is right and +y is forward.

## Fields

| Field | Meaning |
| --- | --- |
| `schema` | Always `1`. |
| `id`, `name`, `description` | Identification. |
| `size.width / length / height` | Overall footprint and height. Width and length are the collision box against the field walls. |
| `drivetrain.type` | `"tank"`. Other drivetrains are not supported yet. |
| `drivetrain.left`, `drivetrain.right` | Smart ports of each side's motors, **signed the way your code must declare them to drive forward**. For example, if your code says `pros::MotorGroup left({-1, -2, -3})`, use `[-1, -2, -3]`. If the code's reversal doesn't match, the robot spins or drives backwards, just like the real one. |
| `drivetrain.cartridge` | `red` (100 rpm), `green` (200 rpm) or `blue` (600 rpm). |
| `drivetrain.wheelDiameter` | Inches: 2.75, 3.25, 4 (new omnis), 4.125 (old 4" omnis), and so on. |
| `drivetrain.wheelRpm` | Wheel rpm at full motor speed, after gearing. For example, blue motors geared 36:48 give 600 × 36/48 = 450. |
| `drivetrain.trackWidth` | Distance between the centers of the left and right wheels. |
| `drivetrain.maxAccel` | Linear acceleration and braking limit, in in/s². Typical V5 drivetrains are 120–250. Lower it for heavy robots or slippery wheels. |
| `drivetrain.speedScale` | Optional, 0.1–1. The fraction of free speed reached under load (default 1). Set it around 0.9 if your robot is slower than theory. |
| `devices` | Everything else plugged into the brain (see below). |
| `mechanisms` | Moving parts shown in the viewer (see below). |
| `model` | Set by the app when you attach a GLB: `assetId`, plus optional `scale`, `offset [x, y, z]` and `rotationDeg`. |

### Devices

| Type | Fields | Simulated as |
| --- | --- | --- |
| `motor` | `port`, `cartridge` | A motor with its own speed ramp (non-drive mechanisms). |
| `imu` | `port` | Ideal heading and rotation. 2 s calibration. The accelerometer includes vibration while moving. |
| `rotation` | `port`, plus optionally `trackingWheel {axis, wheelDiameter, offset}` or `mechanism` | A tracking wheel reads its travel: `vertical` wheels roll forward (offset = inches to the right of center), `horizontal` wheels roll sideways (offset = inches forward of center). With `mechanism`, it reads that mechanism's angle. |
| `distance` | `port`, `mount {x, y, z?, heading}` | Distance (mm, like PROS) along the sensor's direction to the walls, Goals and Loaders, and on a game field to Pins and Cups at its height `z` (default 3"). |
| `gps` | `port`, optional `mount {x, y, heading?}` (where the sensor sits, which way it faces) | Field position in meters and heading. It reports the turning center when your code's offset (`pros::Gps(port, xOffset, yOffset)`) matches `mount`; otherwise the sensor's own position. |
| `optical` | `port`, optional `mount {x, y, z?, heading}` (default: front center, 2" up, facing forward), optional `watches` (a claw, intake or staging mechanism) | On a game field: hue, saturation, brightness and proximity of the Pin, Cup, Goal or Toggle face in front of it (up to 6") at height `z`. With `watches`, it reads what that mechanism holds, e.g. the color of the Pin in a staging tray. |
| `adi_digital_out` | `port` (`"A"`–`"H"`) | A solenoid. Drives `piston` mechanisms. |
| `vision`, `ai_vision`, `adi_digital_in` | `port` | Present on the port, but readings aren't simulated yet. |

The **code is authoritative for ports**. If code uses a device on a port where the
profile has nothing, or has a different device, the calls do nothing and the
simulator shows a note, as a real robot with the wrong wiring would behave.

### Mechanisms

| Kind | Fields | Shown as |
| --- | --- | --- |
| `roller`, `arm`, `flywheel` | `name`, `motors` (unsigned ports), `ratio` (output turns per motor turn), optional `range [minDeg, maxDeg]` (hard stops, for arms), optional `node` | A rotating part. Its angle is recorded every frame. |
| `piston` | `name`, `adi` (port letter), optional `travel` (inches), optional `node` | An extending part. |

`node` is the name of a node in your GLB model that the mechanism moves. In Onshape,
make the moving part its own sub-assembly or part, then export the assembly as GLB. The
part names become node names.

### Game manipulators (V5RC Override)

These mechanisms let your code pick up, carry, stack and drop Pins and Cups, and turn
Toggles. Each one is driven like any other mechanism:
- **Motors:** `motors` plus `ratio`, optionally `range`. The output is in degrees.
- **Solenoid:** `adi`. The output is 0 when retracted and 1 when extended.

Positions use the robot frame in inches: `x` is right, `y` is forward from the robot's
center, and `z` is up from the tiles.

Pickup and placement are idealized "snap" rules:
- A claw that closes on an object takes it.
- A claw that opens over a Goal or a stack at the right height nests what it holds.
- Anywhere else, the held pieces drop. A lone Pin falls over; anything else lands
  standing.

| Kind | Fields | What it does |
| --- | --- | --- |
| `lift` | `lift`: `arm`, `fourbar`, `sixbar`, `dr4b`, `cascade`, `chainbar` or `piston`. `home {y, z}`: the end effector at output 0. Bar lifts (and `chainbar`) take `length` and `startAngle` (degrees above horizontal at output 0). `cascade` takes `spoolDiameter` and `stages`. `piston` takes `travel`. Optional `facing`: `front` (default) or `rear`, for a bar lift that reaches out behind the robot (home `y` negative). Optional `base`: the name of another lift this one rides on (a chain bar on a cascade's carriage): it moves with that lift's end effector. | Moves its end effector. arm / fourbar: the tip swings on a bar. sixbar: twice the rise of a fourbar with the reach of one bar. dr4b: twice the rise, with constant reach. cascade: rises by spool travel × stages. chainbar: swings on a bar like an arm, but the claw stays level (it can swing from the front over the top to the back). piston: rises `travel`. An `arm` tilts its claw by its angle (a `wrist` can turn it back); a claw tilted more than 20° can't pick up or set down a standing stack. Unpowered, a lift sags (coast) or creeps down (brake); `hold` keeps it up. |
| `claw` | `grip`: `piston`, `motor` (closed at or past `closedAt` degrees) or `roller`. `lift` (rides on it) or a fixed `at {y, z}`. Optional: `closedWhen` (`extended`, the default, or `retracted`), `inward` (roller), `reach` (capture radius, default 2″), `capacity {pins, cups}` (default 1 + 1), `preload`. | **Closing** grabs what is between the jaws: within `reach` along them and at most 1.25″ to the side of the grip point. Candidates: a staging area's contents; the bottom piece of a Loader, if the claw is low; a lying Pin; or the piece of a floor or Goal stack at the grip height, together with everything above it. Loose pieces are taken before Placed ones, and a Goal's pieces only when the claw is centered on it (within 1.5″). **An open claw holds nothing it gripped:** opening within 1.5″ of a Goal or stack places the held stack, provided its bottom is between 2″ below and 4″ above where it would rest and the kinds alternate (a Pin can't stand on a Pin, nor a Cup on a Cup). Otherwise it drops beside the robot. A claw holds a piece where it closed on it (never within 1″ of either end), so lift heights are the same however a piece was picked up. A Preload claw starts closed on the Preload, which stands on the tiles (a motor claw starts at `closedAt`). A claw must be within 20° of upright to close around, or set down, a standing stack. A claw on a single-pivot `arm` tilts with the arm, so an arm robot only grabs and places near its lowest positions; a motor `wrist` tilts it too (0° and 180° are upright). A roller claw grabs while spinning in, and spits pieces out one at a time, bottom first, at roller speed. |
| `intake` | `zone {x, y, width, length}` (capture area). Optional: `into` (a claw or staging area), `accepts {pins, cups, lying}`, `inward`, `transferMs` (default 300), `rollerDiameter` (default 2.75″), `capacity`, `preload`, `handoff {y, z}` (where it hands pieces to its claw: the claw takes them when it is within 2.5″ of that point and open, e.g. an arm folded back over the intake). | While spinning in, it takes standing stacks, lying Pins and a Loader's bottom piece that touch the zone (a piece pressed against the bumper counts when the zone reaches the bumper). Pieces follow one piece-length apart at the rollers' surface speed (rpm × π × `rollerDiameter`). A Loader's next piece needs ~0.2 s to drop into its opening. After `transferMs`, pieces move on to `into` if there's room. A claw only receives them while it is open and at the `handoff` point (default: its lift down); they rest in the open claw until it closes, and fall out if it is raised first. Spinning out spits back what is still in the intake. |
| `staging` | `at {y, z}`. Optional: `capacity`, `preload`. | Holds what an intake delivers, assembled into a combo: Pin, then the Cup over it. A claw that closes at `at` takes the whole combo. |
| `wrist` | `claw`, driven by motors or a solenoid | Turns what the claw holds end over end: a motor output past 95° (and back below 85°: no chatter around 90°), or the solenoid extended. |
| `toggleTool` | `tool`: `bumper`, `plate`, `roller` or `jammer`. `box {x, y, width, length}`, plus `bottom` and `top` heights. `plate` and `jammer` use `adi` (out while extended); `roller` uses `motors` and `inward`. | Reaches the perimeter Toggles, whose underside is about 11.2″ up. Pressing a bumper, or an extended plate, into a Toggle rolls it outward one face per press; hit faster than 40 in/s, it turns two faces (it carries on to the second face even if the robot backs straight off). A roller rolls it either way while spinning. A jammer touching a Toggle stops it turning either way; a Toggle still touched by the robot at the end counts as neutral, so let go first. The chassis box (`size.height`) counts too. |

Notes:
- **Preload.** `preload` (`alliance-down` or `yellow-down`) on one claw, intake or
  staging area starts the Match holding the alliance Preload Pin. A preloaded claw lets
  go the first time it opens.
- **Lying Pins.** A lying Pin that is picked up stands with the end nearest the robot at
  the bottom.
- **Possession.** The simulator reports `<SG6>` when the robot possesses more than 1 Pin
  or 1 Cup in total. Capacities only limit what each mechanism can hold.
- **Skills Match Loads.** In Skills, the drive team keeps both red Loaders stocked:
  1 piece per Loader about every second, alternating Pins and Cups, up to 2 per chute.
  In head-to-head autonomous, Match Loads aren't allowed (`<SG11>`).

## Editing a robot

**CAD a robot** (at the top of the page, or **Edit** beside the robot) opens the robot
selected at the top in three tabs that edit the same profile. Unsaved edits are kept while
you switch workspaces; picking another robot starts over with it.

- **Layout:** a top view (front up) and a side view (front to the right) on an inch grid.
  - Drag the chassis from its corners (it stays centered), the wheel track, intake pickup
    zones and hand-off points, Toggle tools (their footprint and height), sensor mounts,
    lift carriages, and bar-lift tips and pivots. Dragging a tip keeps the pivot and sets
    `length` and `startAngle`; dragging a pivot carries the whole lift.
  - The side view shows each lift's path over its `range` and how far each claw reaches.
  - Pick a part to edit everything else in the form. Add a mechanism or sensor (free ports
    are picked, and a motor device is added for each motor), or remove one (its ports are
    freed). Ctrl+Z undoes.
- **JSON:** the profile itself. Every layout change appears here and is validated.

## 3D models (optional)

Without a model of its own, a robot is drawn from its profile with the VEX parts kit's parts, the way a team would build it. Nothing floats: every part is fastened to the rest of the robot, and a test checks this for every preset at every mechanism position.

- **Drive base.** Drilled C-channel drive rails, joined by standoffs. Omni wheels sit on shafts at the robot's track width (a traction wheel in the middle of a 6-wheel drive), running through bearing flats, with spacers filling every gap and collars at the ends. Each drive motor is screwed to the rail on its wheel's axle; a one-motor side drives its other wheels by chain. Crossbars are bolted to the rails at every crossing.
- **Electronics.** The brain sits on standoffs. The battery and (with pistons) the air tank are zip-tied down, and the solenoid sits in a crossbar's trough. Smart Cables run from every motor to the brain, and tubing from the tank. License plates are screwed to the end crossbars.
- **Lifts.** Towers are gusseted to the rails and braced. Their motors drive the pivots through gear pairs matching the lift's ratio. 4-bars and 6-bars have parallel bars and couplers with screw joints. Chain bars have chain and sprockets; DR4Bs have a carriage and rubber bands. Cascades have nested stages on nylon slide blocks, with pulleys and string from a motor-driven spool.
- **Claws.** Side and back plates, fingers on arms, a piston on standoffs (or upright rollers between plates), and shafts through bearings into the lift. A motor wrist drives the claw through a gear pair.
- **Other mechanisms.** Intakes run on side arms with a chain drive. Toggle tools are mounted on posts bolted to the end crossbars.

- **Build from VEX parts:** see below.

**Build from VEX parts** builds the look from VEX parts on
the ½″ hole grid: 131 parts in [data/parts/vex-parts.json](../data/parts/vex-parts.json) (approximate
dimensions, generated by scripts/gen-vex-parts.ts): aluminum and steel C-channel, angle, plates and bars, slides, gussets, a turntable; standoffs and couplers, nylon spacers, set-screw and clamping collars, bearing flats and pillow blocks, 8-32 star-drive screws (¼″ to 2″), keps and nylock nuts, steel and Teflon washers, bent gussets and L-brackets; square, high-strength and hex shafts; standard, high-strength and crown gears, a worm and a rack; #25 and #35 sprockets and chain; pulleys, a winch spool, string and surgical tubing; omni, traction, anti-static, mecanum and flex wheels; 11 W and 5.5 W motors, the brain, battery, radio and every V5 sensor; pneumatic cylinders, tank, solenoid, manifold, regulator and tubing. Search the list by name. It is saved at real scale (`model.scale` 1), the build is kept to edit later,
and it is included when you export the robot. **Fit the robot's size to the build** sets
`size`, `trackWidth` and `wheelDiameter` from it.


Attach a `.glb` (Onshape: right-click the assembly, then **Export → GLTF/GLB**). The
model is scaled to fit the profile's footprint unless you set `model.scale`. Rotate it
with `model.rotationDeg` if its front doesn't face forward, and shift it with
`model.offset`. The model never changes the physics.
