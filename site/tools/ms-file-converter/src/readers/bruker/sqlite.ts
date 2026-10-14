// Lazy sql.js (SQLite compiled to WASM, MIT) loader that works in a browser Web Worker and in Node (Vitest).
// Browser: the package's "browser" export (sql-wasm-browser.js) plus its .wasm, located through a Vite `?url` import.
// Node: the default export (sql-wasm.js) finds its .wasm next to itself on disk.
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';

let sqlPromise: Promise<SqlJsStatic> | null = null;

const isNode = () =>
  typeof process !== 'undefined' && !!(process as { versions?: { node?: string } }).versions?.node &&
  typeof (globalThis as { window?: unknown }).window === 'undefined' && typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope === 'undefined';

export function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const mod = (await import('sql.js')) as unknown as { default?: (cfg?: object) => Promise<SqlJsStatic> } & ((cfg?: object) => Promise<SqlJsStatic>);
      const init = (mod.default ?? mod) as (cfg?: object) => Promise<SqlJsStatic>;
      if (isNode()) return init();
      const { default: wasmUrl } = await import('sql.js/dist/sql-wasm-browser.wasm?url');
      return init({ locateFile: () => wasmUrl });
    })();
    sqlPromise.catch(() => { sqlPromise = null; });
  }
  return sqlPromise;
}

/** Open an SQLite file (analysis.tdf / analysis.tsf). The metadata database is small next to the *_bin file, so it is read whole. */
export async function openDatabase(file: Blob): Promise<Database> {
  const SQL = await loadSqlJs();
  return new SQL.Database(new Uint8Array(await file.arrayBuffer()));
}

export type Row = Record<string, SqlValue>;

export function query(db: Database, sql: string): Row[] {
  const res = db.exec(sql);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => { const r: Row = {}; columns.forEach((c, i) => (r[c] = v[i])); return r; });
}

export function hasTable(db: Database, name: string): boolean {
  const st = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?");
  try { st.bind([name]); return st.step(); } finally { st.free(); }
}

export function columnsOf(db: Database, table: string): string[] {
  return query(db, `PRAGMA table_info(${table})`).map((r) => String(r.name));
}

export const num = (v: SqlValue | undefined): number | undefined => (v == null || v === '' ? undefined : Number(v));
