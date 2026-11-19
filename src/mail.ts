export type MailEnv = Pick<Env, 'MAIL_FROM' | 'MAIL_PROVIDER' | 'MAILGUN_DOMAIN' | 'MAILGUN_REGION'> & {
  EMAIL?: SendEmail;
  MAILGUN_API_KEY?: string;
};

export function mailConfigured(env: MailEnv): boolean {
  if (!env.MAIL_FROM) return false;
  if (env.MAIL_PROVIDER === 'mailgun') {
    return Boolean(env.MAILGUN_API_KEY && /^[a-z0-9.-]+$/i.test(env.MAILGUN_DOMAIN)
      && ['us', 'eu'].includes(env.MAILGUN_REGION));
  }
  return env.MAIL_PROVIDER === 'cloudflare' && Boolean(env.EMAIL);
}

export async function sendSignInMail(env: MailEnv, to: string, link: URL): Promise<void> {
  const message = {
    from: env.MAIL_FROM,
    to,
    subject: 'Your sign-in link',
    text: `Open this link within 15 minutes to sign in:\n${link.href}`,
  };
  if (env.MAIL_PROVIDER === 'cloudflare' && env.EMAIL) {
    await env.EMAIL.send(message);
    return;
  }
  if (env.MAIL_PROVIDER !== 'mailgun' || !mailConfigured(env)) throw new Error('Mail transport is not configured');

  const host = env.MAILGUN_REGION === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net';
  const body = new FormData();
  for (const [name, value] of Object.entries(message)) body.set(name, value);
  body.set('o:tracking', 'no');
  body.set('o:tracking-clicks', 'no');
  body.set('o:tracking-opens', 'no');

  const response = await fetch(`https://${host}/v3/${env.MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`api:${env.MAILGUN_API_KEY}`)}` },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Mailgun send failed (${response.status})`);
}
