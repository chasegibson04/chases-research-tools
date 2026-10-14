# Tool manifest specification (`tool.json`)

Schema: `site/tools/tool.schema.json` (JSON Schema 2020-12). Validator: `npm run validate`. Types: `site/src/lib/types.ts`. Use `null`, `[]`, or `false` for not-applicable fields; do not omit required keys.

| Field | Type | Required | Meaning / rules |
|---|---|---|---|
| `id` | slug | ✓ | Folder name and URL. Immutable. |
| `name` | string | ✓ | Display name, Title Case. |
| `tagline` | string 10–140 | ✓ | One sentence for cards and under the H1. |
| `description` | string 50–600 | ✓ | 2–4 sentences; listings, llms.txt, OpenGraph fallback. |
| `version` | semver | ✓ | Bump patch for fixes, minor for new options, major for changed results. |
| `status` | draft/beta/stable/deprecated | ✓ | draft = hidden + noindex; deprecated = listed with badge, excluded from related. |
| `kind` | interactive/showcase | ✓ | showcase requires `showcase` block and `runtime.engine: "none"`. |
| `category` | id | ✓ | From categories.json. |
| `subcategories` | id[] ≥1 | ✓ | Must belong to `category`. |
| `tags` | slug[] | ✓ | Related-tool scoring (+1 per shared tag). |
| `keywords` | string[] | ✓ | Google phrases; also in JSON-LD `keywords`. |
| `related` | id[] | – | Explicit related tools (+5). Validator checks they exist. |
| `runtime.engine` | js/python/r/wasm/none | ✓ | Drives preflight warnings and badges. |
| `runtime.languages` | string[] | ✓ | Human-readable, shown on page. |
| `runtime.pyodide` | {version?, packages[], micropip[]} | if python | `packages` = Pyodide built-ins (numpy, scipy, pandas…); `micropip` = pure-Python wheels from PyPI. |
| `runtime.webr` | {version?, packages[]} | if r | CRAN names available in the webR repo. |
| `runtime.wasm` | {source, threads?, simd?} | if wasm | `source` documents how to rebuild. |
| `runtime.bundleSizeKB` | number/null | – | Extra download triggered by the tool (perf budget). |
| `compute.location` | "client" | ✓ | Constant. |
| `compute.worker` | bool | ✓ | Must be true unless compute is trivially fast (<50 ms). |
| `compute.maxRuntimeSeconds` | 1–3600 | ✓ | Hard kill timeout. |
| `compute.maxMemoryMB` | 16–4096 | ✓ | Documented expectation; used for warnings. |
| `compute.maxInputSizeMB` | number | ✓ | Blocks larger uploads before running. |
| `compute.threads` | 1–16 | ✓ | Requested; clamped to cores/2; 1 unless cross-origin isolated. |
| `compute.warnOnMobile` | bool | ✓ | Shows a warning on phones. |
| `compute.longRunning` | bool | ✓ | >10 s expected: progress bar + keep-awake. |
| `layout.aspect` | fill/16:9/4:3/tall | ✓ | Frame sizing. |
| `layout.inputsPosition` | left/top/right | ✓ | Shell orientation (left implemented; others fall back to left for now). |
| `layout.inputsWidthPx` | 200–520 | – | Width of the input column. |
| `layout.panels` | enum[] | ✓ | Documentation of which panels the UI shows. |
| `layout.fullWidth` | bool | – | Use the full viewport width. |
| `inputs[]` | object[] | ✓ | `name` (identifier), `label`, `type` (text/textarea/number/integer/boolean/select/multiselect/file/range/color), **`help` (≥15 chars)**, `default`, `required`, `unit`, `min`, `max`, `step`, `options[{value,label}]`, `placeholder`, `accept`, `maxSizeMB`, `group`, `advanced` (collapsed under "Advanced options"). |
| `outputs[]` | object[] | ✓ | `name`, `label`, `type` (number/text/table/figure/file/json), `help`, `exportFormats[]`. Documentation + export expectations. |
| `figures` | {enabled, library, exportable, defaultPalette?} | ✓ | plotly or none. |
| `exports` | enum[] | ✓ | Union of formats the UI offers: csv/tsv/json/txt/png/svg/pdf. |
| `examples[]` | {file, label, description?, expectedRuntimeSeconds?} | ✓ ≥1 | Files in `examples/`. Label must match the file's `label`. |
| `citation` | {authors[], year, title, doi, version?, preferredFormat?, alsoCite[]} | ✓ | See CITATIONS.md. |
| `seo` | {title ≤65, metaDescription 70–160, ogImage, schemaType, faq[]} | ✓ | schemaType: WebApplication (default) / SoftwareApplication / SoftwareSourceCode (showcase). |
| `ads.allow` | bool | ✓ | false disables ad slots on this page. |
| `maintenance` | {created, updated, author, maintainers[]?, sourceOrigin?, changelog?} | ✓ | `created`, `updated`, `author` required; ISO dates. `sourceOrigin` = original project path/repo (provenance). |
| `links` | {repo?, release?, paper?, docs?, demoVideo?} | ✓ (each string or null) | Shown in the sidebar. |
| `showcase` | {install, platforms[], figures[{src,caption,alt}], releaseUrl} | if showcase | Figures live in `site/public/tools/<id>/`. |
| `accessibility` | {notes, keyboardOperable} | – | |
| `privacy` | {sendsData: false, storesLocal} | ✓ | `sendsData` is constant false. |
| `license` | string | ✓ | Default MIT. |

## Example file format (`examples/<name>.json`)
```json
{ "label": "Angiotensin II (DRVYIHPF)", "description": "Source of expected values", "input": { "...": "..." }, "expected": { "mono": 1045.5345 } }
```
`expected` keys are matched against `[data-output="<key>"]` elements in the UI by the generic e2e test (numeric tolerance 0.1 % + 0.0005) and used directly by unit tests.

## Adding a field to the schema
Edit `tool.schema.json` + `types.ts` + this table + the template; make it optional or provide a default so existing tools keep validating; record an ADR.
