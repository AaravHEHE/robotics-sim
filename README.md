# VEX Auton Simulator

A free, browser-based 3D simulator for planning VEX V5 autonomous routes. Paste or
import a real **PROS** project, including **LemLib** or **EZ-Template** code, then press
**Run** to watch the robot drive it on a 12 × 12 ft field built to real measurements.

- **Your code compiles in your browser.** It uses a WebAssembly build of clang 23. There
  is no server; the site is static. The first run downloads about 40 MB, which is cached
  after that. Rebuilds take a fraction of a second.
- **Real APIs.** It uses the actual PROS 4.2.2, LemLib 0.5.6 and EZ-Template 3.2.2
  headers and C++ code, so every signature matches. The simulator implements the PROS
  kernel underneath. See [docs/supported-api.md](docs/supported-api.md).
- **Idealized motion.** No PID is simulated. LemLib and EZ-Template motions drive the
  intended path as fast as your robot's real motors, gearing and wheels allow. Library
  tuning constants are accepted and ignored. Motors, brake modes, pistons, wall contact
  and grip are modelled on real hardware. Everything that still differs from a real robot,
  and what to expect there, is listed in [docs/sim-vs-real.md](docs/sim-vs-real.md).
- **Deterministic replays.** A run is simulated in milliseconds, then replayed with a
  count-up match timer, auto-stop at 15 s or 60 s, scrubbing and slow motion. The same
  code always produces the same run, in every browser.
- **Robot profiles.** Presets, plus your own robots stored in the browser, with an
  optional cosmetic GLB model exported from Onshape. See
  [docs/robot-profile.md](docs/robot-profile.md).
- **V5RC Override (2026–27).** The field is built from manual v2.0 Appendix A, with
  Pins, Cups, Goals, Toggles and Loaders.
  - **Scoring:** live, by the manual's rules, including the Autonomous Bonus, the AWP
    checklist and Skills scoring.
  - **Robots:** lifts (arm, 4-bar, 6-bar, DR4B, cascade, chain bar on a cascade),
    claws, roller claws, intakes, staging trays, wrists and Toggle tools in the profile
    turn your code's motor and piston commands into picking up, stacking and dropping.
    Pieces visibly ride through intakes into trays and claws. There are 9 presets
    modelled on real robots (the Banshee, an 8059A-style DR4B, the Claw Gate, ACE, the
    Flex hero bot and more); see [docs/robots.md](docs/robots.md).
  - **Samples:** a competitive 15 s auton for every robot, each written for that robot
    and using all of its mechanisms. The four meta robots each build a 3-Pin stack and
    turn a Toggle (55 points and the Autonomous Win Point), in PROS, LemLib (one starting
    from the GPS) or EZ-Template. There are also two Skills runs (Match Loads, both
    Toggles, a Midfield park) and a **mechanism test** for every robot, which drives,
    turns and works each mechanism, printing PASS / FAIL per check.
  - **Official field model:** **Field › Model…** loads the official VEX field CAD (the
    ZIP from VEX's field CAD page, or a GLB / OBJ export) for the look of the field. The
    130 MB STEP is converted in your browser in a few minutes, the first time only: it is
    split into pieces the STEP reader can hold, its Pins, Cups, Toggles and screws are left
    out, and its parts are colored by part number. It stays in your browser and never
    changes the simulation.

Requires a browser with WebAssembly JSPI: Chrome/Edge 137+, Firefox 153+ or Safari 27+.

## Using it

1. Open a sample (**Samples**) or **Import** a zip of your PROS project folder. The
   copies of PROS / LemLib / EZ-Template headers in your project's `include/` are ignored
   automatically.
2. Pick a **Robot** whose ports and drivetrain match your code, or **Edit** one. Picking
   a robot opens its auton (it asks first if you have edited the code); **Auton** and
   **Test** open that robot's auton or mechanism test. If your code uses ports the robot
   doesn't have, the run says so.
3. Set the **start position**. LemLib's first `setPose()` can also place the robot.
4. Press **Run** (Ctrl+Enter). The field resets to its starting layout for every run.
   Problems, console output (`printf`, `std::cout`), the
   brain screen (`pros::lcd`) and notes about unsupported calls appear below the editor.

`initialize()` runs first. The match clock starts when `autonomous()` starts, as in a
real match. A loop without `pros::delay()` is detected and stopped, instead of freezing
the page.

## How it works

```
src/compiler/   in-browser build: clang + wasm-ld (WebAssembly), precompiled headers,
                per-file object cache, diagnostics, undefined-reference checks
src/sim/        deterministic simulator: cooperative PROS scheduler (WebAssembly JSPI,
                one stack per task), PROS C API, motors/drivetrain/sensors, idealized
                LemLib/EZ motions, fdlibm-based math for cross-browser determinism
src/app/        UI: Monaco editor, Three.js viewer, timeline, robot profiles, storage
shim/           C/C++ linked into every program: vendored PROS/LemLib/EZ-Template
                sources (unmodified) + simulator glue
data/           field definition and robot presets (JSON)
schemas/        JSON schemas for robot profiles and fields
tests/          unit tests + end-to-end tests that compile and run real projects
```

User code only ever runs as WebAssembly inside a dedicated Web Worker sandbox. It has
no DOM or network access, and a watchdog terminates runaway programs.

## Development

Requires Node.js 24.

```bash
npm install
npm run setup     # download the pinned compiler (hash-verified) and build the simulator library (~2 min)
npm run dev       # http://localhost:5173
npm test          # compiles and simulates the sample projects and golden tests
npm run build     # static site in dist/ (deployed to GitHub Pages by .github/workflows/deploy.yml)
```

After changing anything in `shim/` or `src/compiler/flags.ts`, run
`node scripts/build-shim.ts` again. `node scripts/gen-supported-api.ts` regenerates
`docs/supported-api.md`.

## Status

- **Milestone 1:** the generic empty field, tank drivetrains, PROS, LemLib 0.5 and
  EZ-Template 3.2 autonomous code, robot profiles with GLB models, and replay.
- **Milestone 2:** the V5RC Override field, game objects, scoring, rules, manipulators,
  sensors, robot presets and samples.
- **Milestone 3:** reliability fixes, realistic motion (no turn swing), correct and
  distinct mechanisms, animated pieces, and mechanism tests.
- **Milestone 4:** the field resets between runs and the code follows the robot; robots
  rebuilt from videos of the real meta designs; competitive robot-specific autons;
  the official field model (loaded locally) and a more realistic look.

Next up are more drivetrains and driver control. See
[docs/prototype-report.md](docs/prototype-report.md) for the feasibility study behind the
in-browser compiler.

## Licenses

The simulator's own code is MIT. Vendored code keeps its license, listed in
[shim/vendor/README.md](shim/vendor/README.md): PROS and EZ-Template are MPL-2.0;
LemLib and fmt are MIT. The in-browser compiler is LLVM (Apache-2.0 with LLVM
exception), built with Emscripten (MIT), with the wasi-sdk sysroot (Apache-2.0). It
comes from the prebuilt [llvm-wasm](https://github.com/LuvHakii/llvm-wasm) release
pinned in `scripts/toolchain-pin.ts`.
