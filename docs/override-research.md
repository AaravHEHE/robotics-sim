# V5RC Override (2026–27): the game, common robot designs, and how the simulator models them

**Research date:** 2026-10-02.

**Sources:**
- The official game manual v2.0, read in full; exact numbers are in [override-field-spec.md](override-field-spec.md).
- The official Q&A.
- The VEXcode VR Override playground.
- jerryio field renders.
- Team code repositories and early-season reveal videos.
- VEX Forum threads, via search excerpts; the forum itself blocks automated access.

**How much to trust each part:** facts from the manual are solid. Robot-design information is graded:
- **[competition]**: seen working at events, or in published team code.
- **[reveal]**: shown in early-season reveal videos.
- **[concept]**: forum or design proposals only.

Heights marked "est." are estimates.

## 1. The game in one page

- **Objective:** stack **Pins** and **Cups** on **Goals**, set **Toggles** to your color, and end the match with robots in the **Midfield**.
- **Match:** 15 s autonomous, then 1:45 driver control. The last 10 s is the Endgame, during which no objects may be Placed on the center Goal.
- **Robot Skills:** 60 s.

**Scoring objects**

- **63 Pins.** Bicone shape, 165 mm long, with a hexagonal collar. Each half is colored red, blue or yellow, and **each half scores separately**.
- **56 Cups.** Hourglass shape, 164.5 mm tall. One half is **transparent** and the other **opaque gray**.

**How stacking works**

- A stack is built Goal → Pin → Cup → Pin → Cup …
- A Pin half slides into a Goal's socket, or into a Cup half, until the Pin's collar rests on the rim.

**What scores**

- Every Pin half that is not hidden inside an *opaque* Cup half.
- Red or blue halves: 5 points to that alliance.
- Yellow halves: 10 points to whoever owns them.
  - In a Quadrant, the Toggle's color decides ownership.
  - On the center Goal, the alliance with more robots in the Midfield owns them.
- Robot in the Midfield at the end: 8 points.
- Autonomous Bonus: 12 points.

**What this means for scoring**

- The cheapest points are visible yellow halves in a Quadrant you control.
- Orienting Cups clear-side-down over Pins keeps Pin halves visible.
- A single Pin + Cup "combo" placed on a Goal is the basic scoring unit.

**Possession limit:** at most **1 Pin and 1 Cup** at a time (SG6).

- A robot can therefore carry one "combo" (a Cup nested on a Pin), never more.
- Robot cycle time — pick up a piece or combo, reach the stack height, place — is the core performance metric.

**Stack heights**

- Each layer adds about 180 mm (7.1″).
- The top of an *n*-Pin stack on a Goal of height G is about G + 90 + (n−1)·180 mm.

| Stack (n Pins) | Alliance Goal (82.5) | Short Goal (146.5) | Center Goal (222.7) |
|---|---|---|---|
| 1 | 173 (6.8″) | 237 (9.3″) | 313 (12.3″) |
| 3 | 534 (21″) | 598 (23.5″) | 674 (26.5″) |
| 5 | 895 (35″) | 959 (37.8″) | 1035 (40.7″) |
| 6 | 1075 (42.3″) | 1139 (44.9″) | 1216 (47.9″) |

So a 50″ robot height limit caps practical stacks at about 6 Pins. Lift height determines how tall a robot can stack.

## 2. Robot archetypes

### Summary table

| # | Archetype | Evidence | Intake? | Piece path | Holds | Lift & reach | Stacks | Toggle method |
|---|---|---|---|---|---|---|---|---|
| 1 | Flex (official VEX Hero Bot) | official | No | Front claw | 1 Pin, or Cup+Pin | Single arm, about 15″ est. | 1–2 layers on alliance and short Goals | Push with claw, arm or chassis |
| 2 | DR4B / DR6B + roller claw | competition (8059A/Y, 82777C) | Roller claw | Front only | Pin, Cup, or combo | DR4B about 40–50″, about 0.5 s to full height | Tall | Arm or wrist push |
| 3 | Cascade / linear slide + claw | reveal ("ACE cascade", the "meta") | Optional horizontal ground intake | Front intake → claw; may score out the back | Combo | Up to 50″, about 10–15 in/s | Tallest | Claw or chassis |
| 4 | Intake → staging → lift claw | concept / reveal | Flex-wheel or counter-roller + conveyor; drop-down front stage | **Front-to-back pass-through** into a rear staging area | Combo, assembled internally | Rear DR4B or cascade | Tall | Chassis |
| 5 | 6-bar / reverse 6-bar + wrist claw | competition (8059S) | No | Claw with a 180–360° wrist | Combo | About 25–35″ est. | Mid | Arm push |
| 6 | 4-bar / arm "workhorse" + pneumatic claw | competition (published code: Rambotics, "Voltage", taksh-nahata) | No | Pneumatic claw, often at the rear | Combo | About 12–20″ est. Height presets for alliance, short and center Goals | Low–mid | **Passive front bumper**: each square press rolls the Toggle one face |
| 7 | Toggle-control / zoning bot | reveal / Q&A-legal | Optional | — | — | — | — | Fold-out wall plate + roller spinner, corner flippers, C-channel jammer (must release before match end), optical sensor reads the face |
| 8 | Midfield pusher | strategy | No | — | — | — | — | — |

**Common drivetrain:** 4 × 11 W blue motors geared 36:48 to **450 rpm on 3.25″ omnis**. Variants: 400 rpm on 3.25″; 450 rpm on 2.75″; 55 W six-motor setups (4 × 11 W + 2 × 5.5 W).

**Common sensors:**
- IMU.
- Two tracking wheels.
- Distance sensors for wall resets.
- Optical sensor, for color sorting and reading Toggles.
- GPS strip, required in Autonomous Coding Skills.
- AI Vision, reading the AprilTags on Goals: center 0, neutral 1 and 4, alliance 2 and 3.

### 2.1 Flex — the official Hero Bot [official]
- **Build:** VEX V5 Competition Starter Kit. 2 × 11 W green (200 rpm) motors on direct-drive 4″ omnis. A single arm on one motor, a claw on one motor, and an IMU.
- **Plays by:** grabbing a Pin, or a pre-nested Cup+Pin, and carrying one at a time to the low alliance Goal (3.25″) or a short Goal (5.77″).
- **Toggles:** pushed with the claw, arm or chassis.
- **Strengths:** simple, and good for novices.
- **Limits:** low reach, so only 1–2 stack layers; one item at a time; slow cycles.

### 2.2 DR4B / DR6B + roller claw [competition]
- **Examples:** 8059A/Y at early-season events, 82777C (published code), and balintuna's DR4B.
- **8059A/Y specs:**
  - Drive: 55 W at 360 rpm.
  - Lift: a 22 W "standoff-linkage" DR4B at about 14 rpm output.
  - Top: an 11 W, 600 rpm rubber-band **roller claw** on a powered 2-bar that acts as a wrist.
- **How it works:**
  - The roller claw sucks in a Pin, a Cup or a combo.
  - The DR4B lifts it to stack height (about 0.5 s to full).
  - The rollers reverse, or the wrist tilts, to seat the piece.
- **Weaknesses:** it arcs sideways when tall, so it must respect the 24″ footprint; it can tip; it uses a big share of the mechanism power budget.

### 2.3 Cascade / continuous linear slide + claw [reveal; called the early-season meta]
- **Examples:** the "ACE cascade + horizontal intake" reveals; a VEX U drawer-slide lift to 50″.
- **How it works:**
  - The lift rises straight up, with almost no sideways growth.
  - It reaches the full 50″, but slower than a DR4B: forum estimate about 3 s to full height, about 10–15 in/s.
  - The claw has curved pads that match the Cup's curvature; some versions flip to score out the back.
  - Optional horizontal ground intake.
- **Best at:** tall center-Goal stacks.

### 2.4 Intake → staging → lift claw [concept / reveal]
- **How it works:**
  - A floor intake (flex wheels, or counter-roller + chain belt) takes Pins or Cups lying or standing. A piston drop-down front can knock over and swallow upright Cups.
  - Pieces pass **front to back** into a staging area: Pin first, then a Cup on top, forming a combo.
  - The rear lift claw picks up the combo and scores it, often out the back.
- **Loader-fed variant:** the drive team drops a pre-nested combo in a chosen orientation into the Loader (legal, driver control only). The robot sits under the Loader, so it never has to flip pieces.

### 2.5 6-bar / reverse 6-bar / chain-bar + wrist claw [competition]
- **Example:** 8059S.
- **How it works:** a rotating claw reorients pieces, which matters because which Pin half is up, and which Cup half covers it, decides the score.
- **Example claw:** one double-acting piston gripping above and below the Pin–Cup joint.
- **Reach:** mid-height, about 25–35″ est.
- A 360° wrist claw is precise but slow.

### 2.6 4-bar / arm "workhorse" + pneumatic claw [competition]
- **Rambotics (Rust code):**
  - 6-motor drive mixing 11 W and 5.5 W motors.
  - 2-motor lift with ramping.
  - Pneumatic claw.
  - IMU and 2 tracking wheels.
  - Anti-tip cutback at about 9° roll.
  - Separate red and blue Toggle autos.
- **taksh-nahata:** lift presets for alliance, neutral and center Goal heights; a claw toggle; autos called "Cup and Goal" and Loader runs.
- **"Voltage":**
  - A **passive front Toggle bumper** — square up against the wall and press.
  - Red autos press once and blue autos press twice. That fits the starting orientation: one roll gives one color, two rolls give the other (see the field spec).
  - A rear claw for picking up and stacking a combo.
- **Commonality:** the most common design among average teams.

### 2.7 Toggle-control / zoning bot [reveal, Q&A-legal]
- **Toggle mechanisms:**
  - Fold-out wall plate with a retractable roller spinner.
  - Corner flippers.
  - Optical sensor to read the Toggle's color.
- **Jamming:** wedging a C-channel to stop the Toggle rotating is legal (Q&A 3135). But a Toggle touched by a robot at match end counts as **neutral**, so jammers must let go before the end.
- **Strategy:** score about 7 Pins in autonomous, then defend one Quadrant's Toggle.

### 2.8 Midfield pusher [strategy]
- **Hardware:** traction wheels between omnis, a wide base, sometimes pneumatic brakes.
- **What it's for:** 8 points per robot in the Midfield, plus ownership of the center Goal's yellows. The robot must be over the Midfield at match end.

## 3. How the simulator models these robots (Milestone 2 plan)

The user's code only commands motors and pistons. The robot profile says which motor is the lift, which piston is the claw, and so on. The simulator then:
- turns a lift motor's angle into end-effector height, using kinematics for the lift type:
  - arm / 4-bar: h₀ + L·sinθ;
  - DR4B: two stages;
  - cascade: h₀ + r·θ·stages;
- turns intake motor speed into pick-up of objects inside a capture zone;
- turns a claw piston or motor into grip and release;
- applies the game rules:
  - possession limit;
  - releasing over a Goal or stack within tolerance nests the piece and makes it Placed; otherwise it drops to the floor;
  - Toggles roll one face per push or spin;
  - Loaders emit queued Match Loads in Skills.

Pieces on the floor use deterministic 2D rigid-body physics, so robots can push and plow them. Scoring is computed exactly per SC1–SC8 / RSC3, and replayed live in the score display.

**What is implemented so far (step 2.3):**
- **Scoring** (`src/games/override/scoring.ts`) is pure: Placed per SC2, visible halves per SC3, Toggle ownership per SC4/SC5, Midfield, the Autonomous Bonus, AWP (standard and Worlds criteria) and Skills rules.
  - A 15 s run is scored as the head-to-head Autonomous Period, so the Midfield is excluded (SC7a).
  - A 60 s run is scored as an Autonomous Coding Skills Match.
- **Toggles** (`toggle.ts`) use an idealized contact model.
  - Part of the robot that is at least as tall as the Toggle's underside (about 11.2″) touches the strip that overhangs the field.
  - Pressing into the Toggle rolls it outward one face; the robot must back off before the next press.
  - If released between faces, the Toggle falls back to the nearest face.
  - A touched Toggle is neutral.
  - Robot-profile chassis boxes under about 11.2″ tall can't reach a Toggle. Step 2.4 adds bumper, roller and plate mechanisms, including inward rolls.
- **Rule monitors** (`rules.ts`) report violations in Notes:
  - SG1/SG2 size limits.
  - SG7: crossing the Autonomous Line, or touching objects that start on the opposing side. The 28 line objects are shared.
  - SG9: touching an opponent Goal.
  - A violation gives the Autonomous Bonus to the opponent and voids the AWP.

| Archetype | Simulator mechanisms |
|---|---|
| Flex | `lift: arm` + `claw` (motor) |
| DR4B | `lift: dr4b` + `claw` (roller) + `wrist` |
| Cascade | `lift: cascade` + `claw` (piston) [+ `intake` front-only] |
| Intake→staging | `intake` (pass-through) + `staging` + `lift: dr4b` + `claw` |
| 6-bar wrist | `lift: sixbar` + `wrist` + `claw` |
| Workhorse | `lift: fourbar` + `claw` (piston) + `toggleBumper` |
| Toggle bot | `toggleRoller` / `togglePlate` |
| Midfield pusher | none (drivetrain only) |

## 4. Sources

**Official**
- Game manual v2.0: https://content.vexrobotics.com/docs/2026-2027/override/files/override-2.0.pdf
- Official Q&A: https://events.vex.com/V5RC/2026-2027/QA (PDF: https://events.vex.com/faqs/51/pdf)
- VEXcode VR Override playground: https://api.vex.com/vr/home/playgrounds/v5rc_override.html
- Hero Bot "Flex" build instructions: https://link.vex.com/docs/26-27/v5rc/hero-robot-instructions
- Field CAD: https://link.vex.com/docs/26-27/v5rc/field-cad

**Field renders and community simulators**
- jerryio field renders (CC BY 4.0): https://field-rendering.jerryio.com/
- PATH.JERRYIO (Override field built in): https://github.com/Jerrylum/path.jerryio
- MMGA Override auton sim (Gazebo): https://github.com/wittodetto/MMGA_Override_AutonSim
- zdrive (3D driver practice; drives, lifts and end effectors match the archetypes above): https://github.com/vyom-aggarwal/zdrive

**Team code**
- 82777C: https://github.com/clearskiesahead/82777C_Override
- Rambotics: https://github.com/gmhs-robotics/override
- taksh-nahata: https://github.com/taksh-nahata/VEX-Override-2026
- "Voltage": https://github.com/BraedynMendonca/override-autonomous
- 19109M: https://github.com/AnshuPlayz17/19109m-2026-2027-override
- balintuna: https://github.com/balintuna/VexOverride
- Driftless VEX U: https://github.com/Driftless-VexU/Override26-27

**Videos (titles only)**
- "The Meta Robot Everyone Will Build": https://www.youtube.com/watch?v=H5qsVkHbX1E
- "ACE Cascade + Horizontal Intake = New Meta?": https://www.youtube.com/watch?v=KeTu6UaoPWA
- 8059 early-season reveals: https://www.youtube.com/watch?v=R39NlWNx9ZQ and https://www.youtube.com/watch?v=xbqURp5oiAc
- Toggle trick: https://www.youtube.com/shorts/Kyow3GVag-0

**VEX Forum (search excerpts only)**
- Which lift is best for Override: https://www.vexforum.com/t/which-lift-is-best-for-override/146049
- Override intakes: https://www.vexforum.com/t/overide-intakes/146818
- Intake or claw: https://www.vexforum.com/t/intake-or-claw/146342
- Override strategy: https://www.vexforum.com/t/override-strat/146080
- Auton strategy: https://www.vexforum.com/t/auton-strategy-override/147107

**Other**
- Purdue SIGBots wiki, standoff DR4B: https://wiki.purduesigbots.com/hardware/lifts/dr4b-standoff-linkage
- Spartan Design manual summary (unofficial): https://spartandesignrobotics.org/override-manual-summary
