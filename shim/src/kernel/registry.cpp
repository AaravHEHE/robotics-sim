// Device registry lookup used by the vendored PROS wrappers' get_all_devices().
// The plugged-in device type comes from the robot profile via the JS runtime.
#include "vdml/vdml.h"

namespace {
v5_smart_device_s_t g_registry[32];
}

extern "C" v5_smart_device_s_t* registry_get_device(uint8_t port) {
  if (port >= 32) return nullptr;
  g_registry[port].device_type = pros::c::registry_get_plugged_type(port);
  return &g_registry[port];
}
