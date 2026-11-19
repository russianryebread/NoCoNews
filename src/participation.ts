import { currentMember, type Member } from './auth';
import { InvalidForm, readForm, redirect } from './forms';
import { page } from './html';

export function voteControl(kind: 'stories' | 'comments', id: number, voted: number, active: boolean): string {
  if (!active) return '';
  return `<form class="inline" method="post" action="/${kind}/${id}/vote">
    <button name="voted" value="${voted ? '0' : '1'}" aria-pressed="${Boolean(voted)}"
    aria-label="${voted ? 'Remove upvote' : 'Upvote'}">▲</button></form>`;
}

export function commentForm(story: number, parent?: number): string {
  return `<form class="stack" method="post" action="/stories/${story}/comments">
    <input type="hidden" name="key" value="${crypto.randomUUID()}">
    ${parent ? `<input type="hidden" name="parent" value="${parent}">` : ''}
    <label>${parent ? 'Reply' : 'Comment'} <textarea name="body" maxlength="10000" required rows="3"></textarea></label>
    <button>Post ${parent ? 'reply' : 'comment'}</button></form>`;
}

function submissionForm(): Response {
  return page('Submit', `<h1>Submit a story</h1><form class="stack" method="post" action="/stories">
    <input type="hidden" name="key" value="${crypto.randomUUID()}">
    <label>Title <input name="title" maxlength="200" required></label>
    <label>Link <input name="url" type="url" maxlength="2048"></label>
    <label>Text <textarea name="body" maxlength="10000" rows="5"></textarea></label>
    <p class="metadata">Enter a link or write a text post.</p><button>Submit</button></form>`);
}

function requestKey(form: URLSearchParams): string {
  const key = form.get('key') ?? '';
  if (!/^[a-f0-9-]{36}$/.test(key)) throw new InvalidForm();
  return key;
}

function conflict(): Response {
  return page('Conflicting request', '<h1>Conflicting request</h1><p>Open the form again and retry.</p>', 409);
}

async function createStory(db: D1Database, member: Member, form: URLSearchParams): Promise<Response> {
  const key = requestKey(form);
  const title = form.get('title')?.trim() ?? '';
  const link = form.get('url')?.trim() || null;
  const body = form.get('body')?.trim() || null;
  if (!title || title.length > 200 || Boolean(link) === Boolean(body) || (body?.length ?? 0) > 10000) throw new InvalidForm();
  let canonical: URL | null = null;
  if (link) {
    canonical = URL.parse(link);
    if (!canonical || link.length > 2048 || !['http:', 'https:'].includes(canonical.protocol) ||
        canonical.username || canonical.password) throw new InvalidForm();
    canonical.hash = '';
    const tracking = [...canonical.searchParams.keys()]
      .filter(param => /^utm_/i.test(param) || /^(fbclid|gclid)$/i.test(param));
    for (const param of tracking) canonical.searchParams.delete(param);
  }
  const normalizedUrl = canonical?.href ?? null;
  const [, byKey, byLink] = await db.batch<{ id: number; title: string; url: string | null; body: string | null; state: string }>([
    db.prepare(`INSERT OR IGNORE INTO stories(author_id,title,url,canonical_url,hostname,body,request_key)
      SELECT id,?,?,?,?,?,? FROM users WHERE id = ? AND state = 'active' AND username IS NOT NULL`)
      .bind(title, link, normalizedUrl, canonical?.hostname ?? null, body, key, member.id),
    db.prepare('SELECT id,title,url,body,state FROM stories WHERE author_id = ? AND request_key = ?').bind(member.id, key),
    db.prepare("SELECT id FROM stories WHERE canonical_url = ? AND state = 'visible'").bind(normalizedUrl),
  ]);
  const own = byKey.results[0];
  if (own && (own.title !== title || own.url !== link || own.body !== body)) return conflict();
  const destination = own ? (own.state === 'visible' ? own : undefined) : byLink.results[0];
  if (!destination) return conflict();
  return redirect(`/stories/${destination.id}`);
}

async function createComment(db: D1Database, member: Member, story: number, form: URLSearchParams): Promise<Response> {
  const key = requestKey(form);
  const parentText = form.get('parent');
  const parent = parentText ? Number(parentText) : null;
  const body = form.get('body')?.trim() ?? '';
  if (!body || body.length > 10000 || (parent !== null && (!Number.isSafeInteger(parent) || parent <= 0))) throw new InvalidForm();
  const [, result] = await db.batch<{ id: number; story_id: number; parent_id: number | null; body: string; state: string }>([
    db.prepare(`INSERT OR IGNORE INTO comments(story_id,parent_id,author_id,body,depth,request_key)
      SELECT s.id, ?, u.id, ?, coalesce(p.depth + 1, 0), ? FROM stories s JOIN users u ON u.id = ?
      LEFT JOIN comments p ON p.id = ? AND p.story_id = s.id AND p.state = 'visible' AND p.depth < 8
      WHERE s.id = ? AND s.state = 'visible' AND u.state = 'active' AND u.username IS NOT NULL
        AND (? IS NULL OR p.id IS NOT NULL)`).bind(parent, body, key, member.id, parent, story, parent),
    db.prepare('SELECT id,story_id,parent_id,body,state FROM comments WHERE author_id = ? AND request_key = ?').bind(member.id, key),
  ]);
  const comment = result.results[0];
  if (!comment || comment.story_id !== story || comment.parent_id !== parent || comment.body !== body ||
      comment.state !== 'visible') return conflict();
  return redirect(`/stories/${story}?comment=${comment.id}#comment-${comment.id}`);
}

async function vote(db: D1Database, member: Member, kind: string, id: number, form: URLSearchParams): Promise<Response> {
  const state = form.get('voted');
  if (state !== '0' && state !== '1') throw new InvalidForm();
  const story = kind === 'stories';
  const table = story ? 'story_votes' : 'comment_votes';
  const targetKey = story ? 'story_id' : 'comment_id';
  const target = story
    ? "SELECT id, id AS story_id FROM stories WHERE id = ? AND state = 'visible' AND author_id <> ?"
    : `SELECT c.id,c.story_id FROM comments c JOIN stories s ON s.id = c.story_id
       WHERE c.id = ? AND c.state = 'visible' AND s.state = 'visible' AND c.author_id <> ?`;
  const user = "SELECT id FROM users WHERE id = ? AND state = 'active' AND username IS NOT NULL";
  const [, result] = await db.batch<{ story_id: number }>([
    state === '1'
      ? db.prepare(`INSERT OR IGNORE INTO ${table}(${targetKey},user_id) SELECT target.id, voter.id
          FROM (${target}) target CROSS JOIN (${user}) voter`).bind(id, member.id, member.id)
      : db.prepare(`DELETE FROM ${table} WHERE ${targetKey} IN (SELECT id FROM (${target}))
          AND user_id IN (${user})`).bind(id, member.id, member.id),
    db.prepare(`SELECT story_id FROM (${target}) CROSS JOIN (${user})`).bind(id, member.id, member.id),
  ]);
  const destination = result.results[0];
  if (!destination) return page('Vote unavailable', '<h1>This vote is unavailable</h1>', 403);
  return redirect(story ? `/stories/${id}` : `/stories/${destination.story_id}?comment=${id}#comment-${id}`);
}

export async function participation(request: Request, db: D1Database, url: URL): Promise<Response | undefined> {
  const submit = request.method === 'GET' && url.pathname === '/submit';
  const create = request.method === 'POST' && url.pathname === '/stories';
  const target = request.method === 'POST' && /^\/(stories|comments)\/(\d+)\/(vote|comments)$/.exec(url.pathname);
  if (!submit && !create && !target) return;
  const member = await currentMember(request, db);
  if (!member) return redirect('/login');
  if (!member.username) return redirect('/account');
  if (submit) return submissionForm();
  const form = await readForm(request);
  if (create) return createStory(db, member, form);
  if (!target) return;
  const [, kind, rawId, action] = target;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id < 1) throw new InvalidForm();
  if (action === 'vote') return vote(db, member, kind, id, form);
  if (kind === 'stories') return createComment(db, member, id, form);
}
