// Download an SVG string as .svg, or rasterise it to a high-DPI .png, entirely in the browser.
import { downloadBlob } from '@/lib/export';

export function downloadSvg(filename: string, svg: string) {
  downloadBlob(filename, new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`], { type: 'image/svg+xml;charset=utf-8' }));
}

export async function downloadPng(filename: string, svg: string, scale = 3, background = '#ffffff') {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const w = m ? Number(m[1]) : 800, h = m ? Number(m[2]) : 400;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('Could not render the figure.')); img.src = url; });
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
    downloadBlob(filename, blob);
  } finally { URL.revokeObjectURL(url); }
}
