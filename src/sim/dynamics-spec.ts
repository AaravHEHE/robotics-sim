// The physical numbers behind a robot's motion, with the defaults used when a profile gives
// none. The motor figures are estimates built from VEX's published V5 smart motor
// ratings (11 W, 2.5 A limit, 100/200/600 rpm cartridges); they are not measurements of a
// particular motor. Everything in SI units so the dynamics code stays free of conversions.

import { CARTRIDGE_RPM, type Cartridge, type RobotProfile } from './profile.ts';

export const LB = 0.45359237; // kg per pound
export const INCH = 0.0254; // m per inch
export const G_SI = 9.80665; // m/s^2

/** One V5 11 W motor with a given cartridge, at its output shaft. */
export interface MotorSpec {
  /** No-load speed, rad/s. */
  freeSpeed: number;
  /** Stall torque at the nominal 12 V, N·m (estimate: the motor's ~11 W peak over the cartridge ratio). */
  stallTorque: number;
  /** Current limit, A (V5 firmware: 2.5 A). */
  currentLimit: number;
  /** Winding resistance, ohms (estimate from the stall torque and current). */
  resistance: number;
  /** Nominal supply, V. */
  nominalVoltage: number;
}

const STALL_TORQUE_NM: Record<Cartridge, number> = { red: 2.1, green: 1.05, blue: 0.35 };

/** Torque per amp and back-EMF per rad/s, from the ratings above. */
export function motorConstants(c: Cartridge): { kt: number; ke: number; spec: MotorSpec } {
  const spec = motorSpec(c);
  return { kt: spec.stallTorque / spec.currentLimit, ke: spec.nominalVoltage / spec.freeSpeed, spec };
}

export function motorSpec(c: Cartridge): MotorSpec {
  const nominalVoltage = 12;
  const currentLimit = 2.5;
  return {
    freeSpeed: (CARTRIDGE_RPM[c] * 2 * Math.PI) / 60,
    stallTorque: STALL_TORQUE_NM[c],
    currentLimit,
    // the rated stall torque is reached at the 2.5 A limit, at the nominal 12 V
    resistance: nominalVoltage / currentLimit,
    nominalVoltage,
  };
}

/** A robot's dynamics with every default filled in (SI units; the center of mass in meters from the footprint center). */
export interface Dynamics {
  mass: number;
  /** About the vertical axis through the center of mass, kg·m². */
  inertia: number;
  com: { x: number; y: number; z: number };
  wheelFriction: number;
  wheelsPerSide: number;
  batteryResistance: number;
}

export const DEFAULT_MASS_LB = 12;
export const DEFAULT_WHEEL_FRICTION = 0.9;
export const DEFAULT_BATTERY_RESISTANCE = 0.15;
/** Lateral (sideways) friction of the wheels, as a fraction of their grip: omni wheels roll sideways easily. */
export const DEFAULT_LATERAL_FRICTION = 0.3;
/** Gearbox and chain efficiency. */
export const DRIVE_EFFICIENCY = 0.85;
/** A full V5 battery's open-circuit voltage. */
export const BATTERY_OPEN_CIRCUIT = 12.8;

export function resolveDynamics(p: RobotProfile): Dynamics {
  const d = p.dynamics ?? {};
  const mass = (p.mass ?? DEFAULT_MASS_LB) * LB;
  const w = p.size.width * INCH;
  const l = p.size.length * INCH;
  const com = d.centerOfMass ?? {};
  return {
    mass,
    // a uniform box, unless the profile says otherwise (lb·in² -> kg·m²)
    inertia: d.inertia !== undefined ? d.inertia * LB * INCH * INCH : (mass * (w * w + l * l)) / 12,
    com: { x: (com.x ?? 0) * INCH, y: (com.y ?? 0) * INCH, z: (com.z ?? p.size.height * 0.3) * INCH },
    wheelFriction: d.wheelFriction ?? DEFAULT_WHEEL_FRICTION,
    wheelsPerSide: d.wheelsPerSide ?? Math.max(2, p.drivetrain.left.length),
    batteryResistance: d.batteryResistance ?? DEFAULT_BATTERY_RESISTANCE,
  };
}
