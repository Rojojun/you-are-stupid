const sourceLabels = { codex: 'Codex', claude_code: 'Claude Code', antigravity: 'Antigravity' }

const dateKey = (iso, timeZone = 'Asia/Seoul') => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return undefined
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const value = (type) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

const average = (values) => values.length === 0 ? null : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
const eventWeight = (event) => event.tokenUsage?.state === 'observed' ? Math.max(1, event.tokenUsage.total) : Math.max(0.25, Math.min(3, (event.redactedText ?? '').length / 80))

export function aggregateClarity(classifications, events, timeZone = 'Asia/Seoul') {
  const eventById = new Map(events.map((event) => [event.eventId, event]))
  const grouped = new Map()
  for (const classification of classifications) {
    const event = eventById.get(classification.eventId)
    const key = event && dateKey(event.occurredAt, timeZone)
    if (!key) continue
    const source = event.source
    const group = grouped.get(key) ?? { date: key, totalQuestions: 0, totalWeight: 0, activityWeights: {}, averageClarityScore: null, profanityCount: 0, frictionCount: 0, correctionCount: 0, clarityReasonCounts: {}, frictionTypeCounts: {}, responsibilityCounts: {}, lowestClarityScore: null, lowestQuestion: null, scores: [], bySource: {} }
    group.totalQuestions += 1
    const weight = eventWeight(event)
    group.totalWeight += weight
    group.activityWeights[classification.primaryKind] = (group.activityWeights[classification.primaryKind] ?? 0) + weight
    group.scores.push(classification.clarityScore)
    if (classification.reactionSignals?.profanityDetected) group.profanityCount += 1
    if (classification.reactionSignals?.friction !== 'low') group.frictionCount += 1
    if (classification.primaryKind === 'agent_correction') group.correctionCount += 1
    for (const reason of classification.clarityReasons ?? []) group.clarityReasonCounts[reason] = (group.clarityReasonCounts[reason] ?? 0) + 1
    const frictionType = classification.reactionSignals?.frictionType
    if (frictionType && frictionType !== 'none') group.frictionTypeCounts[frictionType] = (group.frictionTypeCounts[frictionType] ?? 0) + 1
    const responsibility = classification.reactionSignals?.frictionResponsibility
    if (responsibility && responsibility !== 'unclear') group.responsibilityCounts[responsibility] = (group.responsibilityCounts[responsibility] ?? 0) + 1
    if (group.lowestClarityScore === null || classification.clarityScore < group.lowestClarityScore) {
      group.lowestClarityScore = classification.clarityScore
      group.lowestQuestion = event.redactedText ?? event.text ?? null
    }
    const sourceGroup = group.bySource[source] ?? { source: sourceLabels[source] ?? source, totalQuestions: 0, averageClarityScore: null, scores: [] }
    sourceGroup.totalQuestions += 1
    sourceGroup.scores.push(classification.clarityScore)
    sourceGroup.averageClarityScore = average(sourceGroup.scores)
    group.bySource[source] = sourceGroup
    group.averageClarityScore = average(group.scores)
    grouped.set(key, group)
  }
  return [...grouped.values()].map(({ scores, bySource, activityWeights, totalWeight, ...group }) => ({ ...group, totalWeight, activityWeights, activityShares: Object.fromEntries(Object.entries(activityWeights).map(([key, value]) => [key, Math.round(value / totalWeight * 100)])), bySource: Object.fromEntries(Object.entries(bySource).map(([key, value]) => { const { scores: ignored, ...result } = value; return [key, result] })) }))
}

const periodStart = (date, period) => {
  const value = new Date(`${date}T00:00:00Z`)
  if (period === 'monthly') return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-01`
  const day = value.getUTCDay()
  value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1))
  return value.toISOString().slice(0, 10)
}

export function aggregatePeriod(daily, period, date) {
  const start = periodStart(date, period)
  const endExclusive = period === 'monthly'
    ? new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 1)).toISOString().slice(0, 10)
    : new Date(Date.parse(`${start}T00:00:00Z`) + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const matching = daily.filter((item) => item.date >= start && item.date < endExclusive)
  const scores = matching.flatMap((item) => Array(item.totalQuestions).fill(item.averageClarityScore ?? 0))
  const previous = daily.filter((item) => item.date < start).slice(-(period === 'monthly' ? 31 : 7))
  const previousScores = previous.flatMap((item) => Array(item.totalQuestions).fill(item.averageClarityScore ?? 0))
  const activityWeights = {}
  const clarityReasonCounts = {}
  const frictionTypeCounts = {}
  const responsibilityCounts = {}
  let lowestClarityScore = null
  let lowestQuestion = null
  for (const item of matching) {
    for (const [kind, weight] of Object.entries(item.activityWeights ?? {})) activityWeights[kind] = (activityWeights[kind] ?? 0) + weight
    for (const [reason, count] of Object.entries(item.clarityReasonCounts ?? {})) clarityReasonCounts[reason] = (clarityReasonCounts[reason] ?? 0) + count
    for (const [type, count] of Object.entries(item.frictionTypeCounts ?? {})) frictionTypeCounts[type] = (frictionTypeCounts[type] ?? 0) + count
    for (const [owner, count] of Object.entries(item.responsibilityCounts ?? {})) responsibilityCounts[owner] = (responsibilityCounts[owner] ?? 0) + count
    if (item.lowestClarityScore !== null && (lowestClarityScore === null || item.lowestClarityScore < lowestClarityScore)) {
      lowestClarityScore = item.lowestClarityScore
      lowestQuestion = item.lowestQuestion
    }
  }
  const totalWeight = Object.values(activityWeights).reduce((sum, value) => sum + value, 0)
  return {
    period, start, end: date, totalQuestions: matching.reduce((sum, item) => sum + item.totalQuestions, 0),
    averageClarityScore: average(scores), clarityDelta: average(scores) === null || previousScores.length === 0 ? null : average(scores) - average(previousScores),
    profanityCount: matching.reduce((sum, item) => sum + item.profanityCount, 0),
    frictionCount: matching.reduce((sum, item) => sum + item.frictionCount, 0),
    correctionCount: matching.reduce((sum, item) => sum + item.correctionCount, 0),
    days: matching.length, activityShares: Object.fromEntries(Object.entries(activityWeights).map(([kind, weight]) => [kind, Math.round(weight / totalWeight * 100)])),
    clarityReasonCounts, frictionTypeCounts, responsibilityCounts, lowestClarityScore, lowestQuestion,
  }
}
