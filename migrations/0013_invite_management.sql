ALTER TABLE member_invites ADD COLUMN revoked_at INTEGER;
ALTER TABLE member_invites ADD COLUMN revoked_by INTEGER REFERENCES users(id);

CREATE INDEX member_invites_recent ON member_invites(created_at DESC, email DESC);
