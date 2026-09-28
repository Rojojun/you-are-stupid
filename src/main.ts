import './styles.css'
import { invoke } from '@tauri-apps/api/core'
import { appDataDir } from '@tauri-apps/api/path'
import { Stronghold, type Store } from '@tauri-apps/plugin-stronghold'
import { redactText } from './redaction'
import { classifyCandidates } from './candidate-classifier'
import type { CandidateClassification, ConversationEvent } from './domain'
import { parseImport } from './importer'

const query = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing ${selector}`)
  return element
}

const input = query<HTMLInputElement>('#file-input')
const status = query<HTMLParagraphElement>('#import-status')
const eventCount = query<HTMLElement>('#event-count')
const candidateCount = query<HTMLElement>('#candidate-count')
const tokenTotal = query<HTMLElement>('#token-total')
const clarityScore = query<HTMLElement>('#clarity-score')
const frictionCount = query<HTMLElement>('#friction-count')
const emptyState = query<HTMLParagraphElement>('#empty-state')
const list = query<HTMLOListElement>('#classification-list')
const classificationKindFilter = query<HTMLSelectElement>('#classification-kind-filter')
const classificationFrictionFilter = query<HTMLSelectElement>('#classification-friction-filter')
const classificationPrev = query<HTMLButtonElement>('#classification-prev')
const classificationNext = query<HTMLButtonElement>('#classification-next')
const classificationPage = query<HTMLSpanElement>('#classification-page')
const sourceList = query<HTMLUListElement>('#source-list')
const dateSummary = query<HTMLUListElement>('#date-summary')
const timezone = query<HTMLSpanElement>('#timezone')
const detailDialog = query<HTMLDialogElement>('#conversation-detail')
const detailMeta = query<HTMLDListElement>('#detail-meta')
const detailQuestion = query<HTMLPreElement>('#detail-question')
const detailResponse = query<HTMLPreElement>('#detail-response')
const detailRedacted = query<HTMLPreElement>('#detail-redacted')
const detailReaction = query<HTMLParagraphElement>('#detail-reaction')
const detailInsights = query<HTMLDivElement>('#detail-insights')
const detailAnalysisEvidence = query<HTMLPreElement>('#detail-analysis-evidence')
const vaultStatus = query<HTMLParagraphElement>('#vault-status')
const syncStatus = query<HTMLSpanElement>('#sync-status')
const syncButton = query<HTMLButtonElement>('#sync-now')
const analysisPie = query<HTMLDivElement>('#analysis-pie')
const analysisLegend = query<HTMLUListElement>('#analysis-legend')
const analysisNote = query<HTMLParagraphElement>('#analysis-note')
const baselineComparison = query<HTMLUListElement>('#baseline-comparison')
const sourceComparison = query<HTMLUListElement>('#source-comparison')
const tokenBreakdown = query<HTMLUListElement>('#token-breakdown')
const trendNote = query<HTMLParagraphElement>('#trend-note')
const clarityTrend = query<HTMLUListElement>('#clarity-trend')
const dailyInsightNote = query<HTMLParagraphElement>('#daily-insight-note')
const dailyInsights = query<HTMLUListElement>('#daily-insights')
const periodNote = query<HTMLParagraphElement>('#period-note')
const periodSummary = query<HTMLUListElement>('#period-summary')
const centralForm = query<HTMLFormElement>('#central-form')
const centralUrl = query<HTMLInputElement>('#central-url')
const centralToken = query<HTMLInputElement>('#central-token')
const centralConsent = query<HTMLInputElement>('#central-consent')
const centralStatus = query<HTMLParagraphElement>('#central-status')
const centralRetry = query<HTMLButtonElement>('#central-retry')
const centralCancel = query<HTMLButtonElement>('#central-cancel')
const centralFullReanalyze = query<HTMLButtonElement>('#central-full-reanalyze')
const centralProgressWrap = query<HTMLDivElement>('#central-progress-wrap')
const centralProgress = query<HTMLProgressElement>('#central-progress')
const centralProgressLabel = query<HTMLSpanElement>('#central-progress-label')
const centralProgressPercent = query<HTMLElement>('#central-progress-percent')
const feedbackForm = query<HTMLFormElement>('#feedback-form')
const feedbackKind = query<HTMLSelectElement>('#feedback-kind')
const feedbackNote = query<HTMLInputElement>('#feedback-note')
const feedbackStatus = query<HTMLParagraphElement>('#feedback-status')
const dataStatus = query<HTMLParagraphElement>('#data-status')
const exportStatus = query<HTMLParagraphElement>('#export-status')
const settingsOpen = query<HTMLButtonElement>('#settings-open')
const settingsDialog = query<HTMLDialogElement>('#settings-dialog')
const settingsForm = query<HTMLFormElement>('#settings-form')
const settingsClose = query<HTMLButtonElement>('#settings-close')
const settingsCancel = query<HTMLButtonElement>('#settings-cancel')
const scheduleDays = query<HTMLInputElement>('#schedule-days')
const scheduleHour = query<HTMLInputElement>('#schedule-hour')
const scheduleEnabled = query<HTMLInputElement>('#schedule-enabled')
const settingsStatus = query<HTMLParagraphElement>('#settings-status')
const themeToggle = query<HTMLButtonElement>('#theme-toggle')
const quickMenuLeft = query<HTMLButtonElement>('#quick-menu-left')
const quickMenuRight = query<HTMLButtonElement>('#quick-menu-right')
const quickMenuPanel = query<HTMLDivElement>('#quick-menu-panel')
const appearanceMenuPanel = query<HTMLDivElement>('#appearance-menu-panel')
const quickMenuToday = query<HTMLButtonElement>('#quick-menu-today')
const quickMenuAll = query<HTMLButtonElement>('#quick-menu-all')
const quickMenuSync = query<HTMLButtonElement>('#quick-menu-sync')
const appLoading = query<HTMLDivElement>('#app-loading')
const appLoadingLabel = query<HTMLElement>('#app-loading-label')
const dateSection = query<HTMLElement>('#date-section')

type SourceDiscovery = Readonly<{
  source: 'codex' | 'claude_code' | 'antigravity'
  state: 'ready' | 'metadata_ready' | 'not_found' | 'unavailable'
  sessionCount: number
  detail: string
}>

type SourceImportResult = Readonly<{
  sessionCount: number
  eventCount: number
  skippedLineCount: number
  events: readonly ConversationEvent[]
}>

type DateSummary = Readonly<{
  key: string
  eventCount: number
  userCount: number
  assistantCount: number
  sourceCounts: Readonly<Record<ConversationEvent['source'], number>>
}>

type CentralOutbox = Readonly<{
  batchId: string
  workspaceId: string
  events: readonly CentralEvent[]
  attempts: number
  createdAt: string
}>

type CentralEvent = Omit<ConversationEvent, 'text'> & Readonly<{ redactedText: string }>

type CentralAnalysisSnapshot = Readonly<{
  engine: string
  analyzedAt: string
  classifications: readonly CentralClassification[]
  analyzedEventIds?: readonly string[]
}>

type ClassificationFeedback = Readonly<{ eventId: string; kind: CandidateClassification['kind']; note: string; createdAt: string }>

let activeDateFilter: 'all' | 'today' | string = 'all'
let activeSourceFilter: 'all' | ConversationEvent['source'] = 'all'
let classificationPageIndex = 0
let currentEvents: readonly ConversationEvent[] = []
let centralCandidates = new Map<string, CandidateClassification>()
let centralOutbox: CentralOutbox | undefined
let centralAnalysisSnapshot: CentralAnalysisSnapshot | undefined
let centralLastError: string | undefined
let centralRunController: AbortController | undefined
let centralForceReanalysis = false
const centralAnalyzedEventIds = new Set<string>()
const classificationFeedback = new Map<string, ClassificationFeedback>()
let detailEventId: string | undefined
const importedBySource = new Map<ConversationEvent['source'], readonly ConversationEvent[]>()
let vaultSession: Readonly<{ stronghold: Stronghold; store: Store }> | undefined
let scheduleTimer: number | undefined
const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const currentDeterministicEngine = 'deterministic-v7'
centralForm.noValidate = true

type ScheduleSettings = Readonly<{ enabled: boolean; everyDays: number; hour: number; lastRunDate?: string }>
const scheduleStorageKey = 'ai-usage-insights.schedule-v1'
const defaultSchedule: ScheduleSettings = { enabled: false, everyDays: 1, hour: 9 }
const readSchedule = (): ScheduleSettings => {
  try {
    const parsed = JSON.parse(localStorage.getItem(scheduleStorageKey) ?? 'null') as Partial<ScheduleSettings> | null
    return {
      enabled: parsed?.enabled === true,
      everyDays: Math.min(7, Math.max(1, Number(parsed?.everyDays ?? defaultSchedule.everyDays))),
      hour: Math.min(23, Math.max(0, Number(parsed?.hour ?? defaultSchedule.hour))),
      lastRunDate: typeof parsed?.lastRunDate === 'string' ? parsed.lastRunDate : undefined,
    }
  } catch { return defaultSchedule }
}
const writeSchedule = (settings: ScheduleSettings): void => localStorage.setItem(scheduleStorageKey, JSON.stringify(settings))
const scheduleLabel = (settings: ScheduleSettings): string => settings.enabled ? `${settings.everyDays}일마다 ${settings.hour}시 자동 동기화` : '자동 동기화 꺼짐'
const applyTheme = (theme: 'light' | 'dark'): void => {
  document.documentElement.dataset.theme = theme
  const themeIcon = themeToggle.querySelector('span')
  if (themeIcon) themeIcon.textContent = theme === 'dark' ? '☀' : '◐'
  themeToggle.title = theme === 'dark' ? '라이트모드 전환' : '다크모드 전환'
  themeToggle.setAttribute('aria-label', themeToggle.title)
  localStorage.setItem('ai-usage-insights.theme', theme)
}
applyTheme(localStorage.getItem('ai-usage-insights.theme') === 'dark' ? 'dark' : 'light')
themeToggle.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'))
const toggleFloatingPanel = (panel: HTMLDivElement, trigger: HTMLButtonElement): void => {
  const open = panel.hidden
  quickMenuPanel.hidden = true
  appearanceMenuPanel.hidden = true
  quickMenuLeft.setAttribute('aria-expanded', 'false')
  quickMenuRight.setAttribute('aria-expanded', 'false')
  panel.hidden = !open
  trigger.setAttribute('aria-expanded', String(open))
}
quickMenuLeft.addEventListener('click', () => toggleFloatingPanel(quickMenuPanel, quickMenuLeft))
quickMenuRight.addEventListener('click', () => toggleFloatingPanel(appearanceMenuPanel, quickMenuRight))
quickMenuToday.addEventListener('click', () => { activeDateFilter = 'today'; render(currentEvents, true); dateSection.scrollIntoView({ behavior: 'smooth', block: 'start' }); quickMenuPanel.hidden = true })
quickMenuAll.addEventListener('click', () => { activeDateFilter = 'all'; render(currentEvents, true); dateSection.scrollIntoView({ behavior: 'smooth', block: 'start' }); quickMenuPanel.hidden = true })
quickMenuSync.addEventListener('click', () => { query<HTMLButtonElement>('#import-all').click(); quickMenuPanel.hidden = true })

const localDateKey = (occurredAt: string): string | undefined => {
  const date = new Date(occurredAt)
  if (Number.isNaN(date.getTime())) return undefined
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: localTimeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

const todayKey = (): string => localDateKey(new Date().toISOString()) ?? ''

const summariesByDate = (events: readonly ConversationEvent[]): readonly DateSummary[] => {
  const summaries = new Map<string, {
    eventCount: number
    userCount: number
    assistantCount: number
    sourceCounts: Record<ConversationEvent['source'], number>
  }>()
  for (const event of events) {
    const key = localDateKey(event.occurredAt)
    if (!key) continue
    const summary = summaries.get(key) ?? {
      eventCount: 0,
      userCount: 0,
      assistantCount: 0,
      sourceCounts: { codex: 0, claude_code: 0, antigravity: 0 },
    }
    summary.eventCount += 1
    summary.sourceCounts[event.source] += 1
    if (event.role === 'user') summary.userCount += 1
    if (event.role === 'assistant') summary.assistantCount += 1
    summaries.set(key, summary)
  }
  return [...summaries.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) => right.key.localeCompare(left.key))
}

const koreanDate = (key: string): string => new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
}).format(new Date(`${key}T00:00:00`))

const filteredEvents = (): readonly ConversationEvent[] => {
  const sourceEvents = activeSourceFilter === 'all'
    ? currentEvents
    : currentEvents.filter((event) => event.source === activeSourceFilter)
  if (activeDateFilter === 'all') return sourceEvents
  const target = activeDateFilter === 'today' ? todayKey() : activeDateFilter
  return sourceEvents.filter((event) => localDateKey(event.occurredAt) === target)
}

const labels: Readonly<Record<CandidateClassification['kind'], string>> = {
  productive_work: '실제 작업', agent_correction: '에이전트 교정', progress_check: '진행 확인',
  cross_agent_handoff: '대화 전달', resume_instruction: '재개 지시', simplify_explanation: '쉬운 설명 요청',
  rule_reminder: '규칙 재고지', other: '기타',
}

const analysisColors: Readonly<Record<CandidateClassification['kind'], string>> = {
  productive_work: '#0d6c60', agent_correction: '#c75b39', progress_check: '#d59a24',
  cross_agent_handoff: '#6f64b5', resume_instruction: '#2e83a0', simplify_explanation: '#ae638d',
  rule_reminder: '#65737e', other: '#b5c2c0',
}

const baseline: Readonly<Record<CandidateClassification['kind'], number>> = {
  productive_work: 55, agent_correction: 13, progress_check: 9.5, cross_agent_handoff: 6,
  resume_instruction: 4, simplify_explanation: 4, rule_reminder: 3, other: 5,
}

const eventWeight = (event: ConversationEvent): number => event.tokenUsage.state === 'observed'
  ? Math.max(1, event.tokenUsage.total)
  : Math.max(0.25, Math.min(3, (event.redactedText ?? event.text).length / 80))

const renderAnalysis = (candidates: readonly CandidateClassification[], events: readonly ConversationEvent[]): void => {
  const eventById = new Map(events.map((event) => [event.eventId, event]))
  const weights = new Map<CandidateClassification['kind'], number>()
  const counts = new Map<CandidateClassification['kind'], number>()
  for (const candidate of candidates) {
    counts.set(candidate.kind, (counts.get(candidate.kind) ?? 0) + 1)
    const event = eventById.get(candidate.eventId)
    if (event) weights.set(candidate.kind, (weights.get(candidate.kind) ?? 0) + eventWeight(event))
  }
  const entries = [...weights.entries()].sort((left, right) => right[1] - left[1])
  const total = [...weights.values()].reduce((sum, value) => sum + value, 0)
  if (total === 0) {
    analysisPie.style.background = '#e8efee'
    analysisPie.setAttribute('aria-label', '분석할 사용자 발화가 없습니다')
    analysisLegend.innerHTML = '<li class="analysis-empty">분석할 사용자 발화가 없습니다.</li>'
    baselineComparison.innerHTML = '<li class="analysis-empty">비교할 사용자 발화가 없습니다.</li>'
    analysisNote.textContent = '대화를 가져오면 사용자 발화의 분류 비율이 표시됩니다.'
    return
  }
  let cursor = 0
  const segments = entries.map(([kind, weight]) => {
    const start = cursor
    cursor += (weight / total) * 360
    return `${analysisColors[kind]} ${start}deg ${cursor}deg`
  })
  analysisPie.style.background = `conic-gradient(${segments.join(', ')})`
  analysisPie.setAttribute('aria-label', `사용 방식 분포: ${entries.map(([kind, weight]) => `${labels[kind]} ${Math.round(weight / total * 100)}%`).join(', ')}`)
  analysisLegend.replaceChildren(...entries.map(([kind, weight]) => {
    const item = document.createElement('li')
    const percentage = Math.round(weight / total * 100)
    item.innerHTML = `<span class="legend-label"><i style="background:${analysisColors[kind]}"></i>${labels[kind]}</span><strong>${percentage}% <small>${counts.get(kind) ?? 0}개</small></strong>`
    return item
  }))
  analysisNote.textContent = `${candidates.length}개 사용자 발화를 토큰 사용량 또는 가림본 길이로 가중한 활동 비율입니다. 괄호 안 숫자는 메시지 수입니다.`
  baselineComparison.replaceChildren(...entries.map(([kind, weight]) => {
    const item = document.createElement('li')
    const actual = weight / total * 100
    const delta = actual - baseline[kind]
    item.innerHTML = `<span><i style="background:${analysisColors[kind]}"></i>${labels[kind]}</span><strong>${actual.toFixed(1)}%</strong><small>기준 ${baseline[kind]}% · ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%p</small>`
    return item
  }))
}

const renderClarityTrend = (events: readonly ConversationEvent[]): void => {
  const groups = new Map<string, number[]>()
  for (const event of events) {
    if (event.role !== 'user') continue
    const candidate = centralCandidates.get(event.eventId) ?? classifyCandidates([event])[0]
    const key = localDateKey(event.occurredAt)
    if (!key || candidate?.clarityScore === undefined) continue
    const values = groups.get(key) ?? []
    values.push(candidate.clarityScore)
    groups.set(key, values)
  }
  const rows = [...groups.entries()].sort((left, right) => right[0].localeCompare(left[0])).slice(0, 14)
  if (rows.length === 0) {
    clarityTrend.innerHTML = '<li class="trend-empty">중앙 분석 결과가 쌓이면 날짜별 추이가 표시됩니다.</li>'
    trendNote.textContent = '현재 선택된 기간·도구에는 중앙 명확도 점수가 없습니다.'
    return
  }
  clarityTrend.replaceChildren(...rows.map(([date, scores]) => {
    const score = Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
    const item = document.createElement('li')
    item.innerHTML = `<span class="trend-date">${koreanDate(date)}<small>${scores.length}개 질문</small></span><span class="trend-track"><i style="width:${score}%"></i></span><strong>${score}점</strong>`
    return item
  }))
  trendNote.textContent = `최근 ${rows.length}일의 질문 명확도 평균입니다. 중앙 분석 전에는 로컬 기준선이 표시됩니다.`
}

const renderDailyInsights = (events: readonly ConversationEvent[]): void => {
  type DailyGroup = { scores: number[]; reasons: Map<string, number>; friction: Map<string, number>; lowest?: { score: number; text: string } }
  const groups = new Map<string, DailyGroup>()
  for (const event of events) {
    if (event.role !== 'user') continue
    const candidate = centralCandidates.get(event.eventId) ?? classifyCandidates([event])[0]
    const date = localDateKey(event.occurredAt)
    if (!candidate || candidate.clarityScore === undefined || !date) continue
    const group: DailyGroup = groups.get(date) ?? { scores: [], reasons: new Map<string, number>(), friction: new Map<string, number>() }
    group.scores.push(candidate.clarityScore)
    for (const reason of candidate.clarityReasons ?? []) group.reasons.set(reason, (group.reasons.get(reason) ?? 0) + 1)
    const frictionType = candidate.frictionType && candidate.frictionType !== 'none' ? frictionTypeLabel(candidate.frictionType) : ''
    if (frictionType) group.friction.set(frictionType, (group.friction.get(frictionType) ?? 0) + 1)
    if (!group.lowest || candidate.clarityScore < group.lowest.score) group.lowest = { score: candidate.clarityScore, text: event.text }
    groups.set(date, group)
  }
  const rows = [...groups.entries()].sort((left, right) => right[0].localeCompare(left[0])).slice(0, 7)
  if (rows.length === 0) {
    dailyInsights.innerHTML = '<li class="trend-empty">중앙 분석 결과가 쌓이면 날짜별 품질 요약이 표시됩니다.</li>'
    dailyInsightNote.textContent = '현재 선택된 기록에는 중앙 명확도 점수가 없습니다.'
    return
  }
  dailyInsights.replaceChildren(...rows.map(([date, group]) => {
    const row = document.createElement('li')
    row.className = 'daily-insight-row'
    const score = Math.round(group.scores.reduce((sum, value) => sum + value, 0) / group.scores.length)
    const reason = [...group.reasons.entries()].sort((left, right) => right[1] - left[1])[0]
    const friction = [...group.friction.entries()].sort((left, right) => right[1] - left[1])[0]
    const heading = document.createElement('strong')
    heading.textContent = koreanDate(date)
    const scoreLabel = document.createElement('b')
    scoreLabel.textContent = `${score}점`
    const questionCount = document.createElement('span')
    questionCount.textContent = `질문 ${group.scores.length}개`
    const summary = document.createElement('em')
    summary.textContent = `주요 이유: ${reason?.[0] ?? '뚜렷한 낮은 점수 이유 없음'}${reason ? ` (${reason[1]}회)` : ''} · 마찰: ${friction?.[0] ?? '없음'}${friction ? ` (${friction[1]}회)` : ''}`
    row.append(heading, scoreLabel, questionCount, summary)
    if (group.lowest) {
      const lowest = document.createElement('small')
      lowest.textContent = `가장 낮은 질문 ${group.lowest.score}점 · ${group.lowest.text.slice(0, 100)}${group.lowest.text.length > 100 ? '…' : ''}`
      row.append(lowest)
    }
    return row
  }))
  dailyInsightNote.textContent = `현재 필터 기준 최근 ${rows.length}일의 평균점수와 주요 신호입니다. 낮은 점수의 이유는 Jev가 반환한 설명을 그대로 집계합니다.`
}

const renderSourceComparison = (events: readonly ConversationEvent[]): void => {
  const sourceNames: Readonly<Record<ConversationEvent['source'], string>> = { codex: 'Codex', claude_code: 'Claude Code', antigravity: 'Antigravity' }
  const groups = new Map<ConversationEvent['source'], { scores: number[]; weight: number; friction: number; questions: number }>()
  for (const event of events) {
    if (event.role !== 'user') continue
    const candidate = centralCandidates.get(event.eventId) ?? classifyCandidates([event])[0]
    if (!candidate) continue
    const group = groups.get(event.source) ?? { scores: [], weight: 0, friction: 0, questions: 0 }
    group.questions += 1
    group.weight += eventWeight(event)
    if (candidate.clarityScore !== undefined) group.scores.push(candidate.clarityScore)
    if (candidate.friction !== undefined && candidate.friction !== 'low') group.friction += 1
    groups.set(event.source, group)
  }
  if (groups.size === 0) {
    sourceComparison.innerHTML = '<li class="trend-empty">비교할 사용자 질문이 없습니다.</li>'
    return
  }
  sourceComparison.replaceChildren(...[...groups.entries()].map(([source, group]) => {
    const item = document.createElement('li')
    const score = group.scores.length > 0 ? `${Math.round(group.scores.reduce((sum, value) => sum + value, 0) / group.scores.length)}점` : '—'
    item.innerHTML = `<strong>${sourceNames[source]}</strong><span>질문 ${group.questions}개</span><b>명확도 ${score}</b><em>가중 활동 ${group.weight.toFixed(1)} · 마찰 ${group.friction}</em>`
    return item
  }))
}

const renderTokenBreakdown = (events: readonly ConversationEvent[]): void => {
  const names: Readonly<Record<ConversationEvent['source'], string>> = { codex: 'Codex', claude_code: 'Claude Code', antigravity: 'Antigravity' }
  const groups = new Map<ConversationEvent['source'], { input: number; output: number; total: number; observed: number; unavailable: number }>()
  for (const event of events) {
    const group = groups.get(event.source) ?? { input: 0, output: 0, total: 0, observed: 0, unavailable: 0 }
    if (event.tokenUsage.state === 'observed') {
      group.input += event.tokenUsage.input
      group.output += event.tokenUsage.output
      group.total += event.tokenUsage.total
      group.observed += 1
    } else group.unavailable += 1
    groups.set(event.source, group)
  }
  if (groups.size === 0) {
    tokenBreakdown.innerHTML = '<li class="trend-empty">토큰을 표시할 이벤트가 없습니다.</li>'
    return
  }
  tokenBreakdown.replaceChildren(...[...groups.entries()].map(([source, group]) => {
    const item = document.createElement('li')
    item.innerHTML = `<strong>${names[source]}</strong><span>입력 ${group.input.toLocaleString('ko-KR')} · 출력 ${group.output.toLocaleString('ko-KR')}</span><b>전체 ${group.total.toLocaleString('ko-KR')}</b><small>관측 ${group.observed}개 · 불가 ${group.unavailable}개</small>`
    return item
  }))
}

const periodKey = (date: string, period: 'week' | 'month'): string => {
  if (period === 'month') return date.slice(0, 7)
  const value = new Date(`${date}T00:00:00`)
  const day = value.getDay() || 7
  value.setDate(value.getDate() - day + 1)
  return localDateKey(value.toISOString()) ?? date
}

const renderPeriodSummary = (events: readonly ConversationEvent[]): void => {
  const renderPeriod = (period: 'week' | 'month', label: string): readonly { key: string; label: string; scores: number[]; friction: number; corrections: number; reasons: Map<string, number>; frictionTypes: Map<string, number>; responsibilities: Map<string, number>; lowest?: { score: number; text: string } }[] => {
    const groups = new Map<string, { scores: number[]; friction: number; corrections: number; reasons: Map<string, number>; frictionTypes: Map<string, number>; responsibilities: Map<string, number>; lowest?: { score: number; text: string } }>()
    for (const event of events) {
      if (event.role !== 'user') continue
      const candidate = centralCandidates.get(event.eventId) ?? classifyCandidates([event])[0]
      const date = localDateKey(event.occurredAt)
      if (candidate?.clarityScore === undefined || !date) continue
      const key = periodKey(date, period)
      const group = groups.get(key) ?? { scores: [], friction: 0, corrections: 0, reasons: new Map<string, number>(), frictionTypes: new Map<string, number>(), responsibilities: new Map<string, number>() }
      group.scores.push(candidate.clarityScore)
      if (candidate.friction !== undefined && candidate.friction !== 'low') group.friction += 1
      if (candidate.kind === 'agent_correction') group.corrections += 1
      for (const reason of candidate.clarityReasons ?? []) group.reasons.set(reason, (group.reasons.get(reason) ?? 0) + 1)
      if (candidate.frictionType && candidate.frictionType !== 'none') group.frictionTypes.set(frictionTypeLabel(candidate.frictionType), (group.frictionTypes.get(frictionTypeLabel(candidate.frictionType)) ?? 0) + 1)
      if (candidate.frictionResponsibility && candidate.frictionResponsibility !== 'unclear') group.responsibilities.set(responsibilityLabel(candidate.frictionResponsibility), (group.responsibilities.get(responsibilityLabel(candidate.frictionResponsibility)) ?? 0) + 1)
      if (!group.lowest || candidate.clarityScore < group.lowest.score) group.lowest = { score: candidate.clarityScore, text: event.text }
      groups.set(key, group)
    }
    return [...groups.entries()].sort((left, right) => right[0].localeCompare(left[0])).slice(0, 4).map(([key, value]) => ({ key, label, ...value }))
  }
  const weeks = renderPeriod('week', '주간')
  const months = renderPeriod('month', '월간')
  const rows = [...weeks.map((item) => ({ ...item, period: '주간' })), ...months.map((item) => ({ ...item, period: '월간' }))]
  if (rows.length === 0) {
    periodSummary.innerHTML = '<li class="trend-empty">중앙 분석 결과가 쌓이면 주간·월간 요약이 표시됩니다.</li>'
    periodNote.textContent = '현재 선택된 기록에 집계할 중앙 명확도 점수가 없습니다.'
    return
  }
  periodSummary.replaceChildren(...rows.map((item) => {
    const score = Math.round(item.scores.reduce((sum, value) => sum + value, 0) / item.scores.length)
    const row = document.createElement('li')
    const reason = [...item.reasons.entries()].sort((left, right) => right[1] - left[1])[0]
    const friction = [...item.frictionTypes.entries()].sort((left, right) => right[1] - left[1])[0]
    const responsibility = [...item.responsibilities.entries()].sort((left, right) => right[1] - left[1])[0]
    row.innerHTML = `<span><strong>${item.label} · ${item.key}</strong><small>${item.scores.length}개 질문</small></span><b>${score}점</b><em>마찰 ${item.friction} · 교정 ${item.corrections} · 주요 이유 ${reason?.[0] ?? '없음'} · 유형 ${friction?.[0] ?? '없음'} · 책임 ${responsibility?.[0] ?? '판단 불가'}</em>${item.lowest ? `<small>최저 질문 ${item.lowest.score}점 · ${item.lowest.text.slice(0, 100)}${item.lowest.text.length > 100 ? '…' : ''}</small>` : ''}`
    return row
  }))
  periodNote.textContent = '같은 도구·날짜 필터 기준으로 최근 주간과 월간 집계를 표시합니다. 중앙 분석 전에는 로컬 기준선입니다.'
}

const renderDates = (): void => {
  const today = todayKey()
  const summaries = summariesByDate(activeSourceFilter === 'all'
    ? currentEvents
    : currentEvents.filter((event) => event.source === activeSourceFilter))
  timezone.textContent = `기준: ${localTimeZone}`
  query<HTMLButtonElement>('#date-all').classList.toggle('selected', activeDateFilter === 'all')
  query<HTMLButtonElement>('#date-today').classList.toggle('selected', activeDateFilter === 'today')
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-source-filter]')) {
    button.classList.toggle('selected', button.dataset.sourceFilter === activeSourceFilter)
  }
  dateSummary.replaceChildren(...summaries.map((summary) => {
    const item = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.date = summary.key
    button.className = activeDateFilter === summary.key ? 'date-row selected' : 'date-row'
    const sourcePreview = [
      summary.sourceCounts.codex > 0 ? `Codex ${summary.sourceCounts.codex}` : '',
      summary.sourceCounts.claude_code > 0 ? `Claude ${summary.sourceCounts.claude_code}` : '',
      summary.sourceCounts.antigravity > 0 ? `Anti ${summary.sourceCounts.antigravity}` : '',
    ].filter(Boolean).join(' · ')
    button.innerHTML = `<span><strong>${summary.key === today ? '오늘 · ' : ''}${koreanDate(summary.key)}</strong><small>사용자 ${summary.userCount} · AI ${summary.assistantCount}</small><small class="source-preview">${sourcePreview || '대화 없음'}</small></span><b>${summary.eventCount}개</b>`
    item.append(button)
    return item
  }))
  if (summaries.length === 0) dateSummary.innerHTML = '<li class="no-dates">가져온 대화의 날짜를 기다리고 있습니다.</li>'
}

const render = (events: readonly ConversationEvent[], imported: boolean): void => {
  currentEvents = events
  const selectedEvents = filteredEvents()
  const candidates = classifyCandidates(selectedEvents).map((candidate) => {
    const corrected = classificationFeedback.get(candidate.eventId)
    return corrected
      ? { ...candidate, kind: corrected.kind, rationale: `사용자 수정: ${corrected.note || '분류를 사용자가 직접 수정함'}`, confidence: 'low' as const }
      : centralCandidates.get(candidate.eventId) ?? candidate
  })
  const totalTokens = selectedEvents.reduce((sum, event) => sum + (event.tokenUsage.state === 'observed' ? event.tokenUsage.total : 0), 0)
  const observedTokens = selectedEvents.some((event) => event.tokenUsage.state === 'observed')
  const scoredCandidates = candidates.flatMap((candidate) => candidate.clarityScore === undefined ? [] : [candidate.clarityScore])
  const frictionCandidates = candidates.filter((candidate) => candidate.friction !== undefined && candidate.friction !== 'low')
  eventCount.textContent = String(selectedEvents.length)
  candidateCount.textContent = String(candidates.length)
  tokenTotal.textContent = observedTokens ? totalTokens.toLocaleString('ko-KR') : '—'
  clarityScore.textContent = scoredCandidates.length > 0
    ? `${Math.round(scoredCandidates.reduce((sum, score) => sum + score, 0) / scoredCandidates.length)}점`
    : '—'
  frictionCount.textContent = scoredCandidates.length > 0 ? `${frictionCandidates.length}회` : '—'
  renderAnalysis(candidates, selectedEvents)
  renderClarityTrend(selectedEvents)
  renderDailyInsights(selectedEvents)
  renderPeriodSummary(selectedEvents)
  renderSourceComparison(selectedEvents)
  renderTokenBreakdown(selectedEvents)
  const filteredCandidates = candidates.filter((candidate) => {
    const kindMatches = classificationKindFilter.value === 'all' || candidate.kind === classificationKindFilter.value
    const frictionMatches = classificationFrictionFilter.value === 'all'
      || candidate.friction === classificationFrictionFilter.value
      || (classificationFrictionFilter.value === 'profanity' && candidate.profanityDetected === true)
      || candidate.frictionType === classificationFrictionFilter.value
    return kindMatches && frictionMatches
  })
  const pageSize = 50
  const pageCount = Math.max(1, Math.ceil(filteredCandidates.length / pageSize))
  classificationPageIndex = Math.min(classificationPageIndex, pageCount - 1)
  const previewCandidates = filteredCandidates.slice(classificationPageIndex * pageSize, (classificationPageIndex + 1) * pageSize)
  classificationPage.textContent = `${filteredCandidates.length === 0 ? 0 : classificationPageIndex + 1} / ${pageCount}`
  classificationPrev.disabled = classificationPageIndex === 0
  classificationNext.disabled = classificationPageIndex >= pageCount - 1
  emptyState.hidden = filteredCandidates.length > 0
  list.replaceChildren(...previewCandidates.map((candidate) => {
    const item = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.eventId = candidate.eventId
    button.className = 'classification-row'
    const event = selectedEvents.find((item) => item.eventId === candidate.eventId)
    const sourceLabel = event?.source === 'claude_code' ? 'Claude Code' : event?.source === 'antigravity' ? 'Antigravity' : 'Codex'
    const scoreLabel = candidate.clarityScore === undefined ? '명확도 미분석' : `질문 명확도 ${candidate.clarityScore}점`
    const reasonLabel = candidate.clarityReasons?.[0] ? ` · 이유: ${candidate.clarityReasons[0]}` : ''
    const frictionLabel = candidate.frictionType && candidate.frictionType !== 'none'
      ? ` · 마찰: ${frictionTypeLabel(candidate.frictionType)} · 책임: ${responsibilityLabel(candidate.frictionResponsibility)}`
      : ''
    const centralLabel = candidate.jevConfidence !== undefined
      ? `Jev 분류 · confidence ${Math.round(candidate.jevConfidence * 100)}%${candidate.confidenceStatus === 'review' ? ' · 검토 필요' : ''}`
      : '로컬 기준선'
    button.innerHTML = `<strong>${labels[candidate.kind]}</strong><span>${candidate.rationale}</span><em>${sourceLabel} · ${centralLabel} · ${scoreLabel}${reasonLabel}${frictionLabel}</em>`
    item.append(button)
    return item
  }))
  status.textContent = imported
    ? `${selectedEvents.length}개 이벤트를 현재 선택된 기간에 표시합니다. 파일 내용은 서버로 전송되지 않았습니다.`
    : '예시 데이터를 현재 세션에 표시하고 있습니다.'
  renderDates()
}

const focusDateView = (events: readonly ConversationEvent[]): void => {
  const today = todayKey()
  const availableDates = summariesByDate(events).map((summary) => summary.key)
  activeDateFilter = availableDates.includes(today) ? 'today' : (availableDates[0] ?? 'all')
  render(events, true)
  if (availableDates.length > 0) dateSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const rerenderClassificationPage = (): void => {
  classificationPageIndex = 0
  render(currentEvents, true)
}
classificationKindFilter.addEventListener('change', rerenderClassificationPage)
classificationFrictionFilter.addEventListener('change', rerenderClassificationPage)
classificationPrev.addEventListener('click', () => { classificationPageIndex = Math.max(0, classificationPageIndex - 1); render(currentEvents, true) })
classificationNext.addEventListener('click', () => { classificationPageIndex += 1; render(currentEvents, true) })

type CentralClassification = Readonly<{
  eventId: string
  primaryKind: CandidateClassification['kind']
  confidence: CandidateClassification['confidence']
  rationale: string
  clarityScore: number
  clarityReasons: readonly string[]
  clarityDimensions?: Readonly<Record<string, number>>
  confidenceStatus?: 'accepted' | 'review'
  jevConfidence?: number
  jevAnswers?: Readonly<Record<string, unknown>>
  shadowComparison?: Readonly<{ engine: string; primaryKind: CandidateClassification['kind']; clarityScore: number; confidence: CandidateClassification['confidence'] }>
  reactionSignals: Readonly<{ profanityDetected: boolean; friction: 'low' | 'medium' | 'high'; frictionReason?: string; frictionType?: CandidateClassification['frictionType']; frictionResponsibility?: CandidateClassification['frictionResponsibility'] }>
  context?: Readonly<{ contextSignals: readonly string[]; windowSize: number }>
}>

const frictionReasonLabel = (value?: string): string => ({
  assistant_error: 'AI 오류 또는 허가되지 않은 변경', misunderstanding: 'AI가 요청을 잘못 이해함',
  repeated_failure: '같은 실패가 반복됨', blocked_progress: '작업 진행이 막힘',
  emotional_emphasis: '감정적 강조', none: '명확한 원인 없음',
}[value ?? ''] ?? '확인 필요')
const frictionTypeLabel = (value?: string): string => ({ profanity: '욕설', repeated_request: '반복 요구', disagreement: '의견 충돌', assistant_error: 'AI 오류', none: '해당 없음' }[value ?? ''] ?? '확인 필요')
const responsibilityLabel = (value?: string): string => ({ user: '사용자 쪽', assistant: 'AI 쪽', both: '양쪽 모두', unclear: '판단 불가' }[value ?? ''] ?? '판단 불가')

type CentralAnalysisResponse = Readonly<{
  engine: string
  classifications: readonly CentralClassification[]
  cache?: Readonly<{ cached: number; fresh: number }>
}>

const centralHeaders = (): HeadersInit => ({
  authorization: `Bearer ${centralToken.value.trim()}`,
  'content-type': 'application/json',
})

// Central analysis is incremental: once an event has a central classification,
// do not send it again on the next run. A failed run keeps its exact outbox for
// retry, while a successful run only adds the newly classified events.
const eventsNeedingCentralAnalysis = (events: readonly ConversationEvent[]): readonly ConversationEvent[] =>
  // The server is cache-aware. Send the complete event set so it can compare
  // event IDs against SQLite and Jev only the genuinely missing records.
  events

const updateOutboxStatus = (): void => {
  centralRetry.disabled = centralOutbox === undefined || centralRunController !== undefined
  if (centralOutbox) centralStatus.textContent = `전송 대기 큐 ${centralOutbox.events.length}개 · 시도 ${centralOutbox.attempts}회 · 재시도할 수 있습니다.${centralLastError ? ` 마지막 오류: ${centralLastError}` : ''}`
}

const postCentral = async (path: string, body: unknown): Promise<Response> => {
  const baseUrl = centralUrl.value.trim().replace(/\/$/, '')
  const controller = centralRunController ?? new AbortController()
  try {
    return await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: centralHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('중앙 분석을 사용자가 중단했습니다.')
    }
    throw error
  }
}

const centralFailure = async (response: Response, operation: string): Promise<Error> => {
  let detail = ''
  try { detail = ` · ${JSON.stringify(await response.clone().json())}` } catch { /* keep status-only error */ }
  return new Error(`${operation} (${response.status})${detail}`)
}

const splitIntoBatches = <T,>(items: readonly T[], size: number): readonly (readonly T[])[] => {
  const batches: (readonly T[])[] = []
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size))
  return batches
}

const updateCentralProgress = (completed: number, total: number, label: string): void => {
  const safeTotal = Math.max(1, total)
  const percent = Math.round((completed / safeTotal) * 100)
  centralProgress.max = safeTotal
  centralProgress.value = Math.min(completed, safeTotal)
  centralProgressLabel.textContent = label
  centralProgressPercent.textContent = `${percent}%`
}

centralForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const submittedByFullReanalyze = (event as SubmitEvent).submitter === centralFullReanalyze
  const forceReanalysis = centralForceReanalysis || submittedByFullReanalyze
  if (!centralConsent.checked) {
    centralStatus.textContent = '중앙 분석을 사용하려면 가림본 전송 동의가 필요합니다.'
    return
  }
  if (!centralToken.value.trim()) {
    centralStatus.textContent = '중앙 API 접속 토큰을 입력해 주세요.'
    return
  }
  const importedEvents = mergeImportedEvents()
  centralStatus.textContent = forceReanalysis ? 'Jev 전체 분석·저장을 준비하고 있습니다…' : '신규 발화를 중앙에서 분석하고 있습니다…'
  const events = (forceReanalysis
    ? importedEvents
    : eventsNeedingCentralAnalysis(importedEvents)).map(toCentralEvent)
  if (events.length === 0) {
    centralForceReanalysis = false
    centralStatus.textContent = importedEvents.length === 0
      ? '먼저 대화를 가져와 주세요.'
      : '새로 분석할 사용자 발화가 없습니다. 중앙 분석은 신규 이벤트만 전송합니다.'
    return
  }
  const button = query<HTMLButtonElement>('#central-analyze')
  button.disabled = true
  centralFullReanalyze.disabled = true
  centralCancel.disabled = false
  centralRunController = new AbortController()
  updateOutboxStatus()
  centralStatus.textContent = '가림본을 중앙 서버에 업로드하고 분석 중입니다…'
  centralOutbox = { batchId: `ui-${Date.now()}`, workspaceId: events[0].workspaceId, events, attempts: 0, createdAt: new Date().toISOString() }
  const pendingBatch = centralOutbox
  await persistVault()
  try {
    const batches = splitIntoBatches(pendingBatch.events, 500)
    const classifications: CentralClassification[] = []
    let engine = 'unknown'
    let freshClassificationCount = 0
    centralProgressWrap.hidden = false
    updateCentralProgress(0, batches.length, `분석 준비 중 · ${batches.length}개 배치`)
    for (const [index, batch] of batches.entries()) {
      updateCentralProgress(index, batches.length, `중앙 분석 중… ${index + 1}/${batches.length} 배치`)
      centralStatus.textContent = `중앙 분석 중… ${index + 1}/${batches.length} 배치`
      const upload = await postCentral('/v1/ingestions/batches', { workspaceId: pendingBatch.workspaceId, clientBatchId: `${pendingBatch.batchId}-${index}`, events: batch })
      if (!upload.ok) throw await centralFailure(upload, '업로드 실패')
      const analysis = await postCentral('/v1/analysis/classifications', { workspaceId: pendingBatch.workspaceId, eventIds: batch.map((item) => item.eventId), refresh: forceReanalysis })
      if (!analysis.ok) throw await centralFailure(analysis, '분석 실패')
      const result = await analysis.json() as CentralAnalysisResponse
      engine = result.engine
      classifications.push(...result.classifications)
      freshClassificationCount += result.cache?.fresh ?? result.classifications.length
      // Persist each completed batch immediately. If the next request hangs or
      // the app is closed, already accepted Jev results remain available.
      const persistedClassifications = [...(centralAnalysisSnapshot?.classifications ?? []), ...result.classifications]
        .filter((item, itemIndex, all) => all.findIndex((candidate) => candidate.eventId === item.eventId) === itemIndex)
      for (const item of batch) centralAnalyzedEventIds.add(item.eventId)
      centralAnalysisSnapshot = { engine, analyzedAt: new Date().toISOString(), classifications: persistedClassifications, analyzedEventIds: [...centralAnalyzedEventIds] }
      centralCandidates = new Map(persistedClassifications.map((item) => [item.eventId, {
        eventId: item.eventId, kind: item.primaryKind, confidence: item.confidence, rationale: item.rationale,
        clarityScore: item.clarityScore, clarityReasons: item.clarityReasons, clarityDimensions: item.clarityDimensions,
        confidenceStatus: item.confidenceStatus, jevConfidence: item.jevConfidence, shadowComparison: item.shadowComparison,
        friction: item.reactionSignals.friction, profanityDetected: item.reactionSignals.profanityDetected, frictionReason: item.reactionSignals.frictionReason, frictionType: item.reactionSignals.frictionType, frictionResponsibility: item.reactionSignals.frictionResponsibility,
        contextSignals: item.context?.contextSignals, windowSize: item.context?.windowSize,
      }]))
      centralOutbox = { ...pendingBatch, events: pendingBatch.events.slice((index + 1) * 500) }
      await persistVault()
      updateCentralProgress(index + 1, batches.length, `중앙 분석 중… ${index + 1}/${batches.length} 배치 완료`)
    }
    const mergedClassifications = [...(centralAnalysisSnapshot?.classifications ?? []), ...classifications]
      .filter((item, index, all) => all.findIndex((candidate) => candidate.eventId === item.eventId) === index)
    centralAnalysisSnapshot = { engine, analyzedAt: new Date().toISOString(), classifications: mergedClassifications, analyzedEventIds: [...centralAnalyzedEventIds] }
    centralCandidates = new Map(mergedClassifications.map((item) => [item.eventId, {
      eventId: item.eventId, kind: item.primaryKind, confidence: item.confidence, rationale: item.rationale,
      clarityScore: item.clarityScore, clarityReasons: item.clarityReasons, clarityDimensions: item.clarityDimensions,
      confidenceStatus: item.confidenceStatus, jevConfidence: item.jevConfidence, shadowComparison: item.shadowComparison,
      friction: item.reactionSignals.friction, profanityDetected: item.reactionSignals.profanityDetected, frictionReason: item.reactionSignals.frictionReason, frictionType: item.reactionSignals.frictionType, frictionResponsibility: item.reactionSignals.frictionResponsibility,
      contextSignals: item.context?.contextSignals, windowSize: item.context?.windowSize,
    }]))
    render(currentEvents, true)
    centralOutbox = undefined
    centralLastError = undefined
    await persistVault()
    centralStatus.textContent = `증분 분석 완료: 새로 Jev 판단 ${freshClassificationCount}개 · 기존 SQLite 결과 재사용 ${Math.max(0, classifications.length - freshClassificationCount)}개`
  } catch (error) {
    const remaining = centralOutbox ?? pendingBatch
    centralOutbox = { ...remaining, attempts: remaining.attempts + 1 }
    centralLastError = error instanceof Error ? error.message : '네트워크 오류'
    await persistVault()
  } finally {
    centralRunController = undefined
    centralForceReanalysis = false
    centralCancel.disabled = true
    centralFullReanalyze.disabled = false
    updateOutboxStatus()
    button.disabled = false
  }
})

centralRetry.addEventListener('click', () => centralForm.requestSubmit())
centralFullReanalyze.addEventListener('click', () => { centralForceReanalysis = true })
centralCancel.addEventListener('click', () => {
  if (!centralRunController) return
  centralStatus.textContent = '현재 배치를 중단하고 대기 큐를 보존하는 중입니다…'
  centralRunController.abort()
})

const mergeImportedEvents = (): readonly ConversationEvent[] => {
  const deduplicated = new Map<string, ConversationEvent>()
  for (const events of importedBySource.values()) {
    for (const event of events) deduplicated.set(event.eventId, event)
  }
  return [...deduplicated.values()].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
}

const withRedaction = (event: ConversationEvent): ConversationEvent => ({
  ...event,
  redactedText: event.redactedText ?? redactText(event.text).text,
})

const toCentralEvent = (event: ConversationEvent | CentralEvent): CentralEvent => {
  const redactedText = event.redactedText ?? ('text' in event ? redactText(event.text).text : '')
  const { text: _rawText, ...safeEvent } = event as ConversationEvent
  return { ...safeEvent, redactedText }
}

const classificationFor = (event: ConversationEvent): CandidateClassification => {
  const corrected = classificationFeedback.get(event.eventId)
  if (corrected) return { eventId: event.eventId, kind: corrected.kind, confidence: 'low', rationale: `사용자 수정: ${corrected.note || '분류를 사용자가 직접 수정함'}` }
  return centralCandidates.get(event.eventId) ?? classifyCandidates([event])[0] ?? { eventId: event.eventId, kind: 'other', confidence: 'low', rationale: '분류 결과 없음' }
}

const download = (filename: string, content: string, type: string): void => {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const csvCell = (value: unknown): string => `"${String(value ?? '').replaceAll('"', '""')}"`

const exportData = (format: 'json' | 'csv', redacted: boolean): void => {
  const events = filteredEvents()
  if (events.length === 0) {
    exportStatus.textContent = '내보낼 기록이 없습니다.'
    return
  }
  const rows = events.map((event) => {
    const classification = classificationFor(event)
    return {
      eventId: event.eventId, occurredAt: event.occurredAt, source: event.source, role: event.role,
      conversationId: event.conversationId, text: redacted ? withRedaction(event).redactedText : event.text,
      kind: classification.kind, rationale: classification.rationale, clarityScore: classification.clarityScore ?? '',
      feedback: classificationFeedback.get(event.eventId)?.note ?? '',
    }
  })
  const stamp = new Date().toISOString().slice(0, 10)
  if (format === 'json') download(`yas-${redacted ? 'redacted' : 'raw'}-${stamp}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), redacted, events: rows }, null, 2), 'application/json')
  else {
    const headers = Object.keys(rows[0])
    const csv = [headers, ...rows.map((row) => headers.map((header) => row[header as keyof typeof row]))].map((row) => row.map(csvCell).join(',')).join('\n')
    download(`yas-redacted-${stamp}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8')
  }
  exportStatus.textContent = `${events.length}개 이벤트를 ${redacted ? '가림본' : '원문'} ${format.toUpperCase()}로 내보냈습니다.`
}

const persistAndRender = async (message: string): Promise<void> => {
  await persistVault()
  focusDateView(mergeImportedEvents())
  dataStatus.textContent = message
}

query<HTMLButtonElement>('#delete-filtered').addEventListener('click', async () => {
  const targets = new Set(filteredEvents().map((event) => event.eventId))
  if (targets.size === 0) { dataStatus.textContent = '현재 필터에 삭제할 이벤트가 없습니다.'; return }
  if (!window.confirm(`현재 필터의 ${targets.size}개 이벤트와 관련 분석을 삭제할까요?`)) return
  for (const source of ['codex', 'claude_code', 'antigravity'] as const) importedBySource.set(source, (importedBySource.get(source) ?? []).filter((event) => !targets.has(event.eventId)))
  currentEvents = currentEvents.filter((event) => !targets.has(event.eventId))
  for (const eventId of targets) { centralCandidates.delete(eventId); centralAnalyzedEventIds.delete(eventId); classificationFeedback.delete(eventId) }
  await persistAndRender(`${targets.size}개 이벤트와 관련 분석·피드백을 삭제했습니다.`)
})

query<HTMLButtonElement>('#clear-analysis').addEventListener('click', async () => {
  if (!window.confirm('저장된 중앙 분석 결과를 모두 삭제할까요? 원문 이벤트는 유지됩니다.')) return
  centralCandidates.clear()
  centralAnalysisSnapshot = undefined
  centralAnalyzedEventIds.clear()
  await persistAndRender('중앙 분석 결과를 삭제했습니다. 원문 이벤트는 유지됩니다.')
})

query<HTMLButtonElement>('#clear-feedback').addEventListener('click', async () => {
  if (!window.confirm('사용자 수정 피드백을 모두 삭제할까요?')) return
  classificationFeedback.clear()
  await persistAndRender('사용자 수정 피드백을 삭제했습니다.')
})

query<HTMLButtonElement>('#clear-vault').addEventListener('click', async () => {
  if (!window.confirm('원문 이벤트·분석·피드백·대기 큐를 모두 삭제할까요? 이 작업은 복구할 수 없습니다.')) return
  importedBySource.clear()
  for (const source of ['codex', 'claude_code', 'antigravity'] as const) importedBySource.set(source, [])
  currentEvents = []
  centralCandidates.clear()
  centralAnalysisSnapshot = undefined
  centralOutbox = undefined
  centralAnalyzedEventIds.clear()
  classificationFeedback.clear()
  await persistAndRender('vault의 이벤트·분석·피드백·대기 큐를 모두 초기화했습니다.')
})

query<HTMLButtonElement>('#export-redacted-json').addEventListener('click', () => exportData('json', true))
query<HTMLButtonElement>('#export-redacted-csv').addEventListener('click', () => exportData('csv', true))
query<HTMLButtonElement>('#export-feedback-json').addEventListener('click', () => {
  const feedbackRows = [...classificationFeedback.values()].flatMap((feedback) => {
    const event = currentEvents.find((candidate) => candidate.eventId === feedback.eventId)
    if (!event) return []
    const predicted = centralCandidates.get(event.eventId) ?? classifyCandidates([event])[0]
    return [{
      schemaVersion: 1, eventId: event.eventId, source: event.source, conversationId: event.conversationId,
      redactedText: withRedaction(event).redactedText, predictedKind: predicted?.kind ?? 'other', expectedKind: feedback.kind,
      note: feedback.note, correctedAt: feedback.createdAt,
    }]
  })
  if (feedbackRows.length === 0) {
    exportStatus.textContent = '내보낼 사용자 수정 피드백이 없습니다.'
    return
  }
  download(`yas-feedback-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), cases: feedbackRows }, null, 2), 'application/json')
  exportStatus.textContent = `${feedbackRows.length}개 사용자 수정 피드백을 평가 데이터셋 JSON으로 내보냈습니다.`
})
query<HTMLButtonElement>('#export-raw-json').addEventListener('click', () => {
  if (window.confirm('원문에는 대화 내용과 개인 정보가 포함될 수 있습니다. 기기 보관용으로만 저장하시겠습니까?')) exportData('json', false)
})

const isStoredEvent = (value: unknown): value is ConversationEvent => {
  if (typeof value !== 'object' || value === null) return false
  const event = value as Partial<ConversationEvent>
  return event.schemaVersion === 1
    && typeof event.eventId === 'string'
    && typeof event.conversationId === 'string'
    && (event.source === 'codex' || event.source === 'claude_code' || event.source === 'antigravity')
    && (event.role === 'user' || event.role === 'assistant' || event.role === 'tool' || event.role === 'system')
    && typeof event.occurredAt === 'string'
    && typeof event.text === 'string'
}

const persistVault = async (): Promise<void> => {
  if (!vaultSession) return
  const serialized = JSON.stringify(mergeImportedEvents().map(withRedaction))
  await vaultSession.store.insert('events-v1', Array.from(new TextEncoder().encode(serialized)))
  const outbox = JSON.stringify(centralOutbox ?? null)
  await vaultSession.store.insert('central-outbox-v1', Array.from(new TextEncoder().encode(outbox)))
  const analysis = JSON.stringify(centralAnalysisSnapshot ?? null)
  await vaultSession.store.insert('analysis-results-v1', Array.from(new TextEncoder().encode(analysis)))
  const feedback = JSON.stringify([...classificationFeedback.values()])
  await vaultSession.store.insert('classification-feedback-v1', Array.from(new TextEncoder().encode(feedback)))
  await vaultSession.stronghold.save()
}

const restoreVault = async (password: string): Promise<void> => {
  const vaultPath = `${await appDataDir()}/usage-insights.hold`
  const stronghold = await Stronghold.load(vaultPath, password)
  let client
  try {
    client = await stronghold.loadClient('usage-insights')
  } catch {
    client = await stronghold.createClient('usage-insights')
  }
  const store = client.getStore()
  vaultSession = { stronghold, store }
  const bytes = await store.get('events-v1')
  const outboxBytes = await store.get('central-outbox-v1')
  if (outboxBytes) {
    const pending: unknown = JSON.parse(new TextDecoder().decode(outboxBytes))
    if (pending && typeof pending === 'object' && Array.isArray((pending as { events?: unknown }).events)) {
      const pendingBatch = pending as CentralOutbox
      centralOutbox = { ...pendingBatch, events: pendingBatch.events.map(toCentralEvent) }
    }
  }
  const analysisBytes = await store.get('analysis-results-v1')
  if (analysisBytes) {
    const stored: unknown = JSON.parse(new TextDecoder().decode(analysisBytes))
    if (stored && typeof stored === 'object' && Array.isArray((stored as { classifications?: unknown }).classifications)) {
      const snapshot = stored as CentralAnalysisSnapshot
      if (!snapshot.engine.startsWith('deterministic-') || snapshot.engine === currentDeterministicEngine) {
        centralAnalysisSnapshot = snapshot
        centralAnalyzedEventIds.clear()
        for (const eventId of snapshot.analyzedEventIds ?? snapshot.classifications.map((item) => item.eventId)) centralAnalyzedEventIds.add(eventId)
        centralCandidates = new Map(snapshot.classifications.map((item) => [item.eventId, {
          eventId: item.eventId, kind: item.primaryKind, confidence: item.confidence, rationale: item.rationale,
          clarityScore: item.clarityScore, clarityReasons: item.clarityReasons, clarityDimensions: item.clarityDimensions,
          confidenceStatus: item.confidenceStatus, jevConfidence: item.jevConfidence, shadowComparison: item.shadowComparison,
          friction: item.reactionSignals.friction, profanityDetected: item.reactionSignals.profanityDetected, frictionReason: item.reactionSignals.frictionReason, frictionType: item.reactionSignals.frictionType, frictionResponsibility: item.reactionSignals.frictionResponsibility,
          contextSignals: item.context?.contextSignals, windowSize: item.context?.windowSize,
        }]))
      }
    }
  }
  const feedbackBytes = await store.get('classification-feedback-v1')
  if (feedbackBytes) {
    const stored: unknown = JSON.parse(new TextDecoder().decode(feedbackBytes))
    if (Array.isArray(stored)) {
      classificationFeedback.clear()
      for (const item of stored) {
        if (item && typeof item === 'object' && typeof item.eventId === 'string' && typeof item.kind === 'string') classificationFeedback.set(item.eventId, item as ClassificationFeedback)
      }
    }
  }
  updateOutboxStatus()
  if (!bytes) {
    vaultStatus.textContent = '새 vault를 열었습니다. 이제 가져온 대화가 이 기기에 암호화되어 저장됩니다.'
    return
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!Array.isArray(parsed) || !parsed.every(isStoredEvent)) throw new Error('저장된 vault 데이터 형식이 올바르지 않습니다.')
  importedBySource.clear()
  for (const source of ['codex', 'claude_code', 'antigravity'] as const) {
    importedBySource.set(source, parsed.filter((event) => event.source === source))
  }
  focusDateView(mergeImportedEvents())
  vaultStatus.textContent = `${parsed.length}개 이벤트를 암호화된 vault에서 복원했습니다.`
  if (centralAnalysisSnapshot) centralStatus.textContent = `저장된 중앙 분석을 복원했습니다 · ${centralAnalysisSnapshot.engine} · ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(centralAnalysisSnapshot.analyzedAt))}`
}

const tokenUsageLabel = (event: ConversationEvent): string => event.tokenUsage.state === 'observed'
  ? `입력 ${event.tokenUsage.input.toLocaleString('ko-KR')} · 출력 ${event.tokenUsage.output.toLocaleString('ko-KR')}`
  : '도구가 메시지별 토큰 사용량을 제공하지 않음'

const showDetail = (eventId: string): void => {
  const index = currentEvents.findIndex((event) => event.eventId === eventId)
  const event = currentEvents[index]
  if (!event) return
  detailEventId = eventId
  const responseParts: string[] = []
  for (const candidate of currentEvents.slice(index + 1)) {
    if (candidate.source !== event.source || candidate.conversationId !== event.conversationId) continue
    if (candidate.role === 'user') break
    if (candidate.role === 'assistant' && candidate.text.trim()) responseParts.push(candidate.text.trim())
  }
  const response = responseParts.length > 0 ? responseParts.join('\n\n') : undefined
  const classification = centralCandidates.get(eventId) ?? classifyCandidates([event])[0]
  const centralClassification = centralAnalysisSnapshot?.classifications.find((item) => item.eventId === eventId)
  const rows: ReadonlyArray<readonly [string, string]> = [
    ['도구', event.source === 'claude_code' ? 'Claude Code' : event.source === 'antigravity' ? 'Antigravity' : 'Codex'],
    ['시각', new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeStyle: 'medium', timeZone: localTimeZone }).format(new Date(event.occurredAt))],
    ['모델', event.model ?? '기록에 없음'],
    ['토큰', tokenUsageLabel(event)],
    ...(centralClassification ? [['질문 명확도', `${centralClassification.clarityScore}점 · ${centralClassification.clarityReasons.join(', ')}`] as const] : []),
    ...(centralClassification?.jevConfidence !== undefined ? [['Jev confidence', `${Math.round(centralClassification.jevConfidence * 100)}% · ${centralClassification.confidenceStatus === 'accepted' ? '자동 확정' : '검토 필요'}`] as const] : []),
    ...(centralClassification?.shadowComparison ? [['기존 엔진 비교', `Jev ${centralClassification.clarityScore}점 · ${centralClassification.shadowComparison.engine} ${centralClassification.shadowComparison.clarityScore}점`] as const] : []),
  ]
  detailMeta.replaceChildren(...rows.flatMap(([label, value]) => {
    const term = document.createElement('dt')
    term.textContent = label
    const description = document.createElement('dd')
    description.textContent = value
    return [term, description]
  }))
  detailQuestion.textContent = event.text
  detailResponse.textContent = response
    ?? (event.source === 'antigravity'
      ? 'Antigravity CLI의 history 기록에는 질문만 있습니다. AI 응답은 별도 protobuf 단계 데이터 import를 구현한 뒤 표시됩니다.'
      : '같은 대화의 AI 텍스트 응답을 찾지 못했습니다.')
  detailRedacted.textContent = withRedaction(event).redactedText ?? event.text
  const insightItems: ReadonlyArray<readonly [string, string, string]> = [
    ['질문 명확도', centralClassification ? `${centralClassification.clarityScore}점` : '중앙 분석 전', centralClassification?.clarityReasons?.join(' · ') ?? 'Jev 분석 후 낮은 이유를 확인할 수 있습니다.'],
    ['마찰 원인', centralClassification ? frictionReasonLabel(centralClassification.reactionSignals.frictionReason) : '중앙 분석 전', centralClassification ? `관측된 유형: ${frictionTypeLabel(centralClassification.reactionSignals.frictionType)}` : '중앙 분석 후 마찰 맥락을 확인할 수 있습니다.'],
    ['책임 방향', centralClassification ? responsibilityLabel(centralClassification.reactionSignals.frictionResponsibility) : '중앙 분석 전', centralClassification?.reactionSignals.frictionResponsibility === 'unclear' ? '현재 대화 맥락만으로 어느 쪽의 원인인지 판단하기 어렵습니다.' : '대화 맥락을 바탕으로 한 관측값입니다.'],
  ]
  detailInsights.replaceChildren(...insightItems.map(([label, value, note]) => {
    const article = document.createElement('article')
    article.className = 'detail-insight'
    const heading = document.createElement('span')
    heading.textContent = label
    const strong = document.createElement('strong')
    strong.textContent = value
    const description = document.createElement('small')
    description.textContent = note
    article.append(heading, strong, description)
    return article
  }))
  const signalParts: string[] = []
  if (classification?.profanityDetected) signalParts.push('강한 표현이 포함되어 욕설 반응 신호로 표시되었습니다.')
  if (classification?.friction === 'medium' || classification?.friction === 'high') signalParts.push(`마찰 수준은 ${classification.friction}입니다.`)
  const frictionReason = centralClassification?.reactionSignals.frictionReason
  if (frictionReason) signalParts.push(`Jev가 본 원인: ${frictionReasonLabel(frictionReason)}`)
  if (centralClassification?.reactionSignals.frictionType) signalParts.push(`마찰 유형: ${frictionTypeLabel(centralClassification.reactionSignals.frictionType)}`)
  if (centralClassification?.reactionSignals.frictionResponsibility) signalParts.push(`책임 방향: ${responsibilityLabel(centralClassification.reactionSignals.frictionResponsibility)}`)
  const contextSignals = centralClassification?.context?.contextSignals ?? []
  if (contextSignals.includes('correction_after_assistant')) signalParts.push('직전 AI 응답 뒤에 교정 표현이 이어졌습니다.')
  if (contextSignals.includes('repeated_question')) signalParts.push('이전 질문과 유사한 질문이 반복되었습니다.')
  if (contextSignals.includes('followup_correction')) signalParts.push('이 질문 뒤에 추가 교정 표현이 발생했습니다.')
  if (contextSignals.includes('previous_response_resolved')) signalParts.push('직전 AI 응답에 완료·검증 신호가 있었습니다.')
  detailReaction.textContent = signalParts.length > 0
    ? `${signalParts.join(' ')} 이는 대화 마찰을 관측한 결과이며, 사용자의 감정이나 인성을 확정하는 판단은 아닙니다.`
    : '현재 기록에서 별도의 욕설·마찰 맥락 신호가 확인되지 않았습니다.'
  detailAnalysisEvidence.textContent = centralClassification
    ? JSON.stringify({
      engine: centralClassification.jevAnswers ? 'jev' : 'deterministic',
      clarityDimensions: centralClassification.clarityDimensions ?? null,
      jevAnswers: centralClassification.jevAnswers ?? null,
    }, null, 2)
    : '중앙 분석 전에는 Jev 판단 근거가 없습니다.'
  feedbackKind.replaceChildren(...Object.entries(labels).map(([value, label]) => {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    return option
  }))
  feedbackKind.value = classificationFeedback.get(eventId)?.kind ?? centralCandidates.get(eventId)?.kind ?? classifyCandidates([event])[0]?.kind ?? 'productive_work'
  feedbackNote.value = classificationFeedback.get(eventId)?.note ?? ''
  feedbackStatus.textContent = classificationFeedback.has(eventId) ? '이 질문에는 사용자 수정이 저장되어 있습니다.' : ''
  detailDialog.showModal()
}

feedbackForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!detailEventId) return
  classificationFeedback.set(detailEventId, { eventId: detailEventId, kind: feedbackKind.value as CandidateClassification['kind'], note: feedbackNote.value.trim(), createdAt: new Date().toISOString() })
  await persistVault()
  render(currentEvents, true)
  feedbackStatus.textContent = '사용자 수정이 vault에 저장되었습니다.'
})

input.addEventListener('change', async () => {
  const file = input.files?.item(0)
  if (!file) return
  try {
    const events = parseImport(await file.text())
    render(events.map(withRedaction), true)
  } catch (error) {
    status.textContent = `가져오지 못했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`
  } finally {
    input.value = ''
  }
})

const sourceLabels: Readonly<Record<SourceDiscovery['source'], string>> = {
  codex: 'Codex',
  claude_code: 'Claude Code',
  antigravity: 'Antigravity',
}

const renderSourceDiscovery = (items: readonly SourceDiscovery[]): void => {
  sourceList.replaceChildren(...items.map((item) => {
    const row = document.createElement('li')
    const statusLabel = item.state === 'ready' ? '가져오기 준비됨'
      : item.state === 'metadata_ready' ? '형식 확인 중'
      : item.state === 'not_found' ? '기록 없음'
      : '접근 불가'
    row.innerHTML = `<div><strong>${sourceLabels[item.source]}</strong><span>${item.detail}</span></div><b class="source-state ${item.state}">${statusLabel} · ${item.sessionCount}개</b>`
    return row
  }))
}

const scanSources = async (): Promise<void> => {
  if (!('__TAURI_INTERNALS__' in window)) {
    sourceList.innerHTML = '<li><div><strong>데스크톱 앱에서 실행하세요</strong><span>브라우저 미리보기는 사용자 홈의 대화 기록을 읽지 않습니다.</span></div></li>'
    return
  }
  sourceList.innerHTML = '<li><div><strong>탐색 중</strong><span>로컬 대화 기록의 파일 존재 여부를 확인하고 있습니다.</span></div></li>'
  try {
    renderSourceDiscovery(await invoke<SourceDiscovery[]>('scan_local_sources'))
  } catch {
    sourceList.innerHTML = '<li><div><strong>탐색 실패</strong><span>로컬 경로 접근 권한을 확인해 주세요.</span></div></li>'
  }
}

query<HTMLButtonElement>('#scan-sources').addEventListener('click', () => { void scanSources() })

list.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-event-id]')
  if (button?.dataset.eventId) showDetail(button.dataset.eventId)
})

query<HTMLButtonElement>('#date-all').addEventListener('click', () => {
  activeDateFilter = 'all'
  render(currentEvents, currentEvents.length > 0)
})

query<HTMLButtonElement>('#date-today').addEventListener('click', () => {
  activeDateFilter = 'today'
  render(currentEvents, currentEvents.length > 0)
})

dateSummary.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-date]')
  if (!button?.dataset.date) return
  activeDateFilter = button.dataset.date
  render(currentEvents, currentEvents.length > 0)
})

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-source-filter]')) {
  button.addEventListener('click', () => {
    const source = button.dataset.sourceFilter
    if (source !== 'all' && source !== 'codex' && source !== 'claude_code' && source !== 'antigravity') return
    activeSourceFilter = source
    render(currentEvents, currentEvents.length > 0)
  })
}

const sourceCommands: Readonly<Record<ConversationEvent['source'], string>> = {
  codex: 'import_codex_conversations',
  claude_code: 'import_claude_conversations',
  antigravity: 'import_antigravity_conversations',
}

const sourceNames: Readonly<Record<ConversationEvent['source'], string>> = {
  codex: 'Codex', claude_code: 'Claude Code', antigravity: 'Antigravity',
}

const importSource = async (source: ConversationEvent['source']): Promise<boolean> => {
  if (!('__TAURI_INTERNALS__' in window)) {
    status.textContent = '자동 import는 데스크톱 앱에서만 실행됩니다.'
    return false
  }
  status.textContent = `${sourceNames[source]}의 로컬 세션을 읽기 전용으로 정규화하고 있습니다…`
  try {
    const knownEventIds = (importedBySource.get(source) ?? []).map((event) => event.eventId)
    const result = await invoke<SourceImportResult>(sourceCommands[source], { knownEventIds })
    const merged = new Map((importedBySource.get(source) ?? []).map((event) => [event.eventId, event]))
    for (const event of result.events) merged.set(event.eventId, withRedaction(event))
    importedBySource.set(source, [...merged.values()])
    render(mergeImportedEvents(), true)
    await persistVault()
    status.textContent = `${sourceNames[source]}에서 새 메시지 ${result.eventCount}개를 추가했습니다. ${result.skippedLineCount > 0 ? `건너뛴 레코드 ${result.skippedLineCount}개.` : '중앙 서버 전송은 하지 않았습니다.'}`
    syncStatus.textContent = `마지막 동기화: ${new Intl.DateTimeFormat('ko-KR', { timeStyle: 'medium' }).format(new Date())}`
    return true
  } catch {
    status.textContent = `${sourceNames[source]} 대화를 가져오지 못했습니다. 로컬 기록 접근 권한과 파일 형식을 확인해 주세요.`
    return false
  }
}

const syncAllSources = async (): Promise<void> => {
  if (!vaultSession) {
    syncStatus.textContent = '먼저 vault를 열어 주세요.'
    return
  }
  syncButton.disabled = true
  syncStatus.textContent = '새 대화를 확인하는 중…'
  try {
    for (const source of ['codex', 'claude_code', 'antigravity'] as const) await importSource(source)
    syncStatus.textContent = `동기화 완료: ${new Intl.DateTimeFormat('ko-KR', { timeStyle: 'medium' }).format(new Date())}`
  } finally {
    syncButton.disabled = false
  }
}

const scheduledSyncIfDue = async (): Promise<void> => {
  const settings = readSchedule()
  if (!settings.enabled || !vaultSession) return
  const now = new Date()
  if (now.getHours() < settings.hour) return
  const today = localDateKey(now.toISOString()) ?? now.toISOString().slice(0, 10)
  if (settings.lastRunDate) {
    const elapsed = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${settings.lastRunDate}T00:00:00Z`)) / 86_400_000)
    if (elapsed < settings.everyDays) return
  }
  writeSchedule({ ...settings, lastRunDate: today })
  settingsStatus.textContent = `자동 동기화 실행: ${today} ${settings.hour}시`
  await syncAllSources()
  if (centralConsent.checked && centralToken.value.trim() && !centralRunController) centralForm.requestSubmit()
}

const startScheduleTimer = (): void => {
  if (scheduleTimer !== undefined) window.clearInterval(scheduleTimer)
  scheduleTimer = window.setInterval(() => { void scheduledSyncIfDue() }, 60_000)
  void scheduledSyncIfDue()
}

const applyScheduleToForm = (): void => {
  const settings = readSchedule()
  scheduleDays.value = String(settings.everyDays)
  scheduleHour.value = String(settings.hour)
  scheduleEnabled.checked = settings.enabled
  settingsStatus.textContent = scheduleLabel(settings)
}

settingsOpen.addEventListener('click', () => { applyScheduleToForm(); settingsDialog.showModal() })
settingsClose.addEventListener('click', () => settingsDialog.close())
settingsCancel.addEventListener('click', () => settingsDialog.close())
settingsForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const everyDays = Math.min(7, Math.max(1, Number(scheduleDays.value)))
  const hour = Math.min(23, Math.max(0, Number(scheduleHour.value)))
  const next: ScheduleSettings = { enabled: scheduleEnabled.checked, everyDays, hour, lastRunDate: readSchedule().lastRunDate }
  writeSchedule(next)
  settingsStatus.textContent = scheduleLabel(next)
  settingsDialog.close()
  startScheduleTimer()
})

for (const [source, buttonId] of Object.entries({
  codex: '#import-codex', claude_code: '#import-claude', antigravity: '#import-antigravity',
}) as ReadonlyArray<readonly [ConversationEvent['source'], string]>) {
  query<HTMLButtonElement>(buttonId).addEventListener('click', async () => {
    const button = query<HTMLButtonElement>(buttonId)
    button.disabled = true
    try { await importSource(source) } finally { button.disabled = false }
  })
}

query<HTMLButtonElement>('#import-all').addEventListener('click', async () => {
  const button = query<HTMLButtonElement>('#import-all')
  button.disabled = true
  appLoadingLabel.textContent = '전체 동기화 중…'
  appLoading.hidden = false
  try {
    for (const source of ['codex', 'claude_code', 'antigravity'] as const) {
      appLoadingLabel.textContent = `${sourceNames[source]} 동기화 중…`
      const completed = await importSource(source)
      appLoadingLabel.textContent = `${sourceNames[source]} ${completed ? '동기화 완료' : '동기화 실패'}`
    }
    status.textContent = '전체 동기화가 끝났습니다. 날짜별 대화에서 새 기록을 확인하세요.'
    focusDateView(mergeImportedEvents())
  } finally {
    appLoading.hidden = true
    button.disabled = false
  }
})

syncButton.addEventListener('click', () => { void syncAllSources() })

query<HTMLFormElement>('#vault-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const passwordInput = query<HTMLInputElement>('#vault-password')
  const password = passwordInput.value
  if (password.length < 12) {
    vaultStatus.textContent = '마스터 비밀번호는 12자 이상이어야 합니다.'
    return
  }
  vaultStatus.textContent = '암호화 vault를 열고 있습니다…'
  try {
    await restoreVault(password)
    syncButton.disabled = false
    startScheduleTimer()
    passwordInput.value = ''
  } catch {
    vaultSession = undefined
    vaultStatus.textContent = 'vault를 열지 못했습니다. 비밀번호가 다르거나 저장된 데이터가 손상되었을 수 있습니다.'
  }
})
void scanSources()
