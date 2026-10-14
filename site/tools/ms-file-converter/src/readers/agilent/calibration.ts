// TOF mass calibration of Agilent MassHunter data.
//   Traditional step:  m/z = (A · (t − t0))²            (A, t0 from DefaultMassCal.xml or per scan from MSMassCal.bin)
//   Polynomial step:   m/z −= Σ c_k · clip(t, left, right)^k  for the orders k whose bit is set in ValueUseFlags
//                      (coefficients fill the set bits in ascending order; 2730 = orders 1,3,5,7,9,11).
// t is the flight time in sampling-clock units. Validated against ProteoWizard (Agilent DLL) output to < 0.1 ppm.

export interface MassCal { coeff: number; base: number; left: number; right: number; poly: Array<[order: number, c: number]> }

const tagText = (xml: string, tag: string) => new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`).exec(xml)?.[1];

function polyFromFlags(flags: number, coeffs: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let k = 0;
  for (let bit = 0; bit < 31 && k < coeffs.length; bit++) if ((flags >> bit) & 1) out.push([bit, coeffs[k++]]);
  return out.filter(([, c]) => c !== 0 && Number.isFinite(c));
}

export interface DefaultCals { byId: Map<number, MassCal>; flags: Map<number, number> }

export function parseDefaultMassCal(xml: string): DefaultCals {
  const byId = new Map<number, MassCal>();
  const flags = new Map<number, number>();
  for (const m of xml.matchAll(/<DefaultCalibration\s+DefaultCalibrationID="(\d+)"\s*>([\s\S]*?)<\/DefaultCalibration>/g)) {
    const id = Number(m[1]);
    let trad: number[] = [], poly: number[] = [], f = 0;
    for (const s of m[2].matchAll(/<Step\b[^>]*>([\s\S]*?)<\/Step>/g)) {
      const vals = [...s[1].matchAll(/<Value\b[^>]*>\s*([^<]+?)\s*<\/Value>/g)].map((v) => Number(v[1]));
      const formula = tagText(s[1], 'CalibrationFormula');
      if (formula === 'Traditional') trad = vals;
      else if (formula === 'Polynomial') { poly = vals; f = Number(tagText(s[1], 'ValueUseFlags') ?? 0); }
    }
    if (trad.length < 2) continue;
    flags.set(id, f);
    byId.set(id, { coeff: trad[0], base: trad[1], left: poly[0] ?? -Infinity, right: poly[1] ?? Infinity, poly: polyFromFlags(f, poly.slice(2)) });
  }
  return { byId, flags };
}

/** One MSMassCal.bin row: int32 + 10 doubles (A, t0, left, right, c1..c6), 84 bytes. */
export function calFromRow(dv: DataView, off: number, flags: number): MassCal | null {
  if (off < 0 || off + 84 > dv.byteLength) return null;
  const d = (i: number) => dv.getFloat64(off + 4 + 8 * i, true);
  const coeff = d(0);
  if (!(coeff > 0) || !Number.isFinite(d(1))) return null;
  const coeffs = [d(4), d(5), d(6), d(7), d(8), d(9)];
  return { coeff, base: d(1), left: d(2), right: d(3), poly: polyFromFlags(flags, coeffs) };
}

export function tofToMz(t: number, c: MassCal): number {
  const x = c.coeff * (t - c.base);
  let mz = x * x;
  if (c.poly.length) {
    const tc = t < c.left ? c.left : t > c.right ? c.right : t;
    let corr = 0;
    for (const [k, ck] of c.poly) corr += ck * tc ** k;
    mz -= corr;
  }
  return mz;
}
