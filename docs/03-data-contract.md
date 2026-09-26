# 3. 이벤트·저장·동기화 계약

## 저장 계층

| 계층 | 내용 | 기본 보관 위치 | 용도 |
| --- | --- | --- | --- |
| 원문 | 질문·응답의 정확한 텍스트와 첨부 참조 | 로컬 암호화 vault | 검색, 사용자 검토, 재요약 |
| 축약문 | 세션 요약, 작업 목표, 결정, 미해결 항목 | 로컬 및 선택적 중앙 | 빠른 분석과 대시보드 |
| 이벤트 | 발화 역할·시각·도구·토큰 상태·행동 후보 | 로컬 및 중앙 | 분류·집계 |
| 분석 | 분류, 근거 ID, 신뢰도, 모델/규칙 버전 | 중앙 및 캐시 | 리포트와 정정 |

원문과 축약문은 같은 데이터가 아니다. 축약문을 원문 대체물로 사용하거나, 원문 삭제 후 복구 가능한 형태로 중앙에 남겨서는 안 된다.

## 공통 이벤트 계약

```ts
type Source = 'codex' | 'claude_code' | 'antigravity'
type Role = 'user' | 'assistant' | 'tool' | 'system'
type TokenUsage =
  | { state: 'observed'; input: number; output: number; total: number }
  | { state: 'unavailable' }

type ConversationEvent = Readonly<{
  schemaVersion: 1
  eventId: string                 // UUID, 로컬에서 생성
  workspaceId: string             // 가명 ID
  conversationId: string          // 도구 원본 ID는 별도 암호화 매핑
  source: Source
  role: Role
  occurredAt: string              // ISO-8601 UTC
  content: { state: 'local_only' } | { state: 'synced_redacted'; text: string }
  localCiphertextRef: string      // vault에서만 해석
  summaryRef?: string
  model?: string
  tokenUsage: TokenUsage
  provenance: 'official' | 'local_readonly' | 'user_import'
}>
```

## 분석 결과 계약

```ts
type ActivityKind =
  | 'productive_work'
  | 'agent_correction'
  | 'progress_check'
  | 'cross_agent_handoff'
  | 'resume_instruction'
  | 'simplify_explanation'
  | 'rule_reminder'
  | 'other'

type Classification = Readonly<{
  classificationId: string
  conversationId: string
  windowEventIds: readonly string[]
  primary: ActivityKind
  secondary: readonly ActivityKind[]
  confidence: 'high' | 'medium' | 'low'
  evidenceEventIds: readonly string[]
  rationale: string               // 원문 인용 대신 짧은 근거 요약
  taxonomyVersion: string
  modelVersion: string
  correctedByUser?: boolean
}>
```

## API 초안

| API | 목적 |
| --- | --- |
| `POST /v1/ingestions/batches` | 암호화/비식별 이벤트 배치의 멱등 수신 |
| `POST /v1/conversations/{id}/summaries` | 동의된 축약문 업로드/갱신 |
| `GET /v1/reports/usage?from&to` | 활동 비율·추세·신뢰도 반환 |
| `POST /v1/classifications/{id}/corrections` | 사용자의 분류 정정 |
| `DELETE /v1/workspaces/{id}/data` | 중앙 데이터 삭제 요청 및 상태 확인 |

실제 OpenAPI는 이 계약과 보존/삭제 정책이 승인된 뒤 작성한다. 토큰 필드는 숫자 `0`으로 대체하지 않는다. `unavailable`은 “도구가 제공하지 않았다”는 의미이며, 모델이 추정한 값과 구분된다.
