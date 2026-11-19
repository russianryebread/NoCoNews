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
