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
