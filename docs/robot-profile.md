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

## 3D models (optional)

Attach a `.glb` (Onshape: right-click the assembly, then **Export → GLTF/GLB**). The
model is scaled to fit the profile's footprint unless you set `model.scale`. Rotate it
with `model.rotationDeg` if its front doesn't face forward, and shift it with
`model.offset`. The model never changes the physics.
