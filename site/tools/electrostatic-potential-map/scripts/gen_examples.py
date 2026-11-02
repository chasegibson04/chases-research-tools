"""Maintainer-only: writes the XYZ examples with expected values from PySCF (independent of the browser engine).

    .venv/bin/python scripts/gen_examples.py
expected: energy (Eh), esp3 (kcal/mol, 3.0 A above the ring centroid), qzz (Buckingham, out-of-plane traceless quadrupole).
"""
import json, pathlib
import numpy as np
from pyscf import gto, scf

HERE = pathlib.Path(__file__).resolve().parent.parent
geoms = json.loads((HERE / "tests" / "reference" / "geometries.json").read_text())
BOHR, HA_KCAL, EA0SQ_B = 0.529177210903, 627.5094740631, 1.3450342

def pyscf_values(name, basis):
    g = geoms[name]
    mol = gto.M(atom=[(a[0], tuple(a[1:])) for a in g["atoms"]], unit="Angstrom", basis=basis, charge=0, verbose=0)
    mf = scf.RHF(mol); mf.conv_tol = 1e-12; mf.conv_tol_grad = 1e-9; mf.kernel()
    dm = mf.make_rdm1()
    Z = np.array([mol.atom_charge(i) for i in range(mol.natm)], float)
    R = mol.atom_coords()
    p = np.array([[0.0, 0.0, 3.0 / BOHR]])
    v = (Z / np.linalg.norm(R - p[0], axis=1)).sum() - np.einsum("gij,ij->g", mol.intor("int1e_grids", grids=p), dm)[0]
    rr = mol.intor("int1e_rr", comp=9).reshape(3, 3, mol.nao, mol.nao)
    q = np.array([[-np.einsum("ij,ij->", dm, rr[a, b]) + (Z * R[:, a] * R[:, b]).sum() for b in range(3)] for a in range(3)])
    qzz = 0.5 * (3 * q[2, 2] - np.trace(q)) * EA0SQ_B
    return mf.e_tot, v * HA_KCAL, qzz

for name, label, desc in [
    ("benzene", "Benzene, D6h geometry (XYZ)", "Exact textbook geometry; values reproduce an independent PySCF calculation."),
    ("hexafluorobenzene", "Hexafluorobenzene, D6h geometry (XYZ)", "Exact D6h geometry; values reproduce an independent PySCF calculation."),
]:
    e, v3, qzz = pyscf_values(name, "6-31g")
    xyz = "\n".join(f"{a[0]} {a[1]:.6f} {a[2]:.6f} {a[3]:.6f}" for a in geoms[name]["atoms"])
    ex = {"label": label, "description": desc + " Expected values: PySCF RHF/6-31G.",
          "input": {"source": "xyz", "structure": xyz, "basis": "6-31g", "charge": 0, "quality": "standard", "reorient": True},
          "expected": {"energy": round(e, 6), "esp3": round(v3, 3), "qzz": round(qzz, 3)}}
    (HERE / "examples" / f"{name}-xyz.json").write_text(json.dumps(ex, indent=2) + "\n")
    print(name, ex["expected"])
