import { downloadCSV, downloadTSV, downloadJSON, downloadText } from '@/lib/export';
interface Props { filename: string; rows?: Record<string, unknown>[]; json?: unknown; text?: string; formats: Array<'csv' | 'tsv' | 'json' | 'txt'> }
export function ExportMenu({ filename, rows, json, text, formats }: Props) {
  return (
    <div class="ts-bar" role="group" aria-label="Export">
      <span class="small muted">Export:</span>
      {formats.includes('csv') && rows && <button class="btn-sm" type="button" onClick={() => downloadCSV(`${filename}.csv`, rows)}>CSV</button>}
      {formats.includes('tsv') && rows && <button class="btn-sm" type="button" onClick={() => downloadTSV(`${filename}.tsv`, rows)}>TSV</button>}
      {formats.includes('json') && json !== undefined && <button class="btn-sm" type="button" onClick={() => downloadJSON(`${filename}.json`, json)}>JSON</button>}
      {formats.includes('txt') && text !== undefined && <button class="btn-sm" type="button" onClick={() => downloadText(`${filename}.txt`, text)}>TXT</button>}
    </div>
  );
}
