DROP INDEX visits_assignment;
CREATE INDEX visits_assignment ON visits(site_id,visitor_id,day,timezone,last_at) WHERE closed=0;
CREATE INDEX IF NOT EXISTS visits_expiry ON visits(site_id,last_at) WHERE closed=0;
DROP TRIGGER close_visits_on_timezone;
CREATE TRIGGER close_visits_on_timezone AFTER UPDATE OF timezone ON sites WHEN OLD.timezone != NEW.timezone BEGIN UPDATE visits SET closed=1 WHERE site_id=NEW.id AND closed=0; END;
DROP TRIGGER apply_activity;
CREATE TRIGGER apply_activity AFTER INSERT ON activity BEGIN
  INSERT INTO visits(session_id,site_id,visitor_id,day,hour,timezone,at,last_at,path,entry_path,referrer_host,source,campaign,country,device,browser)
    SELECT lower(hex(randomblob(16))),v.site_id,NEW.visitor_id,NEW.day,NEW.hour,NEW.timezone,NEW.at,NEW.at,p.path,v.entry_path,v.referrer_host,v.source,v.campaign,v.country,v.device,v.browser
    FROM visit_pages p JOIN visits v ON v.session_id=+p.session_id
    WHERE p.site_id=NEW.site_id AND p.token=NEW.token AND NEW.at >= p.at AND NEW.at-p.at <= 90000 AND NEW.visible>p.visible
    AND (v.day!=NEW.day OR v.timezone!=NEW.timezone OR v.closed=1 OR NEW.at-v.last_at>=1800000)
    AND NOT EXISTS (SELECT 1 FROM visits WHERE site_id=NEW.site_id AND visitor_id=+NEW.visitor_id AND day=+NEW.day AND timezone=NEW.timezone AND closed=0 AND last_at>NEW.at-1800000);
  UPDATE visit_pages SET session_id=(SELECT session_id FROM visits WHERE site_id=NEW.site_id AND visitor_id=+NEW.visitor_id AND day=+NEW.day AND timezone=NEW.timezone AND closed=0 AND last_at>NEW.at-1800000 ORDER BY last_at DESC LIMIT 1)
    WHERE site_id=NEW.site_id AND token=NEW.token AND NEW.at>=at AND NEW.at-at<=90000 AND NEW.visible>visible;
  UPDATE visits SET visible_ms=MIN(MAX(0,NEW.at-at), visible_ms+MAX(0,MIN(NEW.visible-(SELECT visible FROM visit_pages WHERE site_id=NEW.site_id AND token=NEW.token),NEW.at-(SELECT at FROM visit_pages WHERE site_id=NEW.site_id AND token=NEW.token),NEW.at-NEW.boundary,90000))), observed=1,signals=signals+1,last_at=MAX(last_at,NEW.at)
    WHERE signals<6000 AND session_id=(SELECT +session_id FROM visit_pages WHERE site_id=NEW.site_id AND token=NEW.token AND NEW.at>=at AND NEW.at-at<=90000 AND NEW.visible>visible);
  UPDATE visit_pages SET at=NEW.at,visible=MAX(visible,NEW.visible),day=+NEW.day,visitor_id=+NEW.visitor_id WHERE site_id=NEW.site_id AND token=NEW.token AND NEW.at>=at;
  DELETE FROM activity WHERE rowid=NEW.rowid;
END;
