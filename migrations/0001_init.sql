CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('store', 'saas', 'docs')),
  currency TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created TEXT NOT NULL,
  retention_months INTEGER NOT NULL DEFAULT 24,
  exclude_bots INTEGER NOT NULL DEFAULT 1,
  respect_dnt INTEGER NOT NULL DEFAULT 0,
  public_dashboard INTEGER NOT NULL DEFAULT 0,
  goals TEXT NOT NULL,
  funnel TEXT NOT NULL
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites (id),
  at INTEGER NOT NULL,
  day TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('pageview', 'event')),
  name TEXT,
  path TEXT NOT NULL,
  entry_path TEXT,
  referrer_host TEXT,
  source TEXT NOT NULL,
  campaign TEXT,
  country TEXT NOT NULL,
  device TEXT NOT NULL,
  browser TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  revenue REAL NOT NULL DEFAULT 0
);

CREATE INDEX events_site_day ON events (site_id, day);
CREATE INDEX events_site_at ON events (site_id, at);
CREATE INDEX events_site_session ON events (site_id, session_id);

CREATE TABLE salts (
  day TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
