// File exports. Everything is generated in the browser; nothing is uploaded.
import { ANGSTROM_PER_BOHR, symbolOf } from './chem';
import type { Mesh } from './surface/marching';

export interface CubeGrid { origin: [number, number, number]; h: number; n: [number, number, number]; data: Float32Array }

/** Gaussian cube file (bohr). NaN (masked far-field points) is written as 0. Readable by VMD, PyMOL, Avogadro, ChimeraX, GaussView. */
export function toCube(grid: CubeGrid, z: number[], bohr: ArrayLike<number>, charge: number, title: string, quantity: string): string {
  const out: string[] = [title, quantity, `${String(z.length).padStart(5)} ${fmt(grid.origin[0])} ${fmt(grid.origin[1])} ${fmt(grid.origin[2])}`];
  out.push(`${String(grid.n[0]).padStart(5)} ${fmt(grid.h)} ${fmt(0)} ${fmt(0)}`, `${String(grid.n[1]).padStart(5)} ${fmt(0)} ${fmt(grid.h)} ${fmt(0)}`, `${String(grid.n[2]).padStart(5)} ${fmt(0)} ${fmt(0)} ${fmt(grid.h)}`);
  z.forEach((zz, i) => out.push(`${String(zz).padStart(5)} ${fmt(zz)} ${fmt(bohr[i * 3])} ${fmt(bohr[i * 3 + 1])} ${fmt(bohr[i * 3 + 2])}`));
  void charge;
  const [nx, ny, nz] = grid.n;
  for (let ix = 0; ix < nx; ix++)
    for (let iy = 0; iy < ny; iy++) {
      let line = '';
      for (let iz = 0; iz < nz; iz++) {
        const v = grid.data[(ix * ny + iy) * nz + iz];
        line += ' ' + (Number.isFinite(v) ? v : 0).toExponential(5).replace(/e([+-])(\d)$/, 'e$10$2').padStart(12);
        if (iz % 6 === 5 || iz === nz - 1) { out.push(line); line = ''; }
      }
    }
  return out.join('\n') + '\n';
}
const fmt = (x: number) => x.toFixed(6).padStart(12);

export function toXYZ(z: number[], xyzAng: ArrayLike<number>, comment: string): string {
  return `${z.length}\n${comment}\n` + z.map((zz, i) => `${symbolOf(zz).padEnd(2)} ${xyzAng[i * 3].toFixed(6).padStart(12)} ${xyzAng[i * 3 + 1].toFixed(6).padStart(12)} ${xyzAng[i * 3 + 2].toFixed(6).padStart(12)}`).join('\n') + '\n';
}

/** Binary little-endian PLY with per-vertex colour; coordinates converted from bohr to Angstrom. */
export function toPLY(mesh: Mesh, colors: Uint8Array): Uint8Array<ArrayBuffer> {
  const nv = mesh.positions.length / 3, nf = mesh.indices.length / 3;
  const header = `ply\nformat binary_little_endian 1.0\ncomment Chase's Research Tools electrostatic-potential-map (Angstrom)\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face ${nf}\nproperty list uchar int vertex_indices\nend_header\n`;
  const head = new TextEncoder().encode(header);
  const out = new Uint8Array(new ArrayBuffer(head.length + nv * 27 + nf * 13));
  out.set(head, 0);
  const dv = new DataView(out.buffer);
  let o = head.length;
  for (let i = 0; i < nv; i++) {
    for (let k = 0; k < 3; k++) { dv.setFloat32(o, mesh.positions[i * 3 + k] * ANGSTROM_PER_BOHR, true); o += 4; }
    for (let k = 0; k < 3; k++) { dv.setFloat32(o, mesh.normals[i * 3 + k], true); o += 4; }
    for (let k = 0; k < 3; k++) out[o++] = colors[i * 3 + k];
  }
  for (let f = 0; f < nf; f++) {
    out[o++] = 3;
    for (let k = 0; k < 3; k++) { dv.setInt32(o, mesh.indices[f * 3 + k], true); o += 4; }
  }
  return out;
}

/** Wavefront OBJ with vertex colours (`v x y z r g b`, understood by MeshLab, Blender, ChimeraX) and normals. Angstrom. */
export function toOBJ(mesh: Mesh, colors: Uint8Array, name: string): string {
  const lines: string[] = [`# ${name} (Angstrom) - Chase's Research Tools`, `o ${name}`];
  const nv = mesh.positions.length / 3;
  for (let i = 0; i < nv; i++) lines.push(`v ${(mesh.positions[i * 3] * ANGSTROM_PER_BOHR).toFixed(5)} ${(mesh.positions[i * 3 + 1] * ANGSTROM_PER_BOHR).toFixed(5)} ${(mesh.positions[i * 3 + 2] * ANGSTROM_PER_BOHR).toFixed(5)} ${(colors[i * 3] / 255).toFixed(4)} ${(colors[i * 3 + 1] / 255).toFixed(4)} ${(colors[i * 3 + 2] / 255).toFixed(4)}`);
  for (let i = 0; i < nv; i++) lines.push(`vn ${mesh.normals[i * 3].toFixed(4)} ${mesh.normals[i * 3 + 1].toFixed(4)} ${mesh.normals[i * 3 + 2].toFixed(4)}`);
  for (let f = 0; f < mesh.indices.length; f += 3) {
    const a = mesh.indices[f] + 1, b = mesh.indices[f + 1] + 1, c = mesh.indices[f + 2] + 1;
    lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
  }
  return lines.join('\n') + '\n';
}
