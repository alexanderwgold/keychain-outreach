-- ============================================================
-- Migration 009: Codebase-wide RLS policies
-- Adds per-rep and admin SELECT policies so authenticated
-- Supabase queries return scoped rows. Service-role Edge
-- Functions bypass RLS and are unaffected.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Admin flag on rep_mapping
-- ------------------------------------------------------------
alter table rep_mapping
  add column is_admin boolean not null default false;

update rep_mapping
  set is_admin = true
  where rep_email in ('alex.gold@keychain.com', 'dusty.reese@keychain.com');

-- ------------------------------------------------------------
-- 2. is_admin() helper
-- Security definer: bypasses RLS on the internal rep_mapping
-- read. Stable so Postgres caches the result within a statement.
-- ------------------------------------------------------------
create or replace function is_admin() returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(
    (select is_admin from rep_mapping
     where rep_email = auth.jwt()->>'email'),
    false
  )
$$;

grant execute on function is_admin() to authenticated;

-- ------------------------------------------------------------
-- 3. Rep-scoped tables: self + admin SELECT
-- ------------------------------------------------------------

-- opportunities
create policy opportunities_rep_read_own on opportunities
  for select to authenticated
  using (rep_email = auth.jwt()->>'email');

create policy opportunities_admin_read_all on opportunities
  for select to authenticated
  using (is_admin());

-- activity_log
create policy activity_log_rep_read_own on activity_log
  for select to authenticated
  using (rep_email = auth.jwt()->>'email');

create policy activity_log_admin_read_all on activity_log
  for select to authenticated
  using (is_admin());

-- upcoming_meetings
create policy upcoming_meetings_rep_read_own on upcoming_meetings
  for select to authenticated
  using (rep_email = auth.jwt()->>'email');

create policy upcoming_meetings_admin_read_all on upcoming_meetings
  for select to authenticated
  using (is_admin());

-- ------------------------------------------------------------
-- 4. Join tables: visibility inherits from parent opportunity
-- ------------------------------------------------------------

-- opportunity_contacts: visible if you can see the parent opportunity
create policy opportunity_contacts_rep_read_via_opp on opportunity_contacts
  for select to authenticated
  using (
    exists (
      select 1 from opportunities o
      where o.id = opportunity_contacts.opportunity_id
        and o.rep_email = auth.jwt()->>'email'
    )
  );

create policy opportunity_contacts_admin_read_all on opportunity_contacts
  for select to authenticated
  using (is_admin());

-- contacts: visible if linked to one of your opportunities via opportunity_contacts
create policy contacts_rep_read_via_opp on contacts
  for select to authenticated
  using (
    exists (
      select 1 from opportunity_contacts oc
      join opportunities o on o.id = oc.opportunity_id
      where oc.contact_id = contacts.id
        and o.rep_email = auth.jwt()->>'email'
    )
  );

create policy contacts_admin_read_all on contacts
  for select to authenticated
  using (is_admin());

-- ------------------------------------------------------------
-- 5. Shared reference data: all authenticated
-- ------------------------------------------------------------
create policy cadence_rules_read_all on cadence_rules
  for select to authenticated
  using (true);

-- ------------------------------------------------------------
-- 6. Admin-only tables
-- ------------------------------------------------------------
create policy rep_mapping_admin_read_all on rep_mapping
  for select to authenticated
  using (is_admin());

-- rep_tokens, supplier_stats, knowledge_base intentionally have no
-- policies. RLS enabled + no policy = default deny. These tables are
-- accessed only by service-role Edge Functions (which bypass RLS).
