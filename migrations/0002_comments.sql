CREATE TABLE comments (
    id INTEGER PRIMARY KEY,
    story_id INTEGER NOT NULL REFERENCES stories(id),
    parent_id INTEGER,
    author_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
    depth INTEGER NOT NULL CHECK (depth BETWEEN 0 AND 8),
    state TEXT NOT NULL DEFAULT 'visible' CHECK (state IN ('visible', 'hidden', 'deleted')),
    vote_count INTEGER NOT NULL DEFAULT 0 CHECK (vote_count >= 0),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    edited_at INTEGER,
    UNIQUE (story_id, id),
    FOREIGN KEY (story_id, parent_id) REFERENCES comments(story_id, id),
    CHECK ((parent_id IS NULL AND depth = 0) OR (parent_id IS NOT NULL AND depth > 0))
);

CREATE INDEX comments_by_parent ON comments(story_id, parent_id, created_at, id);

CREATE TRIGGER comments_count_insert AFTER INSERT ON comments WHEN NEW.state = 'visible' BEGIN
    UPDATE stories SET comment_count = comment_count + 1 WHERE id = NEW.story_id;
END;
CREATE TRIGGER comments_count_delete AFTER DELETE ON comments WHEN OLD.state = 'visible' BEGIN
    UPDATE stories SET comment_count = comment_count - 1 WHERE id = OLD.story_id;
END;
CREATE TRIGGER comments_count_update AFTER UPDATE OF state ON comments WHEN NEW.state <> OLD.state BEGIN
    UPDATE stories SET comment_count = comment_count + (NEW.state = 'visible') - (OLD.state = 'visible')
    WHERE id = NEW.story_id;
END;
