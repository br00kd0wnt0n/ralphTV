-- Hot-path indexes. /assets, /feed/rss and /debug/normalized all sort by uploaded_at
-- desc; without an index that's a seq-scan + sort that degrades as the library grows.
create index if not exists idx_assets_uploaded_at on assets (uploaded_at desc);

-- norm_status is filtered by /feed/rss (norm_status='ready') and scanned by the
-- transcoder's reaper / status checks.
create index if not exists idx_assets_norm_status on assets (norm_status);
