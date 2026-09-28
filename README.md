# You Are Stupid! (YAS)

![YAS crayon character](assets/yas-crayon.png)

## AI는 똑똑한데, 왜 내 답변은 점점 이상해질까?

AI한테 욕해본 적 있지?

> “왜 이것도 못 해?”  
> “내가 분명히 말했잖아.”  
> “아니, 그게 아니라…”

그런데 잠깐. 정말 AI만 문제일까?

AI 모델은 점점 똑똑해지는데, 이상하게 내 질문은 점점 짧아지고, 모호해지고, `ㄱㄱ`가 되어간다. 질문이 멍청해졌는데 AI가 멍청한 답을 한다고 화내고 있었던 건 아닐까?

그래서 만들었다.

**YAS는 AI를 분석하는 도구가 아니라, AI를 쓰는 나를 분석하는 도구다.**

Codex 하나만 써도 되고, Claude Code와 Antigravity를 함께 써도 된다. 내가 어떤 질문을 했는지, 언제 AI를 교정했는지, 왜 욕을 했는지, 질문이 실제로 명확했는지를 기록하고 보여준다.

## YAS가 도와주는 것

- 내 질문이 구체적인지, 아니면 “이거 해줘” 수준인지 확인
- 욕설이 단순 감정 표현인지, 반복 실패에 대한 반응인지 구분
- AI가 틀린 건지, 내가 설명을 덜 한 건지 함께 확인
- 실제 작업·진행 확인·재개 지시·에이전트 교정 비율 확인
- 날짜별·주간·월간으로 질문 습관의 변화를 확인
- 반복되는 문제를 각 도구의 init addendum에 추가할 지침으로 정리

Jev 분석은 **선택 사항**이다. Jev 없이도 로컬 기준선으로 사용할 수 있고, Jev를 연결하면 질문의 명확도·마찰 원인·책임 방향 같은 문맥 기반 분석을 더 깊게 볼 수 있다.

## YAS의 루프

```text
대화 수집
  → 원문은 내 컴퓨터에 보관
  → 질문·응답·마찰 신호 분석
  → 일간·주간·월간 리포트
  → 반복되는 문제를 init addendum으로 정리
  → 더 나은 질문
  → 다시 분석
```

목표는 AI에게 더 세게 화내는 법이 아니다.

**내가 더 명확하게 질문하고, AI와 더 잘 협업하고, 결국 나 자신이 더 똑똑해지는 것.**

YAS. 너를 분석해라. 그리고 너 자신이 똑똑해져라.

## 현재 지원

- macOS / Windows용 Tauri 데스크톱 앱
- Codex, Claude Code, Antigravity CLI 기록 수집
- 날짜별·도구별 필터와 질문 상세 보기
- 로컬 암호화 vault
- Jev 선택형 중앙 분석
- SQLite 분석 결과 캐시
- 일간·주간·월간 집계
- init addendum 생성 및 스케줄러

## 시작하기

```bash
npm install
npm run tauri -- dev
```

Jev를 사용하려면 중앙 분석 서버를 실행하는 컴퓨터에서만 설정한다.

```bash
cp .env.example .env
```

`.env`에 발급받은 키를 입력한다. 실제 키는 절대 GitHub에 커밋하지 않는다.

```dotenv
TYPESAFE_API_KEY=발급받은_키
CENTRAL_MODEL_PROVIDER=jev
JEV_API_URL=https://api.typesafe.ai/v1/systemone
JEV_MODEL=jev-latest
```

공개 전 검증:

```bash
npm run security:public
npm run central:test
npm run typecheck
npm run build
```

상세한 데이터 계약, 개인정보 원칙, Jev 적용 기준, init 스케줄링은 [`docs/`](docs/)에서 확인할 수 있다.

## 중요한 원칙

- 원문은 기본적으로 로컬에 남긴다.
- 중앙 분석에는 가림본만 보낸다.
- 욕설만으로 사용자의 성격을 판단하지 않는다.
- 원본 `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`를 자동으로 덮어쓰지 않는다.
- 반복해서 확인된 패턴만 init addendum으로 제안한다.
