CREATE TABLE rank_generations (
    generated_at INTEGER PRIMARY KEY
);

CREATE TABLE rank_entries (
    generated_at INTEGER NOT NULL REFERENCES rank_generations(generated_at) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    position INTEGER NOT NULL,
    story_id INTEGER NOT NULL REFERENCES stories(id),
    PRIMARY KEY (generated_at, position)
);
