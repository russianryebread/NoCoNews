import { MarkdownBody } from './components/content';
import { MarkdownField, StackForm } from './components/form';
import { currentMember } from './auth';
import { readForm, redirect } from './forms';
import { page, profileLink } from './html';

interface PublicProfile {
  id: number;
  username: string;
  bio: string;
}

function profilePage(profile: PublicProfile, own: boolean, error = '', draft = profile.bio): Response {
  return page(profile.username, (<>
    <h1>{profile.username}</h1>
    {profile.bio && <MarkdownBody source={profile.bio} />}
    {own && <StackForm className="markdown-form editor-panel">
      <MarkdownField id="bio-source" name="bio" label="Edit bio" rows={3} maxLength={280} value={draft}
        hint="Public, up to 280 characters. Basic Markdown supported." />
      {error && <p role="alert">{error}</p>}
      <button>Save bio</button>
    </StackForm>}
  </>).toString(), error ? 400 : 200);
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
