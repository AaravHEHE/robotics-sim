# Sources

Every number the simulator relies on should trace to a row here. Accessed dates
are the day the value was checked. "Unverified" means the value came from a
search snippet, a forum post, or a third-party site, and must not be treated as
official.

## Game rules and field (V5RC Override 2026-27)

| Title | URL | What was taken | Accessed |
|---|---|---|---|
| VEX V5RC Override Game Manual, Version 2.0 (local copy) | `docs/manual/override-2.0.txt` | Current rules. Robot size limit 18 x 18 x 18 in (<R3>), 50 in max height during a match. Goal heights: center 8.7 in, neutral 5.8 in, alliance 3.25 in (Appendix A glossary, "Goal"). Pin 1.6 in (40 mm) diameter x 6.5 in (165 mm) (glossary, "Pin"). Cup 3.15 in (80 mm) x 6.5 in (164.5 mm) (glossary, "Cup"). Toggle 25.8 in long, faces about 2.05 in (glossary, "Toggle"). Field 12 ft x 12 ft, 36 foam tiles, 9 Goals, 4 Loaders, 4 Toggles, 56 Cups, 63 Pins (Appendix A, "Field Overview"). Preloads, possession limit one Pin and one Cup (<SG5>, <SG6>). Scoring: red/blue Pin 5 pts, yellow Pin 10 pts (<SC...> scoring table). | 2026-10-12 |
| VEX V5RC Override manual v1.1 (obsolete) | https://content.vexrobotics.com/docs/2026-2027/override/files/override-v1.1-obs.pdf | Not used. Marked obsolete. Superseded by v2.0. | 2026-10-12 |
| VEX Q&A (official rulings, GDC) | https://events.vex.com/V5RC/2026-2027/QA | Reachable (HTTP 200). Not yet read for rulings that affect the sim. | 2026-10-12 |
| VEX V5RC 26-27 manuals index | https://www.vexrobotics.com/26-27-manuals | Blocked by the proxy (HTTP 403). Cannot confirm the current manual version from it. | 2026-10-12 |

## V5 Smart Motor (11 W)

| Title | URL | What was taken | Accessed |
|---|---|---|---|
| Understanding V5 Smart Motor (11W) Performance (VEX KB) | https://kb.vex.com/hc/en-us/articles/360044325872-Understanding-V5-Smart-Motor-11W-Performance | Speeds about 100 / 200 / 600 rpm by cartridge. Peak and continuous power 11 W. Stall torque 2.1 Nm with the 100 rpm cartridge. Stall current limited to 2.5 A. Motor runs at full speed until about 60% of peak power (12.75 W) or 35% of stall torque (2.1 Nm). Thermal levels cut current to 50%, 25%, 12.5%, 0%. Encoder 1800 / 900 / 300 ticks/rev with 36:1 / 18:1 / 6:1 gears. Dimensions 2.26 x 2.82 x 1.30 in (57.3 x 71.6 x 33.0 mm). | 2026-10-12 |
| Same article, 5.5 W motor rows | (same URL) | The table's second column (120 / 160 / 240 rpm, 1.67 Nm, 3.93 W) is the 5.5 W 393 motor. Do not use it for the 11 W motor. | 2026-10-12 |

**Not published by VEX (sim values are estimates):** 200 rpm and 600 rpm stall torque (sim: 1.05 Nm and 0.35 Nm, which is the 100 rpm value scaled by speed ratio). Stall current at 12 V, free current, winding resistance, and inertia. These appear in `src/sim/dynamics-spec.ts` and are labelled "estimate" there.

A forum thread (https://www.vexforum.com/t/v5-smart-motor-estimating-performance-parameters/135200, unverified) estimates stall current near 4.7 A and free speed near 120 rpm from sampled curves. It conflicts with the official 2.5 A limit and with the 2.1 Nm figure, so it was not used.

## Battery, friction, mass and heat (Phase B, 2026-10-12)

| Title | URL | What was taken | Status |
|---|---|---|---|
| V5 Battery Overview (VEX KB, fetched) | https://kb.vex.com/hc/en-us/articles/360035589732-V5-Battery-Overview | Pack named "Li-Ion 1100mAh" with LiFePO4 chemistry. Runs ten V5 Smart Motors at full power continuously. Motors run at 100% power at low battery. Charge about 60 min. Lifespan 2000 recharge cycles. No internal resistance or open-circuit voltage given. | Verified (read the page) |
| Override Game Manual v2.0 (local copy) | `docs/manual/override-2.0.txt` | No robot weight or mass limit. The only size rules are the 18 × 18 × 18 in start size (<R3>) and a 50 in max height during a match (robot-size section, around manual line 1124). Searched for "lb", "pound", "kg", "mass", "weight": nothing relevant. | Verified |
| Anyone have friction coefficient of vex wheels? (VEX Forum) | https://www.vexforum.com/t/anyone-have-friction-coefficient-of-vex-wheels/19261 | Tilt test on foam: about 0.67 (5 in wheel), 0.81 (4 in with tire), 0.93 (4 in omni and 2.75 in wheel). Poster says preliminary. | Community, unverified (search snippet) |
| Pull tests for VEX wheels (VEX Forum) | https://www.vexforum.com/t/pull-tests-for-vex-wheels/20141 | Pull-test friction 0.53 to 0.84: 2.75 in green 0.59, 4 in stock tread 0.6, 5 in 0.84. | Community, unverified (search snippet) |
| Omni wheel vs Mecanum (VEX Forum) | https://www.vexforum.com/t/omni-wheel-vs-mecanum/48151/13 | Pull force divided by about 16 lb of added weight; 4 in double omni about 0.87. Scale described as inaccurate. | Community, unverified (search snippet) |
| Coming Soon: VRC Anti-Static Tiles (VEX Forum) | https://www.vexforum.com/t/coming-soon-vrc-anti-static-tiles/72260 | Quote from VEX that anti-static and foam tiles are functionally equivalent, with friction differences "extremely negligible". | Search snippet, not fetched |
| Typical Robot Weight (VEX Forum) and related threads | https://www.vexforum.com/t/typical-robot-weight/17816 | Anecdotal V5 robot masses of about 11 to 17 lb (one thread 11 to 22 lb). Electronics about 6 lb. | Anecdotal, unverified |
| V5 Overheating Threshold (VEX Forum) | https://www.vexforum.com/t/v5-overheating-threshold/64984 | Community reports of motors reaching over 55 °C and cutting out. No official temperature. | Community, unverified |
| V5 Robot Battery spec table (VEX KB) | https://kb.vex.com/hc/en-us/articles/360060529912-Understanding-the-V5-Robot-Battery | Nominal voltage 12.8 V; maximum current 20 A (256 W); capacity 12.8 Wh. | Verified (read the page) |
| Understanding V5 Smart Motor (11W) Performance (VEX KB, already above) | https://kb.vex.com/hc/en-us/articles/360044325872-Understanding-V5-Smart-Motor-Performance | Four heat-response levels that cut current to 50%, 25%, 12.5%, 0%. The KB gives no temperature for any level. | Verified (read the page) |

**Not found in any reachable source:** V5 battery internal resistance and open-circuit voltage; V5 wheel dimensions and CAD (the VEX product pages are blocked); a VEX-published foam tile friction coefficient; an official 2025-26 or 2026-27 robot mass rule.

## Blocked or unreached sources

- **Still blocked from this environment (403):** `www.vexrobotics.com` (product pages, CAD downloads, 26-27 manuals index), `www.vexforum.com` (thread pages except search snippets), `pd.vex.com`, and the root of `content.vexrobotics.com`. Needed for wheel, C-channel, standoff and screw dimensions, the official robot-preset specs, and the official V5 CAD.
- **Reachable now (checked 2026-10-12):** `kb.vex.com`, `events.vex.com` (Override Q&A), `www.robotevents.com`, `cad.onshape.com`, `www.youtube.com`, `github.com`, `api.github.com`.
- Team reveal videos and robot writeups: YouTube is reachable, but no per-preset team spec has been pulled yet (see the corrections table in Phase B status).

## Source-quality notes

- Forum and search-snippet numbers are never copied into profiles without an "unverified" tag.
- The local manual file is the rules source of truth. The field JSON (`data/fields/override.json`) has already been checked against its Goal heights.

## Phase B status and corrections (for Phase C approval)

No code changed in Phase B. Each row is a candidate for Phase C, to be approved first.

| Item | File | Current value | Sourced value | Status | Proposed action |
|---|---|---|---|---|---|
| Wheel-to-floor friction | `src/sim/dynamics-spec.ts:59` (`DEFAULT_WHEEL_FRICTION`) | 0.9 → 0.7 (done) | Community: 0.53 to 0.93, depending on method and wheel | Community only | Changed to 0.7. Goldens unchanged; one sanity bound on motor heat lowered from 30 °C to 29 °C in `tests/drive-dynamics.test.ts`. |
| Sideways (scrub) friction | `dynamics-spec.ts:62` (`DEFAULT_LATERAL_FRICTION`) | 0.3 | None found | Estimate | Keep. Labelled in code (done). |
| Default robot mass | `dynamics-spec.ts:58` (`DEFAULT_MASS_LB`) | 12 lb | Anecdotal 11 to 17 lb; no official rule | Anecdotal | Keep; it's inside the anecdotal range. Labelled in code (done). |
| Battery internal resistance | `dynamics-spec.ts:60` (`DEFAULT_BATTERY_RESISTANCE`) | 0.15 Ω | None found | Estimate | Keep. Labelled in code (done). |
| Battery nominal voltage | `dynamics-spec.ts:66` (`BATTERY_OPEN_CIRCUIT`) | 12.8 V | KB "V5 Robot Battery" spec table: nominal 12.8 V, max current 20 A, 256 W, capacity 12.8 Wh. A charged pack reads about 14.4 V (VEX Forum). | Verified (KB) | Value kept as nominal; comment corrected from "open-circuit" to "nominal". Two notes: the KB name says 1100 mAh, which at 12.8 V is about 14 Wh, not 12.8 Wh; the 20 A maximum is now enforced (`BATTERY_MAX_A`, `drive-dynamics.ts`): past it, both sides get proportionally less force. The presets stay well under it at the default grip; only a high-grip drive reaches it. |
| Drive efficiency | `dynamics-spec.ts:64` (`DRIVE_EFFICIENCY`) | 0.85 | None found | Estimate | Keep. Labelled in code (done). |
| Motor heat response | `drive-dynamics.ts:28-31`, `:100` | 55 °C start; half current at 95 °C | KB: four current levels (50/25/12.5/0%) with no temperatures; community about 55 °C | Estimate (the 55 °C start matches community reports) | Keep. Labelled in code (done); the header comment was corrected earlier. |
| Stall torque at 200 and 600 rpm | `dynamics-spec.ts:26` | 1.05 Nm, 0.35 Nm | KB: 2.1 Nm at 100 rpm only | Estimate (ideal speed scaling) | Keep. Labelled in code (already so; done). |
| Override robot presets: mass | `data/robots/override-*.json` | 9 to 18 lb | Anecdotal 11 to 17 lb | Anecdotal | Check each preset against its real robot before changing (the Flex at 9 lb and the midfield pusher at 18 lb are outside the range). |
| Override robot presets: drivetrain | `data/robots/override-*.json` | 600 rpm (blue) cartridges at 450 rpm, 3.25 in wheels; Flex 200 rpm green, 4 in; midfield 4 in at 333 rpm | Not sourced (VEX wheel pages blocked; team specs not pulled) | Unverified | Pull each team's spec from its reveal video or VEX Forum writeup, then correct. Needs the blocked VEX pages or per-team sources. |
| Parts catalog dimensions | `data/parts/vex-parts.json`, `scripts/gen-vex-parts.ts` | "approximate" (generator comment) | Not verifiable from reachable sources (VEX product pages blocked) | Blocked | Blocked until `www.vexrobotics.com` is allowed. |
| Toggle constants | `src/games/override/toggle.ts` | fitted to the manual's described behaviour | Manual gives geometry only (25.8 in long, faces 2.05 in); no torque or spring data | Estimate | Keep. Labelled in code (done). |

**Still open for Phase B:** the per-preset robot specs, the parts catalogue, and the official Override field and robot references, all of which need `www.vexrobotics.com` or `www.vexforum.com`.

## Phase B, round 2 (2026-10-12): official VEX pages, read in the browser

Read through the built-in browser (not downloaded). Anything marked "not downloaded" is a file on a VEX page that would need a download to use.

| Title | URL | What was taken | Status |
|---|---|---|---|
| Wheels (VEX Robotics) | https://www.vexrobotics.com/wheels.html | Omni: 2.75 in (220 mm travel), 3.25 in (260 mm), 4 in (320 mm); travel = π × diameter, so the diameters are confirmed. Traction: 2.75 in (276-1496), 2.75 in anti-static (276-8098), 3.25 in anti-static only (276-7771), 4 in (276-1497), 4 in anti-static (276-8103). Weights: omni 2.75 in 0.154 lb, omni 3.25 in 0.132 lb, omni 4 in 0.232 lb; traction 2.75 in 0.110 lb, 3.25 in anti-static 0.128 lb, 4 in 0.198 lb. 3.25 in wheels fit all V5 shafts. | Verified (read the page) |
| V5 Smart Motor & Gear Cartridges (VEX Robotics) | https://www.vexrobotics.com/276-4840.html | Motor 276-4840, 0.35 lb. Cartridges 36:1 (100 rpm, 276-5840), 18:1 (200 rpm, 276-5841, ships with the motor), 6:1 (600 rpm, 276-5842). Position and velocity within ±1%. | Verified (read the page) |
| V5 Robot Battery spec table (VEX KB) | https://kb.vex.com/hc/en-us/articles/360060529912-Understanding-the-V5-Robot-Battery | Dimensions 1.82 W × 6.31 L × 1.18 H in (46.45 × 160.45 × 30.33 mm). Weight 0.77 lb (350 g). | Verified (read the page) |
| Understanding V5 Smart Motor (11W) Performance (VEX KB) | https://kb.vex.com/hc/en-us/articles/360044325872-Understanding-V5-Smart-Motor-Performance | Dimensions 2.26 W × 2.82 L × 1.30 H in (57.3 × 71.6 × 33.0 mm). | Verified (read the page) |
| Understanding V5 Smart Motor (5.5W) Performance (VEX KB) | https://kb.vex.com/hc/en-us/articles/10002101702932 | Gives the same dimensions as the 11 W motor (2.26 W × 2.82 L × 1.30 H in). This conflicts with the catalogue's 5.5 W entry (1.9 × 1.75 × 1.0 in), which may be a different motor (the 393). | Verified text; the conflict is unresolved |
| 2026-2027 V5 Herobot Flex Parts List (VEX, Google Sheet linked from the build page) | https://docs.google.com/spreadsheets/d/1w-5XjDNNn2YYYm22Y_y8By85Fy1YL3Lumy4sAulY0Hw (view only) | Official Flex BOM: 4 × V5 Smart Motor (11 W); 1 × V5 Brain; 1 × V5 Battery; 1 × V5 Radio; 1 × V5 Claw Assembly; drive wheels candidates: 4 × 2.75 in anti-static traction (276-8098), 2 × 4 in anti-static omni (276-8107), 1 × 4 in anti-static traction (276-8103); 30T, 24T, 16T, 6T sprockets and 123 chain links; structure: U-channel, C-channel, angles and standoffs. | Verified (read the sheet, not downloaded) |
| Flex build PDF (VEX) | https://link.vex.com/docs/26-27/v5rc/hero-robot-instructions-pdf | This link starts a file download (a save dialog appeared; nothing was saved). Not read. | Not downloaded; needs your permission |
| Flex 3D build (instructions.online viewer) | https://instructions.online/?id=4063-2026_-_2027_vrc_herobot_flex | A 3D viewer with no readable text. Not read. | Not readable as text |

### Corrections from round 2

| Item | Where | Before | After | Status |
|---|---|---|---|---|
| Omni 4 in wheel diameter | `scripts/gen-vex-parts.ts` (`omni-4`) | 4.125 in | 4.0 in (320 mm travel = π × 4) | Applied; catalogue regenerated |
| Traction 3.25 in (non-anti-static) | `scripts/gen-vex-parts.ts` (`traction-3.25`) | listed | removed: VEX sells only the anti-static 3.25 in traction wheel (276-7771) | Applied; no profile or test refers to it |
| V5 Smart Motor (11 W) size | `scripts/gen-vex-parts.ts` (`v5-motor`) | 2.5 × 2.25 × 1.25 in | 2.82 × 2.26 × 1.30 in (length along the output shaft, then width, then height) | Applied; visual tests pass |
| V5 Robot Battery size | `scripts/gen-vex-parts.ts` (`v5-battery`) | 4.9 × 2.5 × 1.6 in | 6.31 × 1.82 × 1.18 in (KB) | Applied. The battery straps in `src/app/robot-meshes.ts` now sit where the thinner battery overlaps each crossbar; the fastening check passes for every robot. |
| 5.5 W motor size | `scripts/gen-vex-parts.ts` (`exp-motor`) | 1.9 × 1.75 × 1.0 in | unresolved (the KB 5.5 W article gives the 11 W body size) | **Not applied**: needs checking against the physical 5.5 W motor. |
| Flex Hero Bot preset | `data/robots/override-flex.json` | 1 motor per side, 4 in wheels, green cartridge, 200 rpm, 9 lb, 14 × 14 × 12 in | Official BOM: 4 V5 Smart Motors; drive wheel candidates are 2.75 in anti-static traction (×4). Which motors drive which wheels needs the build steps (the PDF). | **Not applied**: needs the PDF (see above) |

## Flex build PDF (VEX, 2026-27 Hero Bot): read from the user's copy

The file is `flex_build_instructions-v4.pdf` from the user's Downloads folder (18.0 MB, 215 pages, image-only). It was copied to the scratchpad and read by rendering pages to images, not by text extraction (the pages have no text layer, and no OCR tool is installed). Pages were read at low resolution; the sprocket tooth counts are not shown on the steps.

What the PDF shows:

- **Drive: one V5 Smart Motor per side, chain-driven.** Each side is a module with one black motor, a red sprocket on the motor shaft, and a chain to the wheel shafts (pages 41–49, 101–108). The BOM has four motors in total, and the VEXcode VR page lists only an arm motor and a claw motor besides the drive, so two motors are drive. This matches the preset's one motor per side.
- **Wheels per side: three wheels on one module.** The module is a gray traction wheel at the top, an omni in the middle, and a gray traction wheel at the bottom (page 25 at higher resolution, pages 41–49). The top wheel looks about 4 in and the bottom about 2.75 in, but this is by eye.
- **Final robot:** four wheel pods on a flat chassis, two omnis and two traction wheels visible per side (pages 196–215, 54–70).
- **Lift:** a chain-and-sprocket lift with red gears (pages 121–140). Not part of the drive.
- **Sprockets in the BOM:** 30T ×2, 24T ×1, 16T ×1, 6T ×2, plus 123 chain links. The ratio from motor to wheel depends on which sprocket is on the motor and which on the wheels. Not read from the images.

What this means for the preset (`data/robots/override-flex.json`): the motor count (one per side) is consistent with the PDF. The wheel size (4 in for all drive wheels) and the gearing (green cartridge, 200 rpm wheel speed) are not confirmed. The BOM suggests the drive wheels are a mix of 2.75 in traction and 4 in omni, and the chain ratio is unknown. **Not changed**: the gearing needs the sprocket order, which is in the build steps around pages 92–110 at full resolution.
