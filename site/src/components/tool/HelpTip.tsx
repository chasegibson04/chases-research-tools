/** The (?) tooltip every parameter must have. Keyboard focusable; hover or focus reveals. */
export function HelpTip({ text, label }: { text: string; label?: string }) {
  return (
    <span class="help" tabIndex={0} role="note" aria-label={`Help: ${label ?? ''}`}>
      ?
      <span class="help-pop" role="tooltip">{text}</span>
    </span>
  );
}
