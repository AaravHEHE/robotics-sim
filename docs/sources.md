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

## Blocked or unreached sources (not yet read)

- vexrobotics.com product pages (403 from the proxy). Needed for wheel, C-channel, standoff, and screw dimensions, and for CAD downloads.
- content.vexrobotics.com files other than the v1.1 manual (403 for some paths).
- forum.vex.com and vexforum.com thread pages (403 from the proxy, except the search snippets above).
- Team reveal videos and robot writeups (YouTube reachable, not yet searched for each preset).

## Source-quality notes

- Forum and search-snippet numbers are never copied into profiles without an "unverified" tag.
- The local manual file is the rules source of truth. The field JSON (`data/fields/override.json`) has already been checked against its Goal heights.
