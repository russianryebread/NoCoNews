export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
  );
}

export function page(title: string, content: string, status = 200, previewStylesheet?: string): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/site.css">
<link rel="stylesheet" href="/theme.css">
${previewStylesheet ? `<link rel="stylesheet" href="${escapeHtml(previewStylesheet)}">` : ''}
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
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
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

export function profileLink(username: string): string {
  return `/users/${encodeURIComponent(username)}`;
}
