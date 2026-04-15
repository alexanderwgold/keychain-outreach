/* ==========================================================================
 * Database types — mirrors Supabase schema from docs/database.md
 * Generate fresh types via: mcp__supabase__generate_typescript_types
 * These hand-written types are used until the generated types are available.
 * ========================================================================== */

export type ActivityType =
  | "email_sent"
  | "email_received"
  | "reply_received"
  | "meeting_held"
  | "meeting_scheduled"
  | "collateral_shared"
  | "gong_call"
  | "manual_log"
  | "post_meeting_followup"

export type ActivitySource =
  | "gmail_scan"
  | "calendar_scan"
  | "gong_detection"
  | "sf_report"
  | "slack_log"
  | "manual"

export type MeetingType =
  | "intro"
  | "meeting"
  | "proposal"
  | "next_steps"
  | "catch_up"
  | "unknown"

export interface Opportunity {
  id: string
  sf_opportunity_id: string
  sf_account_id: string | null
  account_name: string
  manufacturer_id: string | null
  opportunity_name: string
  opp_owner: string
  rep_email: string | null
  stage_name: string
  close_date: string | null
  amount: number | null
  next_step: string | null
  next_steps_c: string | null
  description: string | null
  categories: string | null
  company_category: string | null
  last_sf_sync_at: string | null
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  sf_contact_id: string
  first_name: string
  last_name: string
  email: string | null
  title: string | null
  created_at: string
}

export interface OpportunityContact {
  opportunity_id: string
  contact_id: string
  primary: boolean
}

export interface ActivityLog {
  id: string
  opportunity_id: string
  contact_id: string | null
  rep_email: string
  activity_type: ActivityType
  activity_date: string
  subject: string | null
  notes: string | null
  draft_copy: string | null
  source: ActivitySource
  created_at: string
}

export interface CadenceRule {
  id: string
  stage_name: string
  days_between_touches: number
  max_attempts: number
  auto_followup_on_meeting: boolean
  suggested_action: string | null
  outreach_template_key: string | null
}

export interface UpcomingMeeting {
  id: string
  opportunity_id: string
  contact_id: string | null
  rep_email: string
  meeting_title: string
  meeting_date: string
  attendees: string[]
  inferred_type: MeetingType
  stage_progression_detected: boolean
  touchpoint_drafted: boolean
  followup_drafted: boolean
  created_at: string
}

export interface RepMapping {
  id: string
  sf_display_name: string
  rep_email: string
  rep_name: string
  is_active: boolean
}

/* ==========================================================================
 * Derived / view types — used by frontend components
 * ========================================================================== */

/** A contact row enriched with opportunity and cadence data for the pipeline table */
export interface PipelineContact {
  contact: Contact
  opportunity: Opportunity
  isPrimary: boolean
  daysSinceLastTouch: number | null
  cadenceThreshold: number
  lastActivity: ActivityLog | null
  suggestedAction: string | null
  isOverdue: boolean
  isAtThreshold: boolean
}

/** Summary stats shown in the briefing header */
export interface BriefingStats {
  overdueCount: number
  pendingDraftsCount: number
  meetingsThisWeek: number
  activitiesToday: number
}

/** Urgency level for color-coding */
export type UrgencyLevel = "healthy" | "at-threshold" | "overdue"
