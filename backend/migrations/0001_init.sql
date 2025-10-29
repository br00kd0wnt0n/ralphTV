-- Enable crypto UUIDs
create extension if not exists pgcrypto;

-- Users
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

-- Assets and tags
create table if not exists assets (
  id uuid primary key,
  file_name text not null,
  mime_type text not null,
  size bigint not null,
  s3_key text not null,
  file_type text not null,
  uploaded_at timestamptz not null default now(),
  vimeo_reference text,
  duration_sec int,
  thumbnail_url text
);

create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  name text unique not null
);

create table if not exists asset_tags (
  asset_id uuid references assets(id) on delete cascade,
  tag_id uuid references tags(id) on delete cascade,
  primary key (asset_id, tag_id)
);

create index if not exists idx_asset_tags_tag on asset_tags(tag_id);

-- Schedules
create table if not exists schedules (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  week text not null,
  day text not null,
  timezone text default 'UTC',
  version int not null default 0,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  unique (channel, week, day)
);

create table if not exists schedule_items (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references schedules(id) on delete cascade,
  position int not null,
  asset_id uuid references assets(id),
  start_time int,
  duration_sec int not null default 0,
  unique (schedule_id, position)
);

create index if not exists idx_schedule_items_sched_pos on schedule_items(schedule_id, position);

