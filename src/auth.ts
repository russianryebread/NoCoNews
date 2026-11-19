import { cookieValue, InvalidForm, readForm, redirect } from './forms';
import { escapeHtml, page } from './html';

const sessionCookie = '__Host-session';
const confirmCookie = '__Host-confirm';
const sessionSeconds = 30 * 86400;
const cookieFlags = 'Path=/; HttpOnly; Secure; SameSite=Lax';

export type AppEnv = Env & { TURNSTILE_SECRET?: string };

export interface Member {
  id: number;
  username: string | null;
  role: 'member' | 'moderator' | 'admin';
}

export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    byte => byte.toString(16).padStart(2, '0')).join('');
}

function token(): string {
  return crypto.randomUUID() + crypto.randomUUID();
}

export async function currentMember(request: Request, db: D1Database): Promise<Member | null> {
  const session = cookieValue(request, sessionCookie);
  if (!session) return null;
  return db.prepare(`SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.digest = ? AND s.expires_at > unixepoch() AND u.state = 'active'`)
    .bind(await digest(session)).first<Member>();
}

function allowed(env: AppEnv, email: string): boolean {
  return email.length > 0 && env.LOGIN_RECIPIENTS.split(',')
    .some(recipient => recipient.trim().toLowerCase() === email);
}

async function requestLink(request: Request, env: AppEnv, form: URLSearchParams): Promise<Response> {
  const response = () => page('Check your inbox', '<h1>Check your inbox</h1><p>If your address is invited, we’ll send a sign-in link.</p>');
  const { success } = await env.LOGIN_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' });
  if (!success) return page('Try again later', '<h1>Too many sign-in requests</h1>', 429);

  const challenge = form.get('cf-turnstile-response');
  if (!env.TURNSTILE_SECRET || !env.TURNSTILE_SITE_KEY || !env.PUBLIC_ORIGIN || !env.MAIL_FROM) {
    return page('Sign-in unavailable', '<h1>Sign-in has not been configured</h1>', 503);
  }
  const retry = () => page('Verification required', '<h1>Could not verify your sign-in request</h1><p><a href="/login">Try signing in again</a></p>', 400);
  if (!challenge || challenge.length > 2048) return retry();
  const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: challenge }),
  });
  const result = await verification.json<{ success?: boolean; hostname?: string }>();
  if (!result.success || result.hostname !== new URL(env.PUBLIC_ORIGIN).hostname) return retry();

  const email = form.get('email')?.trim().toLowerCase() ?? '';
  if (!allowed(env, email)) return response();

  const now = Math.floor(Date.now() / 1000);
  const quota = await env.DB.prepare(`INSERT INTO login_quotas(email, last_request, day, sent)
    VALUES (?, ?, ?, 1) ON CONFLICT(email) DO UPDATE
    SET last_request = excluded.last_request, day = excluded.day,
      sent = CASE WHEN day = excluded.day THEN sent + 1 ELSE 1 END
    WHERE last_request <= excluded.last_request - 60 AND (day <> excluded.day OR sent < 5)`)
    .bind(email, now, Math.floor(now / 86400)).run();
  if (!quota.meta.changes) return response();

  const raw = token();
  const hashed = await digest(raw);
  await env.DB.prepare('INSERT INTO login_challenges VALUES (?, ?, ?)').bind(hashed, email, now + 900).run();
  const link = new URL('/auth/confirm', env.PUBLIC_ORIGIN);
  link.searchParams.set('token', raw);
  try {
    await env.EMAIL.send({
      from: env.MAIL_FROM, to: email, subject: 'Your sign-in link',
      text: `Open this link within 15 minutes to sign in:\n${link.href}`,
    });
  } catch {
    await env.DB.prepare('DELETE FROM login_challenges WHERE digest = ?').bind(hashed).run();
    console.error({ event: 'sign_in_email_failed' });
  }
  return response();
}

async function confirm(env: AppEnv, request: Request, form: URLSearchParams): Promise<Response> {
  const raw = form.get('token');
  const csrf = cookieValue(request, confirmCookie);
  if (!raw || raw.length !== 72 || !csrf || csrf !== form.get('csrf')) throw new InvalidForm();
  const hashed = await digest(raw);
  const challenge = await env.DB.prepare('SELECT email FROM login_challenges WHERE digest = ? AND expires_at > unixepoch()')
    .bind(hashed).first<{ email: string }>();
  const expired = () => page('Link expired', '<h1>Link expired or already used</h1><p><a href="/login">Request a new link</a></p>', 400);
  if (!challenge || !allowed(env, challenge.email)) return expired();

  const session = token();
  const match = 'SELECT email FROM login_challenges WHERE digest = ? AND expires_at > unixepoch()';
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO users(email) ${match}`).bind(hashed),
    env.DB.prepare(`INSERT OR IGNORE INTO admin_bootstrap(id, user_id) SELECT 1, id FROM users
      WHERE email = ? AND email IN (${match}) AND state = 'active'`)
      .bind(env.ADMIN_EMAIL.trim().toLowerCase(), hashed),
    env.DB.prepare(`INSERT INTO sessions(digest, user_id, expires_at)
      SELECT ?, id, unixepoch() + ? FROM users WHERE state = 'active' AND email IN (${match})`)
      .bind(await digest(session), sessionSeconds, hashed),
    env.DB.prepare('DELETE FROM login_challenges WHERE digest = ?').bind(hashed),
  ]);
  if (!results[2].meta.changes) return expired();
  const response = redirect('/account', `${sessionCookie}=${session}; ${cookieFlags}; Max-Age=${sessionSeconds}`);
  response.headers.append('Set-Cookie', `${confirmCookie}=; ${cookieFlags}; Max-Age=0`);
  return response;
}

export async function auth(request: Request, env: AppEnv, url: URL): Promise<Response | undefined> {
  if (request.method === 'GET') {
    if (url.pathname === '/login') {
      if (!env.TURNSTILE_SITE_KEY) return page('Sign in', '<h1>Sign in</h1><p>Sign-in is not configured yet.</p>', 503);
      const response = page('Sign in', `<section class="auth-panel" aria-labelledby="sign-in-title">
        <h1 id="sign-in-title">Sign in</h1>
        <p>Use the email address on your invitation.</p>
        <form class="stack" method="post" action="/auth/request">
          <label for="sign-in-email">Email address
            <input id="sign-in-email" type="email" name="email" autocomplete="email" maxlength="254" required>
          </label>
          <div class="cf-turnstile" data-size="flexible" data-sitekey="${escapeHtml(env.TURNSTILE_SITE_KEY)}"></div>
          <button class="primary">Send sign-in link</button>
        </form></section>
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`);
      response.headers.set('Content-Security-Policy', response.headers.get('Content-Security-Policy') +
        "; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com");
      return response;
    }
    if (url.pathname === '/auth/confirm') {
      const raw = url.searchParams.get('token') ?? '';
      if (!/^[a-f0-9-]{72}$/.test(raw)) throw new InvalidForm();
      const csrf = token();
      const response = page('Confirm sign-in', `<h1>Confirm sign-in</h1>
        <form class="stack" method="post" action="/auth/confirm">
        <input type="hidden" name="token" value="${escapeHtml(raw)}">
        <input type="hidden" name="csrf" value="${csrf}">
        <button>Sign in</button></form>`);
      response.headers.set('Set-Cookie', `${confirmCookie}=${csrf}; ${cookieFlags}; Max-Age=900`);
      return response;
    }
    if (url.pathname === '/account') {
      const member = await currentMember(request, env.DB);
      if (!member) return redirect('/login');
      return page('Account', `<h1>Account</h1>${url.searchParams.has('reported') ? '<p>Report received.</p>' : ''}
        ${member.role !== 'member' ? '<p><a href="/moderation/reports">Moderation queue</a></p>' : ''}
        ${member.username ? `<p>${escapeHtml(member.username)}</p>` :
        '<form class="stack" method="post" action="/account"><label>Username <input name="username" required maxlength="24"></label> <button>Save</button></form>'}
        <form method="post" action="/auth/logout"><button>Sign out</button></form>`);
    }
  }
  if (request.method !== 'POST') return;
  if (url.pathname === '/auth/request') return requestLink(request, env, await readForm(request));
  if (url.pathname === '/auth/confirm') return confirm(env, request, await readForm(request));
  if (url.pathname === '/auth/logout') {
    await readForm(request);
    const session = cookieValue(request, sessionCookie);
    if (session) await env.DB.prepare('DELETE FROM sessions WHERE digest = ?').bind(await digest(session)).run();
    return redirect('/', `${sessionCookie}=; ${cookieFlags}; Max-Age=0`);
  }
  if (url.pathname === '/account') {
    const form = await readForm(request);
    const member = await currentMember(request, env.DB);
    if (!member) return redirect('/login');
    if (member.username) return redirect('/account');
    const username = form.get('username')?.trim() ?? '';
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      return page('Invalid username', '<h1>Use 3–24 letters, digits, or underscores</h1><a href="/account">Try again</a>', 400);
    }
    const result = await env.DB.prepare("UPDATE OR IGNORE users SET username = ? WHERE id = ? AND username IS NULL AND state = 'active'")
      .bind(username, member.id).run();
    if (!result.meta.changes) return page('Username unavailable', '<h1>Username unavailable</h1><a href="/account">Try again</a>', 409);
    return redirect('/account');
  }
}
