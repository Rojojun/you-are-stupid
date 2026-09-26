import assert from 'node:assert/strict'
import { ingestBatch } from './ingestion-server.mjs'
import { createModelAdapter } from './model-adapter.mjs'
import { readFile } from 'node:fs/promises'

const event = { schemaVersion: 1, eventId: 'security-1', workspaceId: 'w', conversationId: 'c', source: 'codex', role: 'user', occurredAt: '2026-09-22T00:00:00.000Z', redactedText: '<REDACTED:API_KEY>', tokenUsage: { state: 'unavailable' }, provenance: 'local_readonly' }
const raw = await ingestBatch({ workspaceId: 'w', events: [{ ...event, text: 'secret' }] })
assert.equal(raw.status, 400)
assert.equal(raw.body.error, 'RAW_TEXT_NOT_ALLOWED')
const valid = await ingestBatch({ workspaceId: 'w', events: [event] })
assert.equal(valid.status, 200)
const adapter = createModelAdapter({ provider: 'remote', url: 'https://model.test', fetchImpl: async (_url, options) => {
  const request = JSON.parse(options.body)
  assert.equal('text' in request.events[0], false)
  return { ok: true, async json() { return { classifications: [{ eventId: event.eventId, primaryKind: 'productive_work', clarityScore: 50, rationale: 'test' }] } } }
} })
assert.equal((await adapter.classify([event]))[0].eventId, event.eventId)
const tauriConfig = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
assert.equal(typeof tauriConfig.app.security.csp, 'string')
assert.notEqual(tauriConfig.app.security.csp, '')
console.log('security checks passed')
