ALTER TABLE sites ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sites ADD COLUMN excluded_paths TEXT NOT NULL DEFAULT '[]';
CREATE TRIGGER domain_conflict_insert BEFORE INSERT ON sites
WHEN EXISTS (SELECT 1 FROM sites s WHERE s.domain=NEW.domain OR EXISTS(SELECT 1 FROM json_each(s.aliases) a WHERE a.value=NEW.domain) OR EXISTS(SELECT 1 FROM json_each(NEW.aliases) a WHERE a.value=s.domain OR EXISTS(SELECT 1 FROM json_each(s.aliases) b WHERE b.value=a.value)))
BEGIN SELECT RAISE(ABORT, 'UNIQUE allowed hostname'); END;
CREATE TRIGGER domain_conflict_update BEFORE UPDATE OF domain, aliases ON sites
WHEN EXISTS (SELECT 1 FROM sites s WHERE s.id!=NEW.id AND (s.domain=NEW.domain OR EXISTS(SELECT 1 FROM json_each(s.aliases) a WHERE a.value=NEW.domain) OR EXISTS(SELECT 1 FROM json_each(NEW.aliases) a WHERE a.value=s.domain OR EXISTS(SELECT 1 FROM json_each(s.aliases) b WHERE b.value=a.value))))
BEGIN SELECT RAISE(ABORT, 'UNIQUE allowed hostname'); END;
ALTER TABLE visit_pages ADD COLUMN privacy_paused INTEGER NOT NULL DEFAULT 0;
