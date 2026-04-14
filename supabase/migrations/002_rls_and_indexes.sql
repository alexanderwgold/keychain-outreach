-- ============================================================
-- Migration 002: Indexes, updated_at trigger, and RLS
-- ============================================================

-- ----- INDEXES -----

-- opportunities: queried by rep_email (daily scan per-rep lookup)
-- and stage_name (cadence evaluation)
create index idx_opportunities_rep_email  on opportunities(rep_email);
create index idx_opportunities_stage_name on opportunities(stage_name);

-- activity_log: queried by opportunity_id (cadence eval) and sorted by
-- activity_date desc (most recent touch calculation)
create index idx_activity_log_opportunity_id on activity_log(opportunity_id);
create index idx_activity_log_activity_date  on activity_log(activity_date desc);
create index idx_activity_log_rep_email      on activity_log(rep_email);

-- contacts: matched by email during Gmail scan and Calendar scan
create index idx_contacts_email on contacts(email);

-- upcoming_meetings: queried by rep_email in weekly scan
create index idx_upcoming_meetings_rep_email on upcoming_meetings(rep_email);

-- supplier_stats: joined to opportunities by name for AI personalization lookups
create index idx_supplier_stats_manufacturer_name on supplier_stats(manufacturer_name);

-- ----- UPDATED_AT TRIGGER -----

-- Automatically sets updated_at = now() on every UPDATE for tables that have it.
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger opportunities_updated_at
  before update on opportunities
  for each row execute function update_updated_at();

create trigger collateral_updated_at
  before update on collateral
  for each row execute function update_updated_at();

create trigger supplier_stats_updated_at
  before update on supplier_stats
  for each row execute function update_updated_at();

-- ----- ROW LEVEL SECURITY -----

-- Enable RLS on all 10 tables.
-- Edge Functions use SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS automatically.
-- User-facing select/insert policies are added in Day 3 when frontend auth is wired.
alter table opportunities        enable row level security;
alter table contacts             enable row level security;
alter table opportunity_contacts enable row level security;
alter table rep_mapping          enable row level security;
alter table activity_log         enable row level security;
alter table cadence_rules        enable row level security;
alter table upcoming_meetings    enable row level security;
alter table rep_tokens           enable row level security;
alter table collateral           enable row level security;
alter table supplier_stats       enable row level security;
