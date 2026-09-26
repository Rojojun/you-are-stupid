import assert from 'node:assert/strict'
import { createModelAdapter } from './model-adapter.mjs'

const event = { eventId: 'e', workspaceId: 'w', conversationId: 'c', source: 'codex', role: 'user', occurredAt: '2026-09-22T00:00:00.000Z', redactedText: '계속', tokenUsage: { state: 'unavailable' }, provenance: 'local_readonly' }
const local = createModelAdapter({ url: undefined })
assert.equal(local.name, 'deterministic-v7')
assert.equal((await local.classify([event]))[0].primaryKind, 'resume_instruction')
const remote = createModelAdapter({ url: 'https://model.test/classify', token: 'token', fetchImpl: async (_url, options) => {
  assert.equal(options.headers.authorization, 'Bearer token')
  return { ok: true, async json() { return { engine: 'test-model', classifications: [{ eventId: 'e', primaryKind: 'resume_instruction', confidence: 'medium', clarityScore: 50, rationale: 'context' }] } } }
} })
assert.equal((await remote.classify([event]))[0].engine, 'test-model')
await assert.rejects(() => createModelAdapter({ url: 'https://model.test', fetchImpl: async () => ({ ok: true, async json() { return { classifications: [] } } }), retries: 0 }).classify([event]), /MODEL_RESPONSE_MISSING_EVENTS/)

const jev = createModelAdapter({
  provider: 'jev',
  jevToken: 'jev-token',
  fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body)
    assert.equal(request.state.events[0].redactedText, '계속')
    return {
      ok: true,
      async json() {
        return {
          engine: 'jev-test',
          answers: {
            event_0_activity_kind: { choice: 'resume_instruction', confidence: 0.96 },
            event_0_goal: { score: 2, confidence: 0.96 },
            event_0_context: { score: 2, confidence: 0.96 },
            event_0_constraints: { score: 2, confidence: 0.96 },
            event_0_verification: { score: 2, confidence: 0.96 },
            event_0_completion: { score: 2, confidence: 0.96 },
            event_0_is_friction: { noul: 0.02 },
            event_0_friction_reason: { choice: 'none' },
          },
        }
      },
    }
  },
})
const jevResult = await jev.classify([event])
assert.equal(jev.name, 'jev-v1')
assert.equal(jevResult[0].engine, 'jev-test')
assert.equal(jevResult[0].clarityScore, 100)
assert.equal(jevResult[0].primaryKind, 'resume_instruction')
assert.equal(jevResult[0].shadowComparison.engine, 'deterministic-v7')

// Keep the production quality cases as a regression guard.  Profanity by
// itself must be low-signal, while profanity attached to a concrete request
// remains actionable; repeated requests should be visibly lower and flagged.
const qualityCases = [
  { id: 'quality-noise', text: '씨발 씨발 씨발', dimensions: [0, 0, 0, 0, 0], signal: 0, friction: 0.55, type: 'profanity', reason: 'emotional_emphasis', expectedMin: 0, expectedMax: 35 },
  { id: 'quality-concrete-profanity', text: '씨발 로그인 오류가 계속 나. 재현 방법과 원인을 찾아줘.', dimensions: [2, 1, 1, 1, 2], signal: 1, friction: 0.55, type: 'profanity', reason: 'emotional_emphasis', expectedMin: 55, expectedMax: 85 },
  { id: 'quality-concrete-clean', text: '로그인 오류를 재현하고 원인과 테스트 결과를 정리해줘.', dimensions: [2, 1, 1, 1, 2], signal: 2, friction: 0.05, type: 'none', reason: 'none', expectedMin: 55, expectedMax: 90 },
  { id: 'quality-repeated-request', text: '아까 말한 것 다시 해. 계속 같은 결과잖아.', dimensions: [1, 1, 1, 0, 1], signal: 1, friction: 0.9, type: 'repeated_request', reason: 'repeated_failure', expectedMin: 25, expectedMax: 60 },
]
const qualityAdapter = createModelAdapter({
  provider: 'jev',
  jevToken: 'jev-token',
  fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body)
    const text = request.state.events[0].redactedText
    const testCase = qualityCases.find((item) => item.text === text)
    assert.ok(testCase, `unexpected quality case: ${text}`)
    const [goal, context, constraints, verification, completion] = testCase.dimensions
    const answer = (score) => ({ score, confidence: 0.95 })
    return {
      ok: true,
      async json() {
        return {
          engine: 'jev-quality-test',
          answers: {
            event_0_activity_kind: { choice: testCase.type === 'repeated_request' ? 'agent_correction' : 'productive_work', confidence: 0.95 },
            event_0_goal: answer(goal), event_0_context: answer(context), event_0_constraints: answer(constraints),
            event_0_verification: answer(verification), event_0_completion: answer(completion),
            event_0_is_friction: { noul: testCase.friction, confidence: 0.95 },
            event_0_friction_reason: { choice: testCase.reason, confidence: 0.95 },
            event_0_friction_type: { choice: testCase.type, confidence: 0.95 },
            event_0_friction_responsibility: { choice: 'unclear', confidence: 0.95 },
            event_0_clarity_signal: answer(testCase.signal),
          },
        }
      },
    }
  },
})
const qualityResults = await qualityAdapter.classify(qualityCases.map((item) => ({ ...event, eventId: item.id, conversationId: item.id, redactedText: item.text })))
for (const testCase of qualityCases) {
  const result = qualityResults.find((item) => item.eventId === testCase.id)
  assert.ok(result)
  assert.equal(result.clarityScore >= testCase.expectedMin && result.clarityScore <= testCase.expectedMax, true, `${testCase.id}: ${result.clarityScore}`)
  assert.equal(result.reactionSignals.frictionType, testCase.type)
  assert.equal(result.reactionSignals.frictionReason, testCase.reason)
}
const noise = qualityResults.find((item) => item.eventId === 'quality-noise')
const concreteProfanity = qualityResults.find((item) => item.eventId === 'quality-concrete-profanity')
assert.equal(noise.clarityScore < concreteProfanity.clarityScore, true)
console.log('model adapter tests passed')
