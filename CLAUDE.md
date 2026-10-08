# VEX Auton Simulator

## Goal
Free, public, browser-based 3D simulator for planning VEX V5 autonomous routes
using real PROS C++ code and real field/robot measurements.

## Hard constraints
- Static hosting only (free). No backend. User code compiles in the browser.
- Autonomous only for now. Driver control is a later feature.
- No PID simulation. PID constants are accepted and ignored. Motion is
  limited by real motor/gear/wheel speed and a physical drive model (V5 motor
  torque, battery, grip, mass and inertia; src/sim/drive-dynamics.ts). Profiles
  can set `dynamics.model: "idealized"` for the old fixed-acceleration limit.
- Real measurements for field and robots (inches).
- Scoring is out of scope until a specific game is added.

## Code support
- PROS C++ via a PROS API shim (use real public headers for signatures).
- LemLib and EZ-Template: re-implement public APIs with idealized motion.
  Track which functions are supported in docs/supported-api.md.

## Architecture rules
- Robots are JSON profiles, not hard-coded. Cosmetic glTF/GLB models are
  optional and never affect physics. Moving parts are named nodes in the model.
- Field is data-driven: generic 12x12 ft first, game-specific fields added later.
- Timer: count-up, auto-stop selectable at 15 s or 60 s.
- Custom robots/models stored in browser, exportable as files.
- Untrusted user code: never run outside a browser sandbox.

## Working style
- Build in small end-to-end milestones; commit after each working one.
- Prototype risky pieces (browser compile) before building on them.
- Put reference docs and game manuals in docs/.
