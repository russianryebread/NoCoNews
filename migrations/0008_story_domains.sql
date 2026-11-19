CREATE INDEX stories_domain_feed ON stories(hostname, created_at DESC, id DESC)
    WHERE state = 'visible' AND hostname IS NOT NULL;
