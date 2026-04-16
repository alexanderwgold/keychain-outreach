-- ============================================================
-- Migration 008: rep_style_guides RLS policies
-- Per-user access scoped by auth.jwt()->>'email' matching rep_email.
-- Service-role (Edge Functions) bypasses RLS automatically.
-- ============================================================

create policy rep_style_guides_select_own on rep_style_guides
  for select to authenticated
  using (rep_email = auth.jwt()->>'email');

create policy rep_style_guides_insert_own on rep_style_guides
  for insert to authenticated
  with check (rep_email = auth.jwt()->>'email');

create policy rep_style_guides_update_own on rep_style_guides
  for update to authenticated
  using (rep_email = auth.jwt()->>'email')
  with check (rep_email = auth.jwt()->>'email');
