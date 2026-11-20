import { Button } from './button';
import type { Child } from 'hono/jsx';

export function StackForm({ action, className, children }: {
  action?: string; className?: string; children?: Child;
}) {
  return <form class={className ? `stack ${className}` : 'stack'} method="post" action={action}>{children}</form>;
}

export function Composer({ id, name, label, showLabel = false, placeholder, rows, maxLength, required, value, hint, submit, markdown = true }: {
  id: string; name: string; label: string; showLabel?: boolean; placeholder?: string; rows: number; maxLength: number;
  required?: boolean; value?: string; hint?: Child; submit: string; markdown?: boolean;
}) {
  const hintId = `${id}-hint`;
  return <div class="composer-field">
    {showLabel && <label for={id}>{label}</label>}
    <div class="composer" data-composer="">
      <textarea id={id} name={name} rows={rows} maxlength={maxLength} required={required}
        aria-label={showLabel ? undefined : label} placeholder={placeholder}
        aria-describedby={hint ? hintId : undefined}>{value}</textarea>
      <div class="composer-toolbar">
        {markdown && <details class="composer-help">
          <summary aria-label="Markdown formatting" title="Markdown formatting">
            <svg aria-hidden="true" width="20" height="16" viewBox="0 0 24 18" fill="none"
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 3h20v12H2zM5 12V6l3 3 3-3v6m6-6v6m-2-2 2 2 2-2" />
            </svg>
          </summary>
          <div class="composer-help-text">Use <code>**bold**</code>, <code>*italics*</code>, and <code>- list items</code>. Links and images display as text.</div>
        </details>}
        <span class="composer-count" data-count="" aria-label="Character count">
          <span data-length="">{(value ?? '').replace(/\r\n?/g, '\n').length}</span> / {maxLength}
        </span>
        <Button tone="primary">{submit}</Button>
      </div>
    </div>
    {hint && <small class="metadata" id={hintId}>{hint}</small>}
  </div>;
}

export function HiddenTarget({ type, id }: { type: 'story' | 'comment'; id: number | null }) {
  return <><input type="hidden" name="type" value={type} /><input type="hidden" name="id" value={id ?? ''} /></>;
}

export function ModeratorReason({ label }: { label: string }) {
  return <label>{label} <input name="reason" maxlength={500} required /></label>;
}
