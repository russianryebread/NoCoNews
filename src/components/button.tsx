import type { Child } from 'hono/jsx';

export function Button({ tone = 'secondary', children, ...attributes }: {
  tone?: 'primary' | 'secondary' | 'compact';
  children?: Child;
  name?: string;
  value?: string;
  'aria-label'?: string;
  'aria-pressed'?: string;
}) {
  return <button type="submit" class={`button button--${tone}`} {...attributes}>{children}</button>;
}
