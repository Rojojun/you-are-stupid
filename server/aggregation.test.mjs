import assert from 'node:assert/strict'
import { aggregateClarity, aggregatePeriod } from './aggregation.mjs'

const events = [
  { eventId: 'a', source: 'codex', occurredAt: '2026-09-21T01:00:00.000Z', redactedText: '첫 질문' },
  { eventId: 'b', source: 'claude_code', occurredAt: '2026-09-21T02:00:00.000Z', redactedText: '두 번째 질문' },
]
const daily = aggregateClarity([
  { eventId: 'a', clarityScore: 80, primaryKind: 'agent_correction', clarityReasons: ['범위·제약·권한 조건이 명시되지 않음'], reactionSignals: { profanityDetected: true, friction: 'medium', frictionType: 'profanity', frictionResponsibility: 'user' } },
  { eventId: 'b', clarityScore: 40, primaryKind: 'productive_work', clarityReasons: ['범위·제약·권한 조건이 명시되지 않음'], reactionSignals: { profanityDetected: false, friction: 'low', frictionType: 'none', frictionResponsibility: 'unclear' } },
], events)
assert.equal(daily[0].totalQuestions, 2)
assert.equal(daily[0].averageClarityScore, 60)
assert.equal(aggregatePeriod(daily, 'monthly', '2026-09-21').averageClarityScore, 60)
assert.equal(aggregatePeriod(daily, 'monthly', '2026-09-21').profanityCount, 1)
assert.equal(aggregatePeriod(daily, 'monthly', '2026-09-21').correctionCount, 1)
assert.equal(daily[0].activityShares.agent_correction > 0, true)
assert.equal(daily[0].clarityReasonCounts['범위·제약·권한 조건이 명시되지 않음'], 2)
assert.equal(daily[0].frictionTypeCounts.profanity, 1)
assert.equal(daily[0].responsibilityCounts.user, 1)
assert.equal(daily[0].lowestClarityScore, 40)
assert.equal(daily[0].lowestQuestion, '두 번째 질문')
assert.equal(aggregatePeriod(daily, 'monthly', '2026-09-21').activityShares.agent_correction > 0, true)
console.log('aggregation tests passed')
