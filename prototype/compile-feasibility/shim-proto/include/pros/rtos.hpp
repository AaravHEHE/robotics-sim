// PROS RTOS subset for the simulator. Signatures follow the public PROS 4 API.
// Prototype hand-written subset; Milestone 1 replaces this with the vendored
// MPL-2.0 PROS headers plus simulator-specific implementations.
#ifndef _PROS_RTOS_HPP_
#define _PROS_RTOS_HPP_
#include <cstdint>
#include <functional>
#include <memory>

#define TASK_PRIORITY_DEFAULT 8
#define TASK_STACK_DEPTH_DEFAULT 0x2000

namespace pros {
using task_fn_t = void (*)(void*);

namespace c {
void delay(const std::uint32_t milliseconds);
std::uint32_t millis(void);
}  // namespace c

using c::delay;
using c::millis;

class Task {
 public:
  Task(task_fn_t function, void* parameters = nullptr, std::uint32_t prio = TASK_PRIORITY_DEFAULT,
       std::uint16_t stack_depth = TASK_STACK_DEPTH_DEFAULT, const char* name = "");
  Task(task_fn_t function, void* parameters, const char* name);

  template <class F>
  explicit Task(F&& function, std::uint32_t prio = TASK_PRIORITY_DEFAULT,
                std::uint16_t stack_depth = TASK_STACK_DEPTH_DEFAULT, const char* name = "")
      : Task(&Task::trampoline, new std::function<void()>(std::forward<F>(function)), prio, stack_depth, name) {}

  template <class F>
  Task(F&& function, const char* name)
      : Task(&Task::trampoline, new std::function<void()>(std::forward<F>(function)), TASK_PRIORITY_DEFAULT,
             TASK_STACK_DEPTH_DEFAULT, name) {}

  std::uint32_t get_id() const { return id_; }
  static void delay(const std::uint32_t milliseconds) { pros::c::delay(milliseconds); }

 private:
  static void trampoline(void* fn) {
    std::unique_ptr<std::function<void()>> f(static_cast<std::function<void()>*>(fn));
    (*f)();
  }
  std::uint32_t id_ = 0;
};
}  // namespace pros

#endif  // _PROS_RTOS_HPP_
