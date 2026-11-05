-- Hours are stored in each website's time zone from now on; existing rows were recorded in UTC.
ALTER TABLE events ADD COLUMN hour INTEGER NOT NULL DEFAULT 0;
UPDATE events SET hour = CAST(strftime('%H', at / 1000, 'unixepoch') AS INTEGER);
