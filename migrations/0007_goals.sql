CREATE TABLE page_goal_matches(event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, goal_id TEXT NOT NULL);
CREATE TRIGGER remove_page_goal AFTER DELETE ON events BEGIN DELETE FROM page_goal_matches WHERE event_id=OLD.id; END;
DROP TRIGGER assign_visit;
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

  INSERT INTO page_goal_matches(event_id, goal_id)
    SELECT e.id,json_extract(g.value,'$.id') FROM events e JOIN sites s ON s.id=e.site_id JOIN json_each(s.goals) g
    WHERE e.id=NEW.id AND e.type='pageview' AND json_extract(g.value,'$.type')='page'
      AND json_extract(g.value,'$.path')=e.path AND COALESCE(json_extract(g.value,'$.archived'),0)=0
      AND e.at>=json_extract(g.value,'$.createdAt');
END;

CREATE VIEW analytics_events AS SELECT * FROM events UNION ALL SELECT -e.id AS id, e.site_id, e.at, e.day, 'event' AS type, m.goal_id AS name, e.path, e.entry_path, e.referrer_host, e.source, e.campaign, e.country, e.device, e.browser, e.visitor_id, e.session_id, 0 AS revenue, e.hour, e.measured, e.timezone, e.page_token FROM events e JOIN page_goal_matches m ON m.event_id=e.id;
DROP VIEW report_events;
CREATE VIEW report_events AS SELECT * FROM analytics_events UNION ALL
  SELECT -1000000000000-rowid,site_id,at,day,'activity',NULL,path,entry_path,referrer_host,source,campaign,country,device,browser,visitor_id,session_id,0,hour,1,timezone,NULL
  FROM visits v WHERE NOT EXISTS(SELECT 1 FROM events e WHERE e.session_id=v.session_id AND e.site_id=v.site_id);
