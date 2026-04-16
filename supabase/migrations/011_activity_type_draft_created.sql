-- ============================================================
-- Migration 011: Add 'draft_created' to activity_type enum.
-- Used by create-gmail-draft so we don't mislabel drafts as
-- 'email_sent' in reports.
-- ============================================================

alter type activity_type add value if not exists 'draft_created';
