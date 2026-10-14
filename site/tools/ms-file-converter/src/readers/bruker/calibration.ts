// TOF index → m/z and TIMS scan → 1/K0 conversions for Bruker timsTOF data.
//
// timsrust (MIT, MannLabs; crates/timsrust-tdf/src/calibration.rs) only offers an *uncalibrated* sqrt-linear
// TOF→m/z mapping between the acquisition-range bounds and a linear scan→1/K0 mapping, which are tens to hundreds
// of ppm (and ~1% in 1/K0) away from Bruker's SDK. The models below use the MzCalibration / TimsCalibration tables
// instead. Their functional forms were fitted against ProteoWizard (Bruker TIMS SDK) reference mzML files in the
// pwiz test corpus, where they reproduce the SDK to ≤0.06 ppm (32-bit references: bit-exact for >99.9% of points)
// and 1/K0 to <1e-12. See tests/bruker.test.ts for the comparison.
import type { Row } from './sqlite';

const n = (v: unknown, d = 0) => (v == null || v === '' ? d : Number(v));

/**
 * m/z from a (possibly fractional) TOF index for one frame.
 *   t = tof·DigitizerTimebase + DigitizerDelay                              (ns)
 *   t = C0 + sqrt(1e12/C1)·sqrt(m + s) + C2·m                               (solved for m; s = C4 for ModelType 1)
 *   m ← m·(1 − 1e-6·(dC1·(T1frame − T1cal) + dC2·(T2frame − T2cal)))       (temperature drift, ppm/K)
 *   ModelType 2 (TSF, newer firmware): m ← m − P(m), P = Σ C(8+k)·m^k (k < C7) inside [C5, C6] m/z, with a
 *   Gaussian (σ≈1 m/z) roll-off of the edge value outside that range (fitted; the SDK's exact taper is unknown).
 */
export class MzConverter {
  private readonly tb: number; private readonly delay: number; private readonly B: number;
  private readonly c0: number; private readonly c2: number; private readonly shift: number;
  private readonly scale: number;
  private readonly poly: number[] | null; private readonly lo: number; private readonly hi: number;
  private readonly pLo: number; private readonly pHi: number;

  constructor(cal: Row, frameT1: number, frameT2: number) {
    const model = n(cal.ModelType, 1);
    this.tb = n(cal.DigitizerTimebase, 0.2); this.delay = n(cal.DigitizerDelay);
    this.B = Math.sqrt(1e12 / n(cal.C1, 1)); this.c0 = n(cal.C0); this.c2 = n(cal.C2);
    this.shift = model === 1 ? n(cal.C4) : 0;
    const drift = n(cal.dC1) * (frameT1 - n(cal.T1)) + n(cal.dC2) * (frameT2 - n(cal.T2));
    this.scale = 1 - drift * 1e-6;
    this.poly = null; this.lo = 0; this.hi = 0; this.pLo = 0; this.pHi = 0;
    if (model === 2 && cal.C7 != null) {
      const deg = Math.round(n(cal.C7));
      const co: number[] = [];
      for (let k = 0; k < deg; k++) co.push(n(cal[`C${8 + k}`]));
      if (co.some((c) => c !== 0)) {
        this.poly = co; this.lo = n(cal.C5); this.hi = n(cal.C6);
        this.pLo = this.evalPoly(this.lo); this.pHi = this.evalPoly(this.hi);
      }
    }
  }

  private evalPoly(m: number): number {
    const c = this.poly!;
    let s = 0;
    for (let k = c.length - 1; k >= 0; k--) s = s * m + c[k];
    return s;
  }

  convert(tof: number): number {
    const t = tof * this.tb + this.delay;
    let x: number;
    if (this.c2 !== 0) {
      // C2·x² + B·x + (C0 − C2·s − t) = 0 with x = sqrt(m + s); numerically stable root.
      const c = this.c0 - this.c2 * this.shift - t;
      const disc = this.B * this.B - 4 * this.c2 * c;
      x = (-2 * c) / (this.B + Math.sqrt(Math.max(0, disc)));
    } else x = (t - this.c0) / this.B;
    let m = (x * x - this.shift) * this.scale;
    if (this.poly) {
      if (m >= this.lo && m <= this.hi) m -= this.evalPoly(m);
      else if (m < this.lo) { const d = this.lo - m; m -= this.pLo * Math.exp(-d * d); }
      else { const d = m - this.hi; m -= this.pHi * Math.exp(-d * d); }
    }
    return m;
  }
}

/**
 * 1/K0 (V·s/cm²) from a 0-based TIMS scan index (fractional allowed), TimsCalibration ModelType 2:
 *   U = C2 + (C3 − C2)·(scan − C4 − C0)/C1 ;  1/K0 = 1/(C6 + C7/U)
 * Other model types fall back to timsrust's linear mapping between OneOverK0AcqRangeUpper (scan 0) and
 * OneOverK0AcqRangeLower (last scan) — ported from timsrust (MIT, MannLabs) calibration.rs.
 */
export class ImConverter {
  private readonly f: (scan: number) => number;
  constructor(cal: Row | undefined, imLower: number, imUpper: number, maxScan: number) {
    if (cal && n(cal.ModelType) === 2) {
      const C = (k: number) => n(cal[`C${k}`]);
      const c0 = C(0), c1 = C(1) || 1, c2 = C(2), c3 = C(3), c4 = C(4), c6 = C(6), c7 = C(7);
      this.f = (s) => { const u = c2 + ((c3 - c2) * (s - c4 - c0)) / c1; return 1 / (c6 + c7 / u); };
    } else {
      const slope = (imLower - imUpper) / Math.max(1, maxScan - 1);
      this.f = (s) => imUpper + slope * s;
    }
  }
  convert(scan: number): number { return this.f(scan); }
}
