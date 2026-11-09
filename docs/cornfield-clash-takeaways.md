# Takeaways: Cornfield Clash Jr. footage and Override robot types

Everything learned from the 7 h 23 m Fall 2026 Illini Cornfield Clash Jr. stream (YouTube `9H4powqTyUA`) and from
the repo's existing Override research, organised by robot type, with pros and cons. Companion to
[reference/cornfield-clash-2026.md](reference/cornfield-clash-2026.md) (the raw findings and measurements).

## 0. How to read this file: where each fact comes from

The footage is an overhead field camera. From above, every lift looks like "a robot with something tall or reaching
on it". **The footage cannot tell a DR4B from a cascade, or a 4-bar from a 6-bar.** So the lift-by-lift sections
below combine three kinds of fact, and each statement is tagged:

| Tag | Meaning |
|---|---|
| **[footage]** | Seen in this event's video (with timestamps where it matters). |
| **[repo research]** | Already recorded in `docs/override-research.md` and `docs/reference/videos.md` from team reveal and explainer videos. I did **not** re-watch those videos in this session; I am repeating what the repo says. |
| **[general]** | General VEX / mechanical-engineering knowledge, not verified against any source here. Treat as background, not evidence. |
| **[sim]** | How the simulator currently models it (`docs/robots.md`, `data/robots/override-*.json`). |

Numbers marked "estimate" are rough. Anything not tagged as measured was not measured.

## 1. What the footage actually shows about robots (all types)

### 1.1 Event and sample
- A middle- and high-school event (Illinois), 54 qualification matches (2v2), then Round of 16, quarter-finals,
  semi-finals and finals. Overhead camera, 12 x 12 ft field, scoreboard overlay with team numbers and a match clock.
- About 27 teams appear (six 2360x, five 3695x, four 355x, three 2827x, two each of 8995x, 88976x and 20612x, plus
  499R, 23545A and 99766D). Several clubs entered multiple teams, so many robots may share a design family and
  builder. That makes this **a narrow, junior sample, not the top of the sport**.
- The overlay never connects a team number to a robot, and robots carry no readable numbers at this resolution.
  **No robot in this report is attributed to a team** except where the scoreboard fixes it by process of elimination
  (and even then I did not rely on it).

### 1.2 Size
- Footprints looked like about 14 to 24 in across blocks of the stream (typical 15 to 22 in), under one 24 in tile
  (estimate; perspective inflates tall robots and extended mechanisms). One calibrated close-up (Qual 39, 144 in field
  about 890 px) gave 19 to 23 in. The start-size limit is 18 in (rule SG1) and the expansion limit is 24 in
  (SG2), so what is seen is consistent with robots expanding after the start.
- The sim's presets are 14 to 18 in (`data/robots/override-*.json`), inside the observed range.

### 1.3 Drivetrain
- **[footage]** Everything looked like tank / skid-steer with a row of wheels along each side. Nothing was clearly
  holonomic (no mecanum or X-drive seen).
- **[footage]** 4 versus 6 wheels could not be counted from 360p and was not resolved in the dense 1080p clips either
  (only four robots were measured).
- **[repo research]** The common competitive drive is 4 x 11 W motors geared to about 450 rpm on 3.25 in omnis,
  with 55 W (six-motor) variants and traction-wheel variants (8059A: 360 rpm traction; midfield pushers).
- **[sim]** Presets use 6 motors (3 per side), blue cartridge, 3.25 in wheels, 450 rpm (360 rpm for the 8059A-style DR4B);
  Flex is one green motor per side on 4 in wheels (about 42 in/s).

### 1.4 Intake and claw hardware seen
- Front roller intakes and open "box" or scoop fronts (many robots).
- A robot with two uprights holding a clamp with a Cone-shaped Pin held in the middle (about 1:03:00).
- A "twin-post mast carrying pins" (Qual 21, 1:54:40) and silver rail lifts beside a built red-and-yellow Pin tower
  (about 4:14:10): consistent with linear lifts, but not conclusive.
- A white C-channel robot with long side wings that extend past the base (Qual 31, about 3:37), and light open-frame
  robots with wide open "U" fronts (about 4:06 to 4:07). **Neither archetype has a simulator preset.**
- A tall white-frame robot paired with a low black/red robot with a blue-lit brain in Finals (about 7:05:30).
- Teal/green lattice robot seen in Quals 11, 14 and 18 (possibly more than one such robot); gold/yellow-framed robot
  in Qual 16; black/purple robot on the blue side in Qual 13.

### 1.5 Autonomous quality is low, relative to the presets
- Several robots barely moved in autonomous (for example Qual 24 at 2:07:20 vs 2:07:40, Qual 25 at 2:11:30 vs 2:11:40,
  Qual 51). Many teams run a very short or no autonomous.
- Real result cards: Red 66 / Blue 80 (QF 4-1), Red 80 / Blue 38 (SF 1-1), Red 52 / Blue 100 (SF 2-1). Score items:
  Pins Placed, Yellow Pins Owned, Robots in Midfield, a 12-point Autonomous Bonus, an Auton Win Point.
- Compare the sim's preset autons at 40 to 55 points in 15 s. Those are expert-level routines, not what this event
  typically did. The sim is fine for planning; it is not a model of an average team's auton.

## 2. Lift types, one by one

For each: how it works, pros, cons, Override specifics, how the sim represents it, and what (if anything) the
footage says. Typical Override geometry from the repo: Goals are 3.25 in (alliance), 5.77 in (short) and 8.77 in
(center) tall, a Pin adds about 6.8 in to the first layer and 7.1 in per extra Pin/Cup layer, and a 50 in robot height
limit caps practical stacks at about 6 Pins (stack-top table in `docs/override-research.md`).

### 2.1 Two-bar (single arm)
**How it works.** One arm pivoting on a shaft, driven by a motor through gearing. **[general]**
- **Path:** an arc. The end of the arm swings forward and up. **[repo research: "arc, 1 to 2 layers"]**
- **Orientation:** whatever the claw rides on tilts with the arm unless a second mechanism (a wrist, a chain bar or
  a second parallel link) levels it. **[sim]**: "a claw on a single-pivot arm tilts with the arm, so it only grabs and
  places near the bottom".

**Pros**
- Simplest lift: fewest parts, lightest, cheapest, fastest to build and to code. **[general]**
- Very little to go wrong; easy to keep inside the starting size. **[general]**
- Fast over short travel. **[general]**
- The official Hero Bot is built this way, so beginners meet it first. **[repo research]**

**Cons**
- Low reach: 1 to 2 stack layers. **[repo research]** The research doc says the Flex arm reaches about 15 in.
- The claw tilts as it rises, so it can only place near the bottom of its travel (Flex presets can only set a stack down
  below about 20 degrees of arm). **[sim]**
- The arc swings the load sideways and forward, so reach and height trade against each other. **[general]**

**Override notes**
- Flex (Hero Bot) reaches an alliance Goal (3.25 in) or a short Goal (5.77 in) but "can't stack": a Cup has to clear
  the placed Pin's 6.8 in top, and at that arm angle the claw is tilted too far to set it down level (`robots.md`).
- Banshee is a two-bar arm with a wrist that keeps the claw upright (wrist = minus arm), folding back over the intake;
  it "has to go up and over a stack", so about three Pins is its limit. **[sim, from a Joseph973 reveal]**

**Sim.** Flex: arm port 7, 1:5, motor claw closed past 60 degrees. Banshee: pivot at (0, 10), 11 in arm, 25 degrees =
a Pin over an empty Goal, 45 degrees = Cup + Pin over 1 Pin, 83 degrees = over 2 Pins.
**Footage.** Not identifiable from overhead.

### 2.2 Four-bar
**How it works.** A parallelogram linkage (two parallel links and two pivots) so the end stays at the same orientation
while it swings. **[general]**

**Pros**
- Keeps the claw level (or close to it) with no extra mechanism. **[general]**
- Moderate reach, simple, light, one or two motors. **[general]**
- "The most common design among average teams" in Override (published code from Rambotics, "Voltage" and
  taksh-nahata). **[repo research]**
- Works with pneumatic claws and a rear-mounted claw. **[repo research]**

**Cons**
- Still an arc: the end moves forward as it rises, so reach and height are coupled. **[general]**
- Limited height, about 12 to 20 in (estimate), "low to mid" stacks. **[repo research]**
- Needs anti-tip logic in code (Rambotics cut back at about 9 degrees of roll). **[repo research]**

**Override notes**
- Presets use a rear claw and a front passive Toggle bumper: square up to the wall and press, one roll gives one colour,
  two rolls give the other. **[repo research]**
- The 4-bar preset starts 3 in off the wall because the rear claw's Preload would otherwise be inside the wall. **[sim]**

**Sim.** `override-fourbar-claw`: 4-bar port 7, 1:5, piston claw. 18 degrees = a Pin over an empty Goal (claw 12.35 in
behind); 36 degrees = Cup + Pin over 1 Pin. Auton scores 45.
**Footage.** Not identifiable from overhead.

### 2.3 Six-bar
**How it works.** A longer, multi-link arm that stays mostly level while rising higher than a four-bar. **[repo research:
"6-bar: higher, mostly level, still an arc"]**

**Pros**
- More height than a 4-bar with the claw staying (mostly) level. **[repo research]**
- Often paired with a wrist claw that can rotate or flip the held Pin, which matters because which half of a Pin is up
  and which Cup half covers it decides the score. **[repo research]**
- Official-style example: 8059S (hero-style 6-bar plus claw). **[repo research]**

**Cons**
- Still an arc, so it moves forward as it rises. **[repo research]**
- More parts and complexity than a 4-bar; a 360-degree wrist claw is precise but slow. **[repo research]**
- Mid reach only: about 25 to 35 in (estimate). **[repo research]**

**Sim.** `override-sixbar-wrist`: 6-bar port 7 (1:5), piston claw on a motor wrist (port 8, 1:2) that can turn the
Preload over. 16 degrees = the flipped Preload over an empty Goal; 27 degrees = Cup + Pin over 1 Pin. Auton scores 45.
**Footage.** Not identifiable from overhead.

### 2.4 Double reverse four-bar (DR4B)
**How it works.** Two four-bar linkages joined in reverse so the end effector rises nearly straight up and stays level.
**[repo research: "straight up, level, tall and stable, heavy"]**

**Pros**
- Tall reach (about 40 to 50 in, about 0.5 s to full height in the research doc's estimate) with the claw staying level.
  **[repo research]**
- Rises almost straight up, so it is easy to line up on a Goal and does not push stacks forward. **[repo research]**
- Good for tall stacks and the Loader hand-off. **[repo research]**
- The meta ranking lists it third ("Tiger"). **[repo research, slides only]**

**Cons**
- Heavy, with lots of parts. **[repo research]** Uses a big share of the mechanism power budget. **[repo research]**
- "It arcs sideways when tall, so it must respect the 24 in footprint; it can tip." **[repo research]**
- Tall and heavy raises the centre of mass; can tip under acceleration or contact. **[repo research, general]**
- Usually needs rubber-band assist and a hard-stop zeroing routine. **[repo research]**

**Override notes**
- 8059A: 360 rpm traction drive, 3-stage 600 rpm 11 W intake into a chamber on a standoff-linkage DR4B (2 x 11 W,
  14 rpm, motors low) at the back of the robot; latex floor lets the Pin drop onto a Goal; one-piston clamp. **[repo research]**
- Joseph973's DR4B: motors at the base, triangle banding, a rotating claw swings down to take from the intake. **[repo research]**

**Sim.** `override-dr4b-intake`: 15 x 15 x 15, 6-motor traction drive at 360 rpm; DR4B on ports 7 and 8 (12:84), chamber
11 in behind centre rising straight up (z 2 at 0 degrees to about 34 at 110 degrees). DR4B 13 degrees = a Pin over an
empty Goal; 25 degrees = over 1 Pin; 45.5 degrees = over 2 Pins. It starts 3 in off the wall. Auton scores 55 with AWP.
**Footage.** Not identifiable from overhead.

### 2.5 Double reverse six-bar (DR6B)
**What I found.** The repo's research doc lists "DR4B / DR6B + roller claw" as one archetype
(`docs/override-research.md` section 2.2) but does **not** define a DR6B, name a team that uses one, or give numbers
for it. No source in this repo, and nothing in the footage, describes one. **I cannot give sourced pros and cons.**

**[general, unverified]** By analogy with DR4B, a DR6B would use longer or additional links to reach higher or fold
smaller, at the cost of more parts, more weight, more friction and more tuning. I would treat these as hypotheses,
not facts. If DR6B matters for the simulator, the next step is to find a real example first.

**Sim.** No DR6B preset. `src/app/chassis-layout.ts` and `manipulator-meshes.ts` mention the name; I did not read how.

### 2.6 Cascade (cascading linear slides)
**How it works.** Nested slide stages that extend together, so height comes from stage count and spool diameter.
**[repo research: "all stages rise at once, fast and compact"]**

**Pros**
- Rises straight up with almost no sideways growth. **[repo research]**
- Compact when retracted; reaches the full 50 in. **[repo research]**
- Fast in competition configurations: forum estimate of about 10 to 15 in/s, about 3 s to full height (consistent for
  a 50 in lift). **[repo research]**
- Ranked first ("Claw Gate / Clawscade") and fourth ("ACE Cascade") in the meta ranking. **[repo research, slides only]**
- Best at tall centre-Goal stacks. **[repo research]**

**Cons**
- More complex rigging (strings or chain across stages) and slop between stages; needs tuning. **[general]**
- Top-heavy when extended; can tip. **[general]**
- Needs a chain bar or a claw mechanism to set a piece out in front of the stack (ACE: "the cascade sets the height;
  the chain bar swings the piece from the front over the stack"). **[repo research]**

**Override notes**
- 99182E (titled 1698Z): 22 W cascade on a 55 W drive, banded 5.5 W chain-bar claw; it drives into the Loader and
  clamps; two pistons tilt the claw down to intake a Cup + Pin from the floor. **[repo research]**
- ACE: a "lobster claw" (bent HS shaft) clamps a Cup's waist and the Pin inside, straight off the floor or out of a
  Loader; anti-tip wedges; a passive one-way "finger" Toggle mechanism. **[repo research]**
- No reveal of the actual Claw Gate / Clawscade was found, so its preset is approximate (99182E + ACE). **[repo research]**

**Sim.** `override-claw-gate` and `override-ace`: cascade ports 7 and 8 (blue, 1:3), 3 stages on a 1.375 in spool, about
0.036 in per spool degree; chain bar on port 9 (green, 1:3) rides the carriage, stays level; ACE has no intake. Spool
degrees for the Claw Gate: 90 carries the Preload over an empty Goal, 70 a Cup + Pin over 1 Pin, 270 over 2 Pins, 140 over
the yellow Pin on a short neutral Goal. Both autons score 55 with AWP.
**Footage.** "Silver rail lifts" and a "twin-post mast carrying pins" are consistent with linear slides, but overhead
frames cannot show how the stages are rigged.

### 2.7 Continuous lift
**How it works.** A cascade-like linear lift on a single rigging in which the stages rise in turn rather than all at
once. **[repo research: "one rigging, stages rise in turn, slower but stronger"]**

**Pros**
- Stronger for a given motor power than a cascade, because the load is lifted one stage at a time. **[repo research]**
- A 3-Pin auto in 15 s was built on a continuous lift with a chain-bar claw. **[repo research]**
- Straight-up motion like a cascade. **[repo research]**

**Cons**
- Slower than a cascade. **[repo research]**
- Same general complexity issues as slides: slop, string routing, tuning. **[general]**
- The claw and any chain bar sit at the top of a lift that has to be raised for every piece, so cycle time suffers.
  **[general, consistent with the frame notes "claw at the top of a raised continuous lift"]**

**Sim.** The cascade preset is the closest model. There is no separate continuous-lift preset.
**Footage.** Not identifiable from overhead.

### 2.8 Side by side

| Lift | Reach (Override, estimate) | Path | Claw stays level? | Speed | Complexity | Main risk |
|---|---|---|---|---|---|---|
| Two-bar | 1 to 2 layers (about 15 in for Flex) | arc | No (unless wrist/chain bar) | fast | lowest | cannot stack tall |
| Four-bar | about 12 to 20 in | arc | Yes | fast | low | low reach, coupled reach/height |
| Six-bar | about 25 to 35 in | arc | Mostly | medium | medium | arc, wrist is slow |
| DR4B | about 40 to 50 in | nearly straight up | Yes | about 0.5 s to full (estimate) | high | weight, tipping, motor budget |
| DR6B | unknown (no source) | unknown | unknown | unknown | unknown | unknown |
| Cascade | up to 50 in | straight up | Yes (with chain bar) | about 10 to 15 in/s (estimate) | high | rigging, slop, tipping |
| Continuous | up to 50 in | straight up | Yes | slower than cascade | high | cycle time |

(All reach numbers are from `docs/override-research.md` and `docs/reference/videos.md`, not from the footage.)

## 3. Other robot types

### 3.1 Intake + roller-claw robots (Banshee-style)
- **[repo research]** Roller claw: two flex-wheel rollers spaced to hold a Pin, plus rubber bands for Cups, on a
  green-motor 12:48 wrist on an arm that folds back into the robot to take pieces from the intake. Mounted low to reach
  Match Loads and to put the first Pin in a Goal. Must go up and over stacks (limits height) and needs precise
  alignment for upright stacks and Loaders.
- **[repo research]** Banshee intake: 200 rpm stages with squishy cut flex wheels and foam pads, a full-width omni
  counter-roller and a 400 rpm top roller that grabs a Cup's top; takes Pins in any orientation; Cups prefer one;
  almost never jams.
- **Pros:** fast cycles, can intake from the floor and hand off, compact (15 x 15 x 14).
- **Cons:** height limit, alignment-sensitive.
- **Footage:** front roller intakes are the most common intake hardware visible.

### 3.2 Intake to staging to rear lift (8059A-style, "pass-through")
- **[repo research]** A floor intake takes Pins or Cups lying or standing, pieces pass front to back into a staging
  chamber (Pin first, then a Cup on top), and a rear lift claw picks up the combo and scores it, often out the back.
  A Loader-fed variant lets the drive team drop a pre-nested combo into the Loader in a chosen orientation.
- **Pros:** the robot never has to orient pieces itself; high throughput; robot stays out of the way of defenders.
- **Cons:** more mechanisms and weight, a three-stage intake to tune.

### 3.3 Hero Bot (Flex)
- **[repo research]** Official VEX kit: 2 x 11 W green motors, direct-drive 4 in omnis, one arm and one claw motor,
  IMU. Carries one Pin or a nested Cup + Pin to the low alliance or short Goal.
- **Pros:** simple, good for novices.
- **Cons:** low reach (1 to 2 layers), one piece at a time, slow cycles.
- **Sim:** 14 x 14 x 12, 9 lb, about 42 in/s; its sample auton scores 35.

### 3.4 Toggle-control / zoning bots
- **[repo research]** Fold-out wall plate with a retractable roller spinner, corner flippers, banded chain Toggle
  flippers, an optical sensor reading the Toggle face, and legal C-channel jammers (Q&A 3135). A Toggle a robot is
  touching at match end counts as neutral, so jammers must release first. Side Toggles are an 80-point swing.
- **Pros:** big point swing for little mechanism; works as a defender.
- **Cons:** must release before the end; contested.
- **Sim:** `override-toggle-bot` rolls both red-side Toggles to red (40 points).

### 3.4b Passive Toggle bumpers
- **[repo research]** A passive front bumper rolls a Toggle one face per square press; 8059's passive rubber-band toggler
  turns a Toggle two faces when hit above about 40 in/s (used in autonomous). Red autos press once, blue autos twice.
- **[sim]** The hit-two-faces threshold and the Toggle damping/detent constants are **fitted to that behaviour, not
  measured**, as `docs/sim-vs-real.md` already says.

### 3.5 Midfield pushers
- **[repo research]** Traction wheels between omnis, a wide base, sometimes pneumatic brakes; worth 8 points per robot in
  the Midfield plus ownership of the centre Goal's yellows.
- **[footage]** Long pushing contests and wall pins are common (see below), so a robot that can win them has real value.
- **Sim:** `override-midfield-pusher`: 18 x 18, heavy 333 rpm traction drive, skills run scores 8.

## 4. Contact, scoring objects and the field (what the footage says)

| Takeaway | Evidence | Versus the sim |
|---|---|---|
| Pushing and pinning is a constant, not an edge case. 30 to 60 s tangles appear in most matches. | e.g. 4:28:10 to 4:29:10 (4 robots), 4:13:20 to 4:14:20 (2 pinned on the bottom wall), QF 3-1 6:36:10 to 6:36:30 (3 robots locked head-on) | Sim models robot-robot contact with mass and inertia. |
| Robots stay entangled long after the buzzer. | 3 to 4 robots from 7:06:20 to 7:10:50 | Entanglement is not checked in the sim. |
| Goals (black posts with yellow caps) stay put. | Every frame compared, including pile-ups. A single report of a base "knocked on its side" at 3:29:00 (Qual 29) was **checked against frames and not confirmed**. | Agrees: Goals are fixed bodies. |
| Pin stacks of 4 to 6 stay upright. | Every frame, including 7:05:30 and 7:06:50. | Agrees: stacks tip only when hit high by something carried. |
| Starting "pinwheel" Pin clusters are broken apart within about 40 s; matches end with 10 to 30 loose pieces, many lying on their sides. | e.g. 6:35:20 to 6:36:00 | The sim scatters, but in 2D with no rolling or bouncing, so real scatter is wider. |
| No robot tip-overs seen in any block or dense clip. | all | Agrees: the sim warns about tipping but does not tip. |

Field: everything seen is consistent with the generic Override field as far as video can show. The coloured wall strips
change between matches (yellow, red, cyan, blue) for a reason I could not determine; it is probably alliance lighting,
and it is not modelled.

## 5. Measured motion (Qual 7, 1080p, estimates with about +/-15% on scale)

| Robot | Result | Implied acceleration |
|---|---|---|
| Bottom-centre robot, straight autonomous move | starts t 28.55 s; about 290 px/s within 0.1 s; peaks about 390 to 420 px/s (about 55 to 65 in/s, estimate); about 22 to 27 in total; stops within about 0.1 s | about 330 to 650 in/s^2 |
| Blue robot at the right wall | ramps to about 170 px/s in about 0.15 s; holds about 200 to 220 px/s (about 30 in/s, estimate); slows over about 0.3 s | about 170 in/s^2 |
| QF 3-1 locked contest | 3 to 4 robots drifted together roughly 25 to 30 in in at least 15 s (very rough, about 2 in/s) | n/a |

- The sim's grip limit is about 270 in/s^2 (friction 0.7, `DEFAULT_WHEEL_FRICTION`); the two clean tracks straddle it.
  **That is not enough to change a constant.** The community foam tests in `docs/sources.md` span 0.53 to 0.93
  (about 205 to 360 in/s^2).
- Two other tracks lost their robot and were discarded. Pitching of tall robots shifts the top-view centroid and adds
  error. Only four robots in one match were measured.

## 6. What I would and would not change in the simulator based on this

**Nothing here justifies changing a physics constant**, and nothing was changed. Candidates, in order of value:
1. **Preset gaps:** wide open-"U" scoop/claw robots and wing-extended robots (not covered by any preset). Source:
   [footage] only, low detail.
2. **Entanglement and long pins** are common; the sim has no entanglement rule (`docs/sim-vs-real.md`, Rules).
3. **Scatter** after pushes is wider in reality than the sim's 2D floor produces.
4. **A "typical team" auton:** real autons here were weak or absent; the presets are expert-level.
5. **DR6B and continuous lifts** have no presets and no sourced geometry; find real examples before adding them.

## 7. Process lessons and pitfalls (for whoever repeats this)

- The video has no captions or chapters. Local Whisper is slow (it had reached 0:55 of 7:23 after about 25 minutes),
  and it was not needed for these findings.
- `faster-whisper` on this machine: Python's HTTPS crashed when fetching the model (access violation); `curl`
  worked, so the model was downloaded by hand and loaded from a local folder. The `av` build also failed to open `.webm`,
  so audio was decoded with `ffmpeg` to raw float32 first.
- **Timestamps on the downloaded `.webm` are unreliable for seeking:** `ffmpeg -ss` landed 5 to 35 s off the frame
  index. Use the pre-extracted frame index for exact moments.
- **Time compression:** stream time is not real time for Quals 1 to 5 (the scoreboard clock runs about 1.55x faster than
  the stream clock); from about 0:49:50 (Qual 6) the video is real time. Do not measure speed on Quals 1 to 5.
- `yt-dlp --download-sections` for 1080p clips is slow (about 5 to 8 min per 3 min clip) and can fail or truncate (a 403
  on Qual 6, a 21 s file for Finals 1); retry and check the duration with `ffprobe`.
- Template tracking works for launches and straight moves; it fails under rotation, occlusion and pile-ups. Always
  overlay the track on frames and discard any with a stuck correlation of 1.0.
- A subagent's claim was wrong or unconfirmed once (a "Goal knocked on its side"); verify against frames before
  accepting a physics claim.

## 8. Open questions

- Which robots use which lift? (Needs a side or close-up view, or a reveal video, per team.)
- What is a DR6B in this community, and is there an Override example?
- Why do the wall strips change colour between matches?
- Do real autons get tuned drive speeds above the sim's limit? (Needs more robots measured, with a better scale.)
- What was the Finals 1 score? (Not captured; the final clip did not download.)
