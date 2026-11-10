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

## What was imported (2026-11-09)

| Build | From | Parts | Notes |
|---|---|---|---|
| `data/builds/cascade.build.json` | "Botty override rework" (cascade), 330 instances | 329 | Goal left out. 26 custom boxes: 23 small unnamed parts, two intake ramps, one plate. |
| `data/builds/dr4b.build.json` | public "botty override 26-27" copy of the DR4B, 254 instances (247 with meshes) | 247 | 10 custom boxes: 4 pneumatic cylinder bodies, 2 cylinder rods, 4 unnamed parts. |

The DR4B you linked first ("botty override 26-27 - Copy", 340 instances, owned by someone else) allows neither
copying nor export, so it was not used. The imported DR4B is the public document it was copied from: the same
robot with fewer parts.

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

## Not done yet

- Lifts do not move: the build is a static pose. Animating it needs each part assigned to a moving group (lift
  stages, DR4B links) from the CAD's connections.
- The custom boxes are boxes, not the real shapes (the intake ramps show as blocks). The bridge's position was
  checked by eye in one render only.
- Attaching a build to a robot preset so the app draws it instead of the profile-built look.
- Other lift types: public CADs were searched (see below) but none imported.
- Pin physics and the other robot presets were not changed.

## Public CAD search (Onshape, "Public" filter, 2026-11-09)

Searches: `vex dr6b` (no results), `vex dr4b lift` (3: a "VEX V5 DR4B Lift", a "VEX V5 6W Drive" and one other),
`vex continuous lift` (2 documents titled "Vex Continuous ..."), `vex cascade lift` (many: several "Cascade Lift
(VEX ...)" and "VEX Cascade" documents). 2-bar, 4-bar and 6-bar were not searched yet. Search URL pattern:
`https://cad.onshape.com/documents?nodeId=3&resourceType=filter&q=_all:<terms> type:all foundin:w when:latest`.
