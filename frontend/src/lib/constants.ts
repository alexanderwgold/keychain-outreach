/** Emails that can access /admin routes */
export const ADMIN_EMAILS = [
  "alex.gold@keychain.com",
  "dusty.reese@keychain.com",
] as const

/** Ordered list of SF pipeline stages (display order) */
export const PIPELINE_STAGES = [
  "Scheduling First Call",
  "Revival",
  "First Call Scheduled",
  "First Meeting Completed",
  "Second Call Scheduled",
  "Second Meeting Completed",
  "Proposal Meeting Scheduled",
  "Proposal Sent",
  "Next Steps Scheduled",
  "Next Steps Completed",
  "Service Agreement Sent",
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]

/**
 * Stages considered "active" — these opportunities sort first in the pipeline view.
 * Active = past first meeting OR has a scheduled next step.
 */
export const ACTIVE_STAGES: ReadonlySet<string> = new Set([
  "First Meeting Completed",
  "Second Call Scheduled",
  "Second Meeting Completed",
  "Proposal Meeting Scheduled",
  "Proposal Sent",
  "Next Steps Scheduled",
  "Next Steps Completed",
  "Service Agreement Sent",
])
