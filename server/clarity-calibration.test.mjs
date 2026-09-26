import assert from 'node:assert/strict'
import { analyzeEvents } from './analysis-engine.mjs'

const base = { workspaceId: 'calibration', conversationId: 'c', source: 'codex', role: 'user', tokenUsage: { state: 'unavailable' }, provenance: 'local_readonly' }
const cases = [
  ['productive-clear', '현재 Tauri 앱에 날짜별 필터와 테스트까지 구현해줘. 완료되면 빌드 결과를 알려줘.', 60, 100],
  ['productive-vague', '이거 해줘', 0, 34],
  ['workflow-progress', '지금 어디까지 진행됐어?', 80, 100],
  ['workflow-simplify', '쉬운 말로 다시 설명해 줘.', 80, 100],
  ['workflow-resume', 'ㄱㄱ', 80, 100],
  ['meta-clarification', '왜 60점으로 평가했어? 기준이 뭐야?', 80, 100],
  ['clear-with-profanity', '씨발 로그인 오류를 재현하고 원인과 수정 테스트까지 정리해줘.', 50, 100],
]
for (const [id, text, minimum, maximum] of cases) {
  const result = analyzeEvents([{ ...base, eventId: id, redactedText: text, occurredAt: `2026-09-22T00:${String(cases.indexOf(cases.find((item) => item[0] === id))).padStart(2, '0')}:00.000Z` }])[0]
  assert.equal(result.clarityScore >= minimum && result.clarityScore <= maximum, true, `${id}: ${result.clarityScore}`)
}
console.log('clarity calibration tests passed')

