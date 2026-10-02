// Included first in every simulator translation unit (via the PCH for user code and
// -include for shim code). Papers over differences between the V5 toolchain
// (GCC + newlib + libstdc++) and the browser toolchain (clang + wasi-libc + libc++).
#ifndef _SIM_PRELUDE_HPP_
#define _SIM_PRELUDE_HPP_

#ifdef __cplusplus
// libstdc++ pulls these in transitively; several PROS headers rely on that.
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>
#endif

#include <math.h>

#ifdef __cplusplus
extern "C" {
#endif
// newlib float classification helpers used by LemLib and some team code.
static inline int isnanf(float x) { return __builtin_isnan(x); }
static inline int isinff(float x) { return __builtin_isinf(x); }
#ifdef __cplusplus
}
#endif

#endif  // _SIM_PRELUDE_HPP_
