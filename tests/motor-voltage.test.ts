// motor_get_voltage reports the voltage the motor is driven at, not its speed.
import { describe, expect, it } from 'vitest';
import { MotorState } from '../src/sim/world.ts';

describe('MotorState.appliedMillivolts', () => {
  it('reports full voltage at full command even when stalled', () => {
    const m = new MotorState(1, 'green');
    m.mode = 'voltage';
    m.cmd = 127;
    m.rpm = 0;
    expect(m.appliedMillivolts(1)).toBe(12000);
  });

  it('scales with the command, reported in the code direction like the other getters', () => {
    // cmd already carries the port sign (motor_move multiplies it in), so a reversed port
    // commanded +64 has cmd -64 and reports +6047 in code direction (sign * cmd).
    const m = new MotorState(1, 'green');
    m.mode = 'voltage';
    m.cmd = 64;
    expect(m.appliedMillivolts(1)).toBe(Math.round((64 * 12000) / 127));
    m.cmd = -64;
    expect(m.appliedMillivolts(-1)).toBe(Math.round((64 * 12000) / 127));
  });

  it('respects a voltage limit', () => {
    const m = new MotorState(1, 'green');
    m.mode = 'voltage';
    m.cmd = 127;
    m.voltageLimit = 6000;
    expect(m.appliedMillivolts(1)).toBe(6000);
  });
});
