# Rebuilding a real robot from an Onshape CAD

The parts kit ([robot-profile.md](robot-profile.md), "Build from VEX parts") can now hold parts exactly where a
real CAD has them, so a published VEX robot CAD can be recreated part for part. Cosmetic only: the robot
profile still decides how it drives and what it can do.

## Pipeline

1. In Onshape, right-click the assembly tab, **Export**, format **GLTF** (leave Y-up unchecked). Large
   assemblies take a few minutes to translate and the file is 100 to 300 MB; it stays outside the repo.
2. Reduce it to what is needed (name, matrix, bounding box, rough centroid of every part instance):
   `python scripts/onshape/gltf-extract.py <assembly.gltf> <extract.json>`
3. Map every instance to a catalog part and write the build:
   `node scripts/import-onshape.ts <extract.json> data/builds/<name>.build.json [--forward=+y|-y] [--exclude=Goal]`
4. Check the gears: `node scripts/check-gears.ts data/builds/<name>.build.json`
5. Look at it: the builds are ordinary parts builds (`{v: 1, parts: [...]}`); `tests/onshape-builds.test.ts`
   validates them.

## How parts are matched

- By name (VEX part names carry the part number): C-channel, angle, standoffs, screws, nuts, collars,
  bearings, spacers, shafts, gears (standard and high-strength), sprockets, wheels, motors.
- Sizes and lengths come from the CAD's own bounding box (lengths round to whole holes).
- The part's catalog box is lined up with the CAD box (which CAD axis is its length, width and height). Where
  the part is lopsided (a C-channel's flanges, a screw's head) the CAD mesh's centroid picks the side.
- A part with no catalog match becomes a `custom-box` of its real size and is listed in the importer's report.
- The robot frame is the CAD's own (x right, y forward, z up) moved so the origin is the middle of the drive
  wheels and the floor is the wheels' bottoms.

## The kit changes this needed

- `Placed.xf` (free placement): the center and rotation of a part in inches, instead of whole holes and quarter
  turns. The builder moves (arrows) and turns (R/T/Y) these parts too.
- `Placed.size`: a part keeps the size it has in the CAD (custom parts, thicker spacers, and so on).
- New catalog parts: high-strength 48T gear, 6T and 36T high-strength sprockets, a VersaHex adapter, and
  `custom-box`.
- `src/app/parts/gear-trains.ts`: which gears mesh (parallel axles, centers (T1+T2)/48 in apart), which trains can
  turn (no odd loop) and which gears mesh with nothing.

## What was imported

| Build | From (public Onshape document, assembly) | Parts | Notes |
|---|---|---|---|
| `cascade` | "Botty override rework", `cascade` (the project owner's) | 329 | Goal left out. 26 custom boxes. |
| `dr4b` | public "botty override 26-27" copy, `Assembly 3` | 247 | 10 custom boxes (pneumatic cylinder parts, unnamed). The 340-part version first linked was view-only with export off. |
| `dr6b` | "v2 bot" by Carlos A (8 copies), `dr6b` | 43 | Lift only (no chassis). 1x3x1 channels are 0.66 in wide in this CAD and keep that width. |
| `sixbar` | "Team A 2026 bot prototype design" by Justin Tabas Carson, `6 bar` | 171 | Prototype frame: angle links, 72T high-strength gears, 24 bearing flats. |
| `fourbar` | same document, `mirrored 4 bar` | 127 | Prototype: two arms on meshing 84T gears, a coupler. |
| `continuous` | "20W Assembly" by XLR8 (Jan 2025), `Continuous Lift` | 306 | Whole robot: chassis, 4 wheels, 5 nested stages. Washers, gear inserts and pulleys mapped. |
| `twobar` | "2 bar lift" by LCI 7481 (Sep 30), `Assembly 1` | 19 | Imported with `--yaw=90` (the CAD swings the arm sideways). |

Every build has a `<name>.fixed.build.json` (odd gear trains; see below). `bash scripts/reimport-builds.sh <folder>` rebuilds
the new ones from the reduced exports.

### How the public search went

Searched Onshape's public documents for the exact words: "dr6b" (14 documents, all named `dr6b`, mostly in progress; one
opened and imported), "6 bar" and "4 bar" (many; the 2026 Team A document holds 4-bar, 6-bar, cascade and DR4B tabs),
"continuous lift" (a one-part stub, an FRC elevator, and the 20W robot used here) and "2 bar lift" (14). Not every
result was opened: only the ones with a VEX-looking thumbnail, a recent date or a copy count were, about ten of them.
Result lists render poorly in the app's browser pane, so names, owners and links were read from the page text.

## Logic problems found in the CADs and how they were fixed

`node scripts/check-gears.ts <build>` finds them; `node scripts/fix-cad-logic.ts <build> [--bridge=<json>]` writes
`data/builds/<name>.fixed.build.json` and leaves the imported 1:1 build as it is. The fixes were chosen by the
assistant when asked to "pick", from your rule (every gear train has an odd number of gears) and the CAD's geometry;
check them against the real robots.

- **Gear rule.** A train of two, four or six gears turns its output the opposite way to its input. One 36T idler
  (on a short shaft) is added at the end of every even train, meshing the last gear, in the first free direction
  around it (nothing overlapped, nothing through the floor).
  - DR4B: trains 7, 7, 2, 3, 2, 2, 3 became 7, 7, 3, 3, 3, 3, 3 (three idlers).
  - Cascade: trains 4, 2, 6, 2 became 5, 3, 7, 3 (four idlers).
- **Cascade intake going nowhere.** The five first-stage rollers (CAD y 1.0 to 3.4, z -12 to -9.5) were fed to
  side ramps that ended at y -2.7, while the back plate began at y -7.6 and the second stage sits at y -10 to
  -15, z -8.6 to -7: a gap of about 5 in that pieces fell through. A 9.18 x 3.30 x 0.12 in bridge plate
  (a `custom-box`, tilted 20 degrees) now spans it, in the 3.3 in gap between the two side ramps.
- **Left alone.** Four gears that mesh with nothing (one DR4B 48T, one cascade 48T and two 60T): they may sit on a
  shaft that a chain or something outside the model drives. The lift motors on the DR4B are not geared to
  anything in the CAD; how the real robot drives them still needs confirming.

## Animation (the motion layer)

The CAD's mates are not in the glTF export and fastener tracing finds almost no rigid groups (7 of 174 in the DR4B),
so each lift's moving parts are chosen from the CAD's geometry by a rule in `scripts/gen-motion.ts`, written to
`data/builds/<name>.motion.json` and applied by `poseBuild()` in `src/app/parts/build-motion.ts`.

| Lift | Motion | How the groups were read |
|---|---|---|
| Four-bar | two arms turn about the 84T pivot gears (y 4.4, z 15 and 11.5); the coupler translates with the top arm's end and stays level | gears, arm bars, coupler at y -8.6; checked in render at 0 and 40 degrees |
| Two-bar | the hanging arm, its 84T gear and shaft hardware turn about the gear's axle | read off the gear |
| Cascade | stages in 1 in y planes (-1.3 base, -2.2, -3.1, -3.9 carriage) rise together, stage k by k/3 of the carriage rise | nearest stage plane |
| Continuous | stages (y 1.2 to 5.2) rise one at a time, carriage first | nearest stage plane; checked in render fully extended |
| DR4B | 8 links turn about their rear ends (clockwise as the lift rises); a mid platform and the carriage ride the front ends of the two link sets and stay level | link endpoints read from the CAD: lower set (rear pivots high, front ends at z 3 and 5.5) carries the 6 in front uprights, upper set (rear pivots low, front ends at z 15.3 and 17.8) the 15 in uprights; checked in render at 0 and 25 degrees |

`tests/build-motion.test.ts` checks the kinematics (arm turn, coupler level and on the right circle, stage ratios, in-turn
rise, rest pose unchanged).

## In the app

`RobotProfile.cad` (see [robot-profile.md](robot-profile.md)) draws a robot from a build; the viewer poses it from the
named lift each frame, mapping the lift's whole output range onto the build's whole travel (`src/app/parts/cad-body.ts`, `Viewer.poseCad`). Claw Gate and ACE use the cascade build and the
8059A-style DR4B preset uses the DR4B build; checked in the running app (the cascade robot is drawn on the field).

## Not done yet

- **Motion for the 6-bar and DR6B.** These two CADs are in-progress prototypes whose link loops the geometry does not
  fix. The 6-bar's lower mechanism (a tower, links at z 11.5, 15 and 8, a front upright and a mid upright) has three
  degrees of freedom from the parts that are modelled, so any rule would be a guess; the DR6B has links of different
  lengths (12.5, 14, 14.5) meeting the same front upright, which a rigid coupler cannot satisfy. They stay static poses.
  Options: get the real mates (a copy of the document with export or the Onshape API), or drive a simplified link
  animation from the simulator's own six-bar kinematics.
- Lift-only builds (`fourbar`, `sixbar`, `twobar`, `dr6b`) have no chassis, so no preset uses them as a robot's body; they
  are in the app's build list for a profile that wants one. Whole-robot builds fit the presets only loosely (the CAD's
  size and claw are not the profile's), so the profile's numbers were not changed.
- The custom boxes are boxes, not the real shapes (the intake ramps show as blocks).
- The sim still has all its other presets, and no "only the seven lift types" cut has been made.
- Pin physics was not changed.
