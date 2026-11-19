CREATE TABLE community_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    guidelines TEXT NOT NULL,
    editor_id INTEGER NOT NULL REFERENCES users(id),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE reports (
    id INTEGER PRIMARY KEY,
    reporter_id INTEGER NOT NULL REFERENCES users(id),
    story_id INTEGER REFERENCES stories(id),
    comment_id INTEGER REFERENCES comments(id),
    reason TEXT NOT NULL CHECK (reason IN ('Spam', 'Abuse', 'Duplicate', 'Off-topic', 'Other')),
    note TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    resolved_at INTEGER,
    resolution TEXT,
    CHECK ((story_id IS NULL) <> (comment_id IS NULL))
);
CREATE UNIQUE INDEX reports_open_story ON reports(reporter_id, story_id) WHERE resolved_at IS NULL;
CREATE UNIQUE INDEX reports_open_comment ON reports(reporter_id, comment_id) WHERE resolved_at IS NULL;
CREATE INDEX reports_queue ON reports(resolved_at, created_at, id);

CREATE TABLE moderation_actions (
    id INTEGER PRIMARY KEY,
    actor_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
