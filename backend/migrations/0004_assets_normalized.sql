-- Assets normalization columns
alter table assets add column if not exists s3_key_norm text;
alter table assets add column if not exists norm_status text not null default 'pending'; -- pending|processing|ready|failed
alter table assets add column if not exists norm_error text;
alter table assets add column if not exists norm_width int;
alter table assets add column if not exists norm_height int;
alter table assets add column if not exists norm_fps int;
alter table assets add column if not exists norm_bitrate int;

-- Jobs table for normalization worker
create table if not exists normalize_jobs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  status text not null default 'pending', -- pending|processing|done|failed
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_normalize_jobs_status on normalize_jobs(status);
create index if not exists idx_normalize_jobs_asset on normalize_jobs(asset_id);

