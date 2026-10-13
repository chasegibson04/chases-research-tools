# Runtimes: running JS, Python, R, C++, and Rust in the user's browser

Everything executes inside `site/src/lib/runtime/tool.worker.ts` (a module Web Worker) so the page never freezes. The worker is created per run and terminated on finish, cancel, or timeout (`workerHost.ts`). Device checks and warnings live in `limits.ts` (`preflight()`): WebAssembly support, input size, mobile warning, memory hint, runtime-download notice.

## Decision table

| Source language | Preferred path | When to use the alternative |
|---|---|---|
| JavaScript/TypeScript | As is | — |
| Python (numpy/scipy/pandas) | **Port to TS** if < ~500 lines of plain math | **Pyodide** when it leans on scipy/pandas/sklearn or faithfulness to the original matters |
| R | **Port to TS** for simple stats/algebra | **webR** when it depends on CRAN packages (e.g. `lme4`, `MSnbase`, `ggplot2`-only logic → re-plot with Plotly) |
| C/C++ | **Emscripten → WASM** | Port to TS only if tiny |
| Rust | **wasm-pack → WASM** | — |
| Julia / MATLAB / Fortran | Port to TS, or wrap Fortran via Emscripten (flang) | Showcase if impractical |
| Needs a GPU, >2 GB RAM, a database, or a server | **Showcase** (SHOWCASE_PROJECTS.md) | — |

## JS/TS (default)
`src/compute.ts` default-exports `(input, ctx) => output`. Use typed arrays for big numeric work. For > 1 s jobs, chunk loops and call `ctx.progress`. Check `ctx.signal.aborted` to honour cancel.

## Python via Pyodide
- Loader: `@/lib/runtime/pyodide.ts` (`runPython(src, input, {packages, micropip, onStatus})`). Version pinned in `PYODIDE_VERSION`; bump deliberately and re-run all Python tools' e2e tests.
- Place Python in `src/runtime/main.py`; import as text: `import src from './runtime/main.py?raw'`. The script receives `inputs` (dict from JSON) and must assign `result` (JSON-serialisable).
- Declare `runtime.pyodide.packages` (built-in wheels: numpy, scipy, pandas, scikit-learn, networkx, sympy, biopython… full list at pyodide.org/en/stable/usage/packages-in-pyodide.html) and `micropip` for pure-Python PyPI packages.
- First run downloads ~10 MB core + packages (numpy ≈ 3 MB, scipy ≈ 10 MB). Cached by the browser afterwards. Set `expectedRuntimeSeconds` accordingly on the first example and `compute.longRunning: true` if > 10 s.
- Pass data as JSON; for large arrays use `py.toPy`/buffers (see Pyodide docs) and return typed arrays via `.toJs()`.
- No threads, no `multiprocessing`, no network, no file system beyond the in-memory FS. Matplotlib works but is slow; re-plot with Plotly from returned arrays instead.

## R via webR
- Loader: `@/lib/runtime/webr.ts` (`runR(src, input, {packages})`). `jsonlite` is always installed. Code receives `inputs` (from `fromJSON`) and must assign `result`.
- Declare `runtime.webr.packages`; check availability at repo.r-wasm.org. Packages with compiled code are prebuilt there; missing ones can be built with the `rwasm` R package and hosted in `site/public/runtimes/r/` (then set a custom `repoUrl`).
- Runtime ≈ 20–40 MB first download. Same `longRunning` guidance as Pyodide.
- Base graphics don't render in the worker; return numeric vectors and plot with Plotly.

## C/C++ via Emscripten
- Build with `emcc -O3 -s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT=worker -s ALLOW_MEMORY_GROWTH=1 -s EXPORTED_FUNCTIONS=... -s EXPORTED_RUNTIME_METHODS=ccall,cwrap -o src/runtime/module.js`. Commit `module.js` + `module.wasm` and a `src/runtime/BUILD.md` with the exact command and toolchain version; put the C++ source in `src/runtime/cpp/`.
- Load with `loadEmscripten(() => import('./runtime/module.js'))` from `@/lib/runtime/wasm.ts`.
- Use `embind` for anything beyond simple numeric arrays.

## Rust via wasm-pack
- `wasm-pack build --target web --release` into `src/runtime/pkg/`. Commit the `pkg/` output (`*.js`, `*_bg.wasm`, `*.d.ts`), source in `src/runtime/rust/`.
- Load with `loadWasmBindgen(() => import('./runtime/pkg/<crate>.js'))`.
- Prefer `serde-wasm-bindgen` for structured I/O.

## Threads, SIMD, and the ad conflict
Multithreaded WASM needs `SharedArrayBuffer`, which needs cross-origin isolation (COOP `same-origin` + COEP `require-corp` or `credentialless`). COEP `require-corp` blocks AdSense/EthicalAds scripts. Policy: **single-threaded by default**. To opt in for a specific heavy tool: set `compute.threads > 1`, add a path-scoped rule in `site/public/_headers` for `/tools/<slug>/*` with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`, set `ads.allow: false` for that tool, and test in Chrome, Firefox, and Safari (credentialless support varies; the code falls back to one thread automatically via `safeThreads()`). WASM SIMD is fine everywhere modern; ship a non-SIMD fallback only if you must support very old browsers.

## Limits and user protection
- Timeouts kill the worker (`maxRuntimeSeconds`). Memory cannot be hard-capped in browsers; `maxMemoryMB` is a documented expectation used for warnings, and `maxInputSizeMB` rejects inputs before work starts. Keep WASM `MAXIMUM_MEMORY` ≤ 2 GB.
- Long-running tools: show progress, offer Cancel, and (planned) request a Screen Wake Lock. Never run more than one worker per tool page at a time.
- Rate limiting is not a server concern here (no server); the only resource is the user's own device.
