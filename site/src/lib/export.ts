// Client-side download helpers. Everything stays in the browser.
export function downloadBlob(filename: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const downloadText = (filename: string, text: string, mime = 'text/plain;charset=utf-8') =>
  downloadBlob(filename, new Blob([text], { type: mime }));
export const downloadJSON = (filename: string, data: unknown) =>
  downloadText(filename, JSON.stringify(data, null, 2), 'application/json');

/** rows: array of objects (keys become header) or array of arrays with explicit header. */
export function toDelimited(rows: Record<string, unknown>[] | unknown[][], opts: { delimiter?: string; header?: string[] } = {}) {
  const d = opts.delimiter ?? ',';
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r\t]/.test(s) || s.includes(d) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  let header: string[];
  let body: unknown[][];
  if (rows.length && !Array.isArray(rows[0])) {
    header = opts.header ?? Object.keys(rows[0] as Record<string, unknown>);
    body = (rows as Record<string, unknown>[]).map((r) => header.map((h) => r[h]));
  } else {
    header = opts.header ?? [];
    body = rows as unknown[][];
  }
  const lines = [...(header.length ? [header] : []), ...body].map((r) => r.map(esc).join(d));
  return lines.join('\r\n') + '\r\n';
}
export const downloadCSV = (filename: string, rows: Record<string, unknown>[] | unknown[][], header?: string[]) =>
  downloadText(filename, toDelimited(rows, { header }), 'text/csv;charset=utf-8');
export const downloadTSV = (filename: string, rows: Record<string, unknown>[] | unknown[][], header?: string[]) =>
  downloadText(filename, toDelimited(rows, { header, delimiter: '\t' }), 'text/tab-separated-values;charset=utf-8');
