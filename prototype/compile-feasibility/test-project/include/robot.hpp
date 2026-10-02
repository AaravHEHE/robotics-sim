#pragma once
#include "main.h"

// Devices are defined once in robot.cpp and shared across translation units.
extern pros::MotorGroup leftMotors;
extern pros::MotorGroup rightMotors;
extern pros::Motor intake;
extern pros::Imu imu;
extern lemlib::Chassis chassis;

enum class IntakeMode { Off, In, Out };
void setIntake(IntakeMode mode);
void startIntakeTask();

// Autonomous routines
void autonRight();
void autonSkillsStart();
void driveSquare(float side);
