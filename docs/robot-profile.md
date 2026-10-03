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
| `distance` | `port`, `mount {x, y, heading}` | Distance to the field walls along the sensor's direction (mm, like PROS). |
| `adi_digital_out` | `port` (`"A"`–`"H"`) | A solenoid. Drives `piston` mechanisms. |
| `optical`, `gps`, `vision`, `ai_vision`, `adi_digital_in` | `port` | Present on the port, but readings aren't simulated yet. |

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
| `lift` | `lift`: `arm`, `fourbar`, `sixbar`, `dr4b`, `cascade` or `piston`. `home {y, z}`: the end effector at output 0. Bar lifts take `length` and `startAngle` (degrees above horizontal at output 0). `cascade` takes `spoolDiameter` and `stages`. `piston` takes `travel`. | Moves its end effector. arm / fourbar: the tip swings on a bar. sixbar: twice the rise of a fourbar with the reach of one bar. dr4b: twice the rise, with constant reach. cascade: rises by spool travel × stages. piston: rises `travel`. |
| `claw` | `grip`: `piston`, `motor` (closed at or past `closedAt` degrees) or `roller`. `lift` (rides on it) or a fixed `at {y, z}`. Optional: `closedWhen` (`extended`, the default, or `retracted`), `inward` (roller), `reach` (capture radius, default 2″), `capacity {pins, cups}` (default 1 + 1), `preload`. | **Closing** grabs the nearest of these within `reach` of the grip point: a staging area's contents; the bottom piece of a Loader, if the claw is low; a lying Pin; or the piece of a floor or Goal stack at the grip height, together with everything above it. **Opening** within 1.5″ of a Goal or stack places the held stack, provided its bottom is between 2″ below and 4″ above where it would rest. A roller claw grabs while spinning in and releases while spinning out. |
| `intake` | `zone {x, y, width, length}` (capture area). Optional: `into` (a claw or staging area), `accepts {pins, cups, lying}`, `inward`, `transferMs` (default 300), `capacity`, `preload`. | While spinning in, it takes standing stacks, lying Pins and a Loader's bottom piece whose center is in the zone, one every 150 ms. After `transferMs`, pieces move on to `into` if there's room; a claw only receives them while its lift is down. Spinning out spits back what is still in the intake. |
| `staging` | `at {y, z}`. Optional: `capacity`, `preload`. | Holds what an intake delivers, assembled into a combo: Pin, then the Cup over it. A claw that closes at `at` takes the whole combo. |
| `wrist` | `claw`, driven by motors or a solenoid | Turns what the claw holds end over end: a motor output between 90° and 270°, or the solenoid extended. |
| `toggleTool` | `tool`: `bumper`, `plate` or `roller`. `box {x, y, width, length}`, plus `bottom` and `top` heights. `plate` uses `adi`; `roller` uses `motors` and `inward`. | Reaches the perimeter Toggles, whose underside is about 11.2″ up. Pressing a bumper, or an extended plate, into a Toggle rolls it outward one face per press. A roller rolls it either way while spinning. The chassis box (`size.height`) counts too. |

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

## 3D models (optional)

Attach a `.glb` (Onshape: right-click the assembly, then **Export → GLTF/GLB**). The
model is scaled to fit the profile's footprint unless you set `model.scale`. Rotate it
with `model.rotationDeg` if its front doesn't face forward, and shift it with
`model.offset`. The model never changes the physics.
