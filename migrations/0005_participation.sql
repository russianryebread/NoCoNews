ALTER TABLE stories ADD COLUMN request_key TEXT;
ALTER TABLE comments ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX stories_request ON stories(author_id, request_key);
CREATE UNIQUE INDEX comments_request ON comments(author_id, request_key);

CREATE TABLE story_votes (
    story_id INTEGER NOT NULL REFERENCES stories(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (story_id, user_id)
);
CREATE TABLE comment_votes (
    comment_id INTEGER NOT NULL REFERENCES comments(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (comment_id, user_id)
);

CREATE TRIGGER story_vote_insert AFTER INSERT ON story_votes BEGIN
    UPDATE stories SET vote_count = vote_count + 1 WHERE id = NEW.story_id;
END;
CREATE TRIGGER story_vote_delete AFTER DELETE ON story_votes BEGIN
    UPDATE stories SET vote_count = vote_count - 1 WHERE id = OLD.story_id;
END;
CREATE TRIGGER comment_vote_insert AFTER INSERT ON comment_votes BEGIN
    UPDATE comments SET vote_count = vote_count + 1 WHERE id = NEW.comment_id;
END;
CREATE TRIGGER comment_vote_delete AFTER DELETE ON comment_votes BEGIN
    UPDATE comments SET vote_count = vote_count - 1 WHERE id = OLD.comment_id;
END;
