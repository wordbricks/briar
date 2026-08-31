# ADR-0007: 독립 SwiftUI Companion 기반과 모바일 API 경계

- 상태: 승인 (2026-08-31 개정)
- 날짜: 2026-08-02

## 배경

초기에는 iOS와 Android Companion이 Tauri가 생성한 네이티브 셸 안에서 공통 웹 UI를 실행했다. iOS는 SwiftUI 앱을 별도 프로젝트로 도입해 기능 동등성과 TestFlight 안정성을 검증했고, 이제 두 iOS 구현을 함께 유지하는 비용과 잘못된 구현을 릴리즈할 위험을 없애기 위해 SwiftUI 구현으로 단일화한다. Android는 Tauri 앱을 유지하며 두 플랫폼은 같은 모바일 API 경계를 계속 사용한다.

## 결정

1. iOS 릴리즈 구현은 `apps/briar/ios/BriarCompanion`의 SwiftUI Xcode 프로젝트 하나만 사용한다. Tauri Apple 생성 프로젝트와 iOS 전용 설정·브리지는 저장소에서 제거한다.
2. 프로덕션 scheme `BriarCompanion-Production`은 기존 App Store bundle ID `app.briar.companion`을 유지한다. 개발 앱은 `app.briar.companion.native.dev`, scheme은 `BriarCompanion-Dev`를 사용해 프로덕션 앱과 같은 시뮬레이터에 동시에 설치할 수 있다.
3. 모바일 앱이 사용하는 서버 경계는 `@briar/contracts/proto/briar/app/v1`의 protobuf service와 message로 명시한다. 체크인된 Buf descriptor image 하나에서 Connect-ES 및 Connect-Swift DTO, service interface, client, test mock을 생성한다.
4. iOS는 `briar-mobile`, Android는 `briar-android` client ID를 사용하되 service descriptor와 오류 의미를 공유한다. Worker는 generated `ServiceImpl`을 구현하고, Android의 공유 TypeScript와 iOS는 generated Connect client를 직접 사용한다. Effect Schema는 handler 뒤의 cross-field/domain invariant에만 사용한다.
5. 초기 앱 단계에서는 이전 모바일 계약과의 하위 호환성을 유지하지 않는다. 필드 삭제·이름 변경·필수화는 canonical schema에서 직접 수행하며, 누락 필드를 허용하기 위한 default, alias, 이중 wire schema를 두지 않는다. 릴리스 안정화 뒤 호환성 정책이 필요해지면 별도 ADR로 도입한다.
6. 모바일 플랫폼 빌드는 필수 `app-worker` signoff와 분리한다. descriptor와 생성물 currentness, generated client와 실제 Worker service의 대표 경계, 의미 있는 domain mapper를 일반 테스트에서 검증하고, SwiftUI App/Unit/UI Test와 Tauri Android 빌드는 명시적인 `bun run mobile:ci`에서 검사한다.
7. iOS 릴리즈 명령에는 구현 선택 옵션이나 Tauri 롤백 경로를 두지 않는다. 실패한 iOS 릴리즈는 같은 native 구현의 수정 빌드를 더 높은 App Store build number로 배포해 복구한다.

## 오류와 복구 원칙

- 인증 폴링의 `authorization_pending`은 실패가 아니라 대기 상태다. `slow_down`은 다음 폴링 간격을 늘리고, `access_denied`와 `expired_token`은 새 로그인 시작이 필요한 종료 상태다.
- `401`은 저장된 access token을 폐기하고 로그인 화면으로 돌아가야 한다.
- 네트워크 오류와 `5xx`는 사용자 세션을 삭제하지 않으며 재시도 가능한 상태로 표시한다.
- 네이티브 앱에는 운영 API 주소를 하드코딩하지 않는다. 개발 scheme의 환경 변수 또는 이후 배포 설정에서 주입한다.

## Android 동등성

Android Tauri 앱은 계속 같은 사용자 기능을 제공하며, 공유 TypeScript generated Connect client와 같은 protobuf descriptor가 Android 경계도 함께 검증한다. 기존 Android 빌드는 명시적인 모바일 CI에서 확인한다. 이후 모바일 기능 PR은 기능 동등성 표의 Android와 iOS 열을 함께 갱신해야 한다.

## 결과

- SwiftUI Production scheme이 기존 TestFlight 앱을 같은 bundle ID로 인플레이스 업데이트한다.
- 서버 팀과 두 모바일 플랫폼이 사용하는 최소 데이터 형식과 오류 경계가 한 계약으로 고정된다.
- iOS 릴리즈는 SwiftUI 아카이브만 만들며 Tauri 구현을 선택할 수 없다.
- Android Tauri 회귀 빌드는 명시적인 모바일 CI로 계속 확인한다.
