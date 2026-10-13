# Showcase projects (tools that cannot run in the browser)

Use `kind: "showcase"` for desktop apps, GPU pipelines, R/Python packages, or anything needing a server. The page documents the project with figures and captions, usage instructions, and a release link, and still gets a directory entry, category, related tools, citation box, and structured data (`schemaType: "SoftwareSourceCode"`).

## Steps
1. `npm run new-tool -- <slug> "<Name>"`, then in `tool.json` set `kind: "showcase"`, `runtime.engine: "none"`, `runtime.languages` to the real languages, `compute.worker: false`, and fill the `showcase` block:
   ```json
   "showcase": { "install": "pip install mytool  # or download the installer", "platforms": ["Windows", "macOS", "Linux"], "releaseUrl": "https://github.com/…/releases/latest", "figures": [ { "src": "fig1.png", "caption": "Main window with a loaded dataset.", "alt": "Screenshot of …" } ] }
   ```
2. Put figures in `site/public/tools/<slug>/` (PNG/WebP, ≤ 400 KB each, 1600 px wide max). Every figure needs a real caption and alt text.
3. Delete `src/`, `tests/compute.test.ts`; keep `examples/` with one JSON describing a sample input file and expected output (used as documentation, not executed). The validator skips compute requirements for showcase tools.
4. README sections become: Overview, How to use (install → run → interpret), Method, Limitations, References. Add a "Download" subsection with release assets and checksums if relevant.
5. `links.release`, `links.repo`, `links.paper` filled. Category usually `software` with the discipline as `tags`, or the discipline category if the project is clearly e.g. mass spec.
6. Validate, build, e2e (the generic test checks the page, citation, and structured data), ship.

Later migration: if the project becomes browser-capable, change `kind` to `interactive`, add `src/`, keep the slug.
