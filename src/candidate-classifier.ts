import { type ActivityKind, type CandidateClassification, type ConversationEvent } from './domain'

const rules: ReadonlyArray<Readonly<{ kind: ActivityKind; pattern: RegExp; rationale: string }>> = [
  { kind: 'agent_correction', pattern: /틀렸|고집|방향.*틀|범위.*바꿨|묻지.*바꿨/i, rationale: '오류 또는 범위 변경을 바로잡는 표현' },
  { kind: 'progress_check', pattern: /진행.*어때|상황.*어때|어디까지|지금.*되고|잘.*되고|작업.*되고|현재.*상태|문제.*있어|여기만.*그런|전부.*그런|다른.*곳.*그런/i, rationale: '진행 상태나 현재 범위를 확인하는 표현' },
  { kind: 'cross_agent_handoff', pattern: /옮겨|전달|다른.*(에이전트|채팅)|복사/i, rationale: '다른 대화·에이전트로 맥락을 전달하는 표현' },
  { kind: 'resume_instruction', pattern: /^(계속|진행해|진행|응|ㄱㄱ|고고|가자|해|시작해|그래|좋아|다음|오케이|오키)(\s*(가자|해|진행해|시작해))?$/i, rationale: '앞선 작업을 승인하고 다음 단계로 진행하는 지시' },
  { kind: 'simplify_explanation', pattern: /쉬운 말|쉽게.*설명|다시.*설명/i, rationale: '설명 수준을 조정하는 요청' },
  { kind: 'rule_reminder', pattern: /이미.*말|규칙.*다시|기억.*해/i, rationale: '기존 규칙을 재고지하는 표현' },
  { kind: 'other', pattern: /질문.*(명확|클리어|평가|점수)|명확.*판단|클리어.*판단|왜.*점수|왜.*평가/i, rationale: '직전 질문이나 분석 기준을 확인하는 메타 질문' },
]

const clarityRules: ReadonlyArray<Readonly<{ key: string; pattern: RegExp; reason: string }>> = [
  { key: 'goal', pattern: /만들|구현|분석|정리|알려|설명|비교|fix|build|analy[sz]e|explain|decide/i, reason: '목표나 원하는 결과가 구체적으로 드러나지 않음' },
  { key: 'context', pattern: /현재|지금|배경|문제|상황|프로젝트|파일|에러|because|context|current|project|file|error/i, reason: '현재 상태나 필요한 배경 맥락이 부족함' },
  { key: 'constraints', pattern: /조건|제약|범위|반드시|금지|운영체제|맥|윈도|must|should|only|constraint|scope|mac|windows/i, reason: '범위·제약·권한 조건이 명시되지 않음' },
  { key: 'verification', pattern: /검증|테스트|확인|근거|재현|verify|test|check|evidence|reproduc/i, reason: '완료 여부를 판단할 검증 방법이 없음' },
  { key: 'completion', pattern: /완료|끝나면|결과|산출물|다음|결정|accept|done|output|next|decision/i, reason: '완료 기준이나 다음 행동이 명확하지 않음' },
]
const profanityPattern = /씨발|시발|병신|좆|fuck|shit|bitch|asshole/i
const continuationPattern = /^(계속|진행해|진행|응|ㄱㄱ|고고|가자|해|시작해|그래|좋아|다음|오케이|오키|그럼|자)(\s*(가자|해|하자|진행|진행해|진행하자|시작해|시작하자))?$/i
const metaQuestionPattern = /질문.*(명확|클리어|평가|점수)|명확.*판단|클리어.*판단|방금|직전|이전|왜.*평가|몇\s*점|점수|이게.*문제|무슨.*문제|어떻게.*판단|기준이/i

const clarity = (text: string): Readonly<{ score: number; reasons: readonly string[] }> => {
  const normalized = text.trim()
  const matched = clarityRules.filter(({ pattern }) => pattern.test(normalized))
  const weights: Readonly<Record<string, number>> = { goal: .3, context: .2, constraints: .15, verification: .15, completion: .2 }
  const dimensions = Object.fromEntries(clarityRules.map(({ key, pattern }) => [key, pattern.test(normalized) ? 2 : 0]))
  if (normalized.length >= 12) dimensions.goal = Math.max(dimensions.goal, 1)
  if (normalized.length >= 25) dimensions.context = Math.max(dimensions.context, 1)
  if (dimensions.goal === 2 && normalized.length >= 25) dimensions.completion = Math.max(dimensions.completion, 1)
  const score = Math.max(normalized.length >= 8 ? 35 : 0, Math.round(Object.entries(dimensions).reduce((sum, [key, value]) => sum + (value / 2) * (weights[key] ?? 0), 0) * 100))
  const reasons = clarityRules.filter(({ key }) => !matched.some((item) => item.key === key)).map(({ reason }) => reason)
  return { score, reasons: reasons.length > 0 ? reasons : ['핵심 질문과 완료 조건이 비교적 구체적임'] }
}

export const classifyCandidates = (events: readonly ConversationEvent[]): CandidateClassification[] =>
  events.flatMap((event) => {
    if (event.role !== 'user') return []
    const rule = rules.find(({ pattern }) => pattern.test(event.text.trim()))
    const kind: ActivityKind = rule?.kind ?? 'productive_work'
    const clarityResult = clarity(event.text)
    const profanityDetected = profanityPattern.test(event.text)
    const isContinuation = continuationPattern.test(event.text.trim())
    const isMetaQuestion = metaQuestionPattern.test(event.text.trim())
    return [{
      eventId: event.eventId,
      kind,
      confidence: 'low' as const,
      rationale: rule?.rationale ?? '새 작업, 질문 또는 의사결정으로 보이는 사용자 발화',
      clarityScore: isContinuation || isMetaQuestion ? 85 : rule && kind !== 'productive_work' ? 80 : clarityResult.score,
      clarityReasons: isContinuation ? ['앞선 작업 문맥을 승인하고 다음 단계로 진행하는 명확한 지시'] : isMetaQuestion ? ['직전 평가나 대화 기준을 확인하는 명확한 메타 질문'] : rule && kind !== 'productive_work' ? ['활동 의도가 명확한 워크플로 지시로 해석됨'] : clarityResult.score >= 80 ? [] : clarityResult.reasons,
      friction: profanityDetected || kind === 'agent_correction' ? 'medium' : 'low',
      profanityDetected,
    }]
  })
