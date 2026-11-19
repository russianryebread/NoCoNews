CREATE VIRTUAL TABLE story_search USING fts5(title, hostname, body);
CREATE VIRTUAL TABLE comment_search USING fts5(body);

INSERT INTO story_search(rowid, title, hostname, body)
    SELECT id, title, hostname, body FROM stories WHERE state = 'visible';
INSERT INTO comment_search(rowid, body)
    SELECT id, body FROM comments WHERE state = 'visible';

CREATE TRIGGER story_search_insert AFTER INSERT ON stories WHEN NEW.state = 'visible' BEGIN
    INSERT INTO story_search(rowid, title, hostname, body) VALUES (NEW.id, NEW.title, NEW.hostname, NEW.body);
END;
CREATE TRIGGER story_search_update AFTER UPDATE OF title, hostname, body, state ON stories BEGIN
    DELETE FROM story_search WHERE rowid = OLD.id;
    INSERT INTO story_search(rowid, title, hostname, body)
        SELECT NEW.id, NEW.title, NEW.hostname, NEW.body WHERE NEW.state = 'visible';
END;
CREATE TRIGGER story_search_delete AFTER DELETE ON stories BEGIN
    DELETE FROM story_search WHERE rowid = OLD.id;
END;

CREATE TRIGGER comment_search_insert AFTER INSERT ON comments WHEN NEW.state = 'visible' BEGIN
    INSERT INTO comment_search(rowid, body) VALUES (NEW.id, NEW.body);
END;
CREATE TRIGGER comment_search_update AFTER UPDATE OF body, state ON comments BEGIN
    DELETE FROM comment_search WHERE rowid = OLD.id;
    INSERT INTO comment_search(rowid, body)
        SELECT NEW.id, NEW.body WHERE NEW.state = 'visible';
END;
CREATE TRIGGER comment_search_delete AFTER DELETE ON comments BEGIN
    DELETE FROM comment_search WHERE rowid = OLD.id;
END;
