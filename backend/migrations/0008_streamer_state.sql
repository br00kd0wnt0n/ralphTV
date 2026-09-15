-- Streamer playback position, written by the streamer (PUT /streamer/state) each time
-- the continuous loop spawns, read back at boot (GET /streamer/desired-state) so a
-- redeploy / Restart / day-rollover reload resumes the day where the feed left off
-- instead of replaying it from item 0. One row, key 'continuous'. Cleared on Stop.
create table if not exists streamer_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
