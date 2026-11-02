"""Maintainer-only: regenerate src/qm/basis.json from PySCF's bundled basis-set files.

    python -m venv .venv && .venv/bin/pip install pyscf
    .venv/bin/python scripts/gen_basis.py

Keeps only elements whose shells are all s or p (the engine supports angular momentum <= 1).
Format: { basisName: { symbol: [ [l, [exponents...], [coefficients...]], ... ] } }
Coefficients are for *normalised primitives* (the standard Gaussian94/BSE convention); the engine
normalises primitives and contractions itself, exactly as PySCF does.
"""
import json, pathlib
from pyscf import gto
from pyscf.data import elements

OUT = pathlib.Path(__file__).resolve().parent.parent / "src" / "qm" / "basis.json"
BASES = {"sto-3g": "STO-3G", "3-21g": "3-21G", "6-31g": "6-31G"}
data, skipped = {}, {}
for key, label in BASES.items():
    data[key] = {}
    skipped[key] = []
    for z in range(1, 37):  # H..Kr
        sym = elements.ELEMENTS[z]
        try:
            shells = gto.basis.load(key, sym)
        except Exception:
            skipped[key].append(sym)
            continue
        if any(sh[0] > 1 for sh in shells):
            skipped[key].append(sym)
            continue
        out = []
        for sh in shells:
            l = sh[0]
            prims = sh[1:]
            if len(prims[0]) != 2:  # general contraction (not used by these sets)
                raise SystemExit(f"general contraction in {key} {sym}")
            out.append([l, [p[0] for p in prims], [p[1] for p in prims]])
        data[key][sym] = out
    print(f"{label}: {len(data[key])} elements, skipped (d or missing): {' '.join(skipped[key])}")
OUT.write_text(json.dumps(data, separators=(",", ":")))
print("wrote", OUT, OUT.stat().st_size, "bytes")
