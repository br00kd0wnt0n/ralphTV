-- Stream actions log table
create table if not exists stream_actions (
  id uuid primary key default gen_random_uuid(),
  action text not null, -- 'start' | 'stop' | 'restart'
  user_email text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_stream_actions_created on stream_actions(created_at desc);
