"""Precompute 2D side-chain drawings for the peptide structure diagram (run once; output is committed).

    python site/src/lib/ms/sidechains/generate_sidechains.py

Needs RDKit (pip install rdkit). Each residue is laid out by RDKit inside a fixed, straight backbone
(Ac-Xaa-NHMe with N, C-alpha, C and both carbonyl O pinned), so the side chain points "up" (+y) and avoids
the neighbouring C=O groups. Only side-chain atoms are exported, in bond-length units relative to C-alpha,
plus the bond that closes onto the backbone N for proline-like residues. The site renders these with
its own SVG (no chemistry library at runtime). See docs/DECISIONS.md ADR-009.
"""
import json
import os

from rdkit import Chem
from rdkit.Chem import rdDepictor
from rdkit.Geometry import Point2D

HERE = os.path.dirname(os.path.abspath(__file__))

# code -> side chain SMILES attached to C-alpha (first atom bonds to C-alpha).
SIDE = {
    "G": "", "A": "C", "S": "CO", "C": "CS", "T": "[C@H](O)C", "V": "C(C)C", "L": "CC(C)C", "I": "[C@@H](C)CC",
    "M": "CCSC", "N": "CC(N)=O", "D": "CC(=O)O", "Q": "CCC(N)=O", "E": "CCC(=O)O", "K": "CCCCN", "R": "CCCNC(=N)N",
    "H": "Cc1c[nH]cn1", "F": "Cc1ccccc1", "Y": "Cc1ccc(O)cc1", "W": "Cc1c[nH]c2ccccc12", "U": "C[SeH]",
    "O": "CCCCNC(=O)C1CCC=N1",
    "Orn": "CCCN", "Dab": "CCN", "Dap": "CN", "Abu": "CC", "Nva": "CCC", "Nle": "CCCC", "Hse": "CCO",
    "Cit": "CCCNC(N)=O", "Phg": "c1ccccc1", "Cha": "CC1CCCCC1", "Nal": "Cc1ccc2ccccc2c1", "Tle": "C(C)(C)C",
    "Bal": "",
    "Bmt": "C(O)C(C)CC=CC", "MeBmt": "C(O)C(C)CC=CC", "Hty": "CCc1ccc(O)cc1", "Hil": "CC(C)CC",
    "pY": "Cc1ccc(OP(=O)(O)O)cc1", "pT": "[C@H](OP(=O)(O)O)C", "pS": "COP(=O)(O)O",
    "hPheF5": "CCc1cc(F)c(C(F)(F)F)c(F)c1", "EtPhe4Me": "Cc1ccc(C)cc1", "MeAspNMe2": "CC(=O)N(C)C",
    "MeCpg": "C1CCCC1", "Hiv": "C(C)C", "Lac": "C",
    # modified residues (key = code+ModName as used by the renderer)
    "M+Oxidation": "CCS(C)=O", "M+Dioxidation": "CCS(C)(=O)=O", "S+Phospho": "COP(=O)(O)O", "T+Phospho": "[C@H](OP(=O)(O)O)C",
    "Y+Phospho": "Cc1ccc(OP(=O)(O)O)cc1", "C+Carbamidomethyl": "CSCC(N)=O", "K+Acetyl": "CCCCNC(C)=O",
    "K+Methyl": "CCCCNC", "K+Dimethyl": "CCCCN(C)C", "K+Trimethyl": "CCCC[N+](C)(C)C", "R+Methyl": "CCCNC(=N)NC",
    "R+Citrullination": "CCCNC(N)=O", "N+Deamidated": "CC(=O)O", "Q+Deamidated": "CCC(=O)O", "W+Oxidation": "Cc1c[nH]c2ccc(O)cc12",
    "Y+Nitro": "Cc1ccc(O)c([N+](=O)[O-])c1", "Y+Sulfo": "Cc1ccc(OS(=O)(=O)O)cc1", "K+GG": "CCCCNC(=O)CN",
    "K+Succinyl": "CCCCNC(=O)CCC(=O)O", "C+Disulfide": "CS",
}
# proline-like: side-chain atoms from C-alpha back to N (last atom bonds to N)
RING = {"P": "CCC", "Hyp": "CC(O)C", "pGlu": "CCC(=O)", "Aze": "CC"}
EMPTY = {"atoms": [], "bonds": [], "attach": None, "closesN": None, "bbox": [0, 0, 0, 0]}


def layout(code, smi, ring):
    # Ac-[N:2][CA:3](R)[C:4](=O:6)[N:5]C with Ac carbonyl C:1 and O:7
    if ring:
        core = f"C[C:1](=[O:7])[N:2]9[C@@H:3]({smi}9)[C:4](=[O:6])[NH:5]C"
    else:
        core = f"C[C:1](=[O:7])[NH:2][C@@H:3]({smi})[C:4](=[O:6])[NH:5]C"
    m = Chem.MolFromSmiles(core)
    assert m is not None, (code, core)
    idx = {a.GetAtomMapNum(): a.GetIdx() for a in m.GetAtoms() if a.GetAtomMapNum()}
    for a in m.GetAtoms():
        a.SetAtomMapNum(0)
    fixed = {1: (-2, 0), 2: (-1, 0), 3: (0, 0), 4: (1, 0), 5: (2, 0), 6: (1, 1), 7: (-2, 1)}
    s = 1.5  # RDKit's default bond length
    rdDepictor.Compute2DCoords(m, coordMap={idx[k]: Point2D(x * s, y * s) for k, (x, y) in fixed.items()})
    conf = m.GetConformer()
    ca = conf.GetAtomPosition(idx[3])
    backbone = set(idx.values())
    for k in (1, 5):  # methyl caps
        for nb in m.GetAtomWithIdx(idx[k]).GetNeighbors():
            backbone.add(nb.GetIdx())
    side = [a.GetIdx() for a in m.GetAtoms() if a.GetIdx() not in backbone]
    pos = {}
    for i in side:
        p = conf.GetAtomPosition(i)
        pos[i] = ((p.x - ca.x) / s, (p.y - ca.y) / s)
    if side and sum(pos[i][1] for i in side) < 0:  # make it point up
        pos = {i: (x, -y) for i, (x, y) in pos.items()}
    order = {i: k for k, i in enumerate(side)}
    atoms = []
    for i in side:
        a = m.GetAtomWithIdx(i)
        atoms.append({"el": a.GetSymbol(), "x": round(pos[i][0], 3), "y": round(pos[i][1], 3),
                      "h": a.GetTotalNumHs(), "q": a.GetFormalCharge(), "ar": a.GetIsAromatic()})
    mk = Chem.Mol(m)
    Chem.Kekulize(mk, clearAromaticFlags=True)
    bonds, attach, closes_n = [], None, None
    for b in mk.GetBonds():
        a1, a2 = b.GetBeginAtomIdx(), b.GetEndAtomIdx()
        if a1 in order and a2 in order:
            bonds.append({"a": order[a1], "b": order[a2], "o": b.GetBondTypeAsDouble(),
                          "ar": m.GetBondWithIdx(b.GetIdx()).GetIsAromatic()})
        elif idx[3] in (a1, a2) and (a1 in order or a2 in order):
            attach = order[a1] if a1 in order else order[a2]
        elif idx[2] in (a1, a2) and (a1 in order or a2 in order):
            closes_n = order[a1] if a1 in order else order[a2]
    xs = [a["x"] for a in atoms]
    ys = [a["y"] for a in atoms]
    return {"atoms": atoms, "bonds": bonds, "attach": attach, "closesN": closes_n,
            "bbox": [round(min(xs), 3), round(min(ys), 3), round(max(xs), 3), round(max(ys), 3)]}


def main():
    out = {}
    for code, smi in SIDE.items():
        out[code] = dict(EMPTY) if not smi else layout(code, smi, False)
    out["Sar"] = dict(EMPTY)
    # Aib: two methyls on C-alpha, drawn straight up and straight down (where H-alpha normally goes).
    out["Aib"] = {"atoms": [{"el": "C", "x": 0, "y": 1, "h": 3, "q": 0, "ar": False}, {"el": "C", "x": 0, "y": -1, "h": 3, "q": 0, "ar": False}],
                  "bonds": [], "attach": 0, "attach2": 1, "closesN": None, "bbox": [0, -1, 0, 1]}
    for code, smi in RING.items():
        out[code] = layout(code, smi, True)
    path = os.path.join(HERE, "sidechains.json")
    with open(path, "w", newline="\n", encoding="utf-8") as f:
        json.dump({"$comment": "Generated by generate_sidechains.py (RDKit). Units = bond lengths; origin = C-alpha; +y = away from backbone.",
                   "residues": out}, f, separators=(",", ":"))
    print(f"wrote {path}: {len(out)} residues, {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    main()
