import { useEffect, useRef } from 'preact/hooks';

const GAP = 8;
let popEl: HTMLDivElement | null = null;

/** One shared popup element on <body>, so no scrolling or clipping ancestor (inputs column, <details>) can cut it off. */
function popup(): HTMLDivElement {
  if (!popEl || !popEl.isConnected) {
    popEl = document.createElement('div');
    popEl.className = 'help-pop';
    popEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(popEl);
  }
  return popEl;
}

function show(anchor: HTMLElement, text: string) {
  const el = popup();
  el.textContent = text;
  el.style.display = 'block';
  const r = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const w = Math.min(260, vw - 2 * GAP);
  el.style.width = `${w}px`;
  const h = el.offsetHeight;
  // Prefer the right of the icon, then the left; on narrow screens centre it under the icon.
  let left = r.right + GAP;
  let top = r.top - 4;
  if (left + w > vw - GAP) left = r.left - GAP - w;
  if (left < GAP) { left = Math.max(GAP, Math.min(vw - GAP - w, r.left + r.width / 2 - w / 2)); top = r.bottom + GAP; }
  if (top + h > vh - GAP) top = Math.max(GAP, vh - GAP - h);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
const hide = () => { if (popEl) popEl.style.display = 'none'; };

/**
 * The (?) tooltip every parameter must have. Keyboard focusable; hover or focus reveals. The visible popup is positioned
 * against the viewport and flips to the left or below when there is no room, so it is never clipped by the inputs column.
 */
export function HelpTip({ text, label }: { text: string; label?: string }) {
  const icon = useRef<HTMLSpanElement>(null);
  useEffect(() => hide, []);
  const open = () => icon.current && show(icon.current, text);
  return (
    <span ref={icon} class="help" tabIndex={0} role="note" aria-label={`Help: ${label ?? ''}`}
      onMouseEnter={open} onMouseLeave={hide} onFocus={open} onBlur={hide}
      onKeyDown={(e) => { if (e.key === 'Escape') hide(); }}>
      ?
      <span class="help-pop-src sr-only" role="tooltip">{text}</span>
    </span>
  );
}
