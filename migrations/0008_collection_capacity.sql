CREATE TABLE collection_limits (
  site_id TEXT NOT NULL REFERENCES sites(id), visitor_id TEXT NOT NULL,
  available_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  PRIMARY KEY(site_id, visitor_id)
);
CREATE INDEX collection_limits_expiry ON collection_limits(expires_at);
CREATE INDEX visit_pages_expiry ON visit_pages(at);
CREATE INDEX visit_pages_session ON visit_pages(session_id);
CREATE INDEX visits_retention ON visits(site_id,day);
CREATE INDEX events_page_token ON events(site_id,page_token) WHERE page_token IS NOT NULL;
DROP TRIGGER deduplicate_page;
CREATE TRIGGER deduplicate_page BEFORE INSERT ON events
WHEN NEW.type='pageview' AND NEW.page_token IS NOT NULL AND (
 EXISTS(SELECT 1 FROM visit_pages WHERE site_id=NEW.site_id AND token=NEW.page_token) OR
 EXISTS(SELECT 1 FROM events WHERE site_id=NEW.site_id AND page_token=NEW.page_token)
) BEGIN SELECT RAISE(IGNORE); END;
CREATE INDEX auth_limits_expiry ON auth_limits(expires_at);
