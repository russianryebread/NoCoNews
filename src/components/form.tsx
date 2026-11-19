import type { Child } from 'hono/jsx';

export function StackForm({ action, className, children }: {
  action?: string; className?: string; children?: Child;
}) {
  return <form class={className ? `stack ${className}` : 'stack'} method="post" action={action}>{children}</form>;
}

export function MarkdownField({ id, name, label, placeholder, rows, maxLength, required, value, hint, footer }: {
  id: string; name: string; label: string; placeholder?: string; rows: number; maxLength: number;
  required?: boolean; value?: string; hint?: Child; footer?: Child;
}) {
  const hintId = `${id}-format`;
  const help = hint && <small class="metadata" id={hintId}>{hint}</small>;
  return <>
    <div class="markdown-field">
      {!placeholder && <label for={id}>{label}</label>}
      <textarea id={id} name={name} rows={rows} maxlength={maxLength} required={required}
        aria-label={placeholder ? label : undefined} placeholder={placeholder}
        aria-describedby={hint ? hintId : undefined}>{value}</textarea>
      {!footer && help}
    </div>
    {footer && <div class="comment-form-actions">{help}{footer}</div>}
  </>;
}

export function HiddenTarget({ type, id }: { type: 'story' | 'comment'; id: number | null }) {
  return <><input type="hidden" name="type" value={type} /><input type="hidden" name="id" value={id ?? ''} /></>;
}

export function ModeratorReason({ label }: { label: string }) {
  return <label>{label} <input name="reason" maxlength={500} required /></label>;
}
