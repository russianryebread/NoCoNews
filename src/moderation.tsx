import { currentMember, type Member } from './auth';
import { InvalidForm, readForm, redirect } from './forms';
import { page } from './html';
import { MarkdownBody } from './components/content';
import { HiddenTarget, Composer, ModeratorReason, StackForm } from './components/form';

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
  if (!['/guidelines', '/admin/guidelines', '/report', '/reports', '/moderation/reports', '/moderation/actions'].includes(path)) return;
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
    return page('Reports', (<><h1>Reports</h1>{entries.length ? entries : <p>No open reports.</p>}
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
  if (!reason || reason.length > 500 || (action !== 'dismiss' && action !== 'hide' && action !== 'restore')) throw new InvalidForm();
  const table = type === 'story' ? 'stories' : 'comments';
  const column = type === 'story' ? 'story_id' : 'comment_id';
  const from = action === 'restore' ? 'hidden' : 'visible';
  const to = action === 'restore' ? 'visible' : 'hidden';
  const statements = [
    db.prepare(`INSERT INTO moderation_actions(actor_id,action,target_type,target_id,reason)
      SELECT id,?,?,?,? FROM (${staff})
      WHERE EXISTS (SELECT 1 FROM ${table} WHERE id = ? AND (? = 'dismiss' OR state = ?))`)
      .bind(action, type, id, reason, member.id, id, action, from),
  ];
  if (action !== 'dismiss') {
    const unique = type === 'story' && action === 'restore'
      ? "AND NOT EXISTS (SELECT 1 FROM stories other WHERE other.state = 'visible' AND other.canonical_url = stories.canonical_url)"
      : '';
    // If a duplicate prevents restore, exclude that target from both the audit insert and update.
    if (unique) statements[0] = db.prepare(`INSERT INTO moderation_actions(actor_id,action,target_type,target_id,reason)
      SELECT id,?,?,?,? FROM (${staff}) WHERE EXISTS (SELECT 1 FROM stories WHERE id = ? AND state = ? ${unique})`)
      .bind(action, type, id, reason, member.id, id, from);
    statements.push(db.prepare(`UPDATE ${table} SET state = ? WHERE id = ? AND state = ? ${unique}
      AND EXISTS (${staff})`).bind(to, id, from, member.id));
  }
  if (action !== 'restore') statements.push(db.prepare(`UPDATE reports SET resolved_at = unixepoch(),resolution = ?
    WHERE ${column} = ? AND resolved_at IS NULL AND EXISTS (${staff})`).bind(action, id, member.id));
  const result = await db.batch(statements);
  if (!result[0].meta.changes) return page('Action unavailable', '<h1>Action unavailable</h1><p>Check the content state and any visible duplicates.</p>', 409);
  return redirect('/moderation/reports');
}
