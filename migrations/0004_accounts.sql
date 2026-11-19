CREATE TABLE login_challenges (
    digest TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX login_challenges_expiry ON login_challenges(expires_at);

CREATE TABLE login_quotas (
    email TEXT PRIMARY KEY,
    last_request INTEGER NOT NULL,
    day INTEGER NOT NULL,
    sent INTEGER NOT NULL
);

CREATE TABLE sessions (
    digest TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE admin_bootstrap (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    user_id INTEGER NOT NULL REFERENCES users(id),
    granted_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TRIGGER admin_bootstrap_role AFTER INSERT ON admin_bootstrap BEGIN
    UPDATE users SET role = 'admin' WHERE id = NEW.user_id;
END;
