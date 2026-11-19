import { renderMarkdown } from './markdown';
import { reportLink } from './moderation';
import type { Member } from './auth';
import { commentForm, voteControl } from './participation';
import { redirect } from './forms';
import { authorLink, escapeHtml, icon, page, publisherLink } from './html';

interface Story {
  author_id: number;
  voted: number;
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

const storyColumns = `s.id, s.author_id, s.title, s.url, s.hostname, s.body, u.username,
  s.created_at, s.vote_count, s.comment_count`;

function storyRow(story: Story, member: Member | null, heading = false): string {
  const discussion = `/stories/${story.id}`;
  const articleUrl = story.url ? URL.parse(story.url) : null;
  const external = articleUrl && ['http:', 'https:'].includes(articleUrl.protocol);
  const target = external ? articleUrl.href : discussion;
  const comments = `${story.comment_count} ${story.comment_count === 1 ? 'comment' : 'comments'}`;
  const timestamp = new Date(story.created_at * 1000).toISOString();

  const headline = heading && !external ? escapeHtml(story.title)
    : `<a class="headline" href="${escapeHtml(target)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(story.title)}</a>`;
  const vote = voteControl('stories', story.id, story.voted, Boolean(member?.username && member.id !== story.author_id));
  const publisher = publisherLink(story.hostname);

  return `<article class="story${heading ? ' discussion-story' : ''}">
  ${heading ? `<h1>${headline}</h1>` : `${vote}${headline} ${publisher}`}
  <div class="metadata">${heading ? `${vote}${publisher ? publisher + ' · ' : ''}` : ''}${story.vote_count} points · ${authorLink(story.username)} ·
  <time datetime="${timestamp}">${timestamp.slice(0, 10)}</time> ·
  <a class="icon-link" href="${discussion}${heading ? '#comments' : ''}" aria-label="${comments}" title="${comments}">${icon('comment')}<span>${story.comment_count}</span></a>${reportLink('story', story.id, member)}</div>
</article>`;
}

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
    JOIN users u ON u.id = s.author_id WHERE s.state = 'visible'
    ${domain ? 'AND s.hostname = ?' : ''}
    ${cursor === null ? '' : 'AND (s.created_at, s.id) < (?, ?)'}
    ORDER BY s.created_at DESC, s.id DESC LIMIT 31`);
  const bindings: (string | number | null)[] = [member?.id ?? null];
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
    ? results.slice(0, 30).map(story => storyRow(story, member)).join('')
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
  return page('Top', `<h1>Top</h1>${notice}${results.slice(0, 30).map(story => storyRow(story, member)).join('')
    || '<p>No more stories.</p>'}${next}`);
}

export async function discussion(db: D1Database, id: number, focus: string | null, member: Member | null): Promise<Response> {
  const story = await db.prepare(`SELECT ${storyColumns}, EXISTS (SELECT 1 FROM story_votes v WHERE v.story_id = s.id AND v.user_id = ?) AS voted FROM stories s
    JOIN users u ON u.id = s.author_id WHERE s.state = 'visible' AND s.id = ?`)
    .bind(member?.id ?? null, id).first<Story>();
  if (!story) return page('Story not found', '<h1>Story not found</h1>', 404);
  const body = story.body ? `<div class="markdown">${renderMarkdown(story.body)}</div>` : '';
  const intro = `<p class="discussion-back"><a href="/">‹ Top</a></p>${storyRow(story, member, true)}${body}`;
  if (focus && /^\d+$/.test(focus) && Number.isSafeInteger(Number(focus))) {
    const { results } = await db.prepare(`WITH RECURSIVE ancestors(id, parent_id) AS (
       SELECT id, parent_id FROM comments WHERE story_id = ? AND id = ? AND state = 'visible'
       UNION
       SELECT c.id, c.parent_id FROM comments c JOIN ancestors a ON c.id = a.parent_id
       WHERE c.story_id = ?
    )
    SELECT c.id, c.author_id, c.parent_id, c.body, c.depth, c.state, c.vote_count, c.edited_at, u.username,
      EXISTS (SELECT 1 FROM comment_votes v WHERE v.comment_id = c.id AND v.user_id = ?) AS voted
    FROM ancestors a JOIN comments c ON c.id = a.id JOIN users u ON u.id = c.author_id`)
      .bind(id, Number(focus), id, member?.id ?? null).all<Comment>();
    if (!results.length) return page('Comment not found', '<h1>Comment not found</h1>', 404);
    return page(story.title, `${intro}<section class="discussion-thread" aria-labelledby="thread-title">
      <h2 id="thread-title">Comment thread</h2><p><a href="/stories/${id}#comments">Full discussion</a></p>
      ${commentList(results, id, member)}</section>`);
  }

  const { results } = await db.prepare(`SELECT c.id, c.author_id, c.parent_id, c.body, c.depth, c.state,
    c.vote_count, c.edited_at, u.username,
    EXISTS (SELECT 1 FROM comment_votes v WHERE v.comment_id = c.id AND v.user_id = ?) AS voted FROM comments c JOIN users u ON u.id = c.author_id
    WHERE c.story_id = ? ORDER BY c.created_at, c.id LIMIT 501`).bind(member?.id ?? null, id).all<Comment>();
  const comments = commentList(results.slice(0, 500), id, member);
  return page(story.title, `${intro}<section class="discussion-thread" id="comments" aria-label="Comments">
    ${member?.username ? commentForm(id) : '<p><a href="/account">Sign in to comment</a></p>'}
    ${comments}${results.length > 500 ? '<p>Only the first 500 comments are shown.</p>' : ''}</section>`);
}

interface Comment {
  author_id: number;
  depth: number;
  voted: number;
  id: number;
  parent_id: number | null;
  body: string;
  state: 'visible' | 'hidden' | 'deleted';
  vote_count: number;
  edited_at: number | null;
  username: string | null;
}

function commentList(comments: Comment[], story: number, member: Member | null): string {
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
        ? `<div class="metadata">${voteControl('comments', comment.id, comment.voted, Boolean(member?.username && member.id !== comment.author_id))} ${authorLink(comment.username)} · ${comment.vote_count} points${comment.edited_at ? ' · edited' : ''}${reportLink('comment', comment.id, member)}</div>
           <div class="markdown">${renderMarkdown(comment.body)}</div>
           ${member?.username && comment.depth < 8 ? `<details><summary>Reply</summary>${commentForm(story, comment.id)}</details>` : ''}`
        : '<p class="metadata">[comment unavailable]</p>';
      return `<li id="comment-${comment.id}">${text}${render(comment.id)}</li>`;
    }).join('')}</ol>`;
  }

  return render(null) || '<p>No comments yet.</p>';
}
