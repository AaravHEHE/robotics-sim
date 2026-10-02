// Entry points the JavaScript scheduler calls through WebAssembly.promising().
#include <cstdint>

extern "C" {
// Competition hooks. Projects normally define these with C linkage (stock main.h);
// weak defaults let projects that omit one still link.
__attribute__((weak)) void initialize(void) {}
__attribute__((weak)) void competition_initialize(void) {}
__attribute__((weak)) void autonomous(void) {}
__attribute__((weak)) void disabled(void) {}
__attribute__((weak)) void opcontrol(void) {}

typedef void (*sim_task_fn_t)(void*);

__attribute__((export_name("sim_task_entry"))) void sim_task_entry(sim_task_fn_t fn, void* arg) { fn(arg); }

// phase: 0 initialize, 1 competition_initialize, 2 autonomous, 3 opcontrol, 4 disabled
__attribute__((export_name("sim_competition_entry"))) void sim_competition_entry(std::int32_t phase) {
  switch (phase) {
    case 0: initialize(); break;
    case 1: competition_initialize(); break;
    case 2: autonomous(); break;
    case 3: opcontrol(); break;
    case 4: disabled(); break;
  }
}
}
