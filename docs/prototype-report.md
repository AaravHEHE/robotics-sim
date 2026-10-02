# Milestone 0: Browser compile feasibility report

**Date:** 2026-10-01 · **Verdict: GO.** All pass criteria were met in Chrome and Firefox. Safari was not tested (no Mac available).

## What was built
`prototype/compile-feasibility/` contains the following:

| File | Role |
| --- | --- |
| `toolchain.mjs` | Driver for the prebuilt **llvm-wasm** multicall binary: clang 23.1.2 + wasm-ld, Emscripten build, wasi-sdk 34 sysroot. Each tool call runs in a fresh instance of one precompiled `WebAssembly.Module`, with the sysroot mounted from tarballs. |
| `pipeline.mjs` | `buildShim` (shim sources → objects + precompiled header) and `compileProject` (user project → objects → linked reactor wasm). The shim include dir comes before the project's, so vendored PROS/LemLib headers in a real project are shadowed. |
| `runtime.mjs` | Deterministic scheduler with a 1 ms fixed step. `pros::delay` and LemLib `waitUntil*` are **JSPI suspending imports**. Each `pros::Task` is a separate `WebAssembly.promising` call with its own 64 KB shadow stack; the scheduler swaps the exported `__stack_pointer` on every switch. Also contains tank kinematics and idealized `moveToPoint` / `turnToHeading` (no PID). |
| `../../shim/` | PROS 4 API subset (`delay`, `millis`, `Task`, `Motor`, `MotorGroup`, `Imu`) plus a LemLib 0.5 `Chassis` subset, built against `shim/include/sim/abi.h`. |
| `test-project/` | Shaped like a real PROS template: `include/main.h`, 3 `.cpp` files, 223 lines. Uses LemLib motions with `async` / `waitUntil`, raw `MotorGroup::move`, an IMU-driven turn loop, and a parallel intake `pros::Task`. |
| `index.html`, `worker.mjs`, `serve.mjs` | In-browser harness. Downloads gzipped assets once (Cache API), then builds 3× and simulates 2×. |
| `bench-node.mjs`, `sizes.mjs` | The same pipeline in Node, plus download-size measurement. |

## Results

### Download (one-time, then served from the Cache API)
| Asset | Raw | gzip-9 | brotli-11 |
| --- | --- | --- | --- |
| llvm.wasm (clang + lld) | 46.9 MB | 17.2 MB | 12.3 MB |
| include.tar (libc / libc++ headers) | 11.5 MB | 1.5 MB | 1.0 MB |
| lib.tar (libc, libc++, builtins) | 14.5 MB | 4.7 MB | 3.2 MB |
| sim.pch (shim + common std headers) | 15.7 MB | 9.7 MB | 7.1 MB |
| **Total** | **88.5 MB** | **33.1 MB** | **23.5 MB** |

Estimated first-visit download: about 5 s at 50 Mbit/s, about 26 s at 10 Mbit/s with gzip. Brotli would be about 30% less, but only if the host serves it.

### Timings (localhost, so network time is excluded)
| | Chrome 152 (built-in browser) | Firefox 156 (headless) | Node 24 |
| --- | --- | --- | --- |
| Toolchain ready, first visit | 0.64 s | 2.0 s | 0.12 s |
| Toolchain ready, cached visit | 0.40 s | 0.67 s | n/a |
| **First build in session** (3 TUs + link) | **1.24–1.26 s** | **0.42–0.49 s** | 1.4 s (no PCH) |
| **Warm build** (3 TUs + link) | **0.36–0.40 s** | **0.39–0.52 s** | 0.41–0.43 s |
| Per TU, warm | 66–167 ms | 64–242 ms | 63–176 ms |
| Link | 48–94 ms | 51–75 ms | 54 ms |
| Compiler peak linear memory | 67 MB | 67 MB | n/a |
| Output app.wasm | 390 KB | 390 KB | 390 KB |
| 15 s of simulated auton (wall time) | 6–20 ms | 9–17 ms | 8–20 ms |
| Determinism (2 runs, same engine) | identical | identical | identical |

Notes:
- The precompiled header is essential: it gives about 3.5× on warm builds (1.43 s → 0.41 s in Node).
- Chrome's first build is slower because V8 tiers up the 47 MB compiler from Liftoff to TurboFan. Firefox doesn't show this.

### Pass criteria
| Criterion | Target | Result |
| --- | --- | --- |
| Warm full-project compile + link | ≤ 3 s | 0.36–0.52 s ✅ |
| Cold first compile | ≤ 10 s | ≤ 1.3 s after the toolchain loads ✅ |
| Download | ≤ 50 MB compressed | 33.1 MB gzip / 23.5 MB brotli ✅ |
| Tasks interleave correctly | | intake task + competition task + LemLib waits interleave at 10 ms granularity ✅ |
| Deterministic | identical logs across runs | identical within an engine ✅ (see the cross-engine caveat below) |

## Findings that shape Milestone 1
1. **`#pragma once` breaks with the PCH.** Each tool call gets a fresh virtual filesystem, so file identity differs between the PCH build and the compile that uses it. Shim headers must use `#ifndef` include guards; the real PROS headers already do. A user project that uses `#pragma once` in its own headers is fine, because those files aren't in the PCH.
2. **Cross-engine floating-point drift.** The event log (which command happened at which ms) was identical in Node and Chrome. Positions differed at about 1e-14, because `Math.atan2` differs in the last bit between V8 versions. To make a route replay identically for every visitor, M1 must do simulation math in WebAssembly (where IEEE ops are exact; this includes Rapier with its determinism feature) or with our own trig functions, not with JS `Math.*`.
3. **Cache the PCH and toolchain in a long-lived Worker.** Per-call instantiate + mount costs about 20–35 ms. The `-cc1` in-process driver works, but `clang` can't spawn `wasm-ld`, so we link explicitly. Recompiling only changed TUs (an object cache keyed by content hash) will make typical edits about 0.1–0.2 s.
4. **Exceptions are on.** libc++ in the sysroot uses wasm exnref exceptions, so we compile with `-fwasm-exceptions`. Every browser that has JSPI also supports exnref.
5. **Static constructors run in `_initialize`.** That's where global `pros::Motor` objects and `lemlib::Chassis` get built; they work as long as they don't call `delay`. A delay in a static constructor needs a clear error message in M1.
6. **Runaway loops** (a `while(true)` with no `delay`) would hang the worker. M1 needs the wall-clock watchdog (terminate the Worker) from the plan.

## Risks / open items
- **llvm-wasm licence.** The repo has no LICENSE file. The binaries are LLVM (Apache-2.0 WITH LLVM-exception), Emscripten runtime (MIT) and wasi-sdk (Apache-2.0), so redistribution with notices is fine. Before public launch, we should either ask the author to add a licence or reproduce the build in our own GitHub Actions; their build scripts are public.
- **Safari 27** is untested. It has JSPI, but someone should open the harness on a Mac.
- **Hosting compression.** GitHub Pages may not serve brotli for `.wasm`/`.pch`. The harness ships pre-gzipped files and inflates them with `DecompressionStream`, so this works regardless of the host.
- **PCH size (9.7 MB gz).** Trimming `<iostream>` / `<map>` or splitting the PCH could save several MB; measure in M1.
- **Toolchain choice.** The release I used (20261001-0459) should be pinned and mirrored into our own site; we can't hotlink GitHub release assets.

## How to reproduce
```
npm install
npm run proto:bench          # Node: build shim + PCH, compile, link, run (writes prototype/compile-feasibility/out/)
npm run proto:sizes          # compressed sizes + .gz copies for the browser
node prototype/compile-feasibility/serve.mjs
# open http://localhost:5173/  →  "Run benchmark"   (or ?auto=<name> to POST results to out/report-<name>.json)
```
The toolchain must first be downloaded into `tools/llvm-wasm/` (git-ignored): `llvm.js`, `llvm.wasm`, `include.tar`, `lib.tar` from https://github.com/LuvHakii/llvm-wasm/releases/tag/20261001-0459.
