Self-hosted runtime payloads served with immutable caching (see site/public/_headers):
- r/      custom webR package repos built with the `rwasm` R package when a CRAN package is missing from repo.r-wasm.org
- python/ wheels not on PyPI/Pyodide that a tool installs via micropip from this origin
- wasm/   shared WASM modules used by more than one tool (tool-specific ones live in site/tools/<id>/src/runtime/)
Version every subfolder (e.g. r/0.6.0/) so cache-busting is automatic. Document each addition in docs/RUNTIMES.md.
