import { profileLink } from '../html';
import { renderMarkdown } from '../markdown';

export function Author({ username }: { username: string | null }) {
  return username ? <a href={profileLink(username)}>{username}</a> : <>member</>;
}

export function Publisher({ hostname }: { hostname: string | null }) {
  if (!hostname) return null;
  return <span class="metadata">(<a href={`/new?domain=${encodeURIComponent(hostname)}`}>{hostname}</a>)</span>;
}

export function MarkdownBody({ source }: { source: string }) {
  return <div class="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }} />;
}

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'always' });
const timeUnits = [
  ['year', 365 * 86400], ['month', 30 * 86400], ['day', 86400], ['hour', 3600], ['minute', 60],
] as const;

export function RelativeTime({ seconds }: { seconds: number }) {
  const timestamp = new Date(seconds * 1000).toISOString();
  const age = Math.floor(Date.now() / 1000) - seconds;
  const unit = timeUnits.find(([, size]) => Math.abs(age) >= size);
  const label = unit ? relativeTime.format(-Math.trunc(age / unit[1]), unit[0]) : 'just now';
  return <time datetime={timestamp} title={`${timestamp.slice(0, 10)} ${timestamp.slice(11, 19)} UTC`}>{label}</time>;
}
