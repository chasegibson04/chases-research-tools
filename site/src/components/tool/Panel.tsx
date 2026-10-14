import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

interface Props {
  /** Short title shown in the panel's header strip, e.g. "Spectrum". */
  title: string;
  /** Stable id for remembering the collapsed state per visitor (localStorage key `crt-panel:<id>`). */
  id: string;
  /** Extra content on the right of the header (counts, small actions). */
  meta?: ComponentChildren;
  defaultOpen?: boolean;
  class?: string;
  children: ComponentChildren;
}

const load = (id: string, fallback: boolean) => {
  try { const v = localStorage.getItem(`crt-panel:${id}`); return v == null ? fallback : v === '1'; } catch { return fallback; }
};

/** A results "window" that can be collapsed to its header strip. Used for every card in the tool layouts. */
export function Panel({ title, id, meta, defaultOpen = true, class: cls, children }: Props) {
  const [open, setOpen] = useState(() => load(id, defaultOpen));
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(`crt-panel:${id}`, next ? '1' : '0'); } catch { /* storage blocked */ }
  };
  return (
    <section class={`ms-card panel${cls ? ` ${cls}` : ''}`} data-open={open ? 'true' : 'false'} aria-label={title}>
      <div class="panel-head">
        <button type="button" class="panel-toggle" aria-expanded={open} onClick={toggle} title={open ? `Collapse ${title}` : `Expand ${title}`}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d={open ? 'M1 3 L5 7 L9 3' : 'M3 1 L7 5 L3 9'} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <span>{title}</span>
        </button>
        {meta && <span class="panel-meta small muted">{meta}</span>}
      </div>
      {/* kept mounted while collapsed so zoom, selections and canvases survive */}
      <div class="panel-body" hidden={!open}>{children}</div>
    </section>
  );
}
