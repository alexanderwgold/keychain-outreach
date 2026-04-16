-- ============================================================
-- Migration 010: Index on opportunity_contacts(contact_id)
-- The contacts_rep_read_via_opp RLS policy (from migration 009)
-- does EXISTS on opportunity_contacts filtered by contact_id.
-- Without this index, each contacts row read triggers a seq scan.
-- ============================================================

create index if not exists idx_opportunity_contacts_contact_id
  on opportunity_contacts (contact_id);
