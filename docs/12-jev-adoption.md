# Jev 우선 도입 결정

상태: 진행 중

## 결정

질문 명확도, 활동 유형, 마찰 신호처럼 문맥을 기반으로 판단해야 하는 분석은 Jev를 우선 판단 엔진으로 사용한다. 기존 `deterministic-v7`은 삭제하지 않고 API 미설정·네트워크 오류·낮은 신뢰도에 대비한 fallback 및 비교 기준으로 유지한다.

Jev는 코딩 에이전트나 대화 생성기를 대체하지 않는다. `Choice`, `Score`, `Noul`로 좁은 판단을 수행하고, 여러 판단의 조합·임계값·일간 집계는 애플리케이션 코드가 담당한다.

## 적용한 평가 질문

사용자 발화별로 다음 질문을 병렬 평가한다.

- `activity_kind`: 실제 작업, 진행 확인, 교정, 이어서 진행, 메타 질문 등
- `goal`: 목표·질문이 얼마나 명확한가
- `context`: 필요한 대화 맥락이 충분한가
- `constraints`: 범위와 제약이 드러나는가
- `verification`: 검증 방법이 있는가
- `completion`: 완료 조건이나 원하는 결과가 있는가
- `is_friction`: 단순 욕설이 아니라 오류·오해·반복 실패로 인한 마찰인가
- `friction_reason`: 마찰의 원인은 무엇인가

각 Score는 0~1로 정규화한 뒤 `server/model-adapter.mjs`의 가중치로 최종 명확도 점수를 계산한다. Jev가 산술이나 날짜 비교를 맡지 않도록 정규화·집계·날짜 처리는 코드가 소유한다.

## 현재 구현

- `server/model-adapter.mjs`에 `jev-v1` adapter 추가
- Jev 결과 스키마 검증 및 timeout/retry 처리
- Jev 실패 시 `deterministic-v7` fallback
- mock Jev 응답 테스트 추가
- 중앙 분석 서버는 `TYPESAFE_API_KEY`와 `CENTRAL_MODEL_PROVIDER=jev`가 있을 때 Jev를 사용

## 다음 순서

1. TypeSafe API 키 없이 mock 평가셋으로 Jev 질문 문구와 기준을 검증한다.
2. 실제 Jev 호출 50~100건을 shadow mode로 실행한다.
3. 사용자 피드백과 Jev confidence를 비교한다.
4. 낮은 confidence 처리 임계값을 정한다.
5. 그 후에만 기존 deterministic 점수 튜닝을 재개한다.

실제 API 키는 프론트엔드에 넣지 않고 중앙 서버 환경변수로만 관리한다.
