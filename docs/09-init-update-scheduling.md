# init 추가 지침 스케줄링

생성기는 기존 `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` 같은 전역 init 파일을 직접 수정하지
않는다. 대신 도구별로 `*.addendum.md`를 생성한다. 사용자는 검토 후 init 파일의 추가
영역에 그대로 붙일 수 있다.

## 수동 실행

```bash
# 매주 집계
npm run init:update -- --period weekly --date 2026-09-22 \
  --storage .data/ingestion-events.jsonl --out-dir .data/init-addenda

# 월간과 주간을 하나의 블록으로 결합
npm run init:update -- --period combined --date 2026-10-01 \
  --storage .data/ingestion-events.jsonl --out-dir .data/init-addenda
```

생성 파일:

- `codex.addendum.md`
- `claude-code.addendum.md`
- `antigravity.addendum.md`

## 운영체제 스케줄러용 단일 명령

하루 한 번 실행해도 실제 생성은 월요일 주간, 매월 1일 월간으로 제한한다. 월요일이
매월 1일이면 `combined`로 한 번만 생성한다.

```bash
npm run init:scheduled -- \
  --workspace YOUR_WORKSPACE_ID \
  --storage .data/ingestion-events.jsonl \
  --analysis-db .data/analysis.sqlite \
  --out-dir .data/init-addenda
```

`--date 2026-09-22`를 추가하면 특정 날짜를 재현할 수 있다. Windows 작업 스케줄러와
macOS/Linux cron 모두 이 명령을 하루 한 번 호출하면 된다.

## 스케줄러

macOS/Linux는 cron에서 월요일 주간 실행과 매월 1일 결합 실행을 등록한다.

```cron
0 9 * * * cd /path/to/ai-usage-insights && npm run init:scheduled -- --workspace YOUR_WORKSPACE_ID --storage .data/ingestion-events.jsonl --analysis-db .data/analysis.sqlite --out-dir .data/init-addenda
```

Windows 작업 스케줄러에서는 같은 `npm run init:update ...` 명령을 주간/월간 작업으로
각각 등록한다. `--period combined`는 주간과 월간 결과를 한 블록에 넣으므로 두 집계가
겹치는 시점에도 init 파일에 붙일 내용이 하나로 정확하게 유지된다.

생성되는 추천 문장은 같은 낮은 명확도 이유가 최소 2회 반복된 경우에만 포함한다. 한 번의
특이한 질문으로 전역 init 지침이 바뀌지 않도록 하며, 반복되는 경우 원인별 개선 문장과
목표·현재 상태·제약·검증·완료 기준 템플릿을 함께 추가한다.
