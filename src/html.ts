export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
  );
}

export function page(title: string, content: string, status = 200): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/site.css">
</head>
<body>
<header><a class="brand" href="/">NoCoNews</a><nav aria-label="Main">
<a href="/">Top</a> <a href="/new">New</a> <a href="/search">Search</a> <a href="/submit">Submit</a> <a href="/guidelines">Guidelines</a> <a href="/account">Account</a>
</nav></header>
<main>${content}</main>
</body>
</html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      // Native POSTs need a serialized Origin. Keep paths and query strings out of referrers.
      'Referrer-Policy': 'strict-origin',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function brand(response: Response, siteName: string): Response {
  if (!response.headers.get('Content-Type')?.startsWith('text/html')) return response;
  return new HTMLRewriter()
    .on('.brand', { element(element) { element.setInnerContent(siteName); } })
    .on('title', { element(element) { element.append(` · ${siteName}`); } })
    .transform(response);
}

export function publisherLink(hostname: string | null): string {
  if (!hostname) return '';
  return `<span class="metadata">(<a href="/new?domain=${encodeURIComponent(hostname)}">${escapeHtml(hostname)}</a>)</span>`;
}

export function icon(name: 'comment' | 'report'): string {
  const path = name === 'comment'
    ? 'M3.5 3.5h13v9h-8l-4 3v-3h-1z'
    : 'M5 17V3m0 1c4-3 6 2 11 0v8c-5 2-7-3-11 0';
  return `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 20 20" fill="none"
    stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
}
