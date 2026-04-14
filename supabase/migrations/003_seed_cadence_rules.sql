-- ============================================================
-- Migration 003: Default cadence rules
-- One row per SF stage name. Values from the product spec.
-- ============================================================
insert into cadence_rules
  (stage_name, days_between_touches, max_attempts, auto_followup_on_meeting, suggested_action, outreach_template_key)
values
  ('Scheduling First Call',      3, 5, false, 'Email with Edge value prop + collateral',                     'scheduling_first_call'),
  ('Revival',                    4, 4, false, 'Re-engagement email with new proof point',                    'revival'),
  ('First Call Scheduled',       2, 2, false, 'Confirmation + prep materials',                               'first_call_scheduled'),
  ('First Meeting Completed',    1, 3, true,  'Follow-up recap based on Gong summary + next step proposal',  'first_meeting_completed'),
  ('Second Call Scheduled',      2, 2, false, 'Agenda + relevant case study',                                'second_call_scheduled'),
  ('Second Meeting Completed',   1, 3, true,  'Follow-up recap + value-add content or proposal teaser',     'second_meeting_completed'),
  ('Proposal Meeting Scheduled', 2, 2, false, 'Pre-read materials',                                          'proposal_meeting_scheduled'),
  ('Proposal Sent',              2, 6, true,  'Check-in + handle objections',                               'proposal_sent'),
  ('Next Steps Scheduled',       2, 2, false, 'Confirmation',                                                'next_steps_scheduled'),
  ('Next Steps Completed',       2, 4, true,  'Push toward agreement',                                      'next_steps_completed'),
  ('Service Agreement Sent',     2, 6, false, 'Gentle follow-up, escalation path',                          'service_agreement_sent');
