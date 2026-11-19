import { escapeHtml, page } from './html';

interface Story {
  id: number;
  title: string;
  url: string | null;
  hostname: string | null;
  body: string | null;
  username: string | null;
  created_at: number;
  vote_count: number;
  comment_count: number;
}

const storyColumns = `s.id, s.title, s.url, s.hostname, s.body, u.username,
  s.created_at, s.vote_count, s.comment_count`;

function storyRow(story: Story): string {
  const discussion = `/stories/${story.id}`;
  const target = story.url ?? discussion;
  const timestamp = new Date(story.created_at * 1000).toISOString();

  return `<article class="story">
  <a class="headline" href="${escapeHtml(target)}">${escapeHtml(story.title)}</a>
  ${story.hostname ? `<span class="metadata">(${escapeHtml(story.hostname)})</span>` : ''}
  <div class="metadata">${story.vote_count} points · ${escapeHtml(story.username ?? 'member')} ·
  <time datetime="${timestamp}">${timestamp.slice(0, 10)}</time> ·
  <a href="${discussion}">${story.comment_count} comments</a></div>
</article>`;
}

export async function feed(db: D1Database, url: URL): Promise<Response> {
  const title = url.pathname === '/' ? 'Top' : 'New';
  const cursor = url.searchParams.get('before');
  const [time, id] = cursor?.split('.').map(Number) ?? [];
  if (cursor !== null && (!/^\d+\.\d+$/.test(cursor) || !Number.isSafeInteger(time) || !Number.isSafeInteger(id))) {
    return page('Invalid page', '<h1>Invalid feed cursor</h1>', 400);
  }

  // Top uses the chronological fallback until the first ranking snapshot exists.
  const statement = db.prepare(`SELECT ${storyColumns} FROM stories s
    JOIN users u ON u.id = s.author_id WHERE s.state = 'visible'
    ${cursor === null ? '' : 'AND (s.created_at, s.id) < (?, ?)'}
    ORDER BY s.created_at DESC, s.id DESC LIMIT 31`);
  const { results } = await (cursor === null ? statement : statement.bind(time, id)).all<Story>();
  const last = results[29];
  const next = results.length > 30
    ? `<p><a href="${url.pathname}?before=${last.created_at}.${last.id}">More</a></p>`
    : '';
  return page(title, `<h1>${title}</h1>${results.length
    ? results.slice(0, 30).map(storyRow).join('')
    : '<p>No stories yet.</p>'}${next}`);
}

export async function discussion(db: D1Database, id: number): Promise<Response> {
  const story = await db.prepare(`SELECT ${storyColumns} FROM stories s
    JOIN users u ON u.id = s.author_id WHERE s.state = 'visible' AND s.id = ?`)
    .bind(id).first<Story>();
  if (!story) return page('Story not found', '<h1>Story not found</h1>', 404);
  const body = story.body ? `<p class="story-body">${escapeHtml(story.body)}</p>` : '';
  return page(story.title, `<h1>Discussion</h1>${storyRow(story)}${body}`);
}
