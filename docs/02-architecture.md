# 2. 로컬-중앙 아키텍처와 수집 전략

## 책임 분리

```text
AI 도구별 기록/내보내기
          │  (사용자 동의)
          ▼
┌──────────────────────┐
│ macOS / Windows Agent │
│ connector → normalize │
│ redact → local vault  │
└──────────┬───────────┘
           │ 요약·이벤트·선택적 원문 암호문
           ▼
┌──────────────────────┐
│ Central API           │
│ ingestion / policy    │
├──────────────────────┤
│ classifier            │
│ aggregation           │
│ feedback correction   │
└──────────┬───────────┘
           ▼
     Web dashboard / export
```

### 로컬 수집기의 책임

- 도구별 공식 export/API 또는 사용자가 지정한 읽기 전용 기록 위치만 연결한다.
- 서로 다른 형식을 공통 `ConversationEvent`로 정규화한다.
- API 키, 액세스 토큰, 비밀값, 주민등록/결제 정보처럼 탐지 가능한 민감값을 동기화 전에 가린다.
- 원문 vault, 동기화 대기열, 커넥터 권한, 삭제 요청을 소유한다.
- 토큰·모델·비용은 도구가 제공한 경우에만 `observed`로 저장하고, 없으면 `unavailable`로 남긴다.

### 중앙 서비스의 책임

- 중복 제거와 순서 보정, 테넌트/사용자 권한 확인을 수행한다.
- 버전이 붙은 분류 기준과 모델을 이용해 세션 단위로 분석한다.
- 수치 집계, 추세 계산, 사용자 정정 반영, 리포트 API를 제공한다.
- 원문이 동기화되지 않은 모드에서도 구조화 이벤트와 안전한 요약으로 분석한다.

## 수집 방식의 우선순위

| 순위 | 방식 | 이유 | 허용 조건 |
| --- | --- | --- | --- |
| 1 | 도구의 공식 export/API | 형식·권한이 명확하고 변경 대응이 쉽다 | 사용자가 계정/파일을 명시적으로 연결 |
| 2 | 사용자가 선택한 로컬 세션 파일 읽기 | 오프라인 기록도 다룰 수 있다 | 읽기 전용 경로, 파일별 미리보기·제외 |
| 3 | 사용자가 파일을 앱에 import | 가장 안전한 호환성 대안 | 원본 파일 보관 여부를 선택 |
| 금지 | 키 입력 훅, 클립보드 상시 감시, 화면/프로세스 메모리 스크래핑 | 비밀·무관한 대화의 과수집 위험 | v1에서 사용하지 않음 |

도구별 커넥터는 공통 인터페이스만 구현한다. 지원 여부는 “기록 존재”, “원문/응답 구분”, “시간”, “토큰/모델”, “공식 허용 범위”를 검증한 뒤 `ready`, `import_only`, `unsupported`로 공개한다.

```ts
type ConnectorCapability = Readonly<{
  source: 'codex' | 'claude_code' | 'antigravity'
  mode: 'official_sync' | 'local_readonly' | 'file_import' | 'unsupported'
  fields: ReadonlySet<'prompt' | 'assistant_reply' | 'timestamp' | 'model' | 'token_usage'>
}>
```

## 동기화와 실패 처리

- 로컬에서 생성한 `eventId`와 `contentHash`로 멱등 업로드한다.
- 네트워크가 없으면 암호화된 outbox에 쌓고 지수 백오프로 재시도한다.
- 서버의 분석 결과는 로컬 원문을 바꾸지 않는다. 분류 정정은 별도 `ClassificationCorrection` 이벤트다.
- 삭제는 중앙 데이터 삭제 확인 전까지 로컬에 상태를 남기고, 완료 증적을 사용자에게 보여 준다.
