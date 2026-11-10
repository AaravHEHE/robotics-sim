# Lift types for Override robots: DR4B, DR6B, 2-bar, 4-bar, 6-bar, cascade, continuous

Everything learned about these seven bot types, from the 7 h 23 m Fall 2026 Illini Cornfield Clash Jr. footage
(YouTube `9H4powqTyUA`) and from the repo's existing Override research. Scope is limited to these seven types
and nothing else. Raw event findings and measurements are in
[reference/cornfield-clash-2026.md](reference/cornfield-clash-2026.md).

## 0. How to read this file: where each fact comes from

The footage is an overhead field camera. From above, every lift looks like "a robot with something tall or reaching
on it". **The footage cannot tell a DR4B from a cascade, or a 4-bar from a 6-bar.** So the lift sections combine
three kinds of fact, and every statement is tagged:

| Tag | Meaning |
|---|---|
| **[footage]** | Seen in this event's video (with timestamps where it matters). |
| **[repo research]** | Already recorded in `docs/override-research.md` and `docs/reference/videos.md` from team reveal and explainer videos. I did **not** re-watch those videos; I am repeating what the repo says. |
| **[general]** | General VEX / mechanical-engineering knowledge, not verified against any source here. Background, not evidence. |
| **[sim]** | How the simulator currently models it (`docs/robots.md`, `data/robots/override-*.json`). |

Numbers marked "estimate" are rough. Reach numbers come from the research docs, not from the footage.

Override reference heights (from `docs/override-research.md` and `data/fields/override.json`): Goals are 3.25 in
(alliance), 5.77 in (short) and 8.77 in (center). One Pin on an alliance Goal tops out at about 6.8 in, and each extra
Pin/Cup layer adds about 7.1 in. The 50 in robot height limit caps practical stacks at about 6 Pins.

## 1. What the footage says that bears on lifts

- **[footage]** Many robots show a tall mast or a reaching mechanism carrying stacks of 3 to 6 Pins. Specific sightings:
  a twin-post mast carrying pins (Qual 21, 1:54:40); silver rail lifts beside a built red-and-yellow Pin tower
  (about 4:14:10); a robot with two uprights holding a clamp (about 1:03:00); a tall white-frame robot in Finals
  (about 7:05:30). These look like linear or tall lifts, but the overhead view cannot show the linkage or rigging, so
  **no robot can be assigned to DR4B, DR6B, 2-bar, 4-bar, 6-bar, cascade or continuous from the footage.**
- **[footage]** Footprints of about 14 to 24 in (typical 15 to 22 in, estimate), under one 24 in tile. A tall lift
  must fit the 18 in start-size limit (SG1) and the 24 in expansion limit (SG2), which constrains every lift below.
- **[footage]** No robot tipped over in any block or dense clip, including robots carrying tall stacks. A robot at about
  45 degrees against another robot with a tall stack stayed upright (about 5:10:20). Stacks of 4 to 6 Pins on Goals
  stayed upright in every frame (for example 7:05:30, 7:06:50). So tipping, a risk for every tall lift below, was not
  observed at this event (10 s sampling could miss a fast tip).
- **[footage]** Contact is constant: pushing and wall pins of 30 to 60 s or more in most matches, and robots entangled
  for minutes after Finals. Any lift that reaches out past the base or stands tall is exposed to this.
- **[footage]** Many robots barely moved in autonomous, so a lift sitting idle matters less than its driver-control
  cycle time at this level.
- **[footage, measured]** Qual 7 autonomous launches reached about 30 and about 55 to 65 in/s within 0.1 to 0.2 s
  (estimates, +/-15%); a lift's mass raises the centre of mass and affects how hard a robot can accelerate without
  pitching, which the overhead view cannot show.

## 2. The seven lift types

### 2.1 Two-bar (single arm)
**How it works.** One arm pivoting on a shaft, driven by a motor through gearing. **[general]**
- Path: an arc; the end swings forward and up. **[repo research: "arc, 1 to 2 layers"]**
- Orientation: whatever rides on the end tilts with the arm unless something levels it (a wrist, a chain bar or a
  second parallel link). **[sim]**: "a claw on a single-pivot arm tilts with the arm, so it only grabs and places near
  the bottom".

**Pros**
- Simplest lift: fewest parts, lightest, easiest to build and code. **[general]**
- Easy to keep inside the start size. **[general]**
- Fast over short travel. **[general]**

**Cons**
- Low reach: 1 to 2 stack layers; about 15 in for the Hero Bot arm. **[repo research]**
- The claw tilts as it rises, so it can only place near the bottom of its travel (about 20 degrees of arm on the sim's
  Flex). **[sim]**
- The arc couples reach and height, so reaching up swings the load sideways. **[general]**

**Override notes**
- A two-bar can set a stack on an alliance Goal (3.25 in) or a short Goal (5.77 in) but not stack tall: a Cup has to
  clear a placed Pin's 6.8 in top, and a tilted claw can't set it down level. **[sim, `robots.md`]**
- A two-bar with a wrist that keeps the claw upright (wrist = minus arm) and an arm that folds back over an intake
  works, but "has to go up and over a stack", so about three Pins is its limit. **[sim, from a Joseph973 reveal]**

**Sim.** Used by the arm presets (pivot 11 in arm, port 7, 1:5; 25 degrees = a Pin over an empty Goal, 45 degrees =
Cup + Pin over 1 Pin, 83 degrees = over 2 Pins). **Footage.** Not identifiable from overhead.

### 2.2 Four-bar
**How it works.** A parallelogram linkage (two parallel links, two pivots) so the end stays at the same orientation
while it swings. **[general]**

**Pros**
- Keeps the claw level (or close) with no extra mechanism. **[general]**
- Moderate reach; simple; light; one or two motors. **[general]**
- Described as "the most common design among average teams" in Override, from published code (Rambotics, "Voltage",
  taksh-nahata). **[repo research]**
- Works with a rear-mounted claw. **[repo research]**

**Cons**
- Still an arc: the end moves forward as it rises, so reach and height are coupled. **[general]**
- Limited height, about 12 to 20 in (estimate), "low to mid" stacks. **[repo research]**
- Needs anti-tip logic in code; Rambotics cut back at about 9 degrees of roll. **[repo research]**

**Override notes**
- Published four-bar code uses lift presets for alliance, neutral and center Goal heights. **[repo research]**
- A rear claw's Preload would sit inside the wall at the standard start, so the sim's four-bar starts 3 in off the
  wall. **[sim]**

**Sim.** Rear 4-bar, port 7, 1:5: 18 degrees = a Pin over an empty Goal (claw 12.35 in behind); 36 degrees =
Cup + Pin over 1 Pin. **Footage.** Not identifiable from overhead.

### 2.3 Six-bar
**How it works.** A longer, multi-link arm that stays mostly level while rising higher than a four-bar.
**[repo research: "6-bar: higher, mostly level, still an arc"]**

**Pros**
- More height than a four-bar with the claw staying (mostly) level. **[repo research]**
- Often paired with a wrist that can rotate or flip the held Pin, which matters because which Pin half is up, and which
  Cup half covers it, decides the score. **[repo research]**
- A hero-style six-bar plus claw exists in competition (8059S). **[repo research]**

**Cons**
- Still an arc, so the load moves forward as it rises. **[repo research]**
- More parts and complexity than a four-bar; a 360-degree wrist is precise but slow. **[repo research]**
- Mid reach only: about 25 to 35 in (estimate). **[repo research]**

**Sim.** 6-bar port 7 (1:5) with a motor wrist (port 8, 1:2) that can turn the Preload over: 16 degrees = the flipped
Preload over an empty Goal; 27 degrees = Cup + Pin over 1 Pin. **Footage.** Not identifiable from overhead.

### 2.4 Double reverse four-bar (DR4B)
**How it works.** Two four-bar linkages joined in reverse so the end effector rises nearly straight up and stays
level. **[repo research: "straight up, level, tall and stable, heavy"]**

**Pros**
- Tall reach, about 40 to 50 in, about 0.5 s to full height (estimate), with the claw staying level. **[repo research]**
- Rises almost straight up, so it is easy to line up on a Goal and does not push stacks forward. **[repo research]**
- Suits tall stacks and Loader hand-off. **[repo research]**
- Ranked third ("Tiger") in the meta ranking. **[repo research, slides only]**

**Cons**
- Heavy, with many parts, and it uses a big share of the mechanism power budget. **[repo research]**
- "It arcs sideways when tall, so it must respect the 24 in footprint; it can tip." **[repo research]**
- A tall, heavy mass raises the centre of mass. **[general]**
- Usually needs rubber-band assist and a hard-stop zeroing routine. **[repo research]**

**Override notes**
- 8059A: a standoff-linkage DR4B with 2 x 11 W motors at about 14 rpm, motors mounted low, at the back of the robot.
  **[repo research]**
- Joseph973's DR4B: motors at the base, triangle banding, a rotating claw swings down to take from the intake.
  **[repo research]**

**Sim.** DR4B ports 7 and 8 (12:84); the chamber sits 11 in behind centre and rises straight up (z 2 at 0 degrees to
about 34 at 110 degrees). 13 degrees = a Pin over an empty Goal; 25 degrees = over 1 Pin; 45.5 degrees = over 2 Pins.
Starts 3 in off the wall. **Footage.** Not identifiable from overhead.

### 2.5 Double reverse six-bar (DR6B)
**What I found.** The repo's research doc lists "DR4B / DR6B" together (`docs/override-research.md`, 2.2) but does not
define a DR6B, name a team using one, or give numbers. Nothing in the footage describes one. **I cannot give sourced
pros and cons.**

**[general, unverified]** By analogy with DR4B, a DR6B would use longer or additional links to reach higher, at the
cost of more parts, weight, friction and tuning. These are hypotheses, not facts. A real example is needed before
anything is modelled.

**Sim.** No dedicated preset or sourced geometry. **Footage.** None.

### 2.6 Cascade (cascading linear slides)
**How it works.** Nested slide stages that extend together, so height comes from stage count and spool diameter.
**[repo research: "all stages rise at once, fast and compact"]**

**Pros**
- Rises straight up with almost no sideways growth. **[repo research]**
- Compact when retracted; reaches the full 50 in. **[repo research]**
- Fast: about 10 to 15 in/s, about 3 s to full height (forum estimate, consistent for a 50 in lift). **[repo research]**
- Ranked first ("Claw Gate / Clawscade") and fourth ("ACE Cascade") in the meta ranking. **[repo research, slides only]**
- Best at tall center-Goal stacks. **[repo research]**

**Cons**
- More complex rigging (string or chain across stages) and slop between stages; needs tuning. **[general]**
- Top-heavy when extended. **[general]**
- Needs a chain bar or similar to set a piece out in front of the stack (the cascade sets the height; the chain bar
  swings the piece from the front over the stack). **[repo research]**

**Override notes**
- 99182E (titled 1698Z): a 22 W cascade on a 55 W drive with a banded chain-bar claw. **[repo research]**
- No reveal of the actual Claw Gate / Clawscade was found, so its sim preset is approximate (99182E + ACE).
  **[repo research]**

**Sim.** Cascade ports 7 and 8 (blue, 1:3), 3 stages on a 1.375 in spool, about 0.036 in per spool degree. Spool degrees
(chain bar level, out front): 90 carries the Preload over an empty Goal, 70 a Cup + Pin over 1 Pin, 270 over 2 Pins,
140 over the yellow Pin on a short neutral Goal.
**Footage.** Silver rail lifts and a twin-post mast are consistent with linear slides, but overhead frames can't show
how stages are rigged.

### 2.7 Continuous lift
**How it works.** A cascade-like linear lift on a single rigging in which the stages rise in turn rather than all at
once. **[repo research: "one rigging, stages rise in turn, slower but stronger"]**

**Pros**
- Stronger for a given motor power, because the load is lifted one stage at a time. **[repo research]**
- A 3-Pin auto in 15 s was built on a continuous lift with a chain-bar claw. **[repo research]**
- Straight-up motion like a cascade. **[repo research]**

**Cons**
- Slower than a cascade. **[repo research]**
- Same general complexity issues as slides: slop, string routing, tuning. **[general]**
- Whatever sits on the carriage rides up and down for every piece, which costs cycle time. **[general]**

**Sim.** The cascade is the closest model; there is no separate continuous-lift model. **Footage.** Not identifiable.

## 3. Side by side

| Lift | Reach (Override, estimate) | Path | Claw stays level? | Speed | Complexity | Main risk |
|---|---|---|---|---|---|---|
| Two-bar | 1 to 2 layers (about 15 in) | arc | No, unless wrist/chain bar | fast | lowest | cannot stack tall |
| Four-bar | about 12 to 20 in | arc | Yes | fast | low | low reach, coupled reach/height |
| Six-bar | about 25 to 35 in | arc | Mostly | medium | medium | arc; wrist is slow |
| DR4B | about 40 to 50 in | nearly straight up | Yes | about 0.5 s to full (estimate) | high | weight, tipping, motor budget |
| DR6B | unknown (no source) | unknown | unknown | unknown | unknown | unknown |
| Cascade | up to 50 in | straight up | Yes, with chain bar | about 10 to 15 in/s | high | rigging, slop, top-heavy |
| Continuous | up to 50 in | straight up | Yes | slower than cascade | high | cycle time |

## 4. Which lift for which job (from the research docs)

- **Alliance Goal only, or a 1-to-2 layer stack:** two-bar or four-bar. **[repo research]**
- **Mid stacks (about 25 to 35 in):** six-bar with a wrist. **[repo research]**
- **Tall stacks (up to about 6 Pins, near 40 to 50 in):** DR4B, cascade, or continuous. **[repo research]**
  - DR4B trades weight and a rear arc for simplicity of motion.
  - Cascade trades rigging complexity for speed and compactness.
  - Continuous trades speed for strength.
- Stack-top heights to design to (Pin = 6.8 in on an alliance Goal; +7.1 in per layer): 1 Pin about 6.8 in, 3 Pins about
  21 in, 5 Pins about 35 in, 6 Pins about 42.3 in on an alliance Goal; add 2.5 in for a short Goal, 5.5 in for the
  center Goal. **[repo research, `docs/override-research.md` table]**

## 5. Limits of this file

- Lift geometry, reach and speed numbers come from the repo's research notes, not from the footage, and I did not
  re-verify them against the original videos.
- The footage supports only the contact, tipping and stack-stability observations in section 1, and only from an
  overhead view.
- DR6B has no source at all. Continuous and cascade have only forum-level numbers.
- Nothing in the simulator was changed for this file.

## 6. Open questions

- Which robot at this event uses which lift? (Needs a side or close-up view, or a team reveal.)
- What is a DR6B in this community, and is there an Override example?
- What are real reach, mass and speed numbers per lift type? (Real CAD, such as the Onshape models you mentioned,
  would answer this.)
