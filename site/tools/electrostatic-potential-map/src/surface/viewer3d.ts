// WebGL viewer (three.js): molecule + one coloured surface, trackball interaction, high-resolution PNG export.
import {
  AmbientLight, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, Group, Matrix4, Mesh, MeshPhongMaterial,
  BackSide, FrontSide, OrthographicCamera, PerspectiveCamera, Plane, Quaternion, Scene, SphereGeometry, Vector3, WebGLRenderer, type Side,
} from 'three';
import { ANGSTROM_PER_BOHR, cpkColor, covalentRadius, vdwRadius } from '../chem';
import { drawOverlay, type OverlayState } from './overlay';
import type { Mesh as SurfaceMesh } from './marching';

export interface ViewerAtom { z: number; x: number; y: number; zc: number }
export type ViewPreset = 'top' | 'side' | 'front' | 'iso';
export interface ViewerStyle {
  atomStyle: 'ballstick' | 'stick' | 'spacefill' | 'none';
  atomScale: number;
  opacity: number;
  shininess: number;
  wireframe: boolean;
  background: 'dark' | 'white' | 'black' | 'transparent' | 'custom';
  bgColor: string;
  projection: 'perspective' | 'orthographic';
  cutaway: boolean;
  cutOffset: number;
}
export const DEFAULT_VIEWER_STYLE: ViewerStyle = { atomStyle: 'ballstick', atomScale: 1, opacity: 1, shininess: 40, wireframe: false, background: 'dark', bgColor: '#101418', projection: 'perspective', cutaway: false, cutOffset: 0 };

export const backgroundColor = (s: ViewerStyle): { color: string; alpha: number; dark: boolean } => {
  switch (s.background) {
    case 'white': return { color: '#ffffff', alpha: 1, dark: false };
    case 'black': return { color: '#000000', alpha: 1, dark: true };
    case 'transparent': return { color: '#ffffff', alpha: 0, dark: false };
    case 'custom': { const c = new Color(s.bgColor); return { color: s.bgColor, alpha: 1, dark: 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 0.5 }; }
    default: return { color: '#101418', alpha: 1, dark: true };
  }
};

export class EspViewer {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private root = new Group();
  private molGroup = new Group();
  private surfGroup = new Group();
  private persp = new PerspectiveCamera(30, 1, 0.1, 2000);
  private ortho = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
  private camera: PerspectiveCamera | OrthographicCamera = this.persp;
  private radius = 6;
  private style: ViewerStyle = { ...DEFAULT_VIEWER_STYLE };
  private overlayState: Omit<OverlayState, 'labels' | 'dark'> = { bar: null, title: '' };
  private atoms: ViewerAtom[] = [];
  private labelTexts: string[] = [];
  private labelColor = '#ffffff';
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private raf = 0;
  private ro: ResizeObserver;
  private disposed = false;
  private clip = new Plane(new Vector3(0, 0, -1), 0);
  private surfaceMaterials: MeshPhongMaterial[] = [];
  private surfGeom: BufferGeometry | null = null;
  private translucent = false;
  private cssW = 1;
  private cssH = 1;
  hasSurface = false;

  constructor(private canvas: HTMLCanvasElement, private overlay: HTMLCanvasElement | null) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.localClippingEnabled = true;
    this.scene.add(this.root);
    this.root.add(this.molGroup, this.surfGroup);
    this.scene.add(new AmbientLight(0xffffff, 0.62));
    const key = new DirectionalLight(0xffffff, 1.0); key.position.set(1.2, 1.6, 2.4); this.scene.add(key);
    const fill = new DirectionalLight(0xffffff, 0.35); fill.position.set(-2, -0.8, 1); this.scene.add(fill);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('pointerleave', () => { if (this.pointers.size === 0) this.engaged = false; });
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dblclick', () => this.resetView('top'));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  // ---- scene content --------------------------------------------------------------------------
  setStructure(atoms: ViewerAtom[], bonds: Array<[number, number, number]>, labelTexts: string[] = []): void {
    this.atoms = atoms;
    this.labelTexts = labelTexts;
    this.molGroup.clear();
    this.molGroup.userData = { atoms, bonds };
    this.buildMolecule();
    let r = 2;
    for (const a of atoms) r = Math.max(r, Math.hypot(a.x, a.y, a.zc) + 2.0);
    this.radius = r;
    this.applyCamera();
    this.render();
  }

  private disposeGroup(g: Group) {
    g.traverse((o) => { const m = o as Mesh; m.geometry?.dispose?.(); });
    g.clear();
  }

  private buildMolecule(): void {
    const { atoms, bonds } = this.molGroup.userData as { atoms: ViewerAtom[]; bonds: Array<[number, number, number]> };
    this.molGroup.clear();
    if (!atoms || this.style.atomStyle === 'none') return;
    const st = this.style;
    const mats = new Map<number, MeshPhongMaterial>();
    const mat = (z: number) => { let m = mats.get(z); if (!m) { m = new MeshPhongMaterial({ color: cpkColor(z), shininess: 60, clippingPlanes: st.cutaway ? [this.clip] : [] }); mats.set(z, m); } return m; };
    const sphere = new SphereGeometry(1, 28, 18);
    const bondR = st.atomStyle === 'stick' ? 0.11 : 0.085;
    const radiusOf = (z: number) => st.atomStyle === 'spacefill' ? vdwRadius(z) * st.atomScale : st.atomStyle === 'stick' ? bondR : (0.2 + 0.28 * covalentRadius(z)) * st.atomScale;
    atoms.forEach((a) => { const m = new Mesh(sphere, mat(a.z)); m.position.set(a.x, a.y, a.zc); const r = radiusOf(a.z); m.scale.setScalar(r); this.molGroup.add(m); });
    if (st.atomStyle !== 'spacefill') {
      const cyl = new CylinderGeometry(1, 1, 1, 14, 1, true);
      for (const [i, j, order] of bonds) {
        const A = atoms[i], B = atoms[j];
        const pa = new Vector3(A.x, A.y, A.zc), pb = new Vector3(B.x, B.y, B.zc);
        const dir = pb.clone().sub(pa);
        const len = dir.length();
        if (len < 1e-6) continue;
        dir.normalize();
        const up = new Vector3(0, 1, 0);
        const q = new Quaternion().setFromUnitVectors(up, dir);
        const side = new Vector3().crossVectors(dir, Math.abs(dir.z) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1)).normalize();
        const n = Math.max(1, Math.min(3, order));
        for (let k = 0; k < n; k++) {
          const off = side.clone().multiplyScalar((k - (n - 1) / 2) * (n === 2 ? 0.17 : 0.16));
          const r = n === 1 ? bondR : bondR * (n === 2 ? 0.72 : 0.62);
          for (const [from, to, atom] of [[pa, pa.clone().lerp(pb, 0.5), A], [pa.clone().lerp(pb, 0.5), pb, B]] as const) {
            const mid = from.clone().add(to).multiplyScalar(0.5).add(off);
            const m = new Mesh(cyl, mat(atom.z));
            m.position.copy(mid);
            m.quaternion.copy(q);
            m.scale.set(r, from.distanceTo(to) + 0.01, r);
            this.molGroup.add(m);
          }
        }
      }
    }
  }

  /** mesh positions are in bohr; colours are 0..1 floats per vertex. Pass null to clear. */
  setSurface(mesh: SurfaceMesh | null, colors: Float32Array | null): void {
    this.clearSurface();
    this.hasSurface = !!mesh && mesh.indices.length > 0;
    if (!mesh || !colors || !this.hasSurface) { this.render(); return; }
    const g = new BufferGeometry();
    const pos = new Float32Array(mesh.positions.length);
    for (let i = 0; i < pos.length; i++) pos[i] = mesh.positions[i] * ANGSTROM_PER_BOHR;
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
    g.setAttribute('color', new BufferAttribute(colors, 3));
    g.setIndex(new BufferAttribute(mesh.indices, 1));
    this.surfGeom = g;
    this.buildSurfaceMeshes();
    this.render();
  }

  private clearSurface(): void {
    this.surfGroup.clear();
    this.surfGeom?.dispose();
    this.surfGeom = null;
    for (const m of this.surfaceMaterials) m.dispose();
    this.surfaceMaterials = [];
  }

  /** Opaque: one double-sided mesh. Translucent: back faces then front faces (no per-triangle sorting needed for a closed surface). */
  private buildSurfaceMeshes(): void {
    if (!this.surfGeom) return;
    this.surfGroup.clear();
    for (const m of this.surfaceMaterials) m.dispose();
    this.surfaceMaterials = [];
    const st = this.style;
    this.translucent = st.opacity < 0.999;
    const make = (side: Side, order: number) => {
      const m = new MeshPhongMaterial({ vertexColors: true, side, shininess: st.shininess, specular: 0x222222 });
      this.surfaceMaterials.push(m);
      const mesh = new Mesh(this.surfGeom!, m);
      mesh.renderOrder = order;
      this.surfGroup.add(mesh);
    };
    if (this.translucent) { make(BackSide, 1); make(FrontSide, 2); } else make(DoubleSide, 0);
    this.applyStyleToSurface();
  }

  private applyStyleToSurface(): void {
    for (const m of this.surfaceMaterials) {
      m.opacity = this.style.opacity;
      m.transparent = this.translucent;
      m.depthWrite = !this.translucent;
      m.shininess = this.style.shininess;
      m.wireframe = this.style.wireframe;
      m.clippingPlanes = this.style.cutaway ? [this.clip] : [];
      m.needsUpdate = true;
    }
  }

  setStyle(next: Partial<ViewerStyle>): void {
    const old = this.style;
    this.style = { ...old, ...next };
    const bg = backgroundColor(this.style);
    this.renderer.setClearColor(bg.color, bg.alpha);
    this.clip.constant = this.style.cutOffset;
    if (old.atomStyle !== this.style.atomStyle || old.atomScale !== this.style.atomScale || old.cutaway !== this.style.cutaway) this.buildMolecule();
    if ((old.opacity < 0.999) !== (this.style.opacity < 0.999)) this.buildSurfaceMeshes(); else this.applyStyleToSurface();
    if (old.projection !== this.style.projection) this.applyCamera();
    this.render();
  }

  setOverlay(o: Omit<OverlayState, 'labels' | 'dark'>, labelTexts?: string[], labelColor?: string): void {
    this.overlayState = o;
    if (labelTexts) this.labelTexts = labelTexts;
    if (labelColor) this.labelColor = labelColor;
    this.render();
  }

  // ---- camera / view ----------------------------------------------------------------------------
  private applyCamera(): void {
    this.camera = this.style.projection === 'orthographic' ? this.ortho : this.persp;
    const dist = this.radius / Math.sin((this.persp.fov * Math.PI) / 360) * 1.02;
    this.persp.position.set(0, 0, dist);
    this.persp.near = Math.max(0.1, dist - this.radius * 2); this.persp.far = dist + this.radius * 2;
    this.ortho.position.set(0, 0, dist);
    this.ortho.near = Math.max(0.1, dist - this.radius * 2); this.ortho.far = dist + this.radius * 2;
    this.updateProjection();
  }
  private updateProjection(): void {
    const aspect = this.cssW / this.cssH;
    this.persp.aspect = aspect;
    const h = this.radius * 1.12;
    this.ortho.left = -h * aspect; this.ortho.right = h * aspect; this.ortho.top = h; this.ortho.bottom = -h;
    this.persp.updateProjectionMatrix();
    this.ortho.updateProjectionMatrix();
  }
  resetView(preset: ViewPreset = 'top'): void {
    const q = new Quaternion();
    if (preset === 'side') q.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    else if (preset === 'front') q.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2));
    else if (preset === 'iso') q.setFromAxisAngle(new Vector3(1, 0, 0), -1.0).premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.5));
    this.root.quaternion.copy(q);
    this.root.position.set(0, 0, 0);
    this.persp.zoom = 1; this.ortho.zoom = 1;
    this.updateProjection();
    this.render();
  }
  /** View rotation as a quaternion [x,y,z,w], for saving and restoring a figure. */
  getView(): { q: number[]; zoom: number; pan: number[] } { const q = this.root.quaternion; return { q: [q.x, q.y, q.z, q.w], zoom: this.persp.zoom, pan: [this.root.position.x, this.root.position.y] }; }
  setView(v: { q: number[]; zoom: number; pan: number[] }): void { this.root.quaternion.set(v.q[0], v.q[1], v.q[2], v.q[3]); this.persp.zoom = v.zoom; this.ortho.zoom = v.zoom; this.root.position.set(v.pan[0], v.pan[1], 0); this.updateProjection(); this.render(); }

  // ---- interaction -------------------------------------------------------------------------------
  private onDown = (e: PointerEvent) => { this.engaged = true; this.canvas.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (this.pointers.size === 2) this.pinch = this.pinchDist(); };
  private pinchDist() { const [a, b] = [...this.pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }
  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pointers.size === 2) {
      const d = this.pinchDist();
      if (this.pinch > 0) this.zoomBy(d / this.pinch);
      this.pinch = d;
    } else if (e.shiftKey || e.buttons === 2 || e.buttons === 4) {
      const visible = this.camera === this.persp ? (2 * this.persp.position.z * Math.tan((this.persp.fov * Math.PI) / 360)) / this.persp.zoom : ((this.ortho.top - this.ortho.bottom) / this.ortho.zoom);
      const k = visible / this.cssH;
      this.root.position.x += dx * k; this.root.position.y -= dy * k;
    } else {
      const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), dx * 0.008);
      const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), dy * 0.008);
      this.root.quaternion.premultiply(qy).premultiply(qx).normalize();
    }
    this.render();
  };
  private onUp = (e: PointerEvent) => { this.pointers.delete(e.pointerId); this.pinch = 0; };
  /** Wheel zoom only once the view has been clicked (or with Ctrl/Cmd, which is how trackpad pinch arrives), so scrolling the page past the figure never gets trapped. */
  private engaged = false;
  private onWheel = (e: WheelEvent) => {
    if (!(this.engaged || e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    this.zoomBy(Math.exp(-e.deltaY * 0.0012));
  };
  private zoomBy(f: number) {
    const z = Math.min(8, Math.max(0.3, this.persp.zoom * f));
    this.persp.zoom = z; this.ortho.zoom = z;
    this.persp.updateProjectionMatrix(); this.ortho.updateProjectionMatrix();
    this.render();
  }

  // ---- rendering -----------------------------------------------------------------------------------
  private resize(): void {
    const host = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, Math.floor(host.clientWidth)), h = Math.max(1, Math.floor(host.clientHeight));
    this.cssW = w; this.cssH = h;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    if (this.overlay) { this.overlay.width = Math.round(w * ratio); this.overlay.height = Math.round(h * ratio); }
    this.updateProjection();
    this.render();
  }

  render(): void {
    if (this.disposed) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => { this.renderNow(); });
  }

  private labels(W: number, H: number): OverlayState['labels'] {
    if (!this.labelTexts.length) return [];
    this.root.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const out: OverlayState['labels'] = [];
    const m = new Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).multiply(this.root.matrixWorld);
    this.atoms.forEach((a, i) => {
      const t = this.labelTexts[i];
      if (!t) return;
      const v = new Vector3(a.x, a.y, a.zc).applyMatrix4(m);
      if (v.z < -1 || v.z > 1) return;
      out.push({ x: ((v.x + 1) / 2) * W + 6, y: ((1 - v.y) / 2) * H - 6, text: t, color: this.labelColor });
    });
    return out;
  }

  private renderNow(): void {
    this.renderer.render(this.scene, this.camera);
    if (this.overlay) {
      const ctx = this.overlay.getContext('2d');
      if (ctx) {
        const scale = this.overlay.width / this.cssW;
        ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        drawOverlay(ctx, this.overlay.width, this.overlay.height, scale, { ...this.overlayState, dark: backgroundColor(this.style).dark, labels: this.labels(this.cssW, this.cssH) });
      }
    }
  }

  /** Renders at the given pixel size (independent of the screen) and returns a PNG with the overlay composited on top. */
  async exportPNG(width: number, height: number): Promise<Blob> {
    const maxSide = Math.min(this.renderer.capabilities.maxTextureSize, 8192);
    const k = Math.min(1, maxSide / Math.max(width, height));
    const W = Math.round(width * k), H = Math.round(height * k);
    const prevAspectW = this.cssW;
    const prevRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    // keep the framing of the on-screen view: use the export aspect for the camera
    const savedW = this.cssW, savedH = this.cssH;
    this.cssW = W; this.cssH = H;
    this.updateProjection();
    // radius-based framing already scales with aspect for the ortho camera; for perspective keep the vertical fov
    this.renderer.render(this.scene, this.camera);
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(this.renderer.domElement, 0, 0);
    const refW = Math.max(prevAspectW, 1);
    const scale = W / refW;
    drawOverlay(ctx, W, H, scale, { ...this.overlayState, dark: backgroundColor(this.style).dark, labels: this.labels(W / scale, H / scale) });
    // restore
    this.cssW = savedW; this.cssH = savedH;
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(savedW, savedH, false);
    this.updateProjection();
    this.render();
    return await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.disposeGroup(this.molGroup);
    this.clearSurface();
    this.renderer.dispose();
  }
}
