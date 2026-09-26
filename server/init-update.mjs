import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { analyzeEvents } from './analysis-engine.mjs'
import { aggregateClarity, aggregatePeriod } from './aggregation.mjs'
import { AnalysisStore } from './analysis-store.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (!value.startsWith('--')) return pairs
  pairs.push([value.slice(2), values[index + 1] && !values[index + 1].startsWith('--') ? values[index + 1] : 'true'])
  return pairs
}, []))
const period = args.period ?? 'weekly'
const date = args.date ?? new Date().toISOString().slice(0, 10)
const timeZone = args.timezone ?? 'Asia/Seoul'
const storage = resolve(args.storage ?? './.data/ingestion-events.jsonl')
const outDir = resolve(args['out-dir'] ?? './.data/init-addenda')
const workspaceId = args.workspace ?? process.env.CENTRAL_WORKSPACE_ID
const analysisDb = args['analysis-db'] ? resolve(args['analysis-db']) : undefined

const sourceNames = { codex: 'Codex', claude_code: 'Claude Code', antigravity: 'Antigravity' }
const sourceFiles = { codex: 'codex.addendum.md', claude_code: 'claude-code.addendum.md', antigravity: 'antigravity.addendum.md' }
const kindLabels = { productive_work: '실제 작업', agent_correction: '에이전트 교정', progress_check: '진행 확인', cross_agent_handoff: '대화 전달', resume_instruction: '재개 지시', simplify_explanation: '쉬운 설명 요청', rule_reminder: '규칙 재고지', other: '기타' }
const frictionLabels = { profanity: '욕설', repeated_request: '반복 요구', disagreement: '의견 충돌', assistant_error: 'AI 오류' }
const responsibilityLabels = { user: '사용자 쪽', assistant: 'AI 쪽', both: '양쪽 모두' }
const topEntries = (values, labels = {}) => Object.entries(values ?? {}).sort((left, right) => right[1] - left[1]).slice(0, 3).map(([key, count]) => `${labels[key] ?? key} ${count}회`).join(' · ')

const readEvents = async () => {
  try { return (await readFile(storage, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line)) }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error }
}

const recommendations = (classifications) => {
  const counts = new Map()
  for (const classification of classifications) for (const reason of classification.clarityReasons) counts.set(reason, (counts.get(reason) ?? 0) + 1)
  const rules = [
    ['목표나 원하는 결과가 구체적으로 드러나지 않음', '요청 첫 문장에 원하는 산출물과 완료 상태를 명시한다.'],
    ['현재 상태나 필요한 배경 맥락이 부족함', '현재 상태, 관련 파일/오류, 지금까지 시도한 내용을 함께 제공한다.'],
    ['범위·제약·권한 조건이 명시되지 않음', '대상 범위, 운영체제, 변경 가능 영역과 금지 영역을 명시한다.'],
    ['완료 여부를 판단할 검증 방법이 없음', '완료 조건과 실행할 테스트 또는 검증 방법을 요청에 포함한다.'],
    ['완료 기준이나 다음 행동이 명확하지 않음', '결과물 형식과 다음 행동 또는 의사결정 기준을 적는다.'],
  ]
  const clarity = rules.filter(([reason]) => (counts.get(reason) ?? 0) >= 2)
    .sort((left, right) => counts.get(right[0]) - counts.get(left[0]))
    .slice(0, 3)
    .map(([reason, recommendation]) => ({ reason, recommendation, count: counts.get(reason) }))
  const frictionCounts = new Map()
  const frictionRules = {
    profanity: '강한 표현보다 문제 상황과 원하는 조치를 함께 적어 감정 신호와 작업 지시를 분리한다.',
    repeated_request: '같은 요청을 반복하기 전에 현재 결과와 기대 결과의 차이를 한 문장으로 설명한다.',
    disagreement: '사용자 판단과 AI 판단이 다를 때 근거·제약·검증 결과를 함께 적어 판단 기준을 맞춘다.',
    assistant_error: 'AI가 잘못 이해했을 때 잘못된 부분, 원하는 방향, 변경 범위를 함께 지정한다.',
  }
  for (const classification of classifications) {
    const type = classification.reactionSignals?.frictionType
    if (type && type !== 'none') frictionCounts.set(type, (frictionCounts.get(type) ?? 0) + 1)
  }
  const friction = Object.entries(frictionRules).filter(([type]) => (frictionCounts.get(type) ?? 0) >= 2)
    .sort((left, right) => frictionCounts.get(right[0]) - frictionCounts.get(left[0]))
    .slice(0, 3)
    .map(([type, recommendation]) => ({ type, recommendation, count: frictionCounts.get(type) }))
  const kindCounts = new Map()
  for (const classification of classifications) kindCounts.set(classification.primaryKind, (kindCounts.get(classification.primaryKind) ?? 0) + 1)
  const style = []
  const total = classifications.length
  if (total > 0 && (kindCounts.get('progress_check') ?? 0) / total >= 0.2) style.push({ recommendation: '진행 확인을 보낼 때 현재 막힌 지점과 다음 확인 기준을 함께 적는다.', count: kindCounts.get('progress_check') })
  if (total > 0 && (kindCounts.get('resume_instruction') ?? 0) / total >= 0.2) style.push({ recommendation: '짧은 재개 지시를 보낼 때 이어서 실행할 대상 작업을 한 단어 이상 덧붙인다.', count: kindCounts.get('resume_instruction') })
  if (total > 0 && (kindCounts.get('agent_correction') ?? 0) / total >= 0.15) style.push({ recommendation: 'AI 교정 시 오류·원하는 결과·허용 범위를 한 번에 명시해 재작업을 줄인다.', count: kindCounts.get('agent_correction') })
  return { clarity, friction, style }
}

const block = (source, reports, classifications) => {
  const title = `AI Usage Insights 추가 지침 · ${sourceNames[source]}`
  const lines = [`<!-- AI-USAGE-INSIGHTS:BEGIN source=${source} date=${date} -->`, `## ${title}`, '', '> 이 블록은 기존 init/MD 내용을 대체하지 않는 자동 생성 추가 지침입니다.', '']
  for (const report of reports) {
    const delta = report.clarityDelta === null ? '비교 데이터 없음' : `${report.clarityDelta >= 0 ? '+' : ''}${report.clarityDelta}점`
    const shares = Object.entries(report.activityShares ?? {}).sort((left, right) => right[1] - left[1]).slice(0, 4).map(([kind, value]) => `${kindLabels[kind] ?? kind} ${value}%`).join(' · ')
    lines.push(`### ${report.label}`, `- 질문 수: ${report.totalQuestions}개`, `- 질문 명확도 평균: ${report.averageClarityScore ?? '데이터 없음'}/100`, `- 이전 기간 대비 명확도 변화: ${delta}`, `- 가중 활동 비율: ${shares || '데이터 없음'}`, `- 욕설 반응 신호: ${report.profanityCount}회`, `- 중간 이상 마찰 신호: ${report.frictionCount}회`, `- 에이전트 교정: ${report.correctionCount}회`, `- 집계 일수: ${report.days}일`)
    lines.push(`- 명확도 저하 주요 이유: ${topEntries(report.clarityReasonCounts) || '뚜렷한 반복 이유 없음'}`, `- 주요 마찰 유형: ${topEntries(report.frictionTypeCounts, frictionLabels) || '없음'}`, `- 책임 방향: ${topEntries(report.responsibilityCounts, responsibilityLabels) || '판단 가능한 책임 신호 없음'}`, `- 가장 낮은 질문: ${report.lowestClarityScore === null ? '데이터 없음' : `${report.lowestClarityScore}점 · ${report.lowestQuestion ?? '가림본 없음'}`}`)
  }
  const suggestions = recommendations(classifications)
  const allSuggestions = [...suggestions.clarity, ...suggestions.friction, ...suggestions.style]
  if (allSuggestions.length > 0) {
    if (suggestions.clarity.length > 0) lines.push('', '### 질문 명확도 개선', ...suggestions.clarity.map((suggestion) => `- ${suggestion.recommendation} (반복 관측 ${suggestion.count}회)`))
    if (suggestions.friction.length > 0) lines.push('', '### 마찰 감소 지침', ...suggestions.friction.map((suggestion) => `- ${suggestion.recommendation} (반복 관측 ${suggestion.count}회)`))
    if (suggestions.style.length > 0) lines.push('', '### 질문 스타일 보완', ...suggestions.style.map((suggestion) => `- ${suggestion.recommendation} (반복 관측 ${suggestion.count}회)`))
    lines.push('', '### 질문 작성 형식', '- 구현·분석을 요청할 때 아래 다섯 항목을 가능한 범위에서 채운다.', '- 목표: 무엇을 만들거나 결정할지', '- 현재 상태: 관련 파일·오류·이미 시도한 것', '- 제약: 범위·운영체제·변경 금지 영역·권한', '- 검증: 실행할 테스트나 확인 방법', '- 완료 기준: 어떤 결과가 나오면 끝인지')
  }
  lines.push('', '<!-- AI-USAGE-INSIGHTS:END -->', '')
  return lines.join('\n')
}

const events = await readEvents()
let allClassifications = analyzeEvents(events)
if (workspaceId && analysisDb) {
  const store = new AnalysisStore(analysisDb)
  const jevClassifications = store.list(workspaceId)
  if (jevClassifications.length > 0) {
    const byEvent = new Map(jevClassifications.map((classification) => [classification.eventId, classification]))
    allClassifications = events.flatMap((event) => byEvent.has(event.eventId) ? [byEvent.get(event.eventId)] : [])
  }
  store.close()
}
await mkdir(outDir, { recursive: true })
for (const source of Object.keys(sourceNames)) {
  const sourceEvents = events.filter((event) => event.source === source)
  const sourceClassifications = allClassifications.filter((classification) => classification.source === source)
  const sourceDaily = aggregateClarity(sourceClassifications, sourceEvents, timeZone)
  const reports = []
  if (period === 'weekly' || period === 'combined') reports.push({ label: '주간 집계', ...aggregatePeriod(sourceDaily, 'weekly', date) })
  if (period === 'monthly' || period === 'combined') reports.push({ label: '월간 집계', ...aggregatePeriod(sourceDaily, 'monthly', date) })
  await writeFile(resolve(outDir, sourceFiles[source]), block(source, reports, sourceClassifications), 'utf8')
}
console.log(`generated ${Object.keys(sourceNames).length} init addenda in ${outDir}`)
