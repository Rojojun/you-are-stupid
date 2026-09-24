export const sources = ['codex', 'claude_code', 'antigravity'] as const
export type Source = (typeof sources)[number]

export const roles = ['user', 'assistant', 'tool', 'system'] as const
export type Role = (typeof roles)[number]

export type TokenUsage =
  | Readonly<{ state: 'observed'; input: number; output: number; total: number }>
  | Readonly<{ state: 'unavailable' }>

export type ConversationEvent = Readonly<{
  schemaVersion: 1
  eventId: string
  workspaceId: string
  conversationId: string
  source: Source
  role: Role
  occurredAt: string
  text: string
  redactedText?: string
  model?: string
  tokenUsage: TokenUsage
  provenance: 'official' | 'local_readonly' | 'user_import'
}>

export const activityKinds = [
  'productive_work',
  'agent_correction',
  'progress_check',
  'cross_agent_handoff',
  'resume_instruction',
  'simplify_explanation',
  'rule_reminder',
  'other',
] as const
export type ActivityKind = (typeof activityKinds)[number]

export type CandidateClassification = Readonly<{
  eventId: string
  kind: ActivityKind
  confidence: 'low'
  rationale: string
  clarityScore?: number
  clarityReasons?: readonly string[]
  confidenceStatus?: 'accepted' | 'review'
  jevConfidence?: number
  shadowComparison?: Readonly<{ engine: string; primaryKind: ActivityKind; clarityScore: number; confidence: 'low' }>
  friction?: 'low' | 'medium' | 'high'
  profanityDetected?: boolean
  frictionReason?: string
  frictionType?: 'profanity' | 'repeated_request' | 'disagreement' | 'assistant_error' | 'none'
  frictionResponsibility?: 'user' | 'assistant' | 'both' | 'unclear'
  contextSignals?: readonly string[]
  windowSize?: number
}>
