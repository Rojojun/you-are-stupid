# 출시 전 보안·패키징 체크리스트

## 자동 점검

```bash
npm run release:check
```

점검 범위:

- 원문 `text` 중앙 수집 거부
- 원격 모델 요청에 원문 미포함
- 가림본 이벤트 schema 검증
- 분류·집계·init 생성 회귀 테스트
- 프론트 typecheck/build

## 데스크톱 빌드

```bash
# 개발용 macOS 앱 번들
npm run tauri -- build --debug --bundles app

# 운영용 전체 번들(서명 인증서와 Windows 빌드 환경 필요)
npm run tauri -- build
```

macOS 운영 배포 전에는 Developer ID 서명·notarization, Windows 운영 배포 전에는
코드 서명 인증서를 별도로 설정해야 한다. 현재 `tauri.conf.json`은 번들 target을 `all`로
두었지만 서명되지 않은 설치물을 운영 배포해서는 안 된다.

## 보류: 운영 단계에서 진행

사용자 결정에 따라 아래 운영 단계는 현재 개발 범위에서 건너뛰고, 기능 개발이 완료된 뒤
별도 릴리스 작업으로 진행한다.

- 현재 Tauri CSP는 로컬 중앙 API만 허용한다. 외부 중앙 API를 배포할 때는 허용 origin을
  제품별로 고정하고 다시 빌드해야 한다.
- 운영 서버는 `CENTRAL_INGESTION_TOKEN`이 없거나 개발 기본값이면 시작하지 않는다. 다음
  단계에서 이를 workspace 사용자 인증·토큰 회전으로 교체해야 한다.
- 개인정보/근로감시/도구 약관에 대한 법률 검토가 필요하다.
- macOS·Windows 실기기 자동 수집 회귀 테스트가 필요하다.

현재 상태: 기능 개발 단계에서는 위 항목을 검증 완료로 간주하지 않으며, 운영 배포 전
체크리스트에서 다시 열어야 한다.
