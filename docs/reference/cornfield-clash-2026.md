# Fall 2026 Illini Cornfield Clash Jr. (match footage)

Source: "Fall 2026 Illini Cornfield Clash Jr. | VEX V5 Robotics Competition Override", Illini VEX Robotics,
YouTube live `9H4powqTyUA`, 7 h 23 m, 2026-11-07 (Siebel Center for Design, Urbana). Middle and high school
teams. Watched 2026-11-07.

**How it was read.** No captions or chapters. The 360p video (640 x 360) was sampled every 10 s into
480 px frames, tiled 16 to a sheet (167 sheets), and every sheet was read, in 8 blocks of about 55 min, with
extra close-ups where needed. A local Whisper transcript was started but is slow and was not used for these
findings. Camera: fixed overhead (oblique) field view with a scoreboard overlay.

**What this can and cannot support.** Every number below is an *estimate* from 10 s samples of a low-resolution
overhead view. It shows what real teams' robots look like at this kind of event and what happens in contact; it
cannot give wheel counts, motor counts, accelerations or top speeds. Nothing here is precise enough to retune a
physics constant. See "Limits".

## Event structure

- 54 qualification matches (Qual 1 from about 0:33:30; 2v2), then an elimination bracket: Round of 16, quarter-finals,
  semi-finals, best-of finals (Finals 1 ran 7:03:48 to 7:06:04). Awards from 6:42 and 7:09; "Thanks for watching" at 7:17.
- Match clock: 15 s autonomous, then about 1:45 of driver control (about 2:00 total). A "BONUS" box under an alliance
  marks the autonomous bonus; both alliances show it on a tie (Qual 3).
- Breaks: a "Starting soon" card to about 0:32; "Be right back" slates at 2:14 to 2:20, 5:15 to 5:35 and 5:43 to 5:53;
  a "Mid Day Highlights" replay package at about 2:20 to 3:09 (replays of Quals 2, 8, 9, 10, 11, 13, 15, 16, 18, 20,
  22, 23, 25 and others).
- **Timing warning.** For Quals 1 to 5 (stream 0:33 to 0:46) the scoreboard clock runs about 1.55x faster than the
  stream clock (it ticks, then jumps about 4 s every 6.25 s of video; estimate). From about 0:49:50 (Qual 6 on) the video is
  real time: the clock steps 10 s per 10 s. Use only Qual 6 onward for any speed or timing measurement.
- Result cards (shown late, sometimes minutes after the match): QF 4-1 Red 66 / Blue 80; SF 1-1 Red 80 / Blue 38;
  SF 2-1 Red 52 / Blue 100. Breakdown items: Pins Placed, Yellow Pins Owned, Robots in Midfield, Autonomous Bonus
  (12), Auton Win Point. Finals 1 was won by Blue (2827S + 2827A, Tournament Champions), no score card captured.
  Quals show no point totals at all.
- Match start times and alliances for every qualification and elimination match are in the working notes
  (`C:\tmp\cornfield\notes\block_*.md`, not in the repo).

## Robots (overhead view only)

- **Scoreboard never ties a team to a robot**, so no robot is attributed to a team. Robots carry no readable numbers
  at this resolution.
- **Size:** about 14 to 24 in across the blocks (typical about 15 to 22 in, under one 24 in tile; estimate, perspective
  inflates tall robots and extended mechanisms). One calibrated close-up (Qual 39, 144 in field about 890 px) gave
  about 19 to 23 in. Consistent with the 18 in starting size limit (SG1) plus expansion. The nine presets (14 to
  18 in) are in range.
- **Drive:** all look like tank / skid-steer with side wheel rows; none looked holonomic (mecanum, X-drive). 4 vs 6
  wheels could not be told for any robot.
- **Mechanisms seen:** front roller intakes or open "box" / scoop fronts; tall masts or lifts carrying stacks of
  3 to 6 Pins; silver rail lifts; one robot with two uprights holding a clamp (about 1:03:00); a white C-channel robot
  with long side wings (Qual 31, about 3:37); light open-frame robots with a wide open "U" front (about 4:06 to 4:07);
  a long red/black segmented-rail robot carrying a Cup (Qual 1). Frames are mostly silver or black aluminium, some
  teal/green, gold, white.
- **Preset coverage:** the tall-mast stackers and front-intake robots match the existing archetypes (DR4B, cascade,
  claw). Not covered by a preset: wide open-U scoop/claw fronts and wing-extended robots. Several robots barely moved in
  autonomous (for example Qual 24 at 2:07:20 vs 2:07:40, Qual 25 at 2:11:30 vs 2:11:40, Qual 51), so many teams here run
  very short or no autons; the presets' 40 to 55 point autons are expert-level, not typical.
- **Start positions used:** left mid-wall, right upper wall, top centre, bottom centre (clearest 1:03 to 1:05).

## Physics observations

| Observation | Where (stream time) | Confidence | Versus the simulator |
|---|---|---|---|
| Sustained robot-vs-robot pushing and wall/corner pins lasting 30 to 60 s or more, in almost every match | e.g. 4:28:10 to 4:29:10 (4 robots, top-right), 4:13:20 to 4:14:20, 6:36:10 to 6:36:30 (3 robots locked head-on across a whole 10 s sample) | High that it occurs | Sim models robot-robot contact with mass and inertia; a pin/stall contest is physically plausible. Defence and prolonged pins are common, not an edge case. |
| After the last Finals match, 3 to 4 robots stayed entangled at odd angles for over 4 min | 7:06:20 to 7:10:50 | High | Entanglement is not checked in the sim (docs/sim-vs-real.md, Rules). |
| Pin stacks of 4 to 6 on Goals stayed upright in every frame; no stack toppling caught | e.g. 7:05:30, 7:06:50 | Medium (10 s sampling could miss it) | Agrees: stacks tip only when hit high by something carried. |
| Black bases with yellow caps (the Goals) stayed in place in every frame compared, even in pile-ups | many | Medium-high | Agrees with "Goals are fixed". One block's report of a base "knocked on its side" at 3:29:00 (Qual 29) was **checked against frames f_01253 to f_01258 and not confirmed**; treat as unverified. |
| Starting pin clusters ("pinwheels", 4 pieces) are broken apart within about 40 s of the match start (e.g. 6:35:20 to 6:36:00); loose pieces end every match scattered wide, 10 to 30 loose, many lying on their sides | all matches | High | Sim floor physics scatters, but 2D with no rolling or bouncing; end-of-match scatter is wider in the real footage. Reset/end frame pairs for calibration are listed in the working notes (for example 4:49:30 vs 4:53:40). |
| No clear robot tip-over in any block; several robots at about 30 to 45 degrees against others or walls (for example about 5:10:20 with a tall stack that stayed upright) | various | Medium | Agrees with the sim not tipping robots (it only warns). |
| Wall LED strips change colour between matches (yellow, red, cyan or blue) | all | n/a | Likely cosmetic or alliance-lighting; meaning unknown. Not modelled; not checked against the manual. |
| Average speed: about 3 to 7 in/s during autonomous; 1 to 3 tiles per 10 s in driver control | various | **Low** | Includes turns, stops and pile-ups, and several block estimates disagree (up to 3 to 5 ft/s). **Do not use** to calibrate drive speed or acceleration. |

## Field

Everything seen matches the generic Override field in `data/fields/override.json` as far as the video can show: 12 x 12 ft,
6 x 6 grey foam tiles, white tape X and central diamond with double diagonals, red and blue corner boxes, about
9 interior plus about 6 wall posts (Goals) with a yellow Pin on top, 4 pinwheel clusters of 4 Pins, loose red / blue
/ yellow Pins and red / blue Cups, spare pieces outside the left (red) and right (blue) walls. Object counts were not
checked against the manual from the video; check them in `docs/override-field-spec.md`.

## Dense 1080p clips (measured, 2026-11-09)

Downloaded 1080p60 clips of Qual 7 (stream 0:52:20 to 0:55:20), Qual 29, QF 3-1 and Qual 6 (Finals 1 did not finish
downloading). Qual 7 is in real time (the clock steps 1 s per 1 s) and its clip lines up with the stream clock within a
few seconds. At 1080p wheels, intakes and lifts are visible, which the 360p copy could not show. Robots were tracked
with template matching on every second frame (about 30 fps) and checked by overlaying the track on the frames.

- **Scale (the main error source).** The field floor was calibrated from the 47.1 in centre diamond: about 7.3 px/in
  horizontally and 6.2 px/in vertically at mid-field (the camera is oblique), larger nearer the camera. Treat every
  inch value as **estimate, about +/-15%**. Tall mechanisms also shift in a top view as the robot pitches, which adds an
  unknown error to speed and acceleration.
- **Tracking limits.** Of four robots tracked in Qual 7's autonomous, two tracks were clean (bottom-centre robot, blue
  robot at the right wall) and two lost the robot (left and top) and were discarded. The tracker fails under
  rotation, occlusion and pile-ups, so this gives launches and straight moves, not whole matches.

| Measurement (Qual 7, autonomous, stream 0:52:20 clip, t = clip seconds) | Result | Versus the simulator |
|---|---|---|
| Bottom-centre robot, straight forward move from the start line (t 28.55 to 29.03) | Starts at 28.55 s. Reaches about 290 px/s within about 0.1 s, peaks about 390 to 420 px/s (about 55 to 65 in/s, estimate) around t 28.7 to 28.9. Travels about 156 to 166 px (about 22 to 27 in) and stops within about 0.1 s. | Implied acceleration about 330 to 650 in/s^2 (large error from the 0.1 s ramp). The simulator's grip limit is 0.7 x g = about 270 in/s^2 (`DEFAULT_WHEEL_FRICTION` in `src/sim/dynamics-spec.ts`). |
| Blue robot at the right wall (t 28.35 to 29.5) | Ramps to about 170 px/s in about 0.15 s, holds about 200 to 220 px/s (about 30 in/s, estimate), then slows over about 0.3 s. About 22 to 26 in total. | Implied acceleration about 170 in/s^2, inside the simulator's limit. |
| QF 3-1 locked pushing contest (clip about 1:34 to 1:19 on the match clock) | Three to four robots stay entangled for at least 15 s and drift together from centre-right toward the right wall, roughly 25 to 30 in (very rough, about 2 in/s). They do not stall completely and do not separate. | Plausible for the simulator's per-side grip-limited push; entanglement is not checked (see above). |

What this adds, honestly:
- Real robots reach their launch speed in about 0.1 to 0.2 s and stop in about 0.1 s. One of two measured robots
  accelerated faster than the simulator's 0.7 grip limit allows, the other did not. The range (about 170 to 650
  in/s^2) is too wide to change `DEFAULT_WHEEL_FRICTION`. The community foam tests in `docs/sources.md` go up to 0.93
  (about 360 in/s^2), which is inside it.
- Peak speeds of about 30 and 55 to 65 in/s for two different robots are not a calibration target (robots differ
  in gearing); they only show real autonomous moves are not slow.
- No tip-overs, no Goal movement and no stack topples appeared in any of the dense clips reviewed.

## Limits

- 640 x 360 source, 10 s sampling, oblique overhead camera, no audio-derived data used.
- Nothing about motors or masses is resolvable, and in the 360p copy wheels were not either. The 1080p clips
  (above) show wheels, but only four clips were measured, with the error bars given there, and no robot is tied to
  a team number or a known mass.
- Dense clips are only usable from Qual 6 on (real-time video), and `yt-dlp` section downloads can fail or truncate
  (Qual 6 and Finals 1 needed retries; Finals 1 was not obtained).
- `ffmpeg -ss` on the downloaded `.webm` does not line up with the sheet timestamps (5 to 35 s off, not constant);
  frames must be taken from the pre-extracted frame list instead.
