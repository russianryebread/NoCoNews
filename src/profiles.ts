import { renderMarkdown } from './markdown';
import { currentMember } from './auth';
import { readForm, redirect } from './forms';
import { escapeHtml, page, profileLink } from './html';

interface PublicProfile {
  id: number;
  username: string;
  bio: string;
}

function profilePage(profile: PublicProfile, own: boolean, error = '', draft = profile.bio): Response {
  const bio = profile.bio ? `<div class="markdown">${renderMarkdown(profile.bio)}</div>` : '';
  const edit = own ? `<form class="stack markdown-form editor-panel" method="post">
    <div class="markdown-field">
      <label for="bio-source">Edit bio</label>
      <textarea id="bio-source" name="bio" rows="3" maxlength="280" aria-describedby="bio-format">${escapeHtml(draft)}</textarea>
      <small class="metadata" id="bio-format">Public, up to 280 characters. Basic Markdown supported.</small>
    </div>
    ${error ? `<p role="alert">${escapeHtml(error)}</p>` : ''}
    <button>Save bio</button>
  </form>` : '';
  return page(profile.username, `<h1>${escapeHtml(profile.username)}</h1>${bio}${edit}`, error ? 400 : 200);
}

export async function profile(request: Request, db: D1Database, pathname: string): Promise<Response | undefined> {
  const match = /^\/users\/([a-zA-Z0-9_]{3,24})$/.exec(pathname);
  if (!match || !['GET', 'HEAD', 'POST'].includes(request.method)) return;
  const user = await db.prepare('SELECT id, username, bio FROM users WHERE username = ?')
    .bind(match[1]).first<PublicProfile>();
  if (!user) return page('User not found', '<h1>User not found</h1>', 404);

  const member = await currentMember(request, db);
  const own = member?.id === user.id;
  if (request.method !== 'POST') return profilePage(user, own);
  if (!member) return redirect('/login');
  if (!own) return page('Forbidden', '<h1>Access denied</h1>', 403);

  const form = await readForm(request);
  const bio = form.get('bio')?.trim() ?? '';
  if (bio.length > 280) return profilePage(user, true, 'Use up to 280 characters.', bio.slice(0, 280));
  await db.prepare("UPDATE users SET bio = ? WHERE id = ? AND state = 'active'").bind(bio, user.id).run();
  return redirect(profileLink(user.username));
}
