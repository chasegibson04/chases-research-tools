"""Maintainer-only: write tests/reference/geometries.json (fixed test geometries, Angstrom).

Needs RDKit (only for the molecules without a textbook geometry). Run once; the file is committed so the
unit tests never depend on any geometry generator.
    python scripts/gen_geometries.py
"""
import json, math, pathlib
from rdkit import Chem
from rdkit.Chem import AllChem

OUT = pathlib.Path(__file__).resolve().parent.parent / "tests" / "reference" / "geometries.json"

def ring(sym, x_sym, r_c, r_x):
    atoms = []
    for k in range(6):
        a = math.radians(60 * k)
        atoms.append(("C", r_c * math.cos(a), r_c * math.sin(a), 0.0))
    for k in range(6):
        a = math.radians(60 * k)
        atoms.append((x_sym, r_x * math.cos(a), r_x * math.sin(a), 0.0))
    return atoms

def from_smiles(smi, seed=7):
    m = Chem.AddHs(Chem.MolFromSmiles(smi))
    AllChem.EmbedMolecule(m, randomSeed=seed)
    AllChem.MMFFOptimizeMolecule(m, maxIters=2000)
    conf = m.GetConformer()
    atoms = [(a.GetSymbol(), *map(float, conf.GetAtomPosition(a.GetIdx()))) for a in m.GetAtoms()]
    return atoms, sum(a.GetFormalCharge() for a in m.GetAtoms())

geoms = {}
geoms["benzene"] = {"charge": 0, "atoms": ring("C", "H", 1.397, 1.397 + 1.084)}
geoms["hexafluorobenzene"] = {"charge": 0, "atoms": ring("C", "F", 1.394, 1.394 + 1.327)}
oh, ang = 0.9572, math.radians(104.52)
geoms["water"] = {"charge": 0, "atoms": [("O", 0, 0, 0), ("H", oh * math.sin(ang / 2), oh * math.cos(ang / 2), 0), ("H", -oh * math.sin(ang / 2), oh * math.cos(ang / 2), 0)]}
t = 1.087 / math.sqrt(3)
geoms["methane"] = {"charge": 0, "atoms": [("C", 0, 0, 0), ("H", t, t, t), ("H", -t, -t, t), ("H", -t, t, -t), ("H", t, -t, -t)]}
t = 1.032 / math.sqrt(3)
geoms["ammonium"] = {"charge": 1, "atoms": [("N", 0, 0, 0), ("H", t, t, t), ("H", -t, -t, t), ("H", -t, t, -t), ("H", t, -t, -t)]}
for name, smi in {
    "methanol": "CO", "formamide": "NC=O", "acetate": "CC(=O)[O-]", "fluorobenzene": "Fc1ccccc1",
    "chloromethane": "CCl", "methanethiol": "CS", "ethene": "C=C", "pyridine": "c1ccncc1", "phenol": "Oc1ccccc1",
}.items():
    atoms, chg = from_smiles(smi)
    geoms[name] = {"charge": chg, "atoms": atoms}
geoms["sodium-cation"] = {"charge": 1, "atoms": [("Na", 0, 0, 0)]}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(geoms, indent=1))
print("wrote", OUT, list(geoms))
