-- supabase/migrations/011_arsenal_tables.sql

create table arsenal_items (
  id uuid primary key default gen_random_uuid(),
  visibility text not null check (visibility in ('global', 'private')),
  owner_email text references rep_tokens(rep_email) on delete cascade,
  type text not null check (type in ('reference', 'collateral', 'report')),
  title text not null,
  description text not null default '',
  url text not null,
  storage_path text,
  thumbnail_url text,
  tags text[] not null default '{}',
  sort_order int not null default 0,
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_email_required_for_private
    check (
      (visibility = 'private' and owner_email is not null)
      or (visibility = 'global' and owner_email is null)
    )
);

create index idx_arsenal_items_vis_type on arsenal_items (visibility, type) where active;
create index idx_arsenal_items_owner on arsenal_items (owner_email, type) where active;
create index idx_arsenal_items_tags on arsenal_items using gin (tags);

create trigger update_arsenal_items_updated_at
  before update on arsenal_items
  for each row execute function update_updated_at();

-- collateral_links: short URL per (rep, item, prospect) triple
create table collateral_links (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  item_id uuid not null references arsenal_items(id) on delete cascade,
  rep_email text not null references rep_tokens(rep_email) on delete cascade,
  prospect_email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One active link per (item, rep, prospect). NULL prospect gets its own active slot.
create unique index idx_collateral_links_unique_active
  on collateral_links (item_id, rep_email, coalesce(prospect_email, ''))
  where active;

-- collateral_events: each open is a row
create table collateral_events (
  id bigserial primary key,
  link_id uuid not null references collateral_links(id) on delete cascade,
  event_type text not null check (event_type in ('opened', 'downloaded')),
  user_agent text,
  ip_prefix text,
  referrer text,
  created_at timestamptz not null default now()
);

create index idx_collateral_events_link_time on collateral_events (link_id, created_at desc);
