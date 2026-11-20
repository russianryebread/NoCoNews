ALTER TABLE users ADD COLUMN shadow_banned INTEGER NOT NULL DEFAULT 0 CHECK (shadow_banned IN (0, 1));
ALTER TABLE stories ADD COLUMN moderation_status TEXT CHECK (moderation_status IN ('archived', 'removed', 'shadow'));
ALTER TABLE comments ADD COLUMN moderation_status TEXT CHECK (moderation_status IN ('archived', 'removed', 'shadow'));

CREATE INDEX stories_moderation_status ON stories(moderation_status, id DESC);
CREATE INDEX comments_moderation_status ON comments(moderation_status, id DESC);
