"""Maintainer-only: independent PySCF reference values for the unit tests.

    .venv/bin/python scripts/gen_reference.py            # all molecules x bases
Writes tests/reference/<molecule>.<basis>.json with: energies, orbital energies, Mulliken/Lowdin charges,
electronic+nuclear dipole and second moments about the coordinate origin (atomic units), and density + ESP
at fixed probe points (atomic units, positive ESP = repels a +1 charge).
"""
import json, pathlib
import numpy as np
from pyscf import gto, scf

HERE = pathlib.Path(__file__).resolve().parent.parent
REF = HERE / "tests" / "reference"
BOHR = 0.529177210903
geoms = json.loads((REF / "geometries.json").read_text())
BASES = ["sto-3g", "3-21g", "6-31g"]
BIG = {"hexafluorobenzene"}

def probes_for(coords_bohr):
    rng = np.random.default_rng(1)
    c = coords_bohr.mean(axis=0)
    fixed = np.array([[0, 0, 3.0], [0, 0, -4.5], [3.5, 0, 0], [0, -4, 1], [2.5, 2.5, 2.5], [-3, 2, -3], [6, 6, 0.5], [0.7, 0.3, 5.5]])
    pts = list(c + fixed)
    while len(pts) < 14:
        p = c + rng.uniform(-3.5, 3.5, 3)
        if np.min(np.linalg.norm(coords_bohr - p, axis=1)) > 0.6:
            pts.append(p)
    return np.array(pts)

for name, g in geoms.items():
    for bas in BASES:
        mol = gto.M(atom=[(a[0], tuple(a[1:])) for a in g["atoms"]], unit="Angstrom", basis=bas, charge=g["charge"], spin=0, verbose=0)
        mf = scf.RHF(mol)
        mf.conv_tol = 1e-12
        mf.conv_tol_grad = 1e-9
        mf.max_cycle = 300
        mf.kernel()
        assert mf.converged, (name, bas)
        dm = mf.make_rdm1()
        S = mol.intor("int1e_ovlp")
        pop_m, chg_m = mf.mulliken_pop(dm=dm, s=S, verbose=0)
        w, v = np.linalg.eigh(S)
        Sh = (v * np.sqrt(w)) @ v.T
        pl = np.diag(Sh @ dm @ Sh)
        chg_l = []
        for ia, (b0, b1, p0, p1) in enumerate(mol.aoslice_by_atom()):
            chg_l.append(float(mol.atom_charge(ia) - pl[p0:p1].sum()))
        coords = mol.atom_coords()  # bohr
        Z = np.array([mol.atom_charge(i) for i in range(mol.natm)], float)
        r = mol.intor("int1e_r", comp=3)
        dip = np.array([-np.einsum("ij,ij->", dm, r[k]) for k in range(3)]) + (Z[:, None] * coords).sum(axis=0)
        rr = mol.intor("int1e_rr", comp=9).reshape(3, 3, mol.nao, mol.nao)
        sec = np.array([[-np.einsum("ij,ij->", dm, rr[a, b]) + (Z * coords[:, a] * coords[:, b]).sum() for b in range(3)] for a in range(3)])
        pts = probes_for(coords)
        ao = mol.eval_gto("GTOval_sph", pts)
        rho = np.einsum("pi,ij,pj->p", ao, dm, ao)
        ints = mol.intor("int1e_grids", grids=pts)  # (ngrid, nao, nao): integral phi_i phi_j / |r - g|
        v_el = -np.einsum("gij,ij->g", ints, dm)
        v_nuc = np.array([(Z / np.linalg.norm(coords - p, axis=1)).sum() for p in pts])
        out = {
            "molecule": name, "basis": bas, "charge": g["charge"], "atoms": g["atoms"], "nbf": int(mol.nao), "nelec": int(sum(mol.nelec)),
            "e_tot": float(mf.e_tot), "e_nuc": float(mol.energy_nuc()), "mo_energy": [float(x) for x in mf.mo_energy],
            "mulliken": [float(x) for x in chg_m], "lowdin": chg_l,
            "dipole_au": [float(x) for x in dip], "second_moment_au": [[float(x) for x in row] for row in sec],
            "probes": [{"r_bohr": [float(x) for x in p], "rho": float(rr_), "esp": float(ve + vn)} for p, rr_, ve, vn in zip(pts, rho, v_el, v_nuc)],
        }
        (REF / f"{name}.{bas}.json").write_text(json.dumps(out, indent=None, separators=(",", ":")))
        print(f"{name:20s} {bas:7s} nbf={mol.nao:3d} E={mf.e_tot:.8f}")
