// LLEMU (pros::lcd) for the simulator: lines are shown in the simulator's LCD panel.
// Defined here instead of liblvgl. This TU deliberately does not include api.h,
// because pros/llemu.h carries a weak inline definition of lcd_print.
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <string>
#include "sim/abi.h"

namespace {
bool g_initialized = false;
using lcd_btn_cb_fn_t = void (*)(void);
}  // namespace

extern "C" bool lcd_print(std::int16_t line, const char* fmt, ...) {
  if (line < 0 || line > 7) return false;
  char buf[256];
  va_list args;
  va_start(args, fmt);
  std::vsnprintf(buf, sizeof buf, fmt, args);
  va_end(args);
  sim_lcd_set_text(line, buf);
  return true;
}

namespace pros {
namespace lcd {
bool is_initialized(void) { return g_initialized; }
bool initialize(void) {
  g_initialized = true;
  sim_lcd_clear(-1);
  return true;
}
bool shutdown(void) {
  g_initialized = false;
  return true;
}
bool set_text(std::int16_t line, std::string text) {
  if (line < 0 || line > 7) return false;
  sim_lcd_set_text(line, text.c_str());
  return true;
}
bool clear(void) {
  sim_lcd_clear(-1);
  return true;
}
bool clear_line(std::int16_t line) {
  sim_lcd_clear(line);
  return true;
}
void register_btn0_cb(lcd_btn_cb_fn_t) {}
void register_btn1_cb(lcd_btn_cb_fn_t) {}
void register_btn2_cb(lcd_btn_cb_fn_t) {}
std::uint8_t read_buttons(void) { return 0; }
}  // namespace lcd
}  // namespace pros
