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
<title>${escapeHtml(title)} · NoCoNews</title>
<link rel="stylesheet" href="/site.css">
</head>
<body>
<header><a class="brand" href="/">NoCoNews</a><nav aria-label="Main">
<a href="/">Top</a> <a href="/new">New</a> <a href="/search">Search</a> <a href="/submit">Submit</a> <a href="/account">Account</a>
</nav></header>
<main>${content}</main>
</body>
</html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
