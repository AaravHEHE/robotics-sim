# Plan for Sonnet 5.5: deep error search, and a research-driven accuracy overhaul

## Context
The user says the simulator is "still extremely bad" despite PRs #1 to #4 (all merged to `main`, last deploy `125b64d` succeeded). They want (1) a deep error search and (2) a deep search of VEX part libraries and every V5RC Override resource and real robot, to make the robots, field and physics much more accurate. This plan was written without doing the searches; Sonnet does them. Repo: `AaravHEHE/robotics-sim`, working branch `claude/physics-phasing-bugs-1kh87h` (restart it from `origin/main` first: `git fetch origin main && git checkout -B claude/physics-phasing-bugs-1kh87h origin/main`).

User preference to follow throughout: do not force an answer when a clear one is not there; ask instead of guessing. Every number taken from a source must cite it (URL or document + page); anything estimated must say "estimate".

## Ground rules for Sonnet
- **Ask before building.** Phases A and B are research and audit only (read-only). Present findings to the user and get a yes on the fix list before Phase C changes code.
- **Network.** This environment's proxy blocks some hosts (it blocked `aaravhehe.github.io` with a 403). Before relying on a site, test it (`curl -sS -m 20 -o /dev/null -w "%{http_code}" <url>`). If a needed host is blocked, tell the user its exact name and that they can add it under the environment's Network access (Allowed domains). Do not invent what a blocked page says.
- **Tests.** Node 22 cannot run the compile tests. Download Node 24 into the scratchpad (`https://nodejs.org/dist/v24.11.0/node-v24.11.0-linux-x64.tar.xz`) and run vitest with a local config (git-excluded) whose forks use `--experimental-wasm-jspi --experimental-wasm-exnref`. The ten golden scores (`tests/override-samples.test.ts:14-25`) must stay or be deliberately retuned; never loosen a golden.
- **Visual checks.** Render with Playwright and the preinstalled Chromium (headless, `--use-angle=swiftshader`) through a temporary, uncommitted `scratch-*.html` page served by `npx vite --port 5199`; look at the screenshots before claiming a visual fix. Delete scratch files before committing.
- **Never pkill with a pattern that matches your own command** (it kills the shell).
- Commit per milestone, push to the branch, open a PR only when the user asks; end commits with the attribution lines the session gives.

## Phase A: deep error search (read-only; report, do not fix)
Use up to 3 Explore agents in parallel, one per area, each told to report file:line, a concrete failing scenario, and severity. Then verify each finding yourself (run it, or write a throwaway test in the scratchpad) and keep only confirmed ones.

1. **Simulator core** (`src/sim/world.ts`, `drive-dynamics.ts`, `other-robot.ts`, `motion.ts`, `runtime.ts`, `pros-api.ts`, `dmath.ts`):
   - determinism: any `Math.sin/cos/atan2/hypot/exp/pow` in sim code (must use `dmath.ts`);
   - drive model edge cases: zero/negative mass, one motor per side, red/green cartridges, `speedScale`, motors unplugged (`currentLimit 0`), very light robots, `planAccel` vs real accel (motions overshoot or reverse?);
   - impacts: corner selection, repeated contacts, energy/momentum, tip warnings on low-speed presses, `MAX_CONTACTS`;
   - second robot: tunneling at speed, two others, others vs Goals/Loaders (they ignore field obstacles today), path end, delay; `src/sim/other-robot.ts` changed on disk after the last commit: diff it against `main` and find out whether the change is the user's.
   - PROS API values now driven by the model (current, temperature, torque, battery) against the PROS docs' units.
2. **Override game** (`src/games/override/*`): toggle dynamics (seat snap, roller, jammer, two robots), toppling (only by carried stacks; ids, SG7, replay), release drift (false misses when the robot creeps), floor physics determinism, scoring/rules edge cases, sensors.
3. **App and visuals** (`src/app/*`): viewer and physics overlay (old recordings without `dyn`, others drawn with wrong heading), robot meshes (`robot-meshes.ts`, `manipulator-meshes.ts`, `claw-meshes.ts`, `chassis-layout.ts`) for every preset AND for user-saved/custom profiles (stale saved robots, profiles with odd sizes), robot editor, mapping, storage/upgrade paths, build ID.
4. Run everything: `npx tsc --noEmit`, the full Node 24 suite, `scripts/check-phasing.ts` and `scripts/check-swing.ts` for every sample, and a headless render of every preset (iso, side, top) with a held stack and an intake ride.

Deliverable A: a table (area, finding, evidence, severity, proposed fix, risk to golden scores) shown to the user.

## Phase B: research for accuracy (read-only; collect sources, do not code)
Goal: replace estimates with sourced numbers and make robots look and move like real Override robots. Record every source in a new `docs/sources.md` (title, URL, what was taken, date accessed). Mark anything unverified.

1. **VEX parts and dimensions** (to fix `data/parts/vex-parts.json` and `scripts/gen-vex-parts.ts`):
   - VEX's own product pages on vexrobotics.com (each part lists dimensions, hole spacing, and often a downloadable STEP/CAD file);
   - VEX's official CAD libraries for Onshape, Fusion 360 and SolidWorks (search vexrobotics.com and the Onshape public library for the official V5 parts library); community libraries (e.g. Protobot, the Onshape "VEX V5" public documents) as a cross-check only;
   - V5 Smart Motor (11 W) and 5.5 W motor spec sheets: free speed, stall torque, stall current, current limit, gear cartridges; V5 battery capacity, voltage and internal resistance if published;
   - wheel catalog sizes (omni 2.75/3.25/4, traction, flex wheel durometers and diameters), C-channel profiles, standoff lengths, shaft sizes, screw lengths, gussets, plates, sprocket and chain pitch, gear tooth counts and pitch diameters.
   For each: compare with the catalog entry and list the diffs.
2. **Override game** (to check `data/fields/override.json`, `docs/override-field-spec.md`, `src/games/override/*`):
   - the latest Override game manual and Q&A rulings on robotevents.com, any manual updates after v2.0, Appendix A field drawings, the official field CAD (already used; re-check part numbers);
   - Pin, Cup, Goal and Toggle drawings: masses if any official or community measurement exists, Goal mounting (are Goals bolted to the tiles? this decides whether Goal tipping should exist), Toggle detent design and the real two-face speed;
   - scoring and autonomous rules that the sim implements; diff the sim's rules against the latest manual text.
3. **Real Override robots** (to fix `data/robots/override-*.json`, `docs/robots.md`):
   - team reveal videos and robot explanations (YouTube, VEX Forum, team Instagram/websites), signature-event and tournament match videos on robotevents.com; `docs/reference/videos.md` already lists some: extend it;
   - for each preset (Banshee, ACE, Claw Gate, DR4B/8059A, Flex Hero Bot, six-bar, four-bar, toggle bot, midfield pusher, skills), find the real robot or the closest real design: drivetrain (wheel size, rpm, motor count), lift type and geometry, claw/intake design, mass if stated, dimensions; note what each preset gets wrong;
   - VEX's own Hero Bot build instructions for Override (exact parts list and geometry for the Flex preset).
4. **Physics references**: published or community-measured V5 drivetrain acceleration and push tests, tile friction coefficients, flex-wheel grip, typical robot masses; use them to calibrate `src/sim/dynamics-spec.ts` and `drive-dynamics.ts` constants (now estimates), the toggle constants in `toggle.ts`, and the toppling thresholds in `game.ts`.

Deliverable B: `docs/sources.md` plus a list of concrete corrections (current value, sourced value, file), shown to the user with Phase A's table. Ask which to do and in what order; also ask whether Goal tipping should be built once the mounting question is answered.

## Phase C: fix (only after the user agrees)
Order by severity and user choice. Expected work, each its own commit with tests:
1. Confirmed bugs from Phase A.
2. Parts catalog corrections (regenerate with `scripts/gen-vex-parts.ts`; `tests/robot-visuals.test.ts`, `tests/claws.test.ts`, `tests/intake-clearance.test.ts` must still pass).
3. Robot preset corrections from real robots (update profiles, `docs/robots.md`; retune each affected sample auton and regenerate `src/app/sample-history.json` with `scripts/gen-sample-history.ts` after committing the sample change; report every golden score that moved and why).
4. Physics constants from sources (`dynamics-spec.ts`, `drive-dynamics.ts`, `toggle.ts`, toppling constants); update `docs/sim-vs-real.md` and `docs/physics-baseline.md` to say which numbers are now sourced.
5. Visual accuracy of robot meshes against the real robots found in B.3, checked by side-by-side renders.

## Verification (every phase C commit)
`npx tsc --noEmit`; full suite on Node 24 green; ten goldens unchanged or deliberately retuned and reported; `scripts/check-phasing.ts` clean per sample; headless renders reviewed; production build (`npx vite build --outDir <scratch>`) succeeds. After the user approves merging: merge the PR and confirm the "Test and deploy to GitHub Pages" run on `main` succeeds.
