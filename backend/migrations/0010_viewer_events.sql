-- Viewer analytics for the Ralph TV player (ralph-world /tv, homepage teaser, /embed).
-- One row per player event. Anonymous by design: session_id is a random id that lives
-- only for one page load (never stored on the device), and there is no IP, user id,
-- email or user-agent column. Rows older than 90 days are purged by the backend.
create table if not exists viewer_events (
  id bigserial primary key,
  ts timestamptz not null default now(),   -- server receive time (client clocks aren't trusted)
  event text not null,                     -- allowlisted name, e.g. 'heartbeat' (see analytics.js)
  session_id uuid not null,
  surface text,                            -- tv-desktop | tv-mobile | tv-immersive | home | embed
  device text,                             -- mobile | tablet | desktop (coarse, from UA at ingest)
  browser text,                            -- chrome | safari | firefox | edge | samsung | other
  asset_id uuid,                           -- clip on screen at the time, if known
  offset_sec int,                          -- position into that clip
  watch_sec int,                           -- cumulative seconds watched this page load
  muted boolean,
  props jsonb                              -- small, allowlisted extras (referrer host, utm, overlay…)
);

create index if not exists idx_viewer_events_ts on viewer_events (ts);
create index if not exists idx_viewer_events_session on viewer_events (session_id, ts);
create index if not exists idx_viewer_events_asset_ts on viewer_events (asset_id, ts) where asset_id is not null;
create index if not exists idx_viewer_events_event_ts on viewer_events (event, ts);
