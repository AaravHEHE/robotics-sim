# Vendored third-party code

These are unmodified copies of public library sources. The simulator compiles them
against its own implementation of the PROS kernel's low-level C API, so user code sees
the real library APIs. Each directory keeps its original license.

| Directory | Source | Version | License | What we use |
| --- | --- | --- | --- | --- |
| `pros/` | [purduesigbots/pros](https://github.com/purduesigbots/pros) | 4.2.2 | MPL-2.0 | Public headers (`include/api.h`, `include/pros/*`) and C++ device wrappers (`src/devices/*.cpp`, `src/rtos/rtos.cpp`) |
| `lemlib/` | [LemLib/LemLib](https://github.com/LemLib/LemLib) | 0.5.6 | MIT (fmt: MIT-style) | Headers; PID, pose, util, timer, drive curves, chassis setup, opcontrol, tracking wheels, logger. Motions and odometry are replaced by `shim/src/lemlib/`. |
| `ez-template/` | [EZ-Robotics/EZ-Template](https://github.com/EZ-Robotics/EZ-Template) | 3.2.2 | MPL-2.0 | Headers and all sources except `drive/pid_tasks.cpp`, which is replaced by the modified copy in `shim/src/ez/pid_tasks.cpp` (also MPL-2.0). |
| `okapi-units/` | OkapiLib units, as shipped in the EZ-Template example project | — | MPL-2.0 | `okapi/api/units/*`, needed by EZ-Template headers |

Simulator-side changes never edit these files. Overrides live in `shim/include/`
(e.g. `lemlib/asset.hpp`), and kernel-internal stand-ins in `shim/private/`.
At build time, `#pragma once` is rewritten to include guards for the precompiled header
(see `src/compiler/headers.ts`); the files on disk stay unmodified.
