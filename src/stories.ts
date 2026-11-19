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
  const { results } = await db.prepare(`SELECT c.id, c.parent_id, c.body, c.depth, c.state,
    c.vote_count, c.edited_at, u.username FROM comments c JOIN users u ON u.id = c.author_id
    WHERE c.story_id = ? ORDER BY c.created_at, c.id LIMIT 501`).bind(id).all<Comment>();
  const comments = commentList(results.slice(0, 500));
  return page(story.title, `<h1>Discussion</h1>${storyRow(story)}${body}<h2>Comments</h2>${comments}${results.length > 500 ? '<p>Only the first 500 comments are shown.</p>' : ''}`);
}

interface Comment {
  id: number;
  parent_id: number | null;
  body: string;
  state: 'visible' | 'hidden' | 'deleted';
  vote_count: number;
  edited_at: number | null;
  username: string | null;
}

function commentList(comments: Comment[]): string {
  const children = new Map<number | null, Comment[]>();
  for (const comment of comments) {
    const siblings = children.get(comment.parent_id) ?? [];
    siblings.push(comment);
    children.set(comment.parent_id, siblings);
  }

  function render(parent: number | null): string {
    const siblings = children.get(parent);
    if (!siblings?.length) return '';
    return `<ol class="comments">${siblings.map(comment => {
      const text = comment.state === 'visible'
        ? `<div class="metadata">${escapeHtml(comment.username ?? 'member')} · ${comment.vote_count} points${comment.edited_at ? ' · edited' : ''}</div>
           <div class="story-body">${escapeHtml(comment.body)}</div>`
        : '<p class="metadata">[comment unavailable]</p>';
      return `<li id="comment-${comment.id}">${text}${render(comment.id)}</li>`;
    }).join('')}</ol>`;
  }

  return render(null) || '<p>No comments yet.</p>';
}
