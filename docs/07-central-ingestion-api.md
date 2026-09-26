# Central ingestion API (v1)

로컬 수집기가 중앙 분석 장치로 보낼 때 사용하는 최소 계약이다. 이 단계에서는
업로드를 자동으로 켜지 않고, 계약과 로컬 개발 서버만 제공한다.

## Privacy boundary

- `text` 원문은 중앙 API에 전송하거나 저장하지 않는다.
- `redactedText`는 로컬 vault에서 가림 처리된 값만 허용한다.
- 원문 필드가 요청에 포함되면 전체 배치를 거부한다(`400 RAW_TEXT_NOT_ALLOWED`).
- 인증은 개발용 bearer token을 사용한다. 운영 배포 전 workspace/user 인증으로 교체한다.

## Endpoint

`POST /v1/ingestions/batches`

Headers:

```text
Authorization: Bearer <CENTRAL_INGESTION_TOKEN>
Content-Type: application/json
```

Request:

```json
{
  "workspaceId": "local-default",
  "clientBatchId": "batch-20260921-001",
  "events": [
    {
      "schemaVersion": 1,
      "eventId": "codex:conversation:message",
      "workspaceId": "local-default",
      "conversationId": "conversation",
      "source": "codex",
      "role": "user",
      "occurredAt": "2026-09-21T10:00:00.000Z",
      "redactedText": "API key [REDACTED_API_KEY]를 회전해 주세요.",
      "model": "gpt-5",
      "tokenUsage": { "state": "unavailable" },
      "provenance": "local_readonly"
    }
  ]
}
```

Response:

```json
{
  "accepted": 1,
  "duplicates": 0,
  "rejected": 0,
  "eventIds": ["codex:conversation:message"]
}
```

`eventId`는 서버 저장소의 유일 키다. 같은 이벤트를 재전송하면 데이터는 한 번만
저장되고 `duplicates`가 증가한다. 분석/분류 API와 실제 사용자 인증은 다음 단계다.

