# Local patch to OpenTFRaw 3.0.0

Vendored from crates.io `opentfraw-3.0.0` (Apache-2.0, see LICENSE; https://github.com/Sigilweaver/OpenTFRaw).
Tests and examples were removed to keep the tool folder small.

Change (src/scan_event.rs, marked `PATCH (MS File Converter)`): `ScanEvent` keeps its raw v66 body bytes and
exposes them with `ScanEvent::body()`. The wrapper (`../../src/lib.rs`, `decode_reactions`) decodes the reaction
records from it — activation type per reaction, supplemental activation and energies — which OpenTFRaw 3.0.0
does not decode. Worth upstreaming; until then, re-apply this patch when updating the crate.
