CREATE TABLE organisations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created TEXT NOT NULL
);
INSERT INTO organisations (id, name, created) VALUES ('default', 'Default organisation', strftime('%Y-%m-%d', 'now'));
ALTER TABLE sites ADD COLUMN organisation_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX sites_organisation ON sites(organisation_id);

CREATE TRIGGER sites_organisation_insert BEFORE INSERT ON sites
WHEN NOT EXISTS (SELECT 1 FROM organisations WHERE id = NEW.organisation_id)
BEGIN SELECT RAISE(ABORT, 'unknown organisation'); END;
CREATE TRIGGER sites_organisation_update BEFORE UPDATE OF organisation_id ON sites
WHEN NOT EXISTS (SELECT 1 FROM organisations WHERE id = NEW.organisation_id)
BEGIN SELECT RAISE(ABORT, 'unknown organisation'); END;
CREATE TRIGGER organisations_preserve_projects BEFORE DELETE ON organisations
WHEN EXISTS (SELECT 1 FROM sites WHERE organisation_id = OLD.id) OR OLD.id = 'default'
BEGIN SELECT RAISE(ABORT, 'organisation is required by projects or legacy clients'); END;
CREATE TRIGGER organisations_stable_id BEFORE UPDATE OF id ON organisations
BEGIN SELECT RAISE(ABORT, 'organisation ids are immutable'); END;
