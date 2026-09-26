# Central analysis API (v1)

중앙 수집 저장소의 가림본 이벤트를 분류하는 단계다. 현재 구현은 실제 생성형 모델의
판정이 아니라 `deterministic-v1` 기준선이며, 응답의 `confidence`는 항상 `low`다.

`POST /v1/analysis/classifications`

```json
{ "workspaceId": "local-default", "eventIds": ["event-1"] }
```

`eventIds`를 생략하면 해당 workspace의 저장 이벤트를 모두 분석한다. 응답은 사용자
발화만 대상으로 하며, 원문은 포함하지 않는다.

```json
{
  "engine": "deterministic-v1",
  "classifications": [{
    "eventId": "event-1",
    "primaryKind": "productive_work",
    "secondaryKinds": [],
    "confidence": "low",
    "rationale": "새 작업, 질문 또는 의사결정으로 보이는 사용자 발화",
    "reactionSignals": { "profanityDetected": false, "friction": "low" }
  }]
}
```

욕설은 원문이나 검출 단어를 반환하지 않고 반응 신호로만 저장한다. 실제 중앙 AI 모델은
평가 세트와 사용자 정정 저장이 준비된 뒤 `deterministic-v1`을 교체한다.

## Daily clarity aggregation

`POST /v1/analysis/clarity/daily`에 `{ "workspaceId": "local-default", "timeZone": "Asia/Seoul" }`를
보내면 사용자 질문별 명확도 점수를 현지 날짜별로 집계한다. 각 날짜에는 질문 수와 평균
점수, 도구별 분해가 포함된다. 주간/월간 집계와 init 추가 지침 생성기는 이 일간 집계를
재사용한다.

분류 결과에는 원문을 포함하지 않는 `context` 구조가 함께 반환된다. 같은 도구·대화의
앞뒤 최대 3개 이벤트에서 역할과 신호만 추출하며, `previousAssistantPresent`,
`correction_after_assistant`, `resume_instruction`처럼 문맥 해석에 필요한 값만 남긴다.
따라서 짧은 `계속`도 직전 AI 응답 뒤라면 부적절한 질문으로 자동 감점하지 않는다.
직전 AI 응답에 해결·검증 신호가 있고 질문이 반복되지 않으면 소폭 보정하며, 같은 질문의
반복이나 직후 교정이 확인되면 감점 이유와 `repeated_question`, `followup_correction`
신호를 추가한다.

클라이언트는 중앙 분석 응답을 Stronghold의 `analysis-results-v1` 항목에 저장한다. 저장
값에는 `engine`, `analyzedAt`, 분류 결과가 함께 들어가므로 앱을 다시 열어도 어떤 엔진으로
분석했는지 확인할 수 있다. 새 엔진 결과가 성공적으로 도착할 때만 기존 snapshot을 교체한다.
사용자가 상세 화면에서 분류를 수정하면 원래 결과를 덮어쓰지 않고 Stronghold의
`classification-feedback-v1`에 별도 저장한다. 이 피드백은 다음 평가 세트·모델 개선에
사용할 수 있다.
화면의 `수정 피드백 JSON` 내보내기는 이 자료를 평가 세트로 옮길 때 사용한다. 파일에는
가림본, 기존 예측 유형, 사용자가 고친 정답 유형, 수정 이유만 포함하고 원문은 포함하지 않는다.

## Model adapter

기본 서버는 `deterministic-v7`를 사용한다. 원격 JSON 모델을 연결할 때는 서버 실행 전에
`CENTRAL_MODEL_URL`과 선택적인 `CENTRAL_MODEL_TOKEN`을 설정한다. 서버는 가림본 이벤트만
`{ "schemaVersion": 1, "events": [...] }`로 보내며, 모델 응답의 분류 유형·점수·근거를
검증한 뒤 반환한다. 원격 모델 장애나 잘못된 응답은 `502`로 처리하고 로컬 outbox가 재시도할
수 있다.

원격 adapter는 기본 15초 timeout과 2회 재시도를 사용한다. `CENTRAL_MODEL_TIMEOUT_MS`와
`CENTRAL_MODEL_RETRIES`로 조정할 수 있으며, 요청한 이벤트가 응답에서 누락되면 부분 결과를
저장하지 않고 오류로 처리한다.

기준선 평가 세트는 `server/evaluation-set.json`이며 다음 명령으로 재현한다.

```bash
npm run analysis:evaluate
```
