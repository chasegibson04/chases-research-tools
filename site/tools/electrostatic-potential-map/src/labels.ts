// Small shared labels (kept out of SurfacePanel so the 3D code stays lazy-loaded).
export const orbitalLabel = (i: number, nocc: number) => (i === nocc - 1 ? 'HOMO' : i === nocc ? 'LUMO' : i < nocc ? `HOMO−${nocc - 1 - i}` : `LUMO+${i - nocc}`);
