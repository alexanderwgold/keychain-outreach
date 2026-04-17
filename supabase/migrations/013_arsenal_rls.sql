-- supabase/migrations/013_arsenal_rls.sql

alter table arsenal_items enable row level security;
alter table collateral_links enable row level security;
alter table collateral_events enable row level security;

-- arsenal_items: SELECT
create policy "arsenal_items_select_global_or_owner" on arsenal_items
  for select using (
    visibility = 'global'
    or owner_email = (auth.jwt() ->> 'email')
  );

-- arsenal_items: INSERT — admins create global, reps create their own private
create policy "arsenal_items_insert_admin_global" on arsenal_items
  for insert with check (
    visibility = 'global'
    and is_admin()
  );

create policy "arsenal_items_insert_rep_private" on arsenal_items
  for insert with check (
    visibility = 'private'
    and owner_email = (auth.jwt() ->> 'email')
    and created_by = (auth.jwt() ->> 'email')
  );

-- arsenal_items: UPDATE/DELETE — admins on global, owners on private
create policy "arsenal_items_update_admin_global" on arsenal_items
  for update using (
    visibility = 'global'
    and is_admin()
  );

create policy "arsenal_items_update_owner_private" on arsenal_items
  for update using (
    visibility = 'private'
    and owner_email = (auth.jwt() ->> 'email')
  );

create policy "arsenal_items_delete_admin_global" on arsenal_items
  for delete using (
    visibility = 'global'
    and is_admin()
  );

create policy "arsenal_items_delete_owner_private" on arsenal_items
  for delete using (
    visibility = 'private'
    and owner_email = (auth.jwt() ->> 'email')
  );

-- collateral_links
create policy "collateral_links_select_own_or_admin" on collateral_links
  for select using (
    rep_email = (auth.jwt() ->> 'email')
    or is_admin()
  );

create policy "collateral_links_insert_own" on collateral_links
  for insert with check (rep_email = (auth.jwt() ->> 'email'));

create policy "collateral_links_update_own" on collateral_links
  for update using (rep_email = (auth.jwt() ->> 'email'))
  with check (rep_email = (auth.jwt() ->> 'email'));

-- collateral_events: SELECT scoped by link ownership
create policy "collateral_events_select_via_link_owner" on collateral_events
  for select using (
    exists (
      select 1 from collateral_links l
      where l.id = collateral_events.link_id
        and (l.rep_email = (auth.jwt() ->> 'email')
             or is_admin())
    )
  );

-- No INSERT policy on collateral_events — inserts happen via service role only
