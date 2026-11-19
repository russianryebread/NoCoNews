CREATE TABLE member_invites (
    email TEXT PRIMARY KEY,
    inviter_id INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX member_invites_quota ON member_invites(inviter_id, created_at);
