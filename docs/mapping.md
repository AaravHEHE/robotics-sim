# Auton mapping (the Map an auton workspace)

**Map an auton** (at the top of the page) shows the field from above beside the plan,
with **Plot points** ready. It treats the field as a 12 × 12 ft coordinate plane, to plan autonomous routes.

## Coordinates

- Inches, with the origin at the field center.
- +x points toward the right (blue) wall and +y toward the far wall.
- Headings are degrees clockwise from +y, as in LemLib, EZ-Template's odometry and the
  GPS sensor. A robot facing the blue wall has heading 90°.

## Plotting points

1. Pick **Plot points** and click the field. Dragging still turns the camera; the **Top**
   view is the easiest to plot in.
2. Points snap to the chosen grid (½″ by default, up to a 2 ft tile). With **to field
   elements** on, a click within 2.5″ of a field element lands on it and takes its name:
   Goals, Toggle centers and ends, Loader openings, floor stacks, lying Pins and start
   positions.
3. Drag a point to move it, or type its x and y in the table.
4. Give a point a **Face °** heading if the robot must face a certain way there; an arrow
   shows it.

## Reading a route

Each row of the table gives:

- the distance to drive from the previous point: the distance between them minus 18 in (a typical robot's length; never below 0). The same 18 in comes off the Measure result and the timing;
- the heading to drive from it;
- the turn at the previous point (+ is a right turn).

The turn is measured from the way the robot arrived there, or from that point's own heading
if it has one. **Start** puts the robot's start pose on a point, facing its heading or
toward the next point.

## Timing estimates

Set **Velocity** to the motor velocity your code drives at, as a percentage of full speed
(e.g. 70 for `move_velocity` at 70%, or a LemLib / EZ max speed of about 89 out of 127).
The **Time** column then estimates each leg for the selected robot:

- the turn in place to face the leg (if the robot's heading there is known), then the drive;
- both from rest to rest: the robot speeds up and brakes at its own acceleration
  (`drivetrain.maxAccel`), and cruises at the velocity times its top speed;
- hover over a time to see the turn and drive separately, and the running total.

The total under the table is compared with the auto-stop (15 s or 60 s). It leaves out
mechanism moves and waits, so keep some margin. These estimates are for planning only; a
run still simulates your actual code.

## Measuring

Pick **Measure** and click two spots: they snap to points and field elements. Or pick
them in the **from** and **to** lists. You get the distance (inches and feet), the heading,
and dx and dy, drawn on the field.

## Saving and sharing

Plans are saved per browser: nothing is uploaded.

- **Save** keeps the plan in this browser under its name. **Open a saved plan…** and
  **Delete** manage saved plans.
- The plan you are working on is kept across reloads, even unsaved.
- **Export file** downloads a `.vexplan.json`, and **Import file** opens one.
- **Copy link** puts the whole plan in a link (`#plan=…`): coordinates are rounded to
  0.1″ and compressed, so dozens of points fit in 1–2 KB.
  - Opening the link shows the plan in the Map an auton workspace, unsaved until you press Save.
  - A plan made on another field says so.
