# Local patch to OpenTFRaw 3.0.0

Vendored from crates.io `opentfraw-3.0.0` (Apache-2.0, see LICENSE; https://github.com/Sigilweaver/OpenTFRaw).
Tests and examples were removed to keep the tool folder small.

Change (src/scan_event.rs, marked `PATCH (MS File Converter)`): `ScanEvent` keeps its raw v66 body bytes and
exposes them with `ScanEvent::body()`. The wrapper (`../../src/lib.rs`, `decode_reactions`) decodes the reaction
records from it — activation type per reaction, supplemental activation and energies — which OpenTFRaw 3.0.0
does not decode. Worth upstreaming; until then, re-apply this patch when updating the crate.

Second change (same file, also marked): in tribrid dependent events (Orbitrap Eclipse/Fusion/Ascend) the
nparam + calibration coefficients block is read right after the scan-window FractionCollector
(`fc_offset + 16`). 3.0.0 used `body_size - 64`, which is only right for events with one reaction, so profile
m/z of EThcD / ETciD / IR-ETD scans (two reaction records) was converted with the wrong coefficients. Found by
point-by-point comparison against ThermoRawFileParser output.
