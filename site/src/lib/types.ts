// Shared TypeScript types for tool manifests and the tool runtime contract.
// The authoritative schema is tools/tool.schema.json; keep this in sync (docs/TOOL_MANIFEST_SPEC.md).

export type ToolStatus = 'draft' | 'beta' | 'stable' | 'deprecated';
export type ToolKind = 'interactive' | 'showcase';
export type Engine = 'js' | 'python' | 'r' | 'wasm' | 'none';

export interface ToolInputSpec {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'integer' | 'boolean' | 'select' | 'multiselect' | 'file' | 'range' | 'color';
  help: string; // REQUIRED: shown in the (?) tooltip
  default?: unknown;
  required?: boolean;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  accept?: string; // for file inputs
  maxSizeMB?: number; // for file inputs
  group?: string;
  advanced?: boolean;
}

export interface ToolOutputSpec {
  name: string;
  label: string;
  type: 'number' | 'text' | 'table' | 'figure' | 'file' | 'json';
  help?: string;
  exportFormats?: Array<'csv' | 'tsv' | 'json' | 'txt' | 'png' | 'svg' | 'pdf'>;
}

export interface ToolManifest {
  id: string;
  name: string;
  tagline: string;
  description: string;
  version: string;
  status: ToolStatus;
  kind: ToolKind;
  category: string;
  subcategories: string[];
  tags: string[];
  keywords: string[];
  related?: string[];
  runtime: {
    engine: Engine;
    languages: string[];
    pyodide?: { version?: string; packages?: string[]; micropip?: string[] };
    webr?: { version?: string; packages?: string[] };
    wasm?: { source: string; threads?: boolean; simd?: boolean };
    bundleSizeKB?: number | null;
  };
  compute: {
    location: 'client';
    worker: boolean;
    maxRuntimeSeconds: number;
    maxMemoryMB: number;
    maxInputSizeMB: number;
    threads: number;
    warnOnMobile: boolean;
    longRunning: boolean;
  };
  layout: {
    aspect: 'fill' | '16:9' | '4:3' | 'tall';
    inputsPosition: 'left' | 'top' | 'right';
    inputsWidthPx?: number;
    panels: string[];
    fullWidth?: boolean;
  };
  inputs: ToolInputSpec[];
  outputs: ToolOutputSpec[];
  figures: { enabled: boolean; library: 'plotly' | 'none'; exportable: boolean; defaultPalette?: string };
  exports: Array<'csv' | 'tsv' | 'json' | 'txt' | 'png' | 'svg' | 'pdf'>;
  examples: Array<{ file: string; label: string; description?: string; expectedRuntimeSeconds?: number }>;
  citation: {
    authors: Array<{ family: string; given: string; orcid?: string }>;
    year: number;
    title: string;
    doi?: string | null;
    version?: string;
    preferredFormat?: string;
    alsoCite?: Array<{ text: string; doi?: string; url?: string }>;
  };
  seo: { title: string; metaDescription: string; ogImage?: string | null; schemaType: 'WebApplication' | 'SoftwareApplication' | 'SoftwareSourceCode'; faq?: Array<{ q: string; a: string }> };
  ads: { allow: boolean };
  maintenance: { created: string; updated: string; author: string; maintainers?: string[]; sourceOrigin?: string; changelog?: string };
  links: { repo?: string | null; release?: string | null; paper?: string | null; docs?: string | null; demoVideo?: string | null };
  showcase?: {
    install: string;
    platforms: string[];
    figures: Array<{ src: string; caption: string; alt: string }>;
    releaseUrl: string;
  };
  accessibility?: { notes?: string; keyboardOperable?: boolean };
  privacy: { sendsData: false; storesLocal: boolean };
  license: string;
}

export interface Example<I = Record<string, unknown>> {
  label: string;
  description?: string;
  input: I;
  expected?: Record<string, unknown>; // golden values for tests
}

export interface ComputeContext {
  progress: (fraction: number, message?: string) => void;
  signal: AbortSignal;
  log: (msg: string) => void;
}

export type ComputeFn<I = unknown, O = unknown> = (input: I, ctx: ComputeContext) => Promise<O> | O;

export interface RunHandle<O = unknown> {
  promise: Promise<O>;
  cancel: () => void;
}

export interface ToolProps<I = Record<string, unknown>, O = unknown> {
  manifest: ToolManifest;
  examples: Example<I>[];
  run: (input: I, onProgress?: (f: number, m?: string) => void) => RunHandle<O>;
}
