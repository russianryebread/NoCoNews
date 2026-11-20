import type { Member } from './auth';
import { Author, MarkdownBody, Publisher, RelativeTime } from './components/content';
import { Composer, StackForm } from './components/form';

export interface Story {
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

export interface Comment {
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


type ContentKind = 'story' | 'comment';

function Icon({ name }: { name: 'comment' | 'report' }) {
  const path = name === 'comment' ? 'M3.5 3.5h13v9h-8l-4 3v-3h-1z' : 'M5 17V3m0 1c4-3 6 2 11 0v8c-5 2-7-3-11 0';
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 20 20" fill="none"
    stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d={path} /></svg>;
}

function ReportLink({ kind, id, member }: { kind: ContentKind; id: number; member: Member | null }) {
  if (!member?.username) return null;
  const label = `Report ${kind}`;
  return <> · <a class="icon-link report-link" href={`/report?type=${kind}&id=${id}`} title={label}
    aria-label={label}><Icon name="report" /></a></>;
}

function VoteControl({ kind, item, member }: {
  kind: ContentKind; item: Pick<Story, 'id' | 'author_id' | 'voted'>; member: Member | null;
}) {
  if (!member?.username || member.id === item.author_id) return null;
  const resource = kind === 'story' ? 'stories' : 'comments';
  return <form class="inline" method="post" action={`/${resource}/${item.id}/vote`}>
    <button name="voted" value={item.voted ? '0' : '1'} aria-pressed={String(Boolean(item.voted))}
      aria-label={item.voted ? 'Remove upvote' : 'Upvote'}>▲</button>
  </form>;
}

export function StoryRow({ story, member, heading = false }: { story: Story; member: Member | null; heading?: boolean }) {
  const discussion = `/stories/${story.id}`;
  const articleUrl = story.url ? URL.parse(story.url) : null;
  const external = articleUrl && ['http:', 'https:'].includes(articleUrl.protocol);
  const comments = `${story.comment_count} ${story.comment_count === 1 ? 'comment' : 'comments'}`;
  const headline = heading && !external ? story.title :
    <a class="headline" href={external ? articleUrl.href : discussion}
      target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>{story.title}</a>;
  const vote = <VoteControl kind="story" item={story} member={member} />;
  const publisher = story.hostname && <Publisher hostname={story.hostname} />;

  return <article class={heading ? 'story discussion-story' : 'story'}>
    {heading ? <h1>{headline}</h1> : <>{vote}{headline}{' '}{publisher}</>}
    <div class="metadata">
      {heading && <>{vote}{publisher && <>{publisher}{' · '}</>}</>}
      {story.vote_count} points · <Author username={story.username} /> · <RelativeTime seconds={story.created_at} /> ·{' '}
      <a class="icon-link" href={heading ? `${discussion}#comments` : discussion} aria-label={comments} title={comments}>
        <Icon name="comment" /><span>{story.comment_count}</span>
      </a><ReportLink kind="story" id={story.id} member={member} />
    </div>
  </article>;
}

function CommentForm({ storyId, parentId }: { storyId: number; parentId?: number }) {
  const fieldId = parentId ? `reply-${parentId}-body` : 'comment-body';
  return <StackForm className={`markdown-form comment-form${parentId ? ' reply-form' : ''}`}
    action={`/stories/${storyId}/comments`}>
    <input type="hidden" name="key" value={crypto.randomUUID()} />
    {parentId && <input type="hidden" name="parent" value={parentId} />}
    <Composer id={fieldId} name="body" rows={parentId ? 2 : 3} maxLength={10000} required
      label={parentId ? 'Write a reply' : 'Add a comment'} placeholder={parentId ? undefined : 'Add a comment…'}
      submit={parentId ? 'Post reply' : 'Post comment'} />
  </StackForm>;
}

function CommentThread({ comments, storyId, member }: { comments: Comment[]; storyId: number; member: Member | null }) {
  const children = new Map<number | null, Comment[]>();
  for (const comment of comments) {
    const siblings = children.get(comment.parent_id) ?? [];
    siblings.push(comment);
    children.set(comment.parent_id, siblings);
  }

  function Branch({ parentId }: { parentId: number | null }) {
    const siblings = children.get(parentId);
    if (!siblings?.length) return null;
    return <ol class="comments">{siblings.map(comment =>
      <li id={`comment-${comment.id}`}>
        {comment.state === 'visible' ? <>
          <div class="metadata">
            <VoteControl kind="comment" item={comment} member={member} />{' '}
            <Author username={comment.username} /> · {comment.vote_count} points
            {comment.edited_at ? ' · edited' : ''}<ReportLink kind="comment" id={comment.id} member={member} />
          </div>
          <MarkdownBody source={comment.body} />
          {member?.username && comment.depth < 8 &&
            <details><summary>Reply</summary><CommentForm storyId={storyId} parentId={comment.id} /></details>}
        </> : <p class="metadata">[comment unavailable]</p>}
        <Branch parentId={comment.id} />
      </li>
    )}</ol>;
  }

  return children.has(null) ? <Branch parentId={null} /> : <p>No comments yet.</p>;
}

export function DiscussionView({ story, member, comments, focused, truncated }: {
  story: Story; member: Member | null; comments: Comment[]; focused?: boolean; truncated?: boolean;
}) {
  return <>
    <p class="discussion-back"><a href="/">‹ Top</a></p>
    <StoryRow story={story} member={member} heading />
    {story.body && <MarkdownBody source={story.body} />}
    <section class="discussion-thread" id={focused ? undefined : 'comments'}
      aria-label={focused ? undefined : 'Comments'} aria-labelledby={focused ? 'thread-title' : undefined}>
      {focused ? <>
        <h2 id="thread-title">Comment thread</h2>
        <p><a href={`/stories/${story.id}#comments`}>Full discussion</a></p>
      </> : member?.username ? <CommentForm storyId={story.id} /> : <p><a href="/account">Sign in to comment</a></p>}
      <CommentThread comments={comments} storyId={story.id} member={member} />
      {truncated && <p>Only the first 500 comments are shown.</p>}
    </section>
  </>;
}
