// Simulator stand-in for the PROS kernel-internal vdml/vdml.h (subset needed by the
// vendored C++ device wrappers). Port mutexes are implemented by the JS runtime.
#ifndef _SIM_VDML_H_
#define _SIM_VDML_H_

#include <errno.h>
#include <stdint.h>
#ifdef __cplusplus
#include <vector>
#endif
#include "api.h"
#include "pros/apix.h"
#include "vdml/port.h"

#ifdef __cplusplus
extern "C" {
#endif
int port_mutex_take(uint8_t port);
int port_mutex_give(uint8_t port);

// Registry entry; only device_type is meaningful in the simulator.
typedef struct {
  pros::c::v5_device_e_t device_type;
  uint8_t pad[128];
} v5_smart_device_s_t;
// Implemented in shim/src/kernel/registry.cpp (port is zero-indexed, as in the kernel).
v5_smart_device_s_t* registry_get_device(uint8_t port);
#ifdef __cplusplus
}
#endif

#define return_port(port, rtn) \
  port_mutex_give(port);       \
  return rtn;

#endif  // _SIM_VDML_H_
