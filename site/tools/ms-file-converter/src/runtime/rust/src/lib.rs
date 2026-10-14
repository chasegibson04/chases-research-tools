//! wasm-bindgen wrapper around OpenTFRaw (Apache-2.0, https://github.com/Sigilweaver/OpenTFRaw) so the MS File
//! Converter can read Thermo .raw files in a Web Worker. The file is never copied into WASM memory: reads go
//! through a JS callback `read(offset, length) -> Uint8Array` (FileReaderSync over a Blob slice), with a small
//! block cache so the parser's many small reads stay cheap.
use opentfraw::mzml::{extract_spectrum, scan_metadata};
use opentfraw::generic_data::GenericValue;
use opentfraw::{Activation, Analyzer, Polarity, RawFileReader, ScanMode};
use serde_json::{json, Value};
use std::io::{self, Read, Seek, SeekFrom};
use wasm_bindgen::prelude::*;

const BLOCK: u64 = 1 << 20;

struct JsSource {
    read: js_sys::Function,
    len: u64,
    pos: u64,
    block_start: u64,
    block: Vec<u8>,
}

impl JsSource {
    fn fill(&mut self, at: u64) -> io::Result<()> {
        let start = at - at % BLOCK;
        let n = BLOCK.min(self.len.saturating_sub(start));
        let out = self
            .read
            .call2(&JsValue::NULL, &JsValue::from_f64(start as f64), &JsValue::from_f64(n as f64))
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("{e:?}")))?;
        self.block = js_sys::Uint8Array::new(&out).to_vec();
        self.block_start = start;
        Ok(())
    }
}

impl Read for JsSource {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos >= self.len || buf.is_empty() {
            return Ok(0);
        }
        // Large reads (profile packets) bypass the cache.
        if buf.len() as u64 > BLOCK {
            let n = (buf.len() as u64).min(self.len - self.pos);
            let out = self
                .read
                .call2(&JsValue::NULL, &JsValue::from_f64(self.pos as f64), &JsValue::from_f64(n as f64))
                .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("{e:?}")))?;
            let arr = js_sys::Uint8Array::new(&out);
            let got = arr.length() as usize;
            arr.copy_to(&mut buf[..got]);
            self.pos += got as u64;
            return Ok(got);
        }
        let in_block = self.pos >= self.block_start && self.pos < self.block_start + self.block.len() as u64;
        if !in_block {
            self.fill(self.pos)?;
        }
        let off = (self.pos - self.block_start) as usize;
        let n = buf.len().min(self.block.len() - off);
        buf[..n].copy_from_slice(&self.block[off..off + n]);
        self.pos += n as u64;
        Ok(n)
    }
}

impl Seek for JsSource {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let p = match to {
            SeekFrom::Start(o) => o as i128,
            SeekFrom::End(o) => self.len as i128 + o as i128,
            SeekFrom::Current(o) => self.pos as i128 + o as i128,
        };
        if p < 0 {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "seek before start"));
        }
        self.pos = p as u64;
        Ok(self.pos)
    }
}

/// Thermo ActivationType enum (RawFileReader): the reaction flags store (type << 1) | energy-valid.
const ACTIVATION_TYPES: [&str; 16] = ["CID", "MPD", "ECD", "PQD", "ETD", "HCD", "Any", "SA", "PTR", "NETD", "NPTR", "UVPD", "ModeA", "ModeB", "ModeC", "ModeD"];

/// Decode the 56-byte reaction records of a v66 dependent event body: u32 count, then per reaction
/// m/z (f64), isolation width (f64), energy (f64), flags (byte 24 = type << 1 | valid; byte 25 bit 4 = supplemental), padding.
/// Layout found by comparing events of known activation (HCD, CID, ETD, EThcD, ETciD, IR-ETD, IRMPD) on an
/// Orbitrap tribrid; accepted only when the first record's m/z agrees with OpenTFRaw's precursor.
fn decode_reactions(body: &[u8], expect_mz: Option<f64>) -> Option<Vec<Value>> {
    const STRIDE: usize = 56;
    let rd = |o: usize| body.get(o..o + 8).map(|b| f64::from_le_bytes(b.try_into().unwrap()));
    let n = u32::from_le_bytes(body.get(0..4)?.try_into().ok()?) as usize;
    if n == 0 || n > 8 || 4 + n * STRIDE > body.len() {
        return None;
    }
    let mz0 = rd(4)?;
    if let Some(e) = expect_mz {
        if (mz0 - e).abs() > 0.01 {
            return None;
        }
    }
    let mut out = Vec::new();
    for i in 0..n {
        let b = 4 + i * STRIDE;
        let (mz, width, energy) = (rd(b)?, rd(b + 8)?, rd(b + 16)?);
        let flags = *body.get(b + 24)?;
        // byte 25 bit 4 marks a supplemental activation of the preceding stage (EThcD, ETciD, IR-ETD)
        let supplemental = body.get(b + 25).is_some_and(|x| x & 0x10 != 0);
        let t = (flags >> 1) as usize;
        if !(mz.is_finite() && width.is_finite() && energy.is_finite()) || t >= ACTIVATION_TYPES.len() {
            return None;
        }
        out.push(json!({ "mz": mz, "isolationWidth": width, "energy": energy, "energyValid": flags & 1 == 1, "type": ACTIVATION_TYPES[t], "supplemental": supplemental }));
    }
    Some(out)
}

#[wasm_bindgen]
pub struct ThermoRaw {
    raw: RawFileReader,
    src: JsSource,
}

fn act(a: Option<Activation>, analyzer: Option<Analyzer>) -> &'static str {
    match a {
        Some(Activation::HCD) => "HCD",
        Some(Activation::CID) if analyzer == Some(Analyzer::FTMS) => "HCD",
        Some(Activation::CID) => "CID",
        Some(Activation::ETD) => "ETD",
        Some(Activation::EThcD) => "EThcD",
        _ => "",
    }
}
fn analyzer_name(a: Option<Analyzer>) -> &'static str {
    match a {
        Some(Analyzer::ITMS) => "ITMS",
        Some(Analyzer::TQMS) => "TQMS",
        Some(Analyzer::SQMS) => "SQMS",
        Some(Analyzer::TOFMS) => "TOFMS",
        Some(Analyzer::FTMS) => "FTMS",
        Some(Analyzer::Sector) => "Sector",
        _ => "",
    }
}

#[wasm_bindgen]
impl ThermoRaw {
    /// Open a .raw file of `len` bytes; `read(offset, length)` must return a Uint8Array synchronously.
    #[wasm_bindgen(constructor)]
    pub fn new(read: js_sys::Function, len: f64) -> Result<ThermoRaw, JsError> {
        let mut src = JsSource { read, len: len as u64, pos: 0, block_start: 0, block: Vec::new() };
        let raw = RawFileReader::open(&mut src).map_err(|e| JsError::new(&format!("Could not open Thermo RAW: {e}")))?;
        Ok(ThermoRaw { raw, src })
    }

    #[wasm_bindgen(js_name = scanCount)]
    pub fn scan_count(&self) -> u32 {
        self.raw.num_scans
    }

    /// Run-level metadata as JSON.
    #[wasm_bindgen(js_name = metaJson)]
    pub fn meta_json(&mut self) -> String {
        let r = &self.raw;
        let method = r.instrument_method_text(&mut self.src).ok().flatten();
        let si = &r.run_header.sample_info;
        let v: Value = json!({
            "version": r.version,
            "instrumentModel": r.instrument_model,
            "deviceFamily": format!("{:?}", r.device_family),
            "startTimeStamp": r.raw_file_info.preamble.acquisition_date_rfc3339(),
            "firstScan": si.first_scan_number,
            "lastScan": si.last_scan_number,
            "sampleId": r.seq_row.id,
            "sampleComment": r.seq_row.comment,
            "vial": r.seq_row.vial,
            "instMethod": r.seq_row.inst_method,
            "procMethod": r.seq_row.proc_method,
            "fileName": r.seq_row.file_name,
            "methodName": r.instrument_method_name(),
            "methodText": method,
            "scanFormat": format!("{:?}", r.scan_format),
        });
        v.to_string()
    }

    /// Per-scan metadata (no peaks) as JSON; `idx` is 0-based.
    #[wasm_bindgen(js_name = scanJson)]
    pub fn scan_json(&self, idx: u32) -> String {
        let Some(m) = scan_metadata(&self.raw, idx) else { return "null".into() };
        let p = m.precursor.as_ref();
        let params = self.raw.scan_params(m.scan_number);
        let event = self.raw.scan_events.get(idx as usize);
        let decoded = event.and_then(|e| decode_reactions(e.body(), e.reactions().first().map(|r| r.precursor_mz())));
        let reactions: Vec<Value> = match (&decoded, event) {
            (Some(d), _) => d.clone(),
            (None, Some(e)) => e.reactions().iter().map(|r| json!({ "mz": r.precursor_mz(), "energy": r.energy() })).collect(),
            _ => Vec::new(),
        };
        let v: Value = json!({
            "scan": m.scan_number,
            "msLevel": m.ms_level,
            "polarity": match m.polarity { Some(Polarity::Positive) => "+", Some(Polarity::Negative) => "-", _ => "" },
            "profile": matches!(m.scan_mode, Some(ScanMode::Profile)),
            "analyzer": analyzer_name(m.analyzer),
            "filter": m.filter,
            "rtMin": m.retention_time_min,
            "tic": m.total_ion_current,
            "basePeakMz": m.base_peak_mz,
            "basePeakIntensity": m.base_peak_intensity,
            "lowMz": m.low_mz,
            "highMz": m.high_mz,
            "injectionTimeMs": m.ion_injection_time_ms,
            "faimsCv": m.faims_cv,
            "isDia": m.is_dia,
            "reactions": reactions,
            "resolution": params.as_ref().and_then(|p| p.ft_resolution()),
            "precursor": p.map(|p| json!({
                "targetMz": p.target_mz,
                "selectedMz": p.selected_mz,
                "isolationWidth": p.isolation_width,
                "charge": p.charge,
                "energy": p.collision_energy,
                "energyIsNce": p.ce_is_nce,
                "masterScan": p.master_scan_number,
                "activation": act(p.activation, p.analyzer),
            })),
        });
        v.to_string()
    }

    /// The scan's trailer extra ("Trailer Extra" in Xcalibur) as JSON {label: value}; `idx` is 0-based.
    #[wasm_bindgen(js_name = trailerJson)]
    pub fn trailer_json(&self, idx: u32) -> String {
        let first = self.raw.run_header.sample_info.first_scan_number;
        let Some(rec) = self.raw.scan_parameters(first + idx) else { return "{}".into() };
        let mut m = serde_json::Map::new();
        for (label, v) in &rec.values {
            let val = match v {
                GenericValue::Gap => continue,
                GenericValue::Int8(x) => json!(x),
                GenericValue::Bool(x) => json!(x),
                GenericValue::UInt8(x) => json!(x),
                GenericValue::Int16(x) => json!(x),
                GenericValue::UInt16(x) => json!(x),
                GenericValue::Int32(x) => json!(x),
                GenericValue::UInt32(x) => json!(x),
                GenericValue::Float32(x) => json!(x),
                GenericValue::Float64(x) => json!(x),
                GenericValue::String(x) => json!(x),
                _ => continue,
            };
            m.insert(label.trim_end_matches(':').trim().to_string(), val);
        }
        Value::Object(m).to_string()
    }

    /// Raw scan-event bytes: preamble followed by the v66 body (activation decoding).
    #[wasm_bindgen(js_name = eventBytes)]
    pub fn event_bytes(&self, idx: u32) -> Vec<u8> {
        self.raw.scan_events.get(idx as usize).map(|e| [e.preamble().bytes(), e.body()].concat()).unwrap_or_default()
    }

    /// Peaks of scan `idx` as [n, mz_0..mz_n-1, int_0..int_n-1]. `profile` keeps profile signal when present.
    pub fn peaks(&mut self, idx: u32, profile: bool) -> Result<js_sys::Float64Array, JsError> {
        let s = extract_spectrum(&self.raw, &mut self.src, idx, profile).map_err(|e| JsError::new(&format!("scan {idx}: {e}")))?;
        let n = s.mz.len();
        let mut out = Vec::with_capacity(1 + 2 * n);
        out.push(n as f64);
        out.extend_from_slice(&s.mz);
        out.extend(s.intensity.iter().map(|&x| x as f64));
        Ok(js_sys::Float64Array::from(&out[..]))
    }
}
