const baseUrl = process.env.CENTRAL_URL ?? 'http://127.0.0.1:8787'
const authToken = process.env.CENTRAL_INGESTION_TOKEN ?? 'local-dev-token'
const event = {
  schemaVersion: 1,
  eventId: `jev-smoke-event-${Date.now()}`,
  workspaceId: 'jev-smoke',
  conversationId: 'jev-smoke-conversation',
  source: 'codex',
  role: 'user',
  occurredAt: new Date().toISOString(),
  redactedText: '로그인 오류를 재현하고 테스트 결과를 알려줘.',
  tokenUsage: { state: 'unavailable' },
  provenance: 'user_import',
}

const request = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(payload)}`)
  return payload
}

const ingestion = await request('/v1/ingestions/batches', {
  workspaceId: event.workspaceId,
  clientBatchId: `jev-smoke-${Date.now()}`,
  events: [event],
})
const analysis = await request('/v1/analysis/classifications', { workspaceId: event.workspaceId, eventIds: [event.eventId] })
console.log(JSON.stringify({ ingestion, analysis }, null, 2))
