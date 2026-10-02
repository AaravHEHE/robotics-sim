// Simulator stand-in for the PROS kernel-internal kapi.h. Used only while compiling
// the vendored PROS C++ wrappers (shim/vendor/pros/src); never visible to user code.
#ifndef _SIM_KAPI_H_
#define _SIM_KAPI_H_

#include <vector>
#include "api.h"
#include "pros/apix.h"
#include "system/optimizers.h"

// The simulator scheduler is cooperative, so critical sections are no-ops.
#define portENTER_CRITICAL()
#define portEXIT_CRITICAL()

#endif  // _SIM_KAPI_H_
