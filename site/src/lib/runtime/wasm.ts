// Loader for tool-specific WebAssembly modules (C/C++ via Emscripten, Rust via wasm-bindgen/wasm-pack).
// Put compiled artifacts in tools/<slug>/src/runtime/ and import them from compute.ts. docs/RUNTIMES.md
export async function loadEmscripten(factory: () => Promise<any>, moduleArgs: Record<string, unknown> = {}) {
  const mod = await factory();
  const init = mod.default ?? mod;
  return init(moduleArgs);
}
export async function loadWasmBindgen(factory: () => Promise<any>) {
  const mod = await factory();
  if (typeof mod.default === 'function') await mod.default();
  return mod;
}
