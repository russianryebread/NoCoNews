CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    username TEXT COLLATE NOCASE UNIQUE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'moderator', 'admin')),
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'suspended')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE stories (
    id INTEGER PRIMARY KEY,
    author_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    url TEXT,
    canonical_url TEXT,
    hostname TEXT,
    body TEXT,
    state TEXT NOT NULL DEFAULT 'visible' CHECK (state IN ('visible', 'hidden')),
    vote_count INTEGER NOT NULL DEFAULT 0 CHECK (vote_count >= 0),
    comment_count INTEGER NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    CHECK (
        (url IS NULL AND canonical_url IS NULL AND hostname IS NULL AND length(coalesce(body, '')) BETWEEN 1 AND 10000)
        OR (url IS NOT NULL AND canonical_url IS NOT NULL AND hostname IS NOT NULL AND body IS NULL)
    )
);

CREATE UNIQUE INDEX stories_visible_canonical_url ON stories(canonical_url)
    WHERE state = 'visible' AND canonical_url IS NOT NULL;

CREATE INDEX stories_feed ON stories(state, created_at DESC, id DESC);
