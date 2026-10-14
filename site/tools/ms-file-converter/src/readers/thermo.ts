// Thermo .raw via OpenTFRaw compiled to WASM (src/runtime/rust, Apache-2.0). The file stays a Blob: the WASM
// side asks for byte ranges, served synchronously with FileReaderSync (available in workers). Outside a worker
// (unit tests) the file is read into memory once.
import { rangeSet } from '../filters';
import { CV, readHead, asciiOf, type CvParam, type Precursor, type InputFormat, type SpectrumRecord, type RunMetadata } from '../model';

interface ScanJson {
  scan: number; msLevel: number; polarity: '+' | '-' | ''; profile: boolean; analyzer: string; filter: string | null; rtMin: number;
  tic: number; basePeakMz: number; basePeakIntensity: number; lowMz: number; highMz: number; injectionTimeMs: number | null; faimsCv: number | null;
  isDia: boolean; resolution: number | null; reactions: Array<{ mz: number; energy: number; isolationWidth?: number; energyValid?: boolean; type?: string; supplemental?: boolean }>;
  precursor: null | { targetMz: number | null; selectedMz: number | null; isolationWidth: number | null; charge: number | null; energy: number | null; energyIsNce: boolean; masterScan: number | null; activation: string };
}

const ACT: Record<string, CvParam[]> = { HCD: [CV.hcd], CID: [CV.cid], ETD: [CV.etd], EThcD: [CV.etd, { accession: 'MS:1002678', name: 'supplemental beam-type collision-induced dissociation' }] };
const ANALYZER: Record<string, CvParam> = {
  FTMS: { accession: 'MS:1000484', name: 'orbitrap' }, ITMS: { accession: 'MS:1000264', name: 'ion trap' },
  TQMS: { accession: 'MS:1000081', name: 'quadrupole' }, SQMS: { accession: 'MS:1000081', name: 'quadrupole' },
  TOFMS: { accession: 'MS:1000084', name: 'time-of-flight' }, Sector: { accession: 'MS:1000080', name: 'magnetic sector' },
};

/** Primary-activation cvParams per Thermo ActivationType (the IR laser of Orbitrap tribrids is "mode C"). */
const PRIMARY: Record<string, CvParam> = {
  CID: CV.cid, HCD: CV.hcd, ETD: CV.etd, ECD: CV.ecd, MPD: CV.irmpd, ModeC: CV.irmpd, UVPD: CV.uvpd,
  PQD: { accession: 'MS:1000599', name: 'pulsed q dissociation' }, NETD: { accession: 'MS:1003247', name: 'negative electron transfer dissociation' },
};
const SUPPLEMENTAL: Record<string, CvParam> = {
  HCD: { accession: 'MS:1002678', name: 'supplemental beam-type collision-induced dissociation' },
  CID: { accession: 'MS:1002679', name: 'supplemental collision-induced dissociation' },
};
const FILTER_CODE: Record<string, string> = { CID: 'cid', HCD: 'hcd', ETD: 'etd', ECD: 'ecd', MPD: 'mpd', PQD: 'pqd', UVPD: 'uvpd', NETD: 'netd', PTR: 'ptr', SA: 'sa', ModeA: 'modeA', ModeB: 'modeB', ModeC: 'modeC', ModeD: 'modeD' };
const isElectron = (t?: string) => t === 'ETD' || t === 'ECD' || t === 'NETD';

/**
 * Stages and supplemental steps from the decoded reaction records (one non-supplemental record per MSn stage;
 * supplemental records such as the HCD of EThcD follow their stage).
 */
function stagesOf(s: ScanJson) {
  const rx = s.reactions.filter((r) => r.type);
  if (!rx.length || s.msLevel < 2) return null;
  // Supplemental steps are flagged per record and belong to the stage before them.
  const stages: Array<ScanJson['reactions'][number] & { sup: ScanJson['reactions'] }> = [];
  for (const r of rx) {
    if (!r.supplemental || !stages.length) stages.push({ ...r, sup: [] });
    else stages[stages.length - 1].sup.push(r);
  }
  const last = stages[stages.length - 1];
  return { stages, supplemental: last.sup, anySupplemental: stages.some((st) => st.sup.length > 0) };
}
function activationOf(st: { type?: string; energy: number }, sup: Array<{ type?: string; energy: number }>): { cv: CvParam[]; ce?: number; user: Array<{ name: string; value: string }> } {
  const cv: CvParam[] = [];
  const user: Array<{ name: string; value: string }> = [];
  if (PRIMARY[st.type!]) cv.push(PRIMARY[st.type!]); else user.push({ name: 'Thermo activation type', value: st.type! });
  if (st.type?.startsWith('Mode')) user.push({ name: 'Thermo activation type', value: st.type });
  let ce: number | undefined;
  if (isElectron(st.type)) user.push({ name: 'ETD reaction time (ms)', value: String(st.energy) }); else ce = st.energy;
  // mzML has one supplemental-energy term: the first supplemental step that has a CV term gets it (HCD of
  // IR-EThcD); other supplemental steps are described as userParams with their energy.
  let energyWritten = false;
  for (const x of sup) {
    const term = SUPPLEMENTAL[x.type!];
    if (term && !energyWritten) {
      cv.push(term, { accession: 'MS:1002680', name: 'supplemental collision energy', value: String(x.energy), unitAccession: 'UO:0000266', unitName: 'electronvolt' });
      energyWritten = true;
    } else {
      const name = x.type === 'ModeC' || x.type === 'MPD' ? 'infrared multiphoton dissociation' : term?.name ?? x.type!;
      user.push({ name: 'supplemental activation', value: `${name} (${x.energy})` });
    }
  }
  // IR-only supplemental (IR-ETD): keep the energy as the supplemental energy term, like other converters.
  if (!energyWritten && sup.length) cv.push({ accession: 'MS:1002680', name: 'supplemental collision energy', value: String(sup[0].energy), unitAccession: 'UO:0000266', unitName: 'electronvolt' });
  return { cv, ce, user };
}
/** Rewrite the "mz@act energy" part of a filter string from the decoded reactions (OpenTFRaw guesses it). */
function fixFilter(filter: string | null, g: NonNullable<ReturnType<typeof stagesOf>>): string | null {
  if (!filter) return filter;
  const part = (r: { type?: string; energy: number }) => `@${FILTER_CODE[r.type!] ?? r.type!.toLowerCase()}${r.energy.toFixed(2)}`;
  const groups = g.stages.map((st) => `${st.mz.toFixed(4)}${part(st)}${st.sup.map(part).join('')}`);
  // Multiplexed MS2 (several reactions at one MS level) carries the "msx" token.
  if (g.stages.length > 1 && /\sms2\s/.test(filter) && !/\smsx\s/.test(filter)) filter = filter.replace(/\sms2\s/, ' msx ms2 ');
  // Thermo marks supplemental activation with an "sa" token before the scan type.
  if (g.anySupplemental && !/\ssa\s/.test(filter)) filter = filter.replace(/\s(Full|SIM|SRM|Z)\s/, ' sa $1 ');
  return filter.replace(/(\d+\.\d+@[a-zA-Z]+-?[\d.]+(?:@[a-zA-Z]+-?[\d.]+)*\s*)+/, `${groups.join(' ')} `).replace(/\s+\[/, ' [');
}

/** SPS ions of a synchronous-precursor-selection MS3 scan, from the trailer ("SPS Masses" + "SPS Masses Continued"). */
function spsMasses(trailerJson: string): number[] {
  try {
    const t = JSON.parse(trailerJson) as Record<string, unknown>;
    return `${t['SPS Masses'] ?? ''},${t['SPS Masses Continued'] ?? ''}`.split(',').map((x) => Number(x.trim())).filter((x) => x > 0);
  } catch { return []; }
}
const isoOf = (mz: number, width?: number) => ({ isolationTarget: mz, isolationLower: width ? width / 2 : undefined, isolationUpper: width ? width / 2 : undefined });

/**
 * Precursor list in ProteoWizard's order. MS2: the one precursor (trailer monoisotopic m/z and charge).
 * Multiplexed MS2 (MSX, several reactions): every multiplexed precursor, last acquired first.
 * MS3+: the final stage first (each SPS ion when present), then earlier stages; the first stage carries the
 * trailer's monoisotopic m/z and charge, which describe the MS2 precursor.
 */
function precursorsOf(s: ScanJson, pr: ScanJson['precursor'], g: ReturnType<typeof stagesOf>, last: ReturnType<typeof activationOf> | null, sps: number[]): Precursor[] {
  if (!pr || s.msLevel < 2) return [];
  const ref = pr.masterScan ? `controllerType=0 controllerNumber=1 scan=${pr.masterScan}` : undefined;
  const primary: Precursor = {
    mz: pr.selectedMz ?? pr.targetMz ?? 0, charge: pr.charge ?? undefined, isolationTarget: pr.targetMz ?? undefined,
    isolationLower: pr.isolationWidth ? pr.isolationWidth / 2 : undefined, isolationUpper: pr.isolationWidth ? pr.isolationWidth / 2 : undefined,
    activation: last?.cv ?? ACT[pr.activation] ?? [], collisionEnergy: last ? last.ce : pr.energy ?? undefined, spectrumRef: ref,
  };
  if (!g || g.stages.length === 1) return [primary];
  const stage = (st: (typeof g.stages)[number], mz = st.mz): Precursor => { const a = activationOf(st, st.sup); return { mz, ...isoOf(mz, st.isolationWidth), activation: a.cv, collisionEnergy: a.ce, spectrumRef: ref }; };
  if (s.msLevel === 2) return [...g.stages].reverse().map((st) => stage(st));
  const fin = g.stages[g.stages.length - 1];
  const finals = (sps.length ? [...sps].reverse() : [fin.mz]).map((mz) => stage(fin, mz));
  const earlier = g.stages.slice(0, -1).reverse().map((st, i, arr) => {
    const p = stage(st);
    if (i === arr.length - 1) { p.mz = pr.selectedMz && Math.abs(pr.selectedMz - st.mz) < 5 ? pr.selectedMz : st.mz; p.charge = pr.charge ?? undefined; }
    return p;
  });
  return [...finals, ...earlier];
}

function syncReader(file: Blob, whole: Uint8Array | null): (off: number, n: number) => Uint8Array {
  if (whole) return (off, n) => whole.subarray(off, off + n);
  const frs = new (globalThis as any).FileReaderSync();
  return (off, n) => new Uint8Array(frs.readAsArrayBuffer(file.slice(off, off + n)));
}

let wasmMod: Promise<any> | null = null;
/** Instantiate the WASM once per worker. In Node (unit tests) the .wasm is read from disk instead of fetched. */
function loadThermo() {
  wasmMod ??= (async () => {
    const mod = await import('../runtime/pkg/thermo_raw_wasm.js');
    const url = new URL('../runtime/pkg/thermo_raw_wasm_bg.wasm', import.meta.url);
    if (url.protocol === 'file:') {
      const fsName = 'node:fs/promises';
      const fs = await import(/* @vite-ignore */ fsName);
      await mod.default({ module_or_path: await fs.readFile(url) });
    } else await mod.default({ module_or_path: url });
    return mod;
  })();
  return wasmMod;
}

/** `vendorCentroidLevels`: return the centroids stored in the file (Thermo's own peak picking) at these MS levels. */
export function createThermo(opts: { vendorCentroidLevels?: string } = {}): InputFormat {
  const vendorAt = opts.vendorCentroidLevels != null ? rangeSet(opts.vendorCentroidLevels) : () => false;
  return {
  id: 'Thermo RAW', label: 'Thermo .raw',
  async detect(input) {
    if (input.files.length !== 1) return false;
    const h = await readHead(input.files[0].file, 64);
    // Header: UTF-16LE "Finnigan" after a 2-byte magic (0xA101).
    return h[0] === 0x01 && h[1] === 0xa1 && asciiOf(h.filter((_, i) => i >= 2 && i % 2 === 0).slice(0, 8)) === 'Finnigan';
  },
  async open(input, ctx) {
    const file = input.files[0].file;
    ctx.progress(0, 'Loading Thermo reader');
    const wasm = await loadThermo();
    const whole = typeof (globalThis as any).FileReaderSync === 'function' ? null : new Uint8Array(await file.arrayBuffer());
    const raw = new wasm.ThermoRaw(syncReader(file, whole), file.size);
    const m = JSON.parse(raw.metaJson());
    const n: number = raw.scanCount();
    const meta: RunMetadata = {
      sourceFormat: 'Thermo RAW',
      sourceFiles: [{ id: 'RAW1', name: input.name, nativeIdFormat: { accession: 'MS:1000768', name: 'Thermo nativeID format' }, fileFormat: { accession: 'MS:1000563', name: 'Thermo RAW format' } }],
      instrument: { name: m.instrumentModel ?? m.deviceFamily, model: { accession: 'MS:1000483', name: 'Thermo Fisher Scientific instrument model' } },
      software: [{ id: 'Xcalibur', name: 'Xcalibur', version: '', cv: { accession: 'MS:1000532', name: 'Xcalibur' } }, { id: 'OpenTFRaw', name: 'OpenTFRaw', version: '3.0.0' }],
      startTimeStamp: m.startTimeStamp ?? undefined,
      sampleName: m.sampleId || undefined,
      extra: Object.fromEntries(Object.entries({
        'raw file version': m.version, 'instrument method': m.instMethod || m.methodName, 'processing method': m.procMethod, vial: m.vial, comment: m.sampleComment,
        'instrument method text': m.methodText,
      }).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])),
    };
    return {
      meta, count: n,
      close() { raw.free(); },
      async *spectra() {
        for (let i = 0; i < n; i++) {
          if (ctx.signal.aborted) throw new Error('Cancelled.');
          const s: ScanJson = JSON.parse(raw.scanJson(i));
          // profile unless Thermo's stored centroids were requested for this MS level (msconvert peakPicking vendor)
          let p: Float64Array;
          if (s.profile && vendorAt(s.msLevel)) {
            p = raw.peaks(i, false);
            // Ion-trap profile scans carry no stored centroids: keep the profile so the peakPicking filter centroids it.
            if (p[0] > 0) s.profile = false; else p = raw.peaks(i, true);
          } else p = raw.peaks(i, s.profile);
          const k = p[0];
          const pr = s.precursor;
          // Like ProteoWizard, distrust a trailer monoisotopic m/z that lies well outside the isolation window
          // (instrument mis-assignment); fall back to the isolation target and keep the trailer value as a userParam.
          let trailerMono: number | null = null;
          // The scan event's reaction m/z is the isolation centre (the filter-string value).
          const rx = s.reactions[s.reactions.length - 1]?.mz;
          if (pr && rx && rx > 0 && Math.abs(rx - (pr.targetMz ?? rx)) > 1e-4) pr.targetMz = rx;
          if (pr?.selectedMz != null && pr.targetMz != null && pr.selectedMz !== pr.targetMz) {
            const allowed = (pr.isolationWidth ?? 2) / 2 + 3 / Math.max(1, pr.charge ?? 1);
            if (Math.abs(pr.selectedMz - pr.targetMz) > allowed) { trailerMono = pr.selectedMz; pr.selectedMz = pr.targetMz; }
          }
          const g = stagesOf(s);
          const last = g ? activationOf(g.stages[g.stages.length - 1], g.supplemental) : null;
          const filter = g ? fixFilter(s.filter, g) : s.filter;
          const rec: SpectrumRecord = {
            index: i, nativeId: `controllerType=0 controllerNumber=1 scan=${s.scan}`, scan: s.scan, msLevel: s.msLevel, rtSeconds: s.rtMin * 60,
            polarity: s.polarity || undefined, centroided: !s.profile, filter: filter ?? undefined, tic: s.tic, basePeakMz: s.basePeakMz, basePeakIntensity: s.basePeakIntensity,
            lowMz: s.lowMz, highMz: s.highMz, scanWindow: [s.lowMz, s.highMz], injectionTimeMs: s.injectionTimeMs ?? undefined, faimsCv: s.faimsCv ?? undefined,
            precursors: precursorsOf(s, pr, g, last, s.msLevel >= 3 ? spsMasses(raw.trailerJson(i)) : []),
            mz: p.slice(1, 1 + k), intensity: p.slice(1 + k, 1 + 2 * k),
            userParams: [
              ...(ANALYZER[s.analyzer] ? [{ name: 'mass analyzer', value: ANALYZER[s.analyzer].name }] : []),
              ...(last?.user ?? []),
              ...(s.resolution ? [{ name: 'FT resolution', value: String(s.resolution) }] : []),
              ...(pr?.energyIsNce ? [{ name: 'normalized collision energy', value: String(pr.energy) }] : []),
              ...(s.isDia ? [{ name: 'data independent acquisition', value: 'true' }] : []),
              ...(trailerMono != null ? [{ name: '[Thermo Trailer Extra]Monoisotopic M/Z:', value: String(trailerMono) }] : []),
            ],
          };
          yield rec;
          if (i % 50 === 0) ctx.progress(i / n, `Scan ${i + 1}/${n}`);
        }
      },
    };
  },
};
}
export const thermoFormat = createThermo();
