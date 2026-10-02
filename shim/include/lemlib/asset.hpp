// Simulator override of LemLib's asset.hpp (MIT, LemLib 0.5.6).
//
// On a real V5 the build embeds static/ files with objcopy, which provides
// _binary_static_<name>_start and an absolute _binary_static_<name>_size symbol.
// WebAssembly has no absolute symbols, so the simulator's project builder emits
// _binary_static_<name>_start plus a _binary_static_<name>_len variable instead.
// ASSET(x) usage in user code is unchanged.
#ifndef _ASSET_H_
#define _ASSET_H_

#include <cstddef>
#include <cstdint>

extern "C" {

typedef struct __attribute__((__packed__)) _asset {
        uint8_t* buf;
        size_t size;
} asset;
}

#define ASSET(x)                                                                                                       \
    extern "C" {                                                                                                       \
    extern uint8_t _binary_static_##x##_start[];                                                                       \
    extern const size_t _binary_static_##x##_len;                                                                      \
    }                                                                                                                  \
    static asset x = {_binary_static_##x##_start, _binary_static_##x##_len};

#define ASSET_LIB(x)                                                                                                   \
    extern "C" {                                                                                                       \
    extern uint8_t _binary_static_lib_##x##_start[];                                                                   \
    extern const size_t _binary_static_lib_##x##_len;                                                                  \
    }                                                                                                                  \
    static asset x = {_binary_static_lib_##x##_start, _binary_static_lib_##x##_len};

#endif // _ASSET_H_
