-- ============================================================
-- Migration 006: pg_cron schedules for daily-scan and research-batch
-- ============================================================

-- Enable required extensions
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Daily scan: weekdays at 3:30pm ET (7:30pm UTC during EDT, 8:30pm UTC during EST)
-- Using EDT offset for now. Adjust when clocks change.
select cron.schedule(
  'daily-scan',
  '30 19 * * 1-5',
  $$
  select extensions.http_post(
    url := 'https://hjxaqhbkdvckapsqvqcq.supabase.co/functions/v1/daily-scan',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    )
  );
  $$
);

-- Research batch: Tuesday and Thursday at 2am ET (6am UTC during EDT)
select cron.schedule(
  'research-batch',
  '0 6 * * 2,4',
  $$
  select extensions.http_post(
    url := 'https://hjxaqhbkdvckapsqvqcq.supabase.co/functions/v1/research-batch',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    )
  );
  $$
);
