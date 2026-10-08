# Physics baseline (before the dynamics work)

The numbers every later physics phase is compared against. A phase that moves one of them reports the change and what was retuned.

## Sample auton scores (`tests/override-samples.test.ts`, `GOLDEN`)

| Sample | Red | Blue |
|---|---|---|
| override-flex | 35 | 0 |
| override-banshee, -ace, -claw-gate, -dr4b-intake | 55 | 0 |
| override-sixbar-wrist, -workhorse-toggle | 45 | 0 |
| override-toggle-bot | 40 | 0 |
| override-midfield-pusher | 8 | 0 |
| override-skills | 48 | 0 |

## Motion behaviour pinned by `tests/world.test.ts`

Top speed within 1% after 900 ms, turn overshoot under 1° on every preset, `moveToPose` never reverses, coast between 10 and 30 in, coast > brake > hold, flush squaring against a wall.

## Model today (see `docs/sim-vs-real.md`)

Two side speeds; acceleration `min(maxAccel, 3·maxAccel·(1 − v/vmax))`; no mass, slip, battery or heat; collisions move the robot out of overlaps without impulses; one robot.

## After the dynamics work

All ten golden scores are unchanged. The toggle-bot's turn/drive settle delays (100 ms to 40 ms) and the Banshee's last approach (10.7 in to 10.65 in) were retuned for the new drive. World-test thresholds moved: top speed within 3% (was 1%) after 900 ms, the rest-to-rest bound uses the drive's real stall acceleration, and a chained move's exit speed uses the planning top speed (85% of free speed). `tests/override-field.test.ts` checks the Goal stop to 0.05 in (was 0.005): the last bounce settles under that.

## Toggles, drops, a second robot, toppling

Toggle rotational dynamics, drift on release, the second robot and stack toppling each left all ten golden scores unchanged. Two tests wait longer for a Toggle to settle (a face takes about half a second: `override-manipulators.test.ts` plate test 500 to 900 ms, `override-scoring.test.ts` release 500 to 900 ms). The suite is 319 tests on Node 24.
