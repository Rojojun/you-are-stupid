import { roles, sources, type ConversationEvent, type Role, type Source, type TokenUsage } from './domain'

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asNonEmptyString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value
}

const asSource = (value: unknown): Source => {
  if (typeof value === 'string' && (sources as readonly string[]).includes(value)) return value as Source
  throw new Error('source must be codex, claude_code, or antigravity')
}

const asRole = (value: unknown): Role => {
  if (typeof value === 'string' && (roles as readonly string[]).includes(value)) return value as Role
  throw new Error('role must be user, assistant, tool, or system')
}

const asTokenUsage = (value: unknown): TokenUsage => {
  if (!isRecord(value) || value.state === 'unavailable') return { state: 'unavailable' }
  if (
    value.state === 'observed' &&
    typeof value.input === 'number' &&
    typeof value.output === 'number' &&
    typeof value.total === 'number'
  ) {
    return { state: 'observed', input: value.input, output: value.output, total: value.total }
  }
  throw new Error('tokenUsage must be unavailable or observed with numeric input/output/total')
}

export const normalizeImportedRecord = (value: unknown, index: number): ConversationEvent => {
  if (!isRecord(value)) throw new Error(`record ${index + 1} must be an object`)
  const occurredAt = asNonEmptyString(value.occurredAt, 'occurredAt')
  if (Number.isNaN(Date.parse(occurredAt))) throw new Error('occurredAt must be ISO-8601')

  return {
    schemaVersion: 1,
    eventId: asNonEmptyString(value.eventId, 'eventId'),
    workspaceId: asNonEmptyString(value.workspaceId, 'workspaceId'),
    conversationId: asNonEmptyString(value.conversationId, 'conversationId'),
    source: asSource(value.source),
    role: asRole(value.role),
    occurredAt,
    text: asNonEmptyString(value.text, 'text'),
    ...(typeof value.model === 'string' ? { model: value.model } : {}),
    tokenUsage: asTokenUsage(value.tokenUsage),
    provenance: 'user_import',
  }
}

export const parseImport = (text: string): ConversationEvent[] => {
  const trimmed = text.trim()
  if (trimmed.length === 0) throw new Error('The file is empty')
  const rawRecords: unknown[] = trimmed.startsWith('[')
    ? JSON.parse(trimmed)
    : trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  if (!Array.isArray(rawRecords)) throw new Error('The JSON root must be an array or JSONL records')
  return rawRecords.map(normalizeImportedRecord)
}
