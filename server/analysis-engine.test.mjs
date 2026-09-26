import assert from 'node:assert/strict'
import { analyzeEvents } from './analysis-engine.mjs'

const base = { schemaVersion: 1, eventId: 'e1', workspaceId: 'local', conversationId: 'c', source: 'codex', role: 'user', occurredAt: '2026-09-21T00:00:00.000Z', tokenUsage: { state: 'unavailable' }, provenance: 'local_readonly' }
const results = analyzeEvents([
  { ...base, redactedText: '진행 상황 어때?' },
  { ...base, eventId: 'assistant-1', role: 'assistant', redactedText: '현재 작업을 진행했습니다.' },
  { ...base, eventId: 'e2', redactedText: '씨발 또 틀렸어' },
  { ...base, eventId: 'e3', role: 'assistant', redactedText: '응답' },
])
assert.equal(results.length, 2)
assert.equal(results[0].primaryKind, 'progress_check')
assert.equal(results[1].reactionSignals.profanityDetected, true)
assert.equal(results[1].engine, 'deterministic-v7')
assert.equal(results[0].clarityScore >= 0 && results[0].clarityScore <= 100, true)
assert.equal(Array.isArray(results[0].clarityReasons), true)
assert.equal(results[1].context.previousAssistantPresent, true)
assert.equal(results[1].context.contextSignals.includes('correction_after_assistant'), true)
const repeated = analyzeEvents([
  { ...base, eventId: 'r1', redactedText: '로그인 기능을 구현해줘.' },
  { ...base, eventId: 'r2', role: 'assistant', redactedText: '완료했고 테스트를 통과했습니다.' },
  { ...base, eventId: 'r3', redactedText: '로그인 기능을 구현해줘.' },
  { ...base, eventId: 'r4', redactedText: '틀렸어. 다시 해.' },
])
assert.equal(repeated[1].context.contextSignals.includes('repeated_question'), true)
assert.equal(repeated[1].context.contextSignals.includes('followup_correction'), true)
assert.equal(repeated[1].clarityReasons.some((reason) => reason.includes('반복')), true)
const continuation = analyzeEvents([
  { ...base, eventId: 'c1', role: 'assistant', redactedText: '다음 단계는 API 구현입니다.' },
  { ...base, eventId: 'c2', redactedText: 'ㄱㄱ' },
])
assert.equal(continuation[0].clarityScore, 85)
assert.equal(continuation[0].clarityReasons[0].includes('명확한 지시'), true)
const workflow = analyzeEvents([{ ...base, eventId: 'p1', redactedText: '지금 어디까지 진행됐어?', occurredAt: '2026-09-22T00:00:00.000Z' }])
assert.equal(workflow[0].clarityScore, 80)
const standaloneContinuation = analyzeEvents([{ ...base, eventId: 'c3', redactedText: 'ㄱㄱ', occurredAt: '2026-09-22T00:00:00.000Z' }])
assert.equal(standaloneContinuation[0].clarityScore, 85)
const calibration = analyzeEvents([
  { ...base, eventId: 'long', redactedText: '현재 Tauri 앱에 날짜별 필터와 테스트까지 구현해줘.', occurredAt: '2026-09-22T00:00:00.000Z' },
  { ...base, eventId: 'vague', redactedText: '이거 해줘', occurredAt: '2026-09-22T00:01:00.000Z' },
  { ...base, eventId: 'clear', redactedText: '씨발 로그인 오류를 재현하고 원인과 수정 테스트까지 정리해줘.', occurredAt: '2026-09-22T00:02:00.000Z' },
])
assert.equal(calibration[0].clarityScore >= 50, true)
assert.equal(calibration[1].clarityScore < calibration[0].clarityScore, true)
assert.equal(calibration[2].clarityScore >= 50, true)
const meta = analyzeEvents([{ ...base, eventId: 'meta', redactedText: '근데 왜 60점으로 평가했어? 이게 지금 문제라고 뭔지 알아?', occurredAt: '2026-09-22T00:03:00.000Z' }])
assert.equal(meta[0].clarityScore, 85)
const statusChecks = analyzeEvents([
  { ...base, eventId: 'status-1', redactedText: '지금 되고 있어?', occurredAt: '2026-09-22T00:04:00.000Z' },
  { ...base, eventId: 'status-2', redactedText: '여기만 그런 거 아니지?', occurredAt: '2026-09-22T00:05:00.000Z' },
])
assert.equal(statusChecks[0].primaryKind, 'progress_check')
assert.equal(statusChecks[1].primaryKind, 'progress_check')
const rationaleCases = analyzeEvents([
  { ...base, eventId: 'r1', redactedText: '그래 하자', occurredAt: '2026-09-22T00:06:00.000Z' },
  { ...base, eventId: 'r2', redactedText: '내 질문이 AI가 명확하게 시킬 정도로 클리어한지 판단해줘', occurredAt: '2026-09-22T00:07:00.000Z' },
  { ...base, eventId: 'r3', redactedText: '현재 Tauri 앱에 날짜별 필터와 테스트까지 구현해줘. 완료되면 빌드 결과를 알려줘.', occurredAt: '2026-09-22T00:08:00.000Z' },
])
assert.equal(rationaleCases[0].clarityScore, 85)
assert.equal(rationaleCases[1].primaryKind, 'other')
assert.equal(rationaleCases[2].clarityReasons[0].includes('충분히 명확'), true)
console.log('analysis engine tests passed')
