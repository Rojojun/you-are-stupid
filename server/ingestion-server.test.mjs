import assert from 'node:assert/strict'
import { ingestBatch } from './ingestion-server.mjs'

const event = {
  schemaVersion: 1, eventId: 'event-1', workspaceId: 'local', conversationId: 'conversation',
  source: 'codex', role: 'user', occurredAt: '2026-09-21T00:00:00.000Z',
  redactedText: 'hello', tokenUsage: { state: 'unavailable' }, provenance: 'local_readonly',
}

const accepted = await ingestBatch({ workspaceId: 'local', events: [event] })
assert.equal(accepted.status, 200)
assert.equal(accepted.body.accepted, 1)

const duplicate = await ingestBatch({ workspaceId: 'local', events: [event] }, new Set(['event-1']))
assert.equal(duplicate.body.duplicates, 1)

const raw = await ingestBatch({ workspaceId: 'local', events: [{ ...event, text: 'secret' }] })
assert.equal(raw.status, 400)
assert.equal(raw.body.error, 'RAW_TEXT_NOT_ALLOWED')

console.log('central ingestion tests passed')

