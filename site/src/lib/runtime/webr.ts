// webR (R in WebAssembly) loader for use INSIDE tool.worker.ts via a tool's compute.ts. docs/RUNTIMES.md
export const WEBR_VERSION = '0.6.0';
let webrReady: Promise<any> | null = null;

export function loadWebR(opts: { packages?: string[]; onStatus?: (s: string) => void } = {}) {
  if (!webrReady) {
    webrReady = (async () => {
      opts.onStatus?.('Downloading R runtime…');
      // @ts-ignore
      const { WebR } = await import(/* @vite-ignore */ `https://cdn.jsdelivr.net/npm/webr@${WEBR_VERSION}/dist/webr.mjs`);
      const webR = new WebR({ baseUrl: `https://cdn.jsdelivr.net/npm/webr@${WEBR_VERSION}/dist/` });
      await webR.init();
      if (opts.packages?.length) { opts.onStatus?.('Installing R packages…'); await webR.installPackages(opts.packages); }
      return webR;
    })();
  }
  return webrReady;
}

/** Run R code with `inputs` list available (from JSON); the expression's value is returned as JSON (code must `jsonlite::toJSON(result)` or return an atomic/list). */
export async function runR(src: string, input: unknown, opts?: Parameters<typeof loadWebR>[0]) {
  const webR = await loadWebR({ packages: ['jsonlite', ...(opts?.packages ?? [])], onStatus: opts?.onStatus });
  const shelter = await new webR.Shelter();
  try {
    const code = `inputs <- jsonlite::fromJSON(${JSON.stringify(JSON.stringify(input))})\n${src}\njsonlite::toJSON(result, auto_unbox = TRUE, digits = NA)`;
    const r = await shelter.evalR(code);
    const json = await r.toString();
    return JSON.parse(json);
  } finally {
    shelter.purge();
  }
}
