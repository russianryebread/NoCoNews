import { escapeHtml, page, publisherLink } from './html';

interface Match {
  story_id: number;
  comment_id: number | null;
  title: string;
  hostname: string | null;
  excerpt: string | null;
}

const storyQuery = `SELECT s.id AS story_id, NULL AS comment_id, s.title, s.hostname,
  snippet(story_search, 2, '', '', '…', 20) AS excerpt
  FROM story_search JOIN stories s ON s.id = story_search.rowid
  WHERE story_search MATCH ? AND s.state = 'visible'
  ORDER BY bm25(story_search, 5, 2, 1), s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`;

const commentQuery = `SELECT s.id AS story_id, c.id AS comment_id, s.title, s.hostname,
  snippet(comment_search, 0, '', '', '…', 20) AS excerpt
  FROM comment_search JOIN comments c ON c.id = comment_search.rowid
  JOIN stories s ON s.id = c.story_id
  WHERE comment_search MATCH ? AND c.state = 'visible' AND s.state = 'visible'
  ORDER BY bm25(comment_search), c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`;

export async function search(db: D1Database, url: URL): Promise<Response> {
  const query = url.searchParams.get('q')?.trim() ?? '';
  const type = url.searchParams.get('type') ?? 'stories';
  const step = Number(url.searchParams.get('page') ?? '1');
  const terms = query.match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
  const form = `<h1>Search</h1><form class="search" method="get" action="/search">
    <label for="q">Keywords</label>
    <input id="q" name="q" type="search" maxlength="160" value="${escapeHtml(query.slice(0, 160))}">
    <label for="type">Search in</label>
    <select id="type" name="type">
    <option value="stories">Stories</option>
    <option value="comments"${type === 'comments' ? ' selected' : ''}>Comments</option>
    </select><button>Search</button></form>`;

  if (query.length > 160 || terms.length > 8 || !['stories', 'comments'].includes(type)
      || !Number.isInteger(step) || step < 1 || step > 10) {
    return page('Search', `${form}<p>Use up to eight terms and 160 characters. Search pages run from 1 to 10.</p>`, 400);
  }
  if (!terms.length) return page('Search', `${form}<p>Enter keywords to search.</p>`);

  const expression = terms.map(term => `"${term}"`).join(' AND ');
  const { results } = await db.prepare(type === 'comments' ? commentQuery : storyQuery)
    .bind(expression, step === 10 ? 20 : 21, (step - 1) * 20).all<Match>();
  const rows = results.slice(0, 20).map(match => {
    const discussion = `/stories/${match.story_id}`;
    const target = match.comment_id
      ? `${discussion}?comment=${match.comment_id}#comment-${match.comment_id}`
      : discussion;
    return `<article class="story"><a class="headline" href="${target}">${escapeHtml(match.title)}</a>
      ${publisherLink(match.hostname)}
      ${match.excerpt ? `<div class="metadata">${escapeHtml(match.excerpt)}</div>` : ''}</article>`;
  });
  const link = (number: number, label: string) =>
    `<a href="/search?${escapeHtml(new URLSearchParams({ q: query, type, page: String(number) }))}">${label}</a>`;
  return page('Search', `${form}${rows.join('') || '<p>No matches.</p>'}
    <nav aria-label="Search pages">${step > 1 ? link(step - 1, 'Previous') : ''}
    ${results.length > 20 ? link(step + 1, 'More') : ''}</nav>`);
}
