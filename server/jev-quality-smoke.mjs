const baseUrl = process.env.CENTRAL_URL ?? 'http://127.0.0.1:8787'
const token = process.env.CENTRAL_INGESTION_TOKEN ?? 'local-dev-token'
const workspaceId = `jev-quality-${Date.now()}`
const cases = [
  { key: 'noise', text: '씨발 씨발 씨발' },
  { key: 'concrete_profanity', text: '씨발 로그인 오류가 계속 나. 재현 방법과 원인을 찾아줘.' },
  { key: 'concrete_clean', text: '로그인 오류를 재현하고 원인과 테스트 결과를 정리해줘.' },
  { key: 'repeated_request', text: '아까 말한 것 다시 해. 계속 같은 결과잖아.' },
]

const request = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(payload)}`)
  return payload
}

const events = cases.map((item, index) => ({
  schemaVersion: 1,
  eventId: `${workspaceId}-${index}`,
  workspaceId,
  conversationId: `${workspaceId}-${item.key}`,
  source: 'codex',
  role: 'user',
  occurredAt: new Date(Date.now() + index).toISOString(),
  redactedText: item.text,
  tokenUsage: { state: 'unavailable' },
  provenance: 'user_import',
}))

await request('/v1/ingestions/batches', { workspaceId, clientBatchId: `${workspaceId}-batch`, events })
const result = await request('/v1/analysis/classifications', { workspaceId, eventIds: events.map((event) => event.eventId), refresh: true })
console.log(JSON.stringify({
  engine: result.engine,
  cache: result.cache,
  cases: result.classifications.map((item, index) => ({
    key: cases[index].key,
    text: cases[index].text,
    clarityScore: item.clarityScore,
    friction: item.reactionSignals.friction,
    frictionType: item.reactionSignals.frictionType,
    frictionReason: item.reactionSignals.frictionReason,
    responsibility: item.reactionSignals.frictionResponsibility,
    claritySignal: item.jevAnswers?.clarity_signal?.score,
  })),
}, null, 2))
