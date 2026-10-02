#include <cstdlib>
#include "pros/rtos.hpp"
#include "sim/abi.h"

namespace {
struct TaskRecord {
  pros::task_fn_t fn;
  void* arg;
};
constexpr std::uint32_t kMaxTasks = 64;
TaskRecord g_tasks[kMaxTasks];
std::uint32_t g_next_task = 1;  // id 0 is the competition (main) task
constexpr std::size_t kTaskStackBytes = 64 * 1024;
}  // namespace

namespace pros {
namespace c {
void delay(const std::uint32_t milliseconds) { sim_delay(milliseconds); }
std::uint32_t millis(void) { return sim_millis(); }
}  // namespace c

Task::Task(task_fn_t function, void* parameters, std::uint32_t, std::uint16_t, const char* name) {
  if (g_next_task >= kMaxTasks) {
    sim_unsupported("pros::Task (more than 63 tasks)");
    return;
  }
  id_ = g_next_task++;
  g_tasks[id_] = {function, parameters};
  // Each task runs on its own shadow stack; the scheduler swaps __stack_pointer.
  auto* stack = static_cast<unsigned char*>(std::aligned_alloc(16, kTaskStackBytes));
  sim_task_spawn(id_, reinterpret_cast<std::uint32_t>(stack + kTaskStackBytes), name ? name : "");
}

Task::Task(task_fn_t function, void* parameters, const char* name)
    : Task(function, parameters, TASK_PRIORITY_DEFAULT, TASK_STACK_DEPTH_DEFAULT, name) {}
}  // namespace pros

extern "C" {
// Weak defaults so projects that omit a competition hook still link.
__attribute__((weak)) void initialize(void) {}
__attribute__((weak)) void autonomous(void) {}

// Entry points called by the scheduler through WebAssembly.promising().
__attribute__((export_name("sim_task_entry"))) void sim_task_entry(std::uint32_t id) {
  if (id < kMaxTasks && g_tasks[id].fn) g_tasks[id].fn(g_tasks[id].arg);
}

__attribute__((export_name("sim_competition_entry"))) void sim_competition_entry(void) {
  initialize();
  autonomous();
}
}
