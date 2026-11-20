import { currentMember, type Member } from './auth';
import { InvalidForm, readForm, redirect } from './forms';
import { page, profileLink } from './html';
import { MarkdownBody } from './components/content';
import { HiddenTarget, Composer, ModeratorReason, StackForm } from './components/form';

const moderationNav = () => <nav aria-label="Moderation"><a href="/moderation">Posts</a> <a href="/moderation?type=comment">Comments</a> <a href="/moderation?type=user">Accounts</a> <a href="/moderation/reports">Reports</a></nav>;

const reasons = ['Spam', 'Abuse', 'Duplicate', 'Off-topic', 'Other'];

function target(params: URLSearchParams): { type: 'story' | 'comment'; id: number } {
  const type = params.get('type');
  const id = Number(params.get('id'));
  if ((type !== 'story' && type !== 'comment') || !Number.isSafeInteger(id) || id < 1) throw new InvalidForm();
  return { type, id };
}

const staff = "SELECT id FROM users WHERE id = ? AND state = 'active' AND role IN ('admin','moderator')";

export async function moderation(request: Request, db: D1Database, url: URL): Promise<Response | undefined> {
  const path = url.pathname;
  if (!['/moderation', '/moderation/accounts', '/guidelines', '/admin/guidelines', '/report', '/reports', '/moderation/reports', '/moderation/actions'].includes(path)) return;
  const member = await currentMember(request, db);
  if (request.method === 'GET' && path === '/guidelines') {
    const text = await db.prepare('SELECT guidelines FROM community_settings WHERE id = 1').first<string>('guidelines');
    return page('Guidelines', (<>
      <h1>Community guidelines</h1>
      {text === null ? <p>Community guidelines will appear here when published.</p> : <MarkdownBody source={text} />}
      {member?.role === 'admin' && <StackForm className="composer-editor" action="/admin/guidelines">
        <Composer id="guidelines-source" name="guidelines" label="Edit community guidelines" placeholder="Write community guidelines…"
          rows={8} maxLength={10000} required value={text ?? ''}
          submit="Publish" />
      </StackForm>}
    </>).toString());
  }
  if (!member) return redirect('/login');

  if (request.method === 'POST' && path === '/admin/guidelines') {
    if (member.role !== 'admin') return denied();
    const form = await readForm(request);
    const text = form.get('guidelines')?.trim() ?? '';
    if (!text || text.length > 10000) throw new InvalidForm();
    const admin = "SELECT id FROM users WHERE id = ? AND state = 'active' AND role = 'admin'";
    await db.batch([
      db.prepare(`INSERT INTO community_settings(id,guidelines,editor_id) SELECT 1,?,id FROM (${admin})
        WHERE 1 ON CONFLICT(id) DO UPDATE SET guidelines = excluded.guidelines, editor_id = excluded.editor_id,
        updated_at = unixepoch()`).bind(text, member.id),
      db.prepare(`INSERT INTO moderation_actions(actor_id,action,target_type,target_id,reason)
        SELECT id,'publish','guidelines',1,'Updated community guidelines' FROM (${admin})`).bind(member.id),
    ]);
    return redirect('/guidelines');
  }

  if (request.method === 'GET' && path === '/report') {
    if (!member.username) return redirect('/account');
    const { type, id } = target(url.searchParams);
    return page('Report', (<><h1>Report {type}</h1><StackForm action="/reports">
      <HiddenTarget type={type} id={id} />
      <label>Reason <select name="reason">{reasons.map(reason => <option>{reason}</option>)}</select></label>
      <Composer id="report-note" name="note" label="Note" showLabel rows={4} maxLength={2000} markdown={false} submit="Send report" />
    </StackForm></>).toString());
  }
  if (request.method === 'POST' && path === '/reports') {
    if (!member.username) return redirect('/account');
    const form = await readForm(request);
    const { type, id } = target(form);
    const reason = form.get('reason') ?? '';
    const note = form.get('note')?.trim() || null;
    if (!reasons.includes(reason) || (note?.length ?? 0) > 2000) throw new InvalidForm();
    const visible = type === 'story'
      ? "SELECT id FROM stories WHERE id = ? AND state = 'visible'"
      : "SELECT c.id FROM comments c JOIN stories s ON c.story_id = s.id WHERE c.id = ? AND c.state = 'visible' AND s.state = 'visible'";
    const column = type === 'story' ? 'story_id' : 'comment_id';
    const [, found] = await db.batch([
      db.prepare(`INSERT OR IGNORE INTO reports(reporter_id,${column},reason,note)
        SELECT u.id,t.id,?,? FROM users u CROSS JOIN (${visible}) t
        WHERE u.id = ? AND u.state = 'active' AND u.username IS NOT NULL`).bind(reason, note, id, member.id),
      db.prepare(visible).bind(id),
    ]);
    if (!found.results.length) return page('Content unavailable', '<h1>Content unavailable</h1>', 404);
    return redirect('/account?reported=1');
  }
  if (member.role === 'member') return denied();

  if (request.method === 'GET' && path === '/moderation') return workspace(db, member, url);
  if (request.method === 'POST' && path === '/moderation/accounts') return moderateAccount(db, member, await readForm(request));

  if (request.method === 'GET' && path === '/moderation/reports') {
    const { results } = await db.prepare(`SELECT r.*, COALESCE(r.story_id,c.story_id) AS discussion
      FROM reports r LEFT JOIN comments c ON c.id = r.comment_id
      WHERE r.resolved_at IS NULL AND EXISTS (${staff}) ORDER BY r.created_at,r.id LIMIT 100`).bind(member.id).all<Report>();
    const entries = results.map(report => {
      const type = report.story_id ? 'story' : 'comment';
      const id = report.story_id ?? report.comment_id;
      return <article class="story"><a href={`/stories/${report.discussion}`}>{type} {id}</a>
        <p>{report.reason}{report.note && <> · {report.note}</>}</p>
        <StackForm action="/moderation/actions">
          <HiddenTarget type={type} id={id} />
          <ModeratorReason label="Moderator reason" />
          <div><button name="action" value="dismiss">Dismiss reports</button>{' '}
            <button name="action" value="hide">Hide</button></div>
        </StackForm></article>;
    });
    return page('Reports', (<><h1>Reports</h1>{moderationNav()}{entries.length ? entries : <p>No open reports.</p>}
      <h2>Restore content</h2><StackForm action="/moderation/actions">
        <label>Type <select name="type"><option>story</option><option>comment</option></select></label>
        <label>ID <input type="number" min={1} name="id" required /></label>
        <ModeratorReason label="Reason" />
        <button name="action" value="restore">Restore</button>
      </StackForm></>).toString());
  }
  if (request.method === 'POST' && path === '/moderation/actions') return moderate(db, member, await readForm(request));
}

interface Report {
  story_id: number | null;
  comment_id: number | null;
  discussion: number;
  reason: string;
  note: string | null;
}

function denied(): Response {
  return page('Forbidden', '<h1>Access denied</h1>', 403);
}

async function moderate(db: D1Database, member: Member, form: URLSearchParams): Promise<Response> {
  const { type, id } = target(form);
  const action = form.get('action');
  const reason = form.get('reason')?.trim() ?? '';
  if (!reason || reason.length > 500 || !['dismiss', 'hide', 'archive', 'remove', 'restore'].includes(action ?? '')) {
    throw new InvalidForm();
  }
  const table = type === 'story' ? 'stories' : 'comments';
  const column = type === 'story' ? 'story_id' : 'comment_id';
  const status = action === 'archive' ? 'archived' : action === 'remove' ? 'removed' : null;
  const rule = action === 'restore'
    ? type === 'story'
      ? "AND state = 'hidden' AND NOT EXISTS (SELECT 1 FROM stories other WHERE other.state = 'visible' AND other.canonical_url = stories.canonical_url)"
      : `AND state = 'hidden'
        AND EXISTS (SELECT 1 FROM stories s WHERE s.id = comments.story_id AND s.moderation_status IS NOT 'shadow')
        AND NOT EXISTS (WITH RECURSIVE ancestors(id, parent_id, moderation_status) AS (
          SELECT id, parent_id, moderation_status FROM comments c WHERE c.id = comments.parent_id
          UNION ALL SELECT c.id, c.parent_id, c.moderation_status FROM comments c JOIN ancestors a ON c.id = a.parent_id
        ) SELECT 1 FROM ancestors WHERE moderation_status = 'shadow')`
    : action === 'hide' ? "AND state = 'visible'"
    : action === 'archive' ? "AND state <> 'deleted' AND moderation_status IS NOT 'archived' AND moderation_status IS NOT 'removed'"
    : action === 'remove' ? "AND state <> 'deleted' AND moderation_status IS NOT 'removed'"
    : '';
  const statements = [db.prepare(`INSERT INTO moderation_actions(actor_id,action,target_type,target_id,reason)
    SELECT id,?,?,?,? FROM (${staff}) WHERE EXISTS (SELECT 1 FROM ${table} WHERE id = ? ${rule})`)
    .bind(action, type, id, reason, member.id, id)];
  if (action !== 'restore') {
    statements.push(db.prepare(`UPDATE reports SET resolved_at = unixepoch(),resolution = ?
      WHERE ${column} = ? AND resolved_at IS NULL AND EXISTS (${staff})
        AND EXISTS (SELECT 1 FROM ${table} WHERE id = ? ${rule})`).bind(action, id, member.id, id));
  }
  if (action !== 'dismiss') {
    statements.push(db.prepare(`UPDATE ${table} SET state = ?, moderation_status = ?
      WHERE id = ? ${rule} AND EXISTS (${staff})`)
      .bind(action === 'restore' ? 'visible' : 'hidden', status, id, member.id));
  }
  const result = await db.batch(statements);
  if (!result[0].meta.changes) {
    return page('Action unavailable', '<h1>Action unavailable</h1><p>Check the content state, parent thread, and any visible duplicate posts.</p>', 409);
  }
  return redirect(form.has('workspace') ? `/moderation?type=${type}` : '/moderation/reports');
}

interface WorkspaceItem {
  id: number;
  username: string | null;
  state: string;
  moderation_status: string | null;
  story_id: number;
  title: string;
  body: string | null;
  url: string | null;
}

async function workspace(db: D1Database, member: Member, url: URL): Promise<Response> {
  const type = url.searchParams.get('type') ?? 'story';
  const raw = url.searchParams.get('before');
  const before = Number(raw ?? Number.MAX_SAFE_INTEGER);
  if ((type !== 'story' && type !== 'comment' && type !== 'user') || !Number.isSafeInteger(before) || before < 1) throw new InvalidForm();

  if (type === 'user') {
    const { results } = await db.prepare(`SELECT id, username, role, state, shadow_banned FROM users
      WHERE id < ? AND EXISTS (${staff}) ORDER BY id DESC LIMIT 26`).bind(before, member.id)
      .all<{ id: number; username: string | null; role: string; state: string; shadow_banned: number }>();
    return page('Moderation', (<><h1>Moderation</h1>{moderationNav()}<h2>Accounts</h2>
      {results.slice(0, 25).map(user => <article class="moderation-item">
        <strong>{user.username ? <a href={profileLink(user.username)}>{user.username}</a> : `Account #${user.id}`}</strong>
        <div class="metadata">{user.role} · {user.shadow_banned ? 'Shadow-banned' : user.state}</div>
        {user.role === 'member' && <details><summary>Manage account</summary>
          <StackForm action="/moderation/accounts">
            <input type="hidden" name="id" value={user.id} />
            <ModeratorReason label="Reason" />
            <button name="action" value={user.shadow_banned ? 'unshadow' : 'shadow'}>
              {user.shadow_banned ? 'Lift shadow ban' : 'Shadow-ban account'}
            </button>
          </StackForm>
        </details>}
      </article>)}
      {results.length > 25 && <p><a href={`/moderation?type=user&before=${results[24].id}`}>Older accounts</a></p>}
    </>).toString());
  }
  const query = type === 'story'
    ? `SELECT s.id, u.username, s.state, s.moderation_status, s.id AS story_id, s.title, s.body, s.url
       FROM stories s JOIN users u ON s.author_id = u.id WHERE s.id < ? AND EXISTS (${staff}) ORDER BY s.id DESC LIMIT 26`
    : `SELECT c.id, u.username, c.state, c.moderation_status, c.story_id, s.title, c.body, NULL AS url
       FROM comments c JOIN users u ON c.author_id = u.id JOIN stories s ON s.id = c.story_id
       WHERE c.id < ? AND EXISTS (${staff}) ORDER BY c.id DESC LIMIT 26`;
  const { results } = await db.prepare(query).bind(before, member.id).all<WorkspaceItem>();
  const label = type === 'story' ? 'Posts' : 'Comments';
  return page('Moderation', (<><h1>Moderation</h1>{moderationNav()}<h2>{label}</h2>
    {!results.length && <p>No content on this page.</p>}
    {results.slice(0, 25).map(item => <article class="moderation-item">
      <strong>{item.title}</strong>
      <div class="metadata">#{item.id} · {item.username ?? 'Member'} · {item.moderation_status === 'shadow' ? 'Shadow-hidden' : item.moderation_status ?? item.state}</div>
      <details><summary>Review and manage</summary>
        {item.url && <p class="metadata">{item.url}</p>}
        {item.body && <MarkdownBody source={item.body} />}
        {item.state === 'visible' && <p><a href={type === 'story' ? `/stories/${item.story_id}` : `/stories/${item.story_id}?comment=${item.id}#comment-${item.id}`}>Open discussion</a></p>}
        {item.state !== 'deleted' && <StackForm action="/moderation/actions">
          <HiddenTarget type={type} id={item.id} />
          <input type="hidden" name="workspace" value="1" />
          <ModeratorReason label="Reason" />
          <div class="moderation-buttons">
            {item.state === 'visible' ? <button name="action" value="hide">Hide</button> : <button name="action" value="restore">Restore</button>}
            {item.moderation_status !== 'archived' && item.moderation_status !== 'removed' && <button name="action" value="archive">Archive</button>}
            {item.moderation_status !== 'removed' && <button name="action" value="remove">Remove</button>}
          </div>
        </StackForm>}
      </details>
    </article>)}
    {results.length > 25 && <p><a href={`/moderation?type=${type}&before=${results[24].id}`}>Older {label.toLowerCase()}</a></p>}
  </>).toString());
}

async function moderateAccount(db: D1Database, member: Member, form: URLSearchParams): Promise<Response> {
  const id = Number(form.get('id'));
  const action = form.get('action');
  const reason = form.get('reason')?.trim() ?? '';
  if (!Number.isSafeInteger(id) || id < 1 || !reason || reason.length > 500 || (action !== 'shadow' && action !== 'unshadow')) {
    throw new InvalidForm();
  }
  const value = action === 'shadow' ? 1 : 0;
  const [audit] = await db.batch([
    db.prepare(`INSERT INTO moderation_actions(actor_id,action,target_type,target_id,reason)
      SELECT id,?,'user',?,? FROM (${staff})
      WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND role = 'member' AND shadow_banned <> ?)`)
      .bind(action, id, reason, member.id, id, value),
    db.prepare(`UPDATE users SET shadow_banned = ? WHERE id = ? AND role = 'member'
      AND shadow_banned <> ? AND EXISTS (${staff})`).bind(value, id, value, member.id),
  ]);
  if (!audit.meta.changes) return page('Action unavailable', '<h1>Account action unavailable</h1>', 409);
  return redirect('/moderation?type=user');
}
