/* tslint:disable */
/* eslint-disable */

export class ThermoRaw {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Raw scan-event bytes: preamble followed by the v66 body (activation decoding).
     */
    eventBytes(idx: number): Uint8Array;
    /**
     * Run-level metadata as JSON.
     */
    metaJson(): string;
    /**
     * Open a .raw file of `len` bytes; `read(offset, length)` must return a Uint8Array synchronously.
     */
    constructor(read: Function, len: number);
    /**
     * Peaks of scan `idx` as [n, mz_0..mz_n-1, int_0..int_n-1]. `profile` keeps profile signal when present.
     */
    peaks(idx: number, profile: boolean): Float64Array;
    scanCount(): number;
    /**
     * Per-scan metadata (no peaks) as JSON; `idx` is 0-based.
     */
    scanJson(idx: number): string;
    /**
     * The scan's trailer extra ("Trailer Extra" in Xcalibur) as JSON {label: value}; `idx` is 0-based.
     */
    trailerJson(idx: number): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_thermoraw_free: (a: number, b: number) => void;
    readonly thermoraw_eventBytes: (a: number, b: number) => [number, number];
    readonly thermoraw_metaJson: (a: number) => [number, number];
    readonly thermoraw_new: (a: any, b: number) => [number, number, number];
    readonly thermoraw_peaks: (a: number, b: number, c: number) => [number, number, number];
    readonly thermoraw_scanCount: (a: number) => number;
    readonly thermoraw_scanJson: (a: number, b: number) => [number, number];
    readonly thermoraw_trailerJson: (a: number, b: number) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
