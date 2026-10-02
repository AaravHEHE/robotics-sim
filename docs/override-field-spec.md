# V5RC Override field and game element specification (simulator reference)

Source: **VEX V5RC Override Game Manual v2.0** (Sep 3 2026), Appendix A drawings A5–A17 and rules SC1–SC8, SG1–SG13, RSC1–RSC4. The citation given for each value is the page or rule it comes from.
The manual itself is not committed (it is VEX's copyright). Download it to `docs/manual/override-2.0.pdf` from
`https://content.vexrobotics.com/docs/2026-2027/override/files/override-2.0.pdf`.

All dimensions are in mm unless noted. Values marked **(derived)** are calculated from the drawings; values marked **(interp.)** are interpretations of a drawing or rule.

## Coordinate system used by the simulator

- Origin at the field center; **+x** points to the audience's right; **+y** points toward the top wall, which carries the GPS **0°** mark (A10). Units in data files are inches.
- The red Alliance Station is on the **left** (−x) and the blue on the right (+x), seen from the audience (A10–A12).
- The manual's drawings measure from the inside bottom-left corner, with the inside wall at 3566.4 (A10). Simulator coordinates are therefore the manual coordinates minus 1783.2.
- Grid lines (tile seams) fall at 587.1 / 1185.1 / 1783.2 / 2381.3 / 2979.3, which gives centered positions of **±1196.1, ±598.1, 0**. The tile pitch is about 598.1.

## Perimeter (A13 portable, A14 metal)

| | Portable 276-8242 | Metal 278-1501 |
|---|---|---|
| Inside wall to wall | 3566.4 (140.41″) | 3568.7 (140.50″) |
| Wall height | 293 (11.54″) | 292.1 (11.50″) |
| Wall thickness | 50.8 (2.00″) | 32.4 (1.27″) |

The simulator uses the portable perimeter, because the Appendix A layout drawings are built on it.

## Pin (A5)

- Overall length **165** (6.50″). Two colored halves, each scored separately.
- Shape: a double cone with a central hexagonal collar.
  - Each half is **74.5** long from its end to the collar.
  - The end has a straight section **16.187** long.
  - The end measures 35.6 across (Ø1.40″); the cone measures 59.6 across (Ø2.35″) where it meets the collar.
  - The collar is Ø**80.3** (3.16″) across its corners and **76.79** across its flats.
  - The collar is 165 − 2×74.5 = **16** thick **(derived)**.
- Color combinations (manual figure P-1): red/yellow, blue/yellow, yellow/yellow, red/blue.
- Mass is not published. The community figure is about 72 g.

## Cup (A6)

- Height **164.5** (6.48″). Hourglass shape with two halves: one **transparent**, one **opaque gray**.
- Rim Ø**80.2** (3.16″) at both ends; waist Ø**59** (2.32″) at mid-height.
- Mass is not published. The community figure is about 77 g.

## Nesting geometry (derived)

- A pin end (Ø35.6, widening to Ø59.6) fits through a cup rim (Ø80.2) and into the cup half. It goes in until the pin collar (Ø80.3) rests on the rim. The pin half is 74.5 long and the cup half is 82.25 deep, so the pin half sits fully inside the cup half.
- A pin end also fits a Goal socket (Ø60.1, A7). In a Goal, the pin half drops into the socket and the collar rests on the Goal top.
- Height added per stacked layer:
  - **Pin collar: about 16.**
  - **Cup: 164.5** (the cup covers the pin's upper half, and the next pin's lower half nests in the cup's upper half).
  - **About 180.5 per Pin + Cup layer.**
- Top of the top Pin on a Goal of height *G*, with *n* Pins and *n−1* Cups: G + 16 + 74.5 + (n−1)·180.5.

## Goals (A7)

| | Height | Base | Top | Socket |
|---|---|---|---|---|
| Alliance (red / blue) | **82.5** (3.25″) | octagon **142.5** across flats; base plate 10 thick | 88.8 | Ø60.1, about 37.8 deep **(interp.)** |
| Short neutral (black) | **146.5** (5.77″) | 64-tall square-ish base, then a taper | 88.8 | Ø60.1 |
| Tall center neutral (black) | **222.7** (8.77″) | 140.2-tall base, then a taper | 88.8 | Ø60.1 |

The octagon's corner radius is R81.9 (3.22″). Its flat-to-hole-center distance is 71.3.

## Toggle (A8, A15; glossary)

- A triangular prism, **660.2** long (25.99″). The glossary gives 656.2, but the drawing governs.
- Cross-section: an equilateral triangle **51.6** tall (side about 59.6), with the axis **30.2** below the apex. The faces are about 52.2 wide (glossary).
- Mounted on the perimeter at the center of each wall, in brackets with vertical slots. The top of the Toggle is **335.3** (13.20″) above the floor (A8).
- **Set color** (SC4 + glossary): the face *seen from inside the field*, provided a face rests flat on the mounts and no Robot is touching it. Any other state is neutral (yellow).
- **Starting orientation** (A15), on every Toggle: yellow faces up and into the field, the alliance-side color faces out of the field, and the remaining color is down on the mounts.
  - Red-side Toggles (left wall and bottom wall): **yellow** in, **red** out, **blue** down.
  - Blue-side Toggles (right wall and top wall): **yellow** in, **blue** out, **red** down.
- Rolling geometry **(derived)**:
  - Rolling the top *outward* (away from the field) by 120° brings the bottom face to the inside.
  - Rolling it *inward* by 120° brings the outward face to the inside.
  - So on a red-side Toggle: one roll inward → red; one roll outward → blue; two rolls outward → red.

## Loader (A9)

- A clear chute with an 86 (Ø3.39″) internal circular passage and a depth of 95. It is about **102.1** wide along the wall.
- Height: **365** when lowered, with a bottom opening **82.5** high; **583.5** when raised, with a bottom opening **301** high.
- Centered on the side walls (red at x = −1783.2, blue at x = +1783.2) at **y = ±1492.6** (A10).

## Field element locations (A10, A16), centered coordinates

| Element | Position (mm) | AprilTag (A16) |
|---|---|---|
| Center Goal (neutral, tall) | (0, 0) | 0 |
| Neutral short Goal | (−1196.1, 598.1), (1196.1, −598.1) | 1 |
| Neutral short Goal | (−598.1, 1196.1), (598.1, −1196.1) | 4 |
| Red Goal | (−1196.1, −598.1) | 2 |
| Red Goal | (−598.1, −1196.1) | 3 |
| Blue Goal | (1196.1, 598.1) | 2 |
| Blue Goal | (598.1, 1196.1) | 3 |
| Toggles | (0, ±1783.2), (±1783.2, 0), on the wall | – |
| Loaders | (±1783.2, ±1492.6) | – |

## Tape (A11)

- **Autonomous Line:** a double line, **63.5** wide overall (2.5″), along y = −x, interrupted by the Midfield. Red's side is x + y < 0.
- A single line runs along y = x (the other diagonal). The two diagonals split the field into 4 triangular **Quadrants**:
  - **Red 1** (left), next to the red station, holds red Goal (−1196.1, −598.1), neutral Goal (−1196.1, 598.1) and the left Toggle.
  - **Red 2** (bottom) holds red Goal (−598.1, −1196.1), neutral Goal (598.1, −1196.1) and the bottom Toggle.
  - **Blue 1** (right) holds blue Goal (1196.1, 598.1), neutral Goal (1196.1, −598.1) and the right Toggle.
  - **Blue 2** (top) holds blue Goal (598.1, 1196.1), neutral Goal (−598.1, 1196.1) and the top Toggle.
- **Midfield:** a square rotated 45°. The tape centerline passes through (0, ±598.1) and (±598.1, 0), and the vertices are at the centers of 4 tiles (A11 detail B). The Midfield is the infinite vertical volume inside the *inner* edges of the tape: |x| + |y| ≤ 598.1 − (tape half-width)·√2. With a 1″ tape that is about **580 (interp.)**.
- **Load Zones:** an L of alliance-colored tape in each Loader corner. The outer tape edge is at the center of the first tile; the inner edge runs along the tile teeth. That makes the zone about **299 × 597** against the side wall, between the corner and the y = ±1185.1 seam **(interp.)**.

## Head-to-Head starting layout (A12; counts from the manual's field overview)

| Group | Location (centered mm) | Contents |
|---|---|---|
| 8 wall groups | (±598.1, ±1743.1) and (±1743.1, ±598.1) | 3 Cups in a row along the wall, at offsets −80.2, 0 and +80.2. All are **gray side up**. A **yellow/yellow Pin** sits in the middle Cup. |
| 4 cross clusters on the Autonomous Line | (−1196.1, 1196.1), (−598.1, 598.1), (598.1, −598.1), (1196.1, −1196.1) | 1 Cup, **clear side up**, with 4 Pins lying radially around it. The 2 red/yellow Pins point left and down with the red end outward; the 2 blue/yellow Pins point up and right with the blue end outward. |
| 4 Midfield corners | (0, ±598.1), (±598.1, 0) | A **clear-up** Cup holding a red/blue Pin. Red half up at (−598.1, 0) and (0, −598.1); blue half up at (598.1, 0) and (0, 598.1). |
| 4 diagonal spots on y = x | (±1196.1, ±1196.1), (±598.1, ±598.1), same sign | A **clear-up** Cup holding a yellow/yellow Pin. |
| 5 neutral Goals | as above | 1 yellow/yellow Pin Placed in each. |
| Alliance Stations | – | Each holds 10 Cups, 10 alliance/yellow Pins and 1 yellow/yellow Pin as Match Loads. |
| Preloads | – | 1 alliance/yellow Pin per Robot. |

**Count check against the manual:**
- 36 Cups on the field: 24 gray-up (wall groups) + 12 clear-up.
- 17 yellow/yellow Pins on the field: 8 + 4 + 5.
- 8 red/yellow and 8 blue/yellow Pins on the field (crosses).
- 4 red/blue Pins on the field.
- 28 objects on the Autonomous Line (SG7 note): 4 crosses × 5 objects + 4 corners × 2 objects.

**Robot Skills (RSC4):**
- The same field, but all Goals start empty, so the 5 neutral-Goal Pins are not placed.
- Match Loads are 3 red/yellow Pins, 4 blue/yellow Pins and 7 Cups, entered only through the red Loaders, at any time.
- The Robot starts in the Quadrant next to the red station (Red 1) with a red/yellow Preload.
- The GPS strip is installed.

## Scoring (SC1–SC8, RSC3)

| | Points |
|---|---|
| Autonomous Bonus | 12 (a tie, including 0–0, gives each alliance 6) |
| Each Scored alliance-colored Pin half | 5 |
| Each Scored yellow Pin half (Owned) | 10 |
| Each Robot ending in the Midfield | 8 |

- **SC1:** scored once everything is at rest, or 5 s after the match ends.
- **SC2 Placed:**
  - A Pin is Placed when it is nested (breaking the plane of an opening) with a Goal, or with a Cup that is nested with another Placed Pin.
  - Each Goal and each Cup half may hold at most one Pin half.
  - A Cup is Placed when it is nested with a Placed Pin.
  - Robot contact doesn't matter.
- **SC3 Scored:** each *visible* half of a Placed Pin. A half is not visible when it is partly or fully inside the **opaque** half of a Cup.
- **SC4 Toggle set:** a face is flat on the mounts at rest and no Robot is touching the Toggle. Otherwise the Toggle is neutral (yellow).
- **SC5 Ownership:**
  - A yellow Pin in a Quadrant is Owned by the Toggle's color; a yellow Toggle means it is not Owned.
  - A yellow Pin in the Midfield (center Goal) is Owned by the alliance with more Robots in the Midfield; a tie means it is not Owned.
- **SC6:** a Robot counts as in the Midfield if any part of it is inside the Midfield volume.
- **SC7 Autonomous Bonus:**
  - Evaluated immediately when autonomous ends.
  - Excludes Midfield-dependent scoring (Robots in the Midfield, and Midfield yellow ownership).
  - Any autonomous violation gives the bonus to the opponent.
- **SC8 Autonomous Win Point:** with no autonomous violations, at the end of autonomous:

  | Event type | Pins Scored for your alliance | Goals with ≥2 of your Scored Pins | Perimeter |
  |---|---|---|---|
  | Standard events | **≥6** | **≥2** | Neither Robot touching it |
  | Events qualifying directly to Worlds | **≥7** | **≥3** | Neither Robot touching it |

  Pins and Goals in Quadrants on the opposing side of the Autonomous Line don't count.
- **Manual worked example (page 17):** a stack with 3 visible red halves, 1 visible blue half and 3 visible yellow halves scores:

  | Toggle | Red | Blue |
  |---|---|---|
  | Yellow | 15 | 5 |
  | Blue | 15 | 35 |
  | Red | 45 | 5 |

- **RSC3 Skills scoring:**
  - Red halves score only in red Quadrants or the Midfield; blue halves only in blue Quadrants or the Midfield.
  - Yellow halves score only if Owned. A Toggle confers ownership only when it matches its own Quadrant's color.
  - Midfield yellows are Owned if the Robot ends in the Midfield.
  - Robot in the Midfield: +8.
  - There is no Autonomous Bonus.

## Rules the simulator monitors

- **SG1:** start size 18 × 18 × 18″, at most 1 Preload, touching the perimeter on your own side, one Robot per Quadrant.
- **SG2 / SG3:** 24 × 24″ footprint and 50″ height at all times.
- **SG6:** possession of at most 1 Pin and 1 Cup.
- **SG7:** in autonomous, don't touch tiles, objects or elements on the opponent's side of the Autonomous Line. The 28 line objects are shared.
- **SG9 / SG10:** never interact with opponent Goals; never remove Placed objects from neutral Goals (head-to-head).
