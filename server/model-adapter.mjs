import { analyzeEvents, ENGINE_VERSION } from './analysis-engine.mjs'

const allowedKinds = new Set(['productive_work', 'agent_correction', 'progress_check', 'cross_agent_handoff', 'resume_instruction', 'simplify_explanation', 'rule_reminder', 'other'])
const jevKinds = [...allowedKinds]
const jevKindCriteria = Object.fromEntries(jevKinds.map((kind) => [kind, {
  productive_work: 'A new task, question, or decision that requires substantive work.',
  agent_correction: 'The user corrects an assistant error, wrong direction, or unauthorized scope change.',
  progress_check: 'The user asks about current progress or status.',
  cross_agent_handoff: 'The user transfers context between agents or chats.',
  resume_instruction: 'The user approves or resumes the already established next step without adding a new task.',
  simplify_explanation: 'The user asks for a simpler or clearer explanation.',
  rule_reminder: 'The user repeats or reinforces an existing rule or constraint.',
  other: 'None of the other activity types clearly fits.',
}[kind]]))

const jevQuestionDefinitions = {
  activity_kind: {
    type: 'choice',
    criteria: jevKindCriteria,
    instructions: 'Classify this user message by its primary activity. A short continuation such as go ahead, continue, or next is resume_instruction, not productive_work, unless it introduces a new task.',
  },
  goal: {
    type: 'score',
    criteria: ['No intended action or question is identifiable.', 'Some intent is identifiable, but the requested result is vague.', 'The intended action or question is specific.'],
    instructions: 'How clearly does this message state the intended action or question?',
  },
  context: {
    type: 'score',
    criteria: ['No relevant context is provided.', 'Some context is provided, but important background is missing.', 'The relevant conversation context is sufficient for this request.'],
    instructions: 'How sufficient is the relevant context for interpreting this message?',
  },
  constraints: {
    type: 'score',
    criteria: ['No scope, constraint, or boundary is stated.', 'Some scope or boundary is implied.', 'The important scope, constraints, or boundaries are explicit.'],
    instructions: 'How clearly are scope and constraints stated in this message and its context?',
  },
  verification: {
    type: 'score',
    criteria: ['No way to check the result is stated.', 'A completion check is implied.', 'The requested verification or evidence is explicit.'],
    instructions: 'How clearly does the message state how the result should be checked?',
  },
  completion: {
    type: 'score',
    criteria: ['No desired result or completion condition is identifiable.', 'A desired result is implied but incomplete.', 'The desired result or completion condition is clear.'],
    instructions: 'How clearly is the desired result or completion condition stated?',
  },
  clarity_signal: {
    type: 'score',
    criteria: ['Mostly noise, profanity, repetition, or insistence without an actionable request.', 'An actionable request is mixed with noise or emotional emphasis.', 'The message contains a substantive, actionable request.'],
    instructions: 'Rate the useful signal in this message. Profanity attached to a concrete request is not noise; repeated profanity or insistence without a request is low signal.',
  },
  is_friction: {
    type: 'noul',
    instructions: 'Does this message show friction caused by an assistant mistake, misunderstanding, repeated failure, or blocked progress? Profanity alone is not enough.',
  },
  friction_reason: {
    type: 'choice',
    criteria: {
      assistant_error: 'The assistant made an incorrect or unauthorized change.',
      misunderstanding: 'The assistant misunderstood the user or the requested direction.',
      repeated_failure: 'The same problem or failed attempt happened repeatedly.',
      blocked_progress: 'The user cannot proceed because the work is stuck.',
      emotional_emphasis: 'Strong language is present but no concrete assistant-caused friction is clear.',
      none: 'No clear friction cause is present.',
    },
    instructions: 'If friction is present, classify its most likely cause. Choose none when there is no clear friction.',
  },
  friction_type: {
    type: 'choice',
    criteria: {
      profanity: 'The user uses profanity as a reaction signal.',
      repeated_request: 'The user repeats the same request because progress or understanding did not advance.',
      disagreement: 'The user and assistant assert conflicting judgments or conclusions.',
      assistant_error: 'The friction is primarily caused by an assistant error or unauthorized change.',
      none: 'No observable friction pattern is present.',
    },
    instructions: 'Classify the observable friction pattern. Profanity is its own type; do not infer emotion or personality.',
  },
  friction_responsibility: {
    type: 'choice',
    criteria: {
      user: 'The user position or request is the primary source of the disagreement.',
      assistant: 'The assistant error or judgment is the primary source of the disagreement.',
      both: 'Both sides contribute materially to the disagreement.',
      unclear: 'The available context cannot determine responsibility.',
    },
    instructions: 'When there is disagreement, identify which side appears responsible from the available conversation context. Use unclear when evidence is insufficient.',
  },
}

const validateRemote = (payload, eventIds) => {
  if (!payload || !Array.isArray(payload.classifications)) throw new Error('MODEL_RESPONSE_INVALID')
  const expected = new Set(eventIds)
  const valid = payload.classifications.filter((item) => expected.has(item.eventId))
  if (new Set(valid.map((item) => item.eventId)).size !== expected.size) throw new Error('MODEL_RESPONSE_MISSING_EVENTS')
  return valid.map((item) => {
    if (!allowedKinds.has(item.primaryKind) || typeof item.rationale !== 'string' || typeof item.clarityScore !== 'number') throw new Error('MODEL_RESPONSE_INVALID')
    return { ...item, confidence: item.confidence === 'high' || item.confidence === 'medium' ? item.confidence : 'low', engine: payload.engine ?? 'remote-v1' }
  })
}

const jevAnswer = (answers, key) => answers?.[key] ?? answers?.[String(key)]

const readChoice = (answer) => answer?.choice ?? answer?.value ?? answer
const readScore = (answer) => {
  const value = answer?.score ?? answer?.value ?? answer
  return typeof value === 'number' ? value : undefined
}
const readProbability = (answer) => {
  const value = answer?.noul ?? answer?.probability
  return typeof value === 'number' ? value : undefined
}

const answerKey = (index, name) => `event_${index}_${name}`

const buildJevQuestions = (events) => Object.fromEntries(events.flatMap((_event, index) => Object.entries(jevQuestionDefinitions).map(([name, definition]) => [answerKey(index, name), definition])))

const scoreDimension = (answer, topLevel = 2) => {
  const score = readScore(answer)
  return typeof score === 'number' && Number.isFinite(score) ? Math.max(0, Math.min(1, score / topLevel)) : undefined
}

const confidenceStatus = (confidence) => confidence >= 0.8 ? 'accepted' : 'review'

const validateJev = (payload, contextEvents, expectedUsers, baseline) => {
  const answers = payload?.answers ?? payload?.results
  if (!answers || typeof answers !== 'object') throw new Error('JEV_RESPONSE_INVALID')
  return expectedUsers.map((event, index) => {
    const activityAnswer = jevAnswer(answers, answerKey(index, 'activity_kind'))
    const dimensionAnswers = Object.fromEntries(['goal', 'context', 'constraints', 'verification', 'completion'].map((name) => [name, jevAnswer(answers, answerKey(index, name))]))
    const frictionAnswer = jevAnswer(answers, answerKey(index, 'is_friction'))
    const frictionReasonAnswer = jevAnswer(answers, answerKey(index, 'friction_reason'))
    const frictionTypeAnswer = jevAnswer(answers, answerKey(index, 'friction_type'))
    const frictionResponsibilityAnswer = jevAnswer(answers, answerKey(index, 'friction_responsibility'))
    const claritySignalAnswer = jevAnswer(answers, answerKey(index, 'clarity_signal'))
    if (!activityAnswer || Object.values(dimensionAnswers).some((answer) => !answer) || !frictionAnswer || !frictionReasonAnswer) throw new Error(`JEV_RESPONSE_MISSING_EVENT_${event.eventId}`)
    const base = baseline.find((item) => item.eventId === event.eventId)
    const kind = readChoice(activityAnswer)
    if (!allowedKinds.has(kind)) throw new Error('JEV_RESPONSE_SCHEMA_INVALID')
    const normalizedDimensions = Object.fromEntries(Object.entries(dimensionAnswers).map(([name, answer]) => [name, scoreDimension(answer)]))
    const normalizedSignal = scoreDimension(claritySignalAnswer) ?? (/^(?:\s*(?:씨발|시발|fuck|shit|좆|병신|개새끼|꺼져)\s*)+$/i.test(event.redactedText ?? '') ? 0 : 1)
    if (Object.values(normalizedDimensions).some((score) => score === undefined)) throw new Error('JEV_RESPONSE_SCHEMA_INVALID')
    const weights = { goal: 0.255, context: 0.17, constraints: 0.1275, verification: 0.1275, completion: 0.17 }
    const baseClarityScore = Math.round(Object.entries(weights).reduce((sum, [name, weight]) => sum + normalizedDimensions[name] * weight, 0) * 100)
    const clarityScore = normalizedSignal < 0.5
      ? Math.min(35, Math.round(baseClarityScore + (normalizedSignal * 100 * 0.15)))
      : Math.round(baseClarityScore + (normalizedSignal * 100 * 0.15))
    const confidenceValues = [activityAnswer, ...Object.values(dimensionAnswers)].map((answer) => answer?.confidence).filter((value) => typeof value === 'number')
    const confidence = confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : undefined
    const friction = readProbability(frictionAnswer)
    const frictionReason = readChoice(frictionReasonAnswer) ?? 'none'
    const clarityReasons = Object.entries(normalizedDimensions).filter(([, score]) => score < 0.5).map(([name]) => ({ goal: '목표가 모호함', context: '필요한 맥락이 부족함', constraints: '범위·제약이 부족함', verification: '검증 방법이 불명확함', completion: '완료 기준이 불명확함' })[name])
    const jevAnswers = Object.fromEntries([
      ['activity_kind', activityAnswer],
      ...Object.entries(dimensionAnswers),
      ['is_friction', frictionAnswer],
      ['friction_reason', frictionReasonAnswer],
      ['friction_type', frictionTypeAnswer],
      ['friction_responsibility', frictionResponsibilityAnswer],
      ['clarity_signal', claritySignalAnswer],
    ])
    const jevConfidenceByQuestion = Object.fromEntries(Object.entries(jevAnswers).map(([name, answer]) => [name, answer?.confidence ?? null]))
    return {
      ...base,
      primaryKind: kind,
      confidence: confidence >= 0.8 ? 'high' : confidence >= 0.55 ? 'medium' : 'low',
      clarityScore,
      clarityReasons: clarityReasons.length ? clarityReasons : ['Jev가 목표·맥락·범위·검증·완료기준을 명확하게 판단함'],
      clarityDimensions: normalizedDimensions,
      jevConfidence: confidence,
      jevAnswers,
      jevConfidenceByQuestion,
      confidenceStatus: confidenceStatus(confidence ?? 0),
      confidencePolicyVersion: 'jev-confidence-v1',
      scoringWeightsVersion: 'clarity-v1',
      shadowComparison: {
        engine: base.engine,
        primaryKind: base.primaryKind,
        clarityScore: base.clarityScore,
        confidence: base.confidence,
      },
      jevUsage: payload.usage ?? null,
      rationale: `Jev 분류: ${kind}`,
      reactionSignals: {
        ...base.reactionSignals,
        friction: friction >= 0.7 ? 'high' : friction >= 0.35 ? 'medium' : base.reactionSignals.friction,
        frictionReason,
        frictionType: readChoice(frictionTypeAnswer) ?? (base.reactionSignals.profanityDetected ? 'profanity' : 'none'),
        frictionResponsibility: readChoice(frictionResponsibilityAnswer) ?? 'unclear',
      },
      engine: payload.model ?? payload.engine ?? 'jev',
    }
  })
}

const jevState = (events) => events.map(({ eventId, source, role, occurredAt, redactedText, conversationId }) => ({
  eventId,
  source,
  role,
  occurredAt,
  // Keep the stored/imported text untouched; cap only the analysis payload.
  redactedText: typeof redactedText === 'string' ? redactedText.slice(0, Number(process.env.JEV_TEXT_MAX_CHARS ?? 3500)) : '',
  conversationId,
}))

const contextForJevBatch = (events, batchUsers) => {
  const ordered = [...events].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
  const selected = new Map()
  for (const user of batchUsers) {
    const conversation = ordered.filter((event) => event.source === user.source && event.conversationId === user.conversationId)
    const index = conversation.findIndex((event) => event.eventId === user.eventId)
    for (const event of conversation.slice(Math.max(0, index - 1), index + 2)) selected.set(event.eventId, event)
  }
  return [...selected.values()].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
}

const createJevAdapter = ({ url, token, fetchImpl, timeoutMs, retries, batchSize = Number(process.env.JEV_EVENT_BATCH_SIZE ?? 1) }) => ({
  name: 'jev-v1',
  async classify(events) {
    const baseline = analyzeEvents(events)
    const userEvents = events.filter((event) => event.role === 'user')
    if (userEvents.length === 0) return []
    const results = []
    for (let offset = 0; offset < userEvents.length; offset += Math.max(1, batchSize)) {
      const batchUsers = userEvents.slice(offset, offset + Math.max(1, batchSize))
      const batchEvents = contextForJevBatch(events, batchUsers)
      let lastError = new Error('JEV_REQUEST_FAILED')
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = new AbortController()
        const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined
        try {
          const response = await fetchImpl(url, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ model: process.env.JEV_MODEL ?? 'jev-latest', state: { events: jevState(batchEvents) }, questions: buildJevQuestions(batchUsers) }),
            signal: controller.signal,
          })
          if (!response.ok) {
            let detail = ''
            try { detail = (await response.text()).slice(0, 1000) } catch { /* keep status-only error */ }
            throw new Error(`JEV_REQUEST_FAILED_${response.status}${detail ? `: ${detail}` : ''}`)
          }
          results.push(...validateJev(await response.json(), batchEvents, batchUsers, baseline))
          lastError = undefined
          break
        } catch (error) {
          lastError = error instanceof Error && error.name === 'AbortError' ? new Error('JEV_REQUEST_TIMEOUT') : error instanceof Error ? error : lastError
          if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, Math.min(250 * (attempt + 1), 1000)))
        } finally { if (timer) clearTimeout(timer) }
      }
      if (lastError) throw lastError
    }
    return results
  },
})

export function createModelAdapter({ url = process.env.CENTRAL_MODEL_URL, token = process.env.CENTRAL_MODEL_TOKEN, jevUrl = process.env.JEV_API_URL ?? 'https://api.typesafe.ai/v1/systemone', jevToken = process.env.TYPESAFE_API_KEY, provider = process.env.CENTRAL_MODEL_PROVIDER, fetchImpl = fetch, timeoutMs = Number(process.env.CENTRAL_MODEL_TIMEOUT_MS ?? 15000), retries = Number(process.env.CENTRAL_MODEL_RETRIES ?? 2) } = {}) {
  if ((provider === 'jev' || (!url && jevToken)) && jevToken) return createJevAdapter({ url: jevUrl, token: jevToken, fetchImpl, timeoutMs, retries })
  if (!url) return { name: ENGINE_VERSION, async classify(events) { return analyzeEvents(events) } }
  return {
    name: 'remote-json-v1',
    async classify(events) {
      let lastError = new Error('MODEL_REQUEST_FAILED')
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = new AbortController()
        const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined
        try {
          const response = await fetchImpl(url, { method: 'POST', headers: { authorization: token ? `Bearer ${token}` : '', 'content-type': 'application/json' }, body: JSON.stringify({ schemaVersion: 1, events }), signal: controller.signal })
          if (!response.ok) throw new Error(`MODEL_REQUEST_FAILED_${response.status}`)
          return validateRemote(await response.json(), events.map((event) => event.eventId))
        } catch (error) {
          lastError = error instanceof Error && error.name === 'AbortError' ? new Error('MODEL_REQUEST_TIMEOUT') : error instanceof Error ? error : lastError
          if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, Math.min(250 * (attempt + 1), 1000)))
        } finally { if (timer) clearTimeout(timer) }
      }
      throw lastError
    },
  }
}
