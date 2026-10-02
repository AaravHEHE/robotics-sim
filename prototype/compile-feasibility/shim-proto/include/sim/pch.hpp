// Precompiled-header root: everything a typical PROS project pulls in.
// User translation units compile with -include-pch built from this file, so their
// own #include "api.h" / "lemlib/api.hpp" become no-ops via the include guards.
// (Guards, not #pragma once: file identity differs between virtual-FS instances.)
#ifndef _SIM_PCH_HPP_
#define _SIM_PCH_HPP_
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "api.h"
#include "lemlib/api.hpp"

#endif  // _SIM_PCH_HPP_
