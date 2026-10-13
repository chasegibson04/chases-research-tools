// Pyodide (CPython in WebAssembly) loader for use INSIDE tool.worker.ts via a tool's compute.ts.
// Pinned CDN version; cached by the browser. Multi-threading is not used. docs/RUNTIMES.md
export const PYODIDE_VERSION = '0.29.3'; // bump deliberately; verify tool tests after bumping (newer "314.x" line = Python 3.14)
const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodideReady: Promise<any> | null = null;

export function loadPyodideRuntime(opts: { packages?: string[]; micropip?: string[]; onStatus?: (s: string) => void } = {}) {
  if (!pyodideReady) {
    pyodideReady = (async () => {
      opts.onStatus?.('Downloading Python runtime…');
      // @ts-ignore - dynamic ESM import from CDN
      const { loadPyodide } = await import(/* @vite-ignore */ `${CDN}pyodide.mjs`);
      const py = await loadPyodide({ indexURL: CDN });
      if (opts.packages?.length) { opts.onStatus?.('Loading packages…'); await py.loadPackage(opts.packages); }
      if (opts.micropip?.length) {
        await py.loadPackage('micropip');
        const micropip = py.pyimport('micropip');
        for (const p of opts.micropip) await micropip.install(p);
      }
      return py;
    })();
  }
  return pyodideReady;
}

/** Run Python source with `input` available as a JSON-decoded `inputs` dict; return value of `result` variable. */
export async function runPython(src: string, input: unknown, opts?: Parameters<typeof loadPyodideRuntime>[0]) {
  const py = await loadPyodideRuntime(opts);
  py.globals.set('inputs_json', JSON.stringify(input));
  await py.runPythonAsync(`import json\ninputs = json.loads(inputs_json)\n${src}`);
  const out = py.globals.get('result');
  const js = typeof out?.toJs === 'function' ? out.toJs({ dict_converter: Object.fromEntries }) : out;
  out?.destroy?.();
  return js;
}
