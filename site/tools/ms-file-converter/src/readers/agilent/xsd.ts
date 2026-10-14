// MassHunter describes its fixed-size binary index records (MSScan.bin, IMSFrame.bin) with an XML Schema
// shipped next to the data (MSScan.xsd, IMSFrame.xsd). The element order and xs: types give the little-endian
// record layout. Commented-out elements are not stored; an element without a type (Padding) has no fixed size.
// Parsed with regular expressions because DOMParser is not available inside Web Workers.

export type Prim = 'byte' | 'short' | 'int' | 'long' | 'float' | 'double';
const PRIM_SIZE: Record<Prim, number> = { byte: 1, short: 2, int: 4, long: 8, float: 4, double: 8 };

export interface XsdElement { name: string; type?: string; unbounded: boolean }
export type XsdTypes = Map<string, XsdElement[]>;

export function parseXsd(text: string): XsdTypes {
  // Drop comments, then anonymous nested types (Padding's PadBytes, the root element) whose children are not fields.
  const t = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<xs:complexType\s*>[\s\S]*?<\/xs:complexType>/g, '');
  const types: XsdTypes = new Map();
  for (const m of t.matchAll(/<xs:complexType\s+name="([\w:]+)"\s*>([\s\S]*?)<\/xs:complexType>/g)) {
    const els: XsdElement[] = [];
    for (const e of m[2].matchAll(/<xs:element\s+([^>]*?)\/?>/g)) {
      const name = /\bname="([\w:]+)"/.exec(e[1])?.[1];
      if (!name) continue;
      const type = /\btype="([\w:]+)"/.exec(e[1])?.[1];
      els.push({ name, type, unbounded: /maxOccurs="unbounded"/.test(e[1]) });
    }
    types.set(m[1], els);
  }
  return types;
}

export interface FieldSpec { name: string; prim: Prim; offset: number }
export interface Layout { fields: Map<string, FieldSpec>; size: number }

const primOf = (type: string | undefined): Prim | null => {
  if (!type) return null;
  const p = type.replace(/^\w+:/, '') as Prim;
  return p in PRIM_SIZE ? p : null;
};

/** Flatten a complex type into fixed offsets. `stopAt` ends the layout at that element (exclusive). */
export function layoutOf(types: XsdTypes, typeName: string, stopAt?: string): Layout {
  const fields = new Map<string, FieldSpec>();
  let off = 0;
  const walk = (tn: string, prefix: string) => {
    const els = types.get(tn.replace(/^\w+:/, ''));
    if (!els) throw new Error(`MSScan.xsd: unknown type ${tn}`);
    for (const e of els) {
      if (!prefix && e.name === stopAt) return true;
      const p = primOf(e.type);
      if (p) { const name = prefix + e.name; if (!fields.has(name)) fields.set(name, { name, prim: p, offset: off }); off += PRIM_SIZE[p]; }
      else if (e.type && types.has(e.type.replace(/^\w+:/, ''))) { if (walk(e.type, prefix + e.name + '.')) return true; }
      // untyped (Padding): no fixed size
    }
    return false;
  };
  walk(typeName, '');
  return { fields, size: off };
}

export function readField(dv: DataView, base: number, f: FieldSpec | undefined): number | undefined {
  if (!f) return undefined;
  const o = base + f.offset;
  if (o + PRIM_SIZE[f.prim] > dv.byteLength) return undefined;
  switch (f.prim) {
    case 'byte': return dv.getInt8(o);
    case 'short': return dv.getInt16(o, true);
    case 'int': return dv.getInt32(o, true);
    case 'long': return Number(dv.getBigInt64(o, true));
    case 'float': return dv.getFloat32(o, true);
    case 'double': return dv.getFloat64(o, true);
  }
}
