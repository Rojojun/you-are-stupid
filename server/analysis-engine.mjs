export const ENGINE_VERSION = 'deterministic-v7'

const rules = [
  ['agent_correction', /틀렸|고집|방향.*틀|범위.*바꿨|묻지.*바꿨/i, '오류 또는 범위 변경을 바로잡는 표현'],
  ['progress_check', /진행.*어때|상황.*어때|어디까지|지금.*되고|잘.*되고|작업.*되고|현재.*상태|문제.*있어|여기만.*그런|전부.*그런|다른.*곳.*그런/i, '진행 상태나 현재 범위를 확인하는 표현'],
  ['cross_agent_handoff', /옮겨|전달|다른.*(에이전트|채팅)|복사/i, '다른 대화·에이전트로 맥락을 전달하는 표현'],
  ['resume_instruction', /^(계속|진행해|진행|응|ㄱㄱ|고고|가자|해|시작해|그래|좋아|다음|오케이|오키)(\s*(가자|해|진행해|시작해))?$/i, '앞선 작업을 승인하고 다음 단계로 진행하는 지시'],
  ['simplify_explanation', /쉬운 말|쉽게.*설명|다시.*설명/i, '설명 수준을 조정하는 요청'],
  ['rule_reminder', /이미.*말|규칙.*다시|기억.*해/i, '기존 규칙을 재고지하는 표현'],
  ['other', /질문.*(명확|클리어|평가|점수)|명확.*판단|클리어.*판단|왜.*점수|왜.*평가/i, '직전 질문이나 분석 기준을 확인하는 메타 질문'],
]

const profanityPattern = /씨발|시발|병신|좆|fuck|shit|bitch|asshole/i
const continuationPattern = /^(계속|진행해|진행|응|ㄱㄱ|고고|가자|해|시작해|그래|좋아|다음|오케이|오키|그럼|자)(\s*(가자|해|하자|진행|진행해|진행하자|시작해|시작하자))?$/i
const metaQuestionPattern = /질문.*(명확|클리어|평가|점수)|명확.*판단|클리어.*판단|방금|직전|이전|왜.*평가|몇\s*점|점수|이게.*문제|무슨.*문제|어떻게.*판단|기준이/i

const clarityDimensions = [
  ['goal', /만들|구현|분석|정리|알려|설명|비교|fix|build|analy[sz]e|explain|decide/i, '목표나 원하는 결과가 구체적으로 드러나지 않음'],
  ['context', /현재|지금|배경|문제|상황|프로젝트|파일|에러|because|context|current|project|file|error/i, '현재 상태나 필요한 배경 맥락이 부족함'],
  ['constraints', /조건|제약|범위|반드시|금지|운영체제|맥|윈도|must|should|only|constraint|scope|mac|windows/i, '범위·제약·권한 조건이 명시되지 않음'],
  ['verification', /검증|테스트|확인|근거|재현|verify|test|check|evidence|reproduc/i, '완료 여부를 판단할 검증 방법이 없음'],
  ['completion', /완료|끝나면|결과|산출물|다음|결정|accept|done|output|next|decision/i, '완료 기준이나 다음 행동이 명확하지 않음'],
]

const scoreClarity = (text, context = {}) => {
  const normalized = text.trim()
  const weights = { goal: 0.3, context: 0.2, constraints: 0.15, verification: 0.15, completion: 0.2 }
  const dimensions = Object.fromEntries(clarityDimensions.map(([key, pattern]) => [key, pattern.test(normalized) ? 2 : 0]))
  if (normalized.length >= 12) dimensions.goal = Math.max(dimensions.goal, 1)
  if (normalized.length >= 25) dimensions.context = Math.max(dimensions.context, 1)
  if (normalized.includes('?') || normalized.includes('？')) dimensions.goal = Math.max(dimensions.goal, 1)
  if (dimensions.goal === 2 && normalized.length >= 25) dimensions.completion = Math.max(dimensions.completion, 1)
  if (context.previousAssistantPresent) dimensions.context = Math.max(dimensions.context, 2)
  if (context.isResumeInstruction && context.previousAssistantPresent) {
    dimensions.goal = 2
    dimensions.completion = 1
  }
  const weighted = Object.entries(dimensions).reduce((sum, [key, value]) => sum + (value / 2) * weights[key], 0)
  let score = Math.round(weighted * 100)
  if (normalized.length >= 8) score = Math.max(score, 35)
  const reasons = clarityDimensions.filter(([key]) => dimensions[key] === 0).map(([, , reason]) => reason)
  if (context.isContinuation) {
    score = 85
    reasons.length = 0
    reasons.push(context.previousAssistantPresent ? '앞선 작업 문맥을 승인하고 다음 단계로 진행하는 명확한 지시' : '짧지만 재개·승인 의도가 명확한 지시')
  }
  if (context.isMetaQuestion) {
    score = Math.max(score, 85)
    reasons.length = 0
    reasons.push('직전 평가나 대화 기준을 확인하는 명확한 메타 질문')
  }
  if (score >= 80 && !context.isContinuation && !context.isMetaQuestion) reasons.length = 0
  if (context.recognizedKind && context.recognizedKind !== 'productive_work' && !context.isContinuation) {
    score = Math.max(score, 80)
    reasons.length = 0
    reasons.push('활동 의도가 명확한 워크플로 지시로 해석됨')
  }
  if (context.responseSeemsResolved) score = Math.min(100, score + 5)
  if (context.repeatedQuestion) { score = Math.max(0, score - 15); reasons.push('이전 질문과 유사한 내용을 반복함') }
  if (context.followupCorrection) { score = Math.max(0, score - 10); reasons.push('질문 직후 추가 교정이 발생함') }
  return { score, dimensions, reasons: reasons.length > 0 ? reasons : [score >= 80 ? '목표와 요청 결과가 충분히 명확함' : '핵심 질문과 완료 조건이 비교적 구체적임'] }
}

export function analyzeEvents(events) {
  const ordered = [...events].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
  return ordered.filter((event) => event.role === 'user').map((event) => {
    const text = event.redactedText
    const rule = rules.find(([, pattern]) => pattern.test(text.trim()))
    const hasProfanity = profanityPattern.test(text)
    const sameConversation = ordered.filter((candidate) => candidate.source === event.source && candidate.conversationId === event.conversationId)
    const index = sameConversation.findIndex((candidate) => candidate.eventId === event.eventId)
    const preceding = sameConversation.slice(Math.max(0, index - 3), index)
    const following = sameConversation.slice(index + 1, index + 4)
    const previousUsers = preceding.filter((candidate) => candidate.role === 'user')
    const normalizedText = text.trim().toLowerCase().replace(/\s+/g, '')
    const context = {
      previousAssistantPresent: preceding.some((candidate) => candidate.role === 'assistant'),
      nextAssistantPresent: following.some((candidate) => candidate.role === 'assistant'),
      isResumeInstruction: rule?.[0] === 'resume_instruction',
      isContinuation: continuationPattern.test(text.trim()),
      isMetaQuestion: metaQuestionPattern.test(text.trim()),
      recognizedKind: rule?.[0],
      responseSeemsResolved: preceding.some((candidate) => candidate.role === 'assistant' && /완료|성공|통과|구현했|finished|passed|done/i.test(candidate.redactedText)),
      repeatedQuestion: previousUsers.some((candidate) => candidate.redactedText.trim().toLowerCase().replace(/\s+/g, '') === normalizedText),
      followupCorrection: following.some((candidate) => candidate.role === 'user' && /틀렸|고집|방향.*틀|범위.*바꿨|묻지.*바꿨/i.test(candidate.redactedText)),
    }
    const clarity = scoreClarity(text, context)
    return {
      eventId: event.eventId,
      workspaceId: event.workspaceId,
      conversationId: event.conversationId,
      source: event.source,
      occurredAt: event.occurredAt,
      primaryKind: rule?.[0] ?? 'productive_work',
      secondaryKinds: hasProfanity ? ['friction_signal'] : [],
      confidence: 'low',
      rationale: rule?.[2] ?? '새 작업, 질문 또는 의사결정으로 보이는 사용자 발화',
      reactionSignals: {
        profanityDetected: hasProfanity,
        friction: hasProfanity || rule?.[0] === 'agent_correction' ? 'medium' : 'low',
      },
      clarityScore: clarity.score,
      clarityDimensions: clarity.dimensions,
      clarityReasons: clarity.reasons,
      context: {
        windowSize: preceding.length + following.length,
        precedingRoles: preceding.map((candidate) => candidate.role),
        followingRoles: following.map((candidate) => candidate.role),
        previousAssistantPresent: context.previousAssistantPresent,
        nextAssistantPresent: context.nextAssistantPresent,
        contextSignals: [
          ...(context.previousAssistantPresent ? ['previous_assistant_response'] : []),
          ...(context.isResumeInstruction || context.isContinuation ? ['resume_instruction'] : []),
          ...(rule?.[0] === 'agent_correction' && preceding.some((candidate) => candidate.role === 'assistant') ? ['correction_after_assistant'] : []),
          ...(context.responseSeemsResolved ? ['previous_response_resolved'] : []),
          ...(context.repeatedQuestion ? ['repeated_question'] : []),
          ...(context.followupCorrection ? ['followup_correction'] : []),
        ],
      },
      engine: ENGINE_VERSION,
    }
  })
}
