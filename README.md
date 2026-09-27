# AI Usage Insights

Codex, Claude Code, Antigravity 사용 기록을 사용자가 소유한 방식으로 모아, 실제 작업 방식과 에이전트 협업 마찰을 보여 주는 개인 분석 제품의 설계 초안이다.

## 이번 설계의 결론

- macOS와 Windows의 **로컬 수집기**는 선택한 대화/세션만 읽고, 원문은 기기에서 암호화해 보관한다.
- 중앙 서비스에는 기본적으로 가명 식별자, 구조화된 이벤트, 비식별 요약과 분류 근거만 보낸다. 원문 동기화는 사용자가 켠 워크스페이스만 별도 동의로 허용한다.
- “55% 실제 작업” 같은 분류는 로컬 규칙으로 확정하지 않는다. 로컬은 증거를 추출하고, 중앙 분류기가 버전 관리된 기준으로 전체 대화 문맥을 보고 판정한다.
- 욕설은 단순 횟수나 인성 점수가 아니다. 대화 실패 신호로 취급하며, `AI 오류 주장 → 정정 요청 → 반복/고집 → 분노 표현` 같은 문맥을 함께 분석한다.

## 문서 순서

1. [제품 범위와 사용자 흐름](docs/01-product-scope.md)
2. [로컬-중앙 아키텍처와 수집 전략](docs/02-architecture.md)
3. [이벤트·저장·동기화 계약](docs/03-data-contract.md)
4. [중앙 분류와 성장 측정 기준](docs/04-evaluation-model.md)
5. [개인정보·보안·운영 원칙](docs/05-privacy-security.md)
6. [9월 22일 설계 완료 기준과 이후 실행 순서](docs/06-delivery-plan.md)
7. [중앙 수집 API 계약](docs/07-central-ingestion-api.md)
8. [중앙 분석 API 계약](docs/08-central-analysis-api.md)
9. [init 추가 지침 스케줄링](docs/09-init-update-scheduling.md)
10. [출시 전 보안·패키징 체크리스트](docs/10-release-checklist.md)
11. [질문 명확도 점수 정책](docs/11-clarity-scoring-policy.md)

화면의 `분석 결과 내보내기`에서 현재 필터 기준 가림본 JSON/CSV를 저장할 수 있다. 원문 JSON은
기기 보관용 확인 절차를 거친 뒤에만 생성하며 중앙 서버로 전송되지 않는다.

`로컬 데이터 관리`에서는 현재 필터 이벤트 삭제, 분석 결과 삭제, 수정 피드백 삭제,
전체 vault 초기화를 각각 실행할 수 있다. 각 작업은 확인 후 실행되며 삭제 후 복구할 수 없다.

이 문서는 구현 승인 전 설계다. 각 AI 제품의 실제 로컬 데이터 위치, 내보내기 형식, 접근 권한은 버전과 계정 유형에 따라 달라질 수 있으므로, 커넥터 구현 전에 도구별 적법성·호환성 스파이크를 통과해야 한다.

## 현재 구현 상태

`src/`와 `src-tauri/`에는 Tauri 2 기반의 로컬 데스크톱 프로토타입이 있다. JSON/JSONL 가져오기, 공통 이벤트 정규화, 토큰 값의 `observed/unavailable` 구분, 화면 내 후보 분류와 질문별 상세 패널을 제공한다. 데스크톱 앱은 Codex·Claude Code·Antigravity CLI의 알려진 로컬 위치를 읽기 전용으로 자동 탐색한다. Codex와 Claude Code는 사용자·AI 메시지를, Antigravity CLI는 brain transcript의 사용자·모델 메시지를 현재 앱 메모리로 가져온다. transcript가 없는 Antigravity 기록은 history의 사용자 질문으로 보완한다. 모든 날짜 표시는 UTC 문자열이 아니라 실행 기기의 시간대 기준으로 계산되며, 전체·오늘·특정 날짜와 AI 도구 필터를 제공한다. 날짜 행에는 도구별 대화 수를 미리 표시한다. 중앙 업로드·영구 원문 저장은 아직 구현하지 않았다.

원문을 재실행 뒤에도 보관하려면 앱에서 12자 이상 마스터 비밀번호로 vault를 연다. vault는 Stronghold의 암호화 snapshot에만 저장하며 비밀번호는 보관하지 않는다. 비밀번호를 분실하면 복구할 수 없다.

vault가 열린 뒤에는 `지금 동기화` 버튼 또는 1분 주기 자동 동기화가 새 `eventId`만 추가한다. 현재 단계는 중복 방지와 증분 반영을 먼저 제공하며, 파일 offset/mtime 기반의 대용량 스캔 최적화는 다음 수집기 작업에서 추가한다.

`src/redaction.ts`는 원문을 덮어쓰지 않고 API 키, Bearer 토큰, 개인키, 비밀번호, 이메일을 가림본으로 만든다. 상세 화면에서 원문과 중앙 분석용 가림본을 구분해 확인할 수 있다. 중앙 API가 연결되면 가림본만 전송하도록 경계를 유지한다.

### Jev 키 설정

Jev를 사용할 때는 중앙 분석 서버를 실행하는 컴퓨터에서만 `.env`를 설정한다.

```bash
cp .env.example .env
```

`.env`의 `TYPESAFE_API_KEY`에 발급받은 키를 입력한다.

```dotenv
TYPESAFE_API_KEY=여기에_발급받은_키
CENTRAL_MODEL_PROVIDER=jev
JEV_API_URL=https://api.typesafe.ai/v1/systemone
JEV_MODEL=jev-latest
```

`.env`는 절대 GitHub에 커밋하지 않는다. 프론트엔드 코드, Tauri 설정, fixture에 키를 넣지
않는다. 키가 노출되었다면 Jev 제공자에서 즉시 폐기하고 새 키를 발급한다. 공개 저장소에는
`.env.example`만 포함한다.

공개 전에는 다음 검사를 실행한다.

```bash
npm run security:public
```

### 실행과 검증

```bash
npm install
npm run tauri -- dev
```

중앙 수집 API 로컬 검증:

```bash
npm run central:dev
npm run central:test
```

macOS 디버그 번들은 다음 명령으로 만든다.

```bash
npm run tauri -- build --debug
```

파일 import는 JSON 배열 또는 한 줄에 한 이벤트인 JSONL을 받는다. 각 이벤트는 `eventId`, `workspaceId`, `conversationId`, `source` (`codex`/`claude_code`/`antigravity`), `role`, `occurredAt`, `text`, `tokenUsage`를 포함해야 한다. `tokenUsage`는 `{ "state": "unavailable" }` 또는 `{ "state": "observed", "input": 1, "output": 2, "total": 3 }` 형태다.
