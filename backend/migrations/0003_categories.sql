create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  color text not null default '#8e8e8e'
);

alter table assets add column if not exists category_id uuid references categories(id);
create index if not exists idx_assets_category on assets(category_id);

