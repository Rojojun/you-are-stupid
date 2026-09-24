import type { ConversationEvent } from './domain'

export const demoEvents: readonly ConversationEvent[] = [
  {
    schemaVersion: 1, eventId: 'demo-1', workspaceId: 'demo', conversationId: 'demo-conversation', source: 'codex', role: 'user',
    occurredAt: '2026-09-21T09:00:00.000Z', text: '원문과 축약문을 분리하는 로컬 import 기능을 만들어줘.',
    tokenUsage: { state: 'observed', input: 120, output: 0, total: 120 }, provenance: 'user_import',
  },
  {
    schemaVersion: 1, eventId: 'demo-2', workspaceId: 'demo', conversationId: 'demo-conversation', source: 'codex', role: 'assistant',
    occurredAt: '2026-09-21T09:01:00.000Z', text: '파일 가져오기 계약부터 구현하겠습니다.',
    tokenUsage: { state: 'observed', input: 0, output: 90, total: 90 }, provenance: 'user_import',
  },
  {
    schemaVersion: 1, eventId: 'demo-3', workspaceId: 'demo', conversationId: 'demo-conversation', source: 'codex', role: 'user',
    occurredAt: '2026-09-21T09:02:00.000Z', text: '진행 상황 어때?',
    tokenUsage: { state: 'unavailable' }, provenance: 'user_import',
  },
  {
    schemaVersion: 1, eventId: 'demo-4', workspaceId: 'demo', conversationId: 'demo-conversation', source: 'codex', role: 'user',
    occurredAt: '2026-09-21T09:03:00.000Z', text: '쉬운 말로 다시 설명해 줘.',
    tokenUsage: { state: 'unavailable' }, provenance: 'user_import',
  },
]
