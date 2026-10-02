// Precompiled-header root for plain PROS and PROS + LemLib projects. User translation
// units compile with -include-pch built from this file; their own #include "main.h"
// -> "api.h" etc. then hit the include guards and cost nothing. (All bundled headers
// use #ifndef guards; see src/compiler/headers.ts.)
#ifndef _SIM_PCH_LEMLIB_HPP_
#define _SIM_PCH_LEMLIB_HPP_

#include "sim/prelude.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "api.h"
#include "lemlib/api.hpp"

#endif  // _SIM_PCH_LEMLIB_HPP_
