// Colormaps for property-on-surface figures. t in [0,1]; t = 0 is the "negative" end of a diverging map.
export type ColormapName = 'spartan' | 'rwb' | 'rainbow' | 'spectral' | 'rdylbu' | 'puor' | 'brbg' | 'viridis' | 'gray' | 'custom';

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}
const toHex = (c: [number, number, number]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

// ColorBrewer diverging schemes (11 classes) are in the public domain; viridis is CC0.
const STOPS: Record<ColormapName, string[]> = {
  // modelled on the cation-pi lecture figure: red -> orange -> yellow -> green -> teal -> blue -> violet
  spartan: ['#e0132b', '#f2561d', '#f6a21e', '#eed21f', '#8fd12f', '#19b58f', '#1f7fd6', '#3a45c2', '#5b2a9e'],
  spectral: ['#9e0142', '#d53e4f', '#f46d43', '#fdae61', '#fee08b', '#ffffbf', '#e6f598', '#abdda4', '#66c2a5', '#3288bd', '#5e4fa2'],
  custom: ['#d62839', '#ffffff', '#1d4ed8'],
  rwb: ['#67001f', '#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#f7f7f7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac', '#053061'],
  rdylbu: ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee090', '#ffffbf', '#e0f3f8', '#abd9e9', '#74add1', '#4575b4', '#313695'],
  puor: ['#7f3b08', '#b35806', '#e08214', '#fdb863', '#fee0b6', '#f7f7f7', '#d8daeb', '#b2abd2', '#8073ac', '#542788', '#2d004b'],
  brbg: ['#543005', '#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#f5f5f5', '#c7eae5', '#80cdc1', '#35978f', '#01665e', '#003c30'],
  viridis: ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725'],
  gray: ['#1a1a1a', '#e6e6e6'],
  // classic "ESP rainbow": red (negative) -> orange -> yellow -> green -> cyan -> blue (positive)
  rainbow: Array.from({ length: 9 }, (_, k) => toHex(hsl2rgb((240 * k) / 8, 0.95, 0.5))),
};

export const COLORMAPS: Record<ColormapName, { label: string; diverging: boolean; cvdSafe: boolean }> = {
  spartan: { label: 'Slide style: red–orange–yellow–green–blue–violet', diverging: false, cvdSafe: false },
  spectral: { label: 'Spectral (red–yellow–green–blue–violet)', diverging: false, cvdSafe: false },
  custom: { label: 'Custom gradient…', diverging: false, cvdSafe: false },
  rwb: { label: 'Red–white–blue (diverging)', diverging: true, cvdSafe: false },
  rainbow: { label: 'Rainbow (classic ESP)', diverging: false, cvdSafe: false },
  rdylbu: { label: 'Red–yellow–blue (diverging)', diverging: true, cvdSafe: false },
  puor: { label: 'Orange–white–purple (colour-blind safe)', diverging: true, cvdSafe: true },
  brbg: { label: 'Brown–white–teal (colour-blind safe)', diverging: true, cvdSafe: true },
  viridis: { label: 'Viridis (sequential)', diverging: false, cvdSafe: true },
  gray: { label: 'Greyscale', diverging: false, cvdSafe: true },
};

const PARSED = Object.fromEntries(Object.entries(STOPS).map(([k, v]) => [k, v.map(hex)])) as Record<ColormapName, Array<[number, number, number]>>;

const HEX = /^#[0-9a-fA-F]{6}$/;
/** Sets the stops used by the 'custom' colormap (2 to 8 hex colours, evenly spaced; invalid entries are ignored). */
export function setCustomStops(stops: string[]): void {
  const ok = stops.filter((c) => HEX.test(c)).slice(0, 8);
  if (ok.length < 2) return;
  STOPS.custom = ok;
  PARSED.custom = ok.map(hex);
}
export const getCustomStops = () => [...STOPS.custom];
export const stopsOf = (name: ColormapName) => [...STOPS[name]];

export function colorAt(name: ColormapName, t: number, reverse = false): [number, number, number] {
  const stops = PARSED[name];
  let u = Math.min(1, Math.max(0, Number.isNaN(t) ? 0.5 : t));
  if (reverse) u = 1 - u;
  const x = u * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export const cssGradient = (name: ColormapName, reverse = false, dir = 'to right') => {
  const list = reverse ? [...STOPS[name]].reverse() : STOPS[name];
  return `linear-gradient(${dir}, ${list.join(', ')})`;
};
