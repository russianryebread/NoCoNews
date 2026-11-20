import type { Member } from './auth';
import { redirect } from './forms';
import { escapeHtml, page } from './html';
import { DiscussionView, StoryRow, type Comment, type Story } from './story-view';

const storyColumns = `s.id, s.author_id, s.title, s.url, s.hostname, s.body, u.username,
  s.created_at, s.vote_count, s.comment_count`;

export async function feed(db: D1Database, url: URL, member: Member | null): Promise<Response> {
  const domain = url.searchParams.get('domain')?.trim().toLowerCase() || null;
  if (domain && domain.length > 253) return page('Invalid domain', '<h1>Invalid domain filter</h1>', 400);
  if (!domain && url.pathname === '/' && !url.searchParams.has('before')) {
    const ranked = await rankedFeed(db, url, member);
    if (ranked) return ranked;
  }
  const title = domain ?? (url.pathname === '/' ? 'Top' : 'New');
  const cursor = url.searchParams.get('before');
  const [time, id] = cursor?.split('.').map(Number) ?? [];
  if (cursor !== null && (!/^\d+\.\d+$/.test(cursor) || !Number.isSafeInteger(time) || !Number.isSafeInteger(id))) {
    return page('Invalid page', '<h1>Invalid feed cursor</h1>', 400);
  }

  // Top uses the chronological fallback until the first ranking snapshot exists.
  const statement = db.prepare(`SELECT ${storyColumns}, EXISTS (SELECT 1 FROM story_votes v WHERE v.story_id = s.id AND v.user_id = ?) AS voted FROM stories s
    JOIN users u ON u.id = s.author_id WHERE (s.state = 'visible' OR (s.moderation_status = 'shadow' AND s.author_id = ?))
    ${domain ? 'AND s.hostname = ?' : ''}
    ${cursor === null ? '' : 'AND (s.created_at, s.id) < (?, ?)'}
    ORDER BY s.created_at DESC, s.id DESC LIMIT 31`);
  const bindings: (string | number | null)[] = [member?.id ?? null, member?.id ?? null];
  if (domain) bindings.push(domain);
  if (cursor !== null) bindings.push(time, id);
  const { results } = await statement.bind(...bindings).all<Story>();
  const last = results[29];
  const params = last ? new URLSearchParams({ before: `${last.created_at}.${last.id}` }) : null;
  if (params && domain) params.set('domain', domain);
  const next = results.length > 30
    ? `<p><a href="${escapeHtml(url.pathname)}?${escapeHtml(params)}">More</a></p>`
    : '';
  return page(title, `<h1>${escapeHtml(title)}</h1>${domain ? '<p class="metadata"><a href="/new">All domains</a></p>' : ''}${results.length
    ? results.slice(0, 30).map(story => StoryRow({ story, member }).toString()).join('')
    : '<p>No stories yet.</p>'}${next}`);
}

async function rankedFeed(db: D1Database, url: URL, member: Member | null): Promise<Response | undefined> {
  const cursor = url.searchParams.get('rank');
  const [generation, position] = cursor?.split('.').map(Number) ?? [];
  if (cursor && (!/^\d+\.\d+$/.test(cursor) || !Number.isSafeInteger(generation) ||
      !Number.isInteger(position) || position < 1 || position > 300)) {
    return page('Invalid page', '<h1>Invalid ranking cursor</h1>', 400);
  }
  const snapshot = cursor
    ? await db.prepare('SELECT generated_at FROM rank_generations WHERE generated_at = ?').bind(generation).first<number>('generated_at')
    : await db.prepare('SELECT max(generated_at) AS generated_at FROM rank_generations').first<number>('generated_at');
  if (snapshot === null) return cursor ? redirect('/?expired=1') : undefined;

  const { results } = await db.prepare(`SELECT ${storyColumns}, r.position,
      EXISTS (SELECT 1 FROM story_votes v WHERE v.story_id = s.id AND v.user_id = ?) AS voted
    FROM rank_entries r JOIN stories s ON s.id = r.story_id JOIN users u ON u.id = s.author_id
    WHERE r.generated_at = ? AND r.position > ? AND s.state = 'visible'
    ORDER BY r.position LIMIT 31`).bind(member?.id ?? null, snapshot, position ?? 0).all<Story & { position: number }>();
  if (!cursor && !results.length) return undefined;
  const next = results.length > 30
    ? `<p><a href="/?rank=${snapshot}.${results[29].position}">More</a></p>`
    : '';
  const notice = url.searchParams.has('expired') ? '<p>The previous ranking expired. Showing the latest ranking.</p>' : '';
  return page('Top', `<h1>Top</h1>${notice}${results.slice(0, 30).map(story => StoryRow({ story, member }).toString()).join('')
    || '<p>No more stories.</p>'}${next}`);
}

export async function discussion(db: D1Database, id: number, focus: string | null, member: Member | null): Promise<Response> {
  const story = await db.prepare(`SELECT ${storyColumns}, EXISTS (SELECT 1 FROM story_votes v WHERE v.story_id = s.id AND v.user_id = ?) AS voted FROM stories s
    JOIN users u ON u.id = s.author_id WHERE (s.state = 'visible' OR (s.moderation_status = 'shadow' AND s.author_id = ?)) AND s.id = ?`)
    .bind(member?.id ?? null, member?.id ?? null, id).first<Story>();
  if (!story) return page('Story not found', '<h1>Story not found</h1>', 404);
  if (focus && /^\d+$/.test(focus) && Number.isSafeInteger(Number(focus))) {
    const { results } = await db.prepare(`WITH RECURSIVE ancestors(id, parent_id) AS (
       SELECT id, parent_id FROM comments WHERE story_id = ? AND id = ? AND (state = 'visible' OR (moderation_status = 'shadow' AND author_id = ?))
       UNION
       SELECT c.id, c.parent_id FROM comments c JOIN ancestors a ON c.id = a.parent_id
       WHERE c.story_id = ?
    )
    SELECT c.id, c.author_id, c.parent_id, c.body, c.depth, CASE WHEN c.moderation_status = 'shadow' AND c.author_id = ? THEN 'visible' ELSE c.state END AS state, c.vote_count, c.edited_at, u.username,
      EXISTS (SELECT 1 FROM comment_votes v WHERE v.comment_id = c.id AND v.user_id = ?) AS voted
    FROM ancestors a JOIN comments c ON c.id = a.id JOIN users u ON u.id = c.author_id`)
      .bind(id, Number(focus), member?.id ?? null, id, member?.id ?? null, member?.id ?? null).all<Comment>();
    if (!results.length) return page('Comment not found', '<h1>Comment not found</h1>', 404);
    return page(story.title, DiscussionView({ story, member, comments: results, focused: true }).toString());
  }

  const { results } = await db.prepare(`SELECT c.id, c.author_id, c.parent_id, c.body, c.depth, CASE WHEN c.moderation_status = 'shadow' AND c.author_id = ? THEN 'visible' ELSE c.state END AS state,
    c.vote_count, c.edited_at, u.username,
    EXISTS (SELECT 1 FROM comment_votes v WHERE v.comment_id = c.id AND v.user_id = ?) AS voted FROM comments c JOIN users u ON u.id = c.author_id
    WHERE c.story_id = ? AND (c.moderation_status IS NOT 'shadow' OR c.author_id = ?) ORDER BY c.created_at, c.id LIMIT 501`).bind(member?.id ?? null, member?.id ?? null, id, member?.id ?? null).all<Comment>();
  return page(story.title, DiscussionView({
    story, member, comments: results.slice(0, 500), truncated: results.length > 500,
  }).toString());
}
