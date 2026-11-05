ALTER TABLE events ADD COLUMN measured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN timezone TEXT;
ALTER TABLE events ADD COLUMN page_token TEXT;
CREATE TABLE visits (
  session_id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id), visitor_id TEXT NOT NULL,
  day TEXT NOT NULL, hour INTEGER NOT NULL, timezone TEXT NOT NULL, at INTEGER NOT NULL, last_at INTEGER NOT NULL,
  path TEXT NOT NULL, entry_path TEXT, referrer_host TEXT, source TEXT NOT NULL, campaign TEXT,
  country TEXT NOT NULL, device TEXT NOT NULL, browser TEXT NOT NULL,
  visible_ms INTEGER NOT NULL DEFAULT 0, observed INTEGER NOT NULL DEFAULT 0, signals INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX visits_assignment ON visits(site_id, visitor_id, day, timezone, last_at);
CREATE TABLE visit_pages (
  site_id TEXT NOT NULL, token TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES visits(session_id),
  day TEXT NOT NULL, visitor_id TEXT NOT NULL, path TEXT NOT NULL, at INTEGER NOT NULL, visible INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(site_id, token)
);
CREATE TABLE activity (
  site_id TEXT, token TEXT, at INTEGER, day TEXT, hour INTEGER, timezone TEXT, visitor_id TEXT, visible INTEGER, boundary INTEGER
);
CREATE TRIGGER deduplicate_page BEFORE INSERT ON events WHEN NEW.type='pageview' AND NEW.page_token IS NOT NULL AND EXISTS(SELECT 1 FROM visit_pages WHERE site_id=NEW.site_id AND token=NEW.page_token) BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER assign_visit AFTER INSERT ON events WHEN NEW.measured = 1 BEGIN
  INSERT INTO visits(session_id, site_id, visitor_id, day, hour, timezone, at, last_at, path, entry_path, referrer_host, source, campaign, country, device, browser)
  SELECT NEW.session_id, NEW.site_id, NEW.visitor_id, NEW.day, NEW.hour, NEW.timezone, NEW.at, NEW.at, NEW.path, NEW.entry_path, NEW.referrer_host, NEW.source, NEW.campaign, NEW.country, NEW.device, NEW.browser
  WHERE NOT EXISTS (SELECT 1 FROM visits WHERE site_id=NEW.site_id AND visitor_id=NEW.visitor_id AND day=NEW.day AND timezone=NEW.timezone AND closed=0 AND last_at > NEW.at-1800000);
  UPDATE events SET session_id=(SELECT session_id FROM visits WHERE site_id=NEW.site_id AND visitor_id=NEW.visitor_id AND day=NEW.day AND timezone=NEW.timezone AND closed=0 AND last_at > NEW.at-1800000 ORDER BY last_at DESC, at DESC LIMIT 1) WHERE id=NEW.id;
  DELETE FROM events WHERE id=NEW.id AND (
    (SELECT COUNT(*) FROM events WHERE site_id=NEW.site_id AND session_id=(SELECT session_id FROM events WHERE id=NEW.id)) > 500 OR
    (NEW.type='event' AND (SELECT COUNT(*) FROM events WHERE site_id=NEW.site_id AND type='event' AND session_id=(SELECT session_id FROM events WHERE id=NEW.id)) > 20));
  UPDATE events SET (entry_path,referrer_host,source,campaign)=(SELECT entry_path,referrer_host,source,campaign FROM visits WHERE session_id=events.session_id) WHERE id=NEW.id;
  UPDATE visits SET last_at=MAX(last_at,NEW.at) WHERE session_id=(SELECT session_id FROM events WHERE id=NEW.id);
  INSERT OR IGNORE INTO visit_pages(site_id,token,session_id,day,visitor_id,path,at)
    SELECT NEW.site_id,NEW.page_token,session_id,NEW.day,NEW.visitor_id,NEW.path,NEW.at FROM events WHERE id=NEW.id AND NEW.type='pageview' AND NEW.page_token IS NOT NULL;
END;
CREATE TRIGGER apply_activity AFTER INSERT ON activity BEGIN
  INSERT INTO visits(session_id,site_id,visitor_id,day,hour,timezone,at,last_at,path,entry_path,referrer_host,source,campaign,country,device,browser)
    SELECT lower(hex(randomblob(16))),v.site_id,NEW.visitor_id,NEW.day,NEW.hour,NEW.timezone,NEW.at,NEW.at,p.path,v.entry_path,v.referrer_host,v.source,v.campaign,v.country,v.device,v.browser
    FROM visit_pages p JOIN visits v ON v.session_id=p.session_id
    WHERE p.site_id=NEW.site_id AND p.token=NEW.token AND NEW.at >= p.at AND NEW.at-p.at <= 90000 AND NEW.visible>p.visible
    AND (v.day!=NEW.day OR v.timezone!=NEW.timezone OR v.closed=1 OR NEW.at-v.last_at>=1800000)
    AND NOT EXISTS (SELECT 1 FROM visits WHERE site_id=NEW.site_id AND visitor_id=NEW.visitor_id AND day=NEW.day AND timezone=NEW.timezone AND closed=0 AND last_at>NEW.at-1800000);
  UPDATE visit_pages SET session_id=(SELECT session_id FROM visits WHERE site_id=NEW.site_id AND visitor_id=NEW.visitor_id AND day=NEW.day AND timezone=NEW.timezone AND closed=0 AND last_at>NEW.at-1800000 ORDER BY last_at DESC LIMIT 1)
    WHERE site_id=NEW.site_id AND token=NEW.token AND NEW.at>=at AND NEW.at-at<=90000 AND NEW.visible>visible;
  UPDATE visits SET visible_ms=MIN(MAX(0,NEW.at-at), visible_ms+MAX(0,MIN(NEW.visible-(SELECT visible FROM visit_pages WHERE site_id=NEW.site_id AND token=NEW.token),NEW.at-(SELECT at FROM visit_pages WHERE site_id=NEW.site_id AND token=NEW.token),NEW.at-NEW.boundary,90000))), observed=1,signals=signals+1,last_at=MAX(last_at,NEW.at)
    WHERE signals<6000 AND session_id=(SELECT session_id FROM visit_pages WHERE site_id=NEW.site_id AND token=NEW.token AND NEW.at>=at AND NEW.at-at<=90000 AND NEW.visible>visible);
  UPDATE visit_pages SET at=NEW.at,visible=MAX(visible,NEW.visible),day=NEW.day,visitor_id=NEW.visitor_id WHERE site_id=NEW.site_id AND token=NEW.token AND NEW.at>=at;
  DELETE FROM activity WHERE rowid=NEW.rowid;
END;
CREATE VIEW report_events AS SELECT * FROM events UNION ALL
  SELECT -rowid,site_id,at,day,'activity',NULL,path,entry_path,referrer_host,source,campaign,country,device,browser,visitor_id,session_id,0,hour,1,timezone,NULL
  FROM visits v WHERE NOT EXISTS(SELECT 1 FROM events e WHERE e.session_id=v.session_id AND e.site_id=v.site_id);

CREATE TRIGGER close_visits_on_timezone AFTER UPDATE OF timezone ON sites WHEN OLD.timezone != NEW.timezone BEGIN UPDATE visits SET closed=1 WHERE site_id=NEW.id; END;
