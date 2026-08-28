# ADR-0007: 독립 SwiftUI Companion 기반과 모바일 API 경계

- 상태: 승인 (2026-08-28 개정)
- 날짜: 2026-08-02

## 배경

현재 iOS와 Android Companion은 Tauri가 생성한 네이티브 셸 안에서 공통 웹 UI를 실행한다. iOS를 SwiftUI로 점진 전환하려면 기존 TestFlight 릴리스 경로를 유지하면서 네이티브 화면을 메인 브랜치에서 독립적으로 개발하고 검증할 수 있어야 한다. 동시에 iOS만 별도 서버 동작을 요구하지 않도록 Android와 공유하는 모바일 API 경계가 필요하다.

## 결정

1. `apps/briar/src-tauri/gen/apple`과 `apps/briar/src-tauri/gen/android`는 기존 Companion 릴리스 경로로 계속 유지한다. 이 ADR에서는 해당 앱의 bundle/application ID, scheme, 빌드 설정을 바꾸지 않는다.
2. 새 iOS 코드는 `apps/briar/ios/BriarCompanion`의 독립 Xcode 프로젝트로 둔다. 개발 앱은 `app.briar.companion.native.dev`, scheme은 `BriarCompanion-Dev`를 사용한다. 따라서 기존 `app.briar.companion` 앱과 같은 시뮬레이터에 동시에 설치할 수 있다.
3. 네이티브 앱이 사용하는 서버 경계는 `@briar/mobile-contracts`의 Effect Schema와 operation descriptor로 명시한다. OpenAPI 3.1 문서와 Swift DTO/client는 이 실행 가능한 계약에서 생성한다.
4. iOS는 `briar-mobile`, Android는 `briar-android` client ID를 사용하되 응답 모델과 오류 의미는 공유한다. 실제 Worker 라우트와 두 클라이언트의 decoder가 같은 operation descriptor를 사용한다.
5. 초기 앱 단계에서는 이전 모바일 계약과의 하위 호환성을 유지하지 않는다. 필드 삭제·이름 변경·필수화는 canonical schema에서 직접 수행하며, 누락 필드를 허용하기 위한 default, alias, 이중 wire schema를 두지 않는다. 릴리스 안정화 뒤 호환성 정책이 필요해지면 별도 ADR로 도입한다.
6. 모바일 플랫폼 빌드는 필수 `app-worker` signoff와 분리한다. 생성물 currentness, 실제 Worker 라우트 validation, TypeScript/Swift decoder의 핵심 경계를 일반 테스트에서 검증하고, 새 SwiftUI App/Unit/UI Test와 기존 Tauri iOS/Android 빌드는 명시적인 `bun run mobile:ci`에서 검사한다.

## 오류와 복구 원칙

- 인증 폴링의 `authorization_pending`은 실패가 아니라 대기 상태다. `slow_down`은 다음 폴링 간격을 늘리고, `access_denied`와 `expired_token`은 새 로그인 시작이 필요한 종료 상태다.
- `401`은 저장된 access token을 폐기하고 로그인 화면으로 돌아가야 한다.
- 네트워크 오류와 `5xx`는 사용자 세션을 삭제하지 않으며 재시도 가능한 상태로 표시한다.
- 네이티브 앱에는 운영 API 주소를 하드코딩하지 않는다. 개발 scheme의 환경 변수 또는 이후 배포 설정에서 주입한다.

## Android 동등성

이번 단계는 iOS 렌더링 기반을 만드는 작업이므로 별도 Android UI 프로젝트를 만들지 않는다. Android Tauri 앱은 계속 같은 사용자 기능을 제공하며, 공유 TypeScript client와 operation descriptor가 Android 경계도 함께 검증한다. 기존 Android 빌드는 명시적인 모바일 CI에서 확인한다. 이후 iOS 기능 PR은 아래 표의 Android 열을 함께 갱신해야 한다.

## 결과

- SwiftUI 작업은 기존 TestFlight 앱을 덮어쓰지 않고 메인에 병합할 수 있다.
- 서버 팀과 두 모바일 플랫폼이 사용하는 최소 데이터 형식과 오류 경계가 한 계약으로 고정된다.
- 기존 Tauri iOS와 Android의 회귀 빌드는 필요할 때 명시적인 모바일 CI로 확인한다.
