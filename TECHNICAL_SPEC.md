# NoCoNews technical specification

**Status:** Draft for review · November 19, 2026

## Product scope

NoCoNews is a community news aggregator where readers submit links, vote, discuss stories, and report problems. The working assumption is a Northern Colorado focus based on the project name. Readers can browse anonymously. Verified members can submit links or text discussions, reply, upvote stories and comments, and report. Moderators review reports and enforce community rules.

The first release includes ranked and chronological feeds, story discussions, full-text search, public usernames, and a private moderation queue. “Submission reports” means member reports about submitted stories. The same workflow supports comment reports. Automated RSS ingestion, downvotes, notifications, and media uploads are deferred.

## Cloudflare architecture

| Concern | Proposed service |
| --- | --- |
| Domain and HTTPS | Cloudflare DNS and a Workers Custom Domain |
| Application | One TypeScript Worker, server-rendered HTML templates, plain CSS, and small vanilla JavaScript enhancements |
| CSS and JavaScript | Workers Static Assets, bundled with the application and served from the same origin |
| Application state | One D1 database per environment |
| Scheduled work | Worker Cron Triggers for ranking snapshots and bounded cleanup |
| Abuse controls | Turnstile, Workers Rate Limiting, and application-level controls |
| Sign-in email | Cloudflare Email Service Workers binding, using a verified sending domain |
| Telemetry and recovery | Workers Logs, D1 query metrics, and D1 Time Travel |

The browser talks to the Worker on the site domain. The Worker reads and writes through Cloudflare bindings. A story click navigates directly to the publisher. The Worker derives the displayed hostname from the submitted URL and does not fetch publisher pages or embed their resources. Production needs no external application host, database, identity provider, email vendor, or asset CDN. Recipient mailboxes and linked publishers are outside the app's infrastructure boundary.

Use Workers Paid for public transactional email. Cloudflare documents Email Sending as beta, so staging must confirm arbitrary-recipient access, sending quotas, and delivery to representative inboxes before launch. If it is unavailable in the account, public launch is blocked pending a revised sign-in decision that preserves the Cloudflare-only requirement.

Platform references. [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) · [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) · [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) · [Cloudflare Email Service](https://developers.cloudflare.com/email-service/) · [Sending email setup](https://developers.cloudflare.com/email-service/get-started/send-emails/)

## User workflows

- **Feeds.** The home page shows Top, with New available as a separate route. Each row shows the title, publisher domain for links, author, age, vote count, and discussion link. Use 30 stories per page and stable continuation cursors.
- **Submission.** Require a title and either a link or a text body. Allow HTTP and HTTPS links, reject embedded credentials, and enforce length limits. Canonicalize by dropping fragments and known tracking parameters while preserving other URL semantics. If the same canonical URL already has a visible submission, link to that discussion. Enforce uniqueness in D1 for visible links so simultaneous requests converge on one submission. For a match against a hidden story, do not disclose the hidden record to the submitter.
- **Voting.** A verified member can set or remove one upvote per submitted article, text story, or comment. Authors cannot vote on their own content. Each score starts at zero and reflects active votes. Show the member's current vote state and the committed count in the response. Story votes affect Top. Comment votes display beside each comment and preserve chronological sibling order. Require a visible target and, for comment votes, a visible parent story.
- **Discussion.** Support threaded replies with a maximum depth of eight, capped body lengths, and pagination for root comments and large reply groups. Order siblings by creation time and ID. Render escaped plain text with safe linkification. Author deletion leaves a tombstone when needed to retain reply context. Comment edits display an edited marker.
- **Reports.** Members can report stories or comments for spam, abuse, duplicate content, off-topic content, or another reason with an optional note. Accept one open report per member per target. Give the reporter a private acknowledgment. A report does not change visibility on its own.
- **Moderation.** Group open reports by target. Show reasons, notes, and prior actions to moderators. Support dismissal, hiding and restoring content, and account suspension. Record actor, action, target, reason, and time. Recompute visible results immediately on the next read, including when a story appears in an older ranking snapshot. Hide a story and its discussion from public routes together. For hidden comments, retain a placeholder so visible replies remain readable. Suspended accounts lose mutation access immediately.

## Interface and visual design

Use the reference's compact list rhythm, short text navigation, and quiet metadata hierarchy as inspiration. Give NoCoNews its own typography, spacing, and restrained accent color. Render a narrow, responsive, single-column layout. Put headlines first, followed by a smaller line for domain, author, age, points, and discussion. Search results reuse the same rows and add short plain-text excerpts where applicable. Indent replies subtly and cap visual indentation on narrow screens. [Svelte Hacker News reference](https://hn.svelte.dev)

Keep navigation, pagination, voting, reply, and report controls small and muted. Use a compact triangle button for an upvote and a clear pressed state with an accessible label for undo. Give compact controls adequate hit areas or spacing, visible keyboard focus, and sufficient contrast. Search uses a labeled single-line input and compact submit button. Render all pages and forms in the Worker with HTML templates. Svelte is a visual reference only. JavaScript can update vote state in place, and ordinary form submissions support the same flow.

## Data and consistency

Store timestamps in UTC and use foreign keys, database checks, and prepared statements. Start with D1 primary reads to simplify read-after-write behavior.

| Table | Key fields and invariants |
| --- | --- |
| `users` | ID, normalized unique email and username, public display username, role, account state, created time |
| `login_challenges`, `sessions` | Hashed random token, expiry, consumption or revocation time, user or email association |
| `stories` | ID, author, title, URL and canonical URL or text body, state, creation time, vote count, visible comment count |
| `comments` | ID, story, optional parent, author, body, depth, state, vote count, creation and edit times. Composite parent reference enforces same-story replies |
| `story_votes`, `comment_votes` | Unique target and voter pair in each table, with creation time |
| `story_search`, `comment_search` | D1 FTS5 virtual tables keyed by story or comment ID |
| `reports` | Reporter, story or comment ID with exactly one present, reason, note, status, resolution metadata, creation time |
| `moderation_actions` | Append-only application audit records with actor, target, reason, outcome, and time |
| `rank_generations`, `rank_entries` | Snapshot time and publication state, plus ordered story IDs keyed by generation |
| `submission_requests` | Actor, action, request key, payload digest, result ID, and expiry for safe retries of story and comment creation |

Index stories by state and creation time, comments by story and parent, reports by status and target, and tokens by digest. Use partial unique indexes for visible canonical links and open reports. Resolve restore conflicts with a new visible duplicate before restoring a hidden link.

Use SQL guards inside mutations for role, state, ownership, and parent eligibility where races matter. D1 triggers maintain counters only on actual row or visibility changes. Batch moderation changes, report resolution, and audit writes so they commit together. Explicit vote state writes use conflict-safe inserts or deletes. Repeating a vote request leaves the stored vote state unchanged. Reconcile story and comment counters against their respective vote tables. A repeated creation key returns the original record, while reusing the key for different content fails. Periodic reconciliation detects counter drift and records repair counts. [D1 Worker API and batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/)

### Ranking and pagination

Rebuild Top every five minutes for visible stories from the previous seven days. Initial formula is `(1 + upvotes) / (2 + age_hours)^1.5`. Use creation time and story ID as tie-breakers, newest first. Store at most 300 ranked entries per generation. Publish only complete generations and prevent an older scheduled run from replacing a newer generation. Retain generations for one hour so Top cursors stay stable across refreshes. Filter out currently hidden stories at read time. If a cursor has expired, redirect the reader to the first page with a notice. Use New as the home feed fallback if no ranking generation has been published. New uses a creation-time and ID cursor.

## Search

Expose public keyword search for story titles, publisher hostnames, text submissions, and comment bodies. A compact Stories or Comments selector defaults to Stories. Story results link to the discussion. Comment results show the story title and a short escaped excerpt and link to the comment in its thread, including the page or ancestor context needed to reach it. Publisher article text remains outside the index.

Use D1 FTS5 and BM25 relevance with extra weight on story titles. Break ties by creation time and ID, newest first. Accept up to 160 characters and eight terms. Normalize input into quoted literal terms joined with AND and bind the resulting expression as a parameter. Show an inline prompt for empty input and a plain-text message for no matches. Return 20 results per page with bounded offset pagination up to 200 matches. Results can shift as new content arrives. Apply a search-specific rate limit.

Update both indexes with D1 triggers in the same transaction as content changes. Index only rows whose own state is visible. Remove index entries when the indexed row is hidden or deleted and reindex when it is restored. Parent story visibility is enforced by the search query, so hiding a story does not require reindexing its whole thread. Join matching IDs against current visibility on every query, including the parent story for comment results, before returning rows or excerpts. Rebuild indexes from canonical tables after recovery as needed. [Cloudflare D1 SQL extensions](https://developers.cloudflare.com/d1/sql-api/sql-statements/)

## HTTP interface and accounts

| Method and route | Behavior |
| --- | --- |
| `GET /`, `GET /new` | Ranked and chronological feeds |
| `GET /stories/:id`, `GET /users/:username` | Discussion and public profile |
| `GET /search?q=…&type=…&page=…` | Server-rendered keyword search and pagination |
| `GET /submit`, `POST /stories` | Submission form and creation |
| `POST /stories/:id/vote`, `POST /comments/:id/vote` | Explicit voted or unvoted state for the target |
| `POST /stories/:id/comments` | Add root comment or reply |
| `POST /comments/:id/edit`, `POST /comments/:id/delete` | Author changes |
| `POST /reports` | Report creation |
| `POST /auth/request`, `GET /auth/confirm`, `POST /auth/confirm`, `POST /auth/logout` | Request email, show confirmation, exchange token, or revoke session |
| `GET /moderation/reports`, `POST /moderation/actions` | Private review queue and audited actions |

HTML forms work without JavaScript and use post-redirect-get on success. Enhanced votes may request JSON on the same route. Return field errors for invalid submissions, 403 for unauthorized mutations, 404 for inaccessible resources on public routes, 409 for state conflicts, and 429 with retry guidance for rate limits.

Sign in with a 15-minute single-use email link. Keep the GET confirmation inert so mail scanners do not consume it. Consume the token and create the session in one atomic operation after explicit confirmation. First sign-in prompts for a unique username before participation. Store session token hashes in D1 and issue a Secure, HttpOnly, SameSite=Lax host-only cookie. Use a 30-day absolute session lifetime as a starting value. Logout revokes the session. Authorize moderator requests against the current database role on every request. Bootstrap the first admin through an audited deployment procedure. Require fresh sign-in for administrator role changes.

## Security and abuse

- Validate same-origin requests and CSRF tokens for mutations, including sign-in confirmation. Bind pre-session confirmation CSRF state to the browser. Apply restrictive CSP, clickjacking protection, and a no-referrer policy to sign-in pages. Keep complete sign-in URLs and email addresses out of application telemetry.
- Require and validate Turnstile server-side for email requests. Apply additional challenges to posting or reporting when abuse thresholds are crossed. Return a generic email-request result to limit account enumeration. Use rate limits by IP and account, plus durable per-recipient email cooldowns and quotas in D1. Workers Rate Limiting is location-local and eventually consistent. D1 constraints enforce any hard global caps.
- Render untrusted content as escaped text and restrict generated link schemes. Enforce field and request-size limits before writing. Send private responses with `Cache-Control: no-store`. Start with caching for fingerprinted assets only, keeping public HTML dynamic so moderation and personalized vote state take effect on the next read.
- Restrict reports, notes, and audit details to moderators. Use a documented retention period for resolved report notes and moderation history. Clean up expired sessions, sign-in challenges, and request keys in capped cron batches.

Cloudflare references. [Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) · [Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

## Deployment and operations

Use Wrangler with separate staging and production Workers, databases, secrets, and domains. Staging sends mail only to designated test recipients. Version SQL migrations with the app. Apply compatible migrations in staging first, then production. Use expand-and-contract for schema changes that span deployments so a prior Worker version can safely run after rollback. Exercise D1 Time Travel and verify database integrity in a recovery drill before launch. For a production restore, enter maintenance mode, quantify writes lost after the selected restore point, invalidate restored sessions and sign-in challenges, rebuild ranking, and smoke-test before reopening writes. [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

Track Worker errors and latency, D1 rows read and written, slow queries, email sending failures, ranking age, rate-limit hits, and unresolved report age. Alert on sustained errors or stale ranking. Review estimated Worker, D1, and email usage before launch against the account's current plan and quotas. Main cost drivers are dynamic page traffic, D1 reads for feeds, threads, and search, search index updates, ranking refresh writes, and sign-in email volume. [D1 query observability](https://developers.cloudflare.com/d1/observability/find-expensive-queries/)

## Delivery sequence and acceptance

1. Stand up staging, domains, D1 migrations, and sign-in. Verify delivery, token expiry and single use, logout, and role enforcement.
2. Build submissions, New, Top, threaded comments, voting on both target types, and search. Verify duplicate handling, parallel vote retries and undo on both targets, self-vote rejection, thread pagination, snapshot rollover, search routing and relevance, and forms without JavaScript.
3. Add reports and moderation. Verify report privacy, moderator authorization, atomic audit writes, and immediate hide and restore behavior across public feeds, discussions, and search. Verify that hidden stories never expose comment excerpts and that edited or deleted comments do not expose stale text.
4. Run production-like smoke, load, and recovery tests. Initial staging target is p95 server response under 500 ms for feed and discussion reads at 25 requests per second from a US test client with 50,000 stories. Treat this as a launch test target and revise it after measuring representative D1 latency. Exercise search with common terms and both result types on a representative corpus. Verify keyboard focus, control contrast and hit areas, and readable threads on narrow screens.

## Decisions for review

- Confirm the Northern Colorado focus and what qualifies as off-topic.
- Confirm that member flags meet the submission reports requirement and whether moderators need exports.
- Confirm that manual submission is sufficient for launch or identify any RSS sources that need automated ingestion.
- Confirm passwordless email and the Workers Paid budget, including use of Cloudflare's beta email service.
- Identify the first administrator and moderation coverage. Agree on retention periods for report notes and audit history before launch.
