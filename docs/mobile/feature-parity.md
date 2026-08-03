# Briar Companion iOS/Android 기능 동등성

상태 값은 `제공`, `기반`, `계획`, `해당 없음`을 사용한다. 네이티브 iOS 열이 `제공`으로 바뀌는 PR은 Android 동작과 API 계약을 함께 검토해야 한다.

| 사용자 기능 | 기존 Tauri iOS | 기존 Tauri Android | 네이티브 SwiftUI iOS | 공유 계약/결정 |
| --- | --- | --- | --- | --- |
| 앱 실행 및 독립 설치 | 제공 | 제공 | 기반 | 개발 앱은 기존 iOS 앱과 다른 bundle ID 사용 |
| Device Authorization 로그인 | 제공 (`briar-mobile`) | 제공 (`briar-android`) | 제공 | `ASWebAuthenticationSession`, device code 시작/폴링과 4개 종료·대기 오류를 사용 |
| 현재 사용자 조회 | 제공 | 제공 | 제공 | `GET /me`, bearer token, `401` 시 Keychain을 비우고 재로그인 |
| 프로젝트 목록 조회 | 제공 | 제공 | 제공 | 사용자·조직·프로젝트 저장소가 선택 상태를 관리 |
| 이슈 목록 및 상세 | 제공 | 제공 | 계획 | 다음 계약 확장 전에는 네이티브 앱에서 호출하지 않음 |
| 실행 진행 상황 | 제공 | 제공 | 제공 | snapshot/delta 공유 계약, 15초 polling, foreground·오프라인 복귀, cursor 만료 시 snapshot 복구 |
| 이슈 대화 및 첨부 | 제공 | 제공 | 계획 | 메시지/첨부 생명주기를 이후 단계에서 추가 |
| 아이디어 문서·대화·이슈 계획 | 제공 | 제공 | 제공 | D1 아이디어 계약, 온라인 실행 워커, 모바일 대화/문서 전환 UI를 공유 |
| 알림 및 딥 링크 | 제공 | 제공 | 계획 | 플랫폼별 권한·복구 동작을 별도 ADR에서 정의 |
| 앱 설정/테마 | 제공 | 제공 | 계획 | 로컬 설정은 플랫폼별 저장, 서버 설정만 계약화 |
| App/Unit/UI 자동 검증 | 해당 없음 | 해당 없음 | 기반 | SwiftUI 3개 target과 개발 scheme을 명시적 `mobile:ci`에서 실행 |
| 기존 릴리스 회귀 빌드 | 제공 | 제공 | 제공 | Tauri iOS/Android 빌드를 명시적 `mobile:ci`에서 검사 |

## 병합 기준

- 네이티브 iOS 기능은 Android에서 대응 기능이 이미 제공되는지 확인하고 표를 갱신한다.
- 서버 필드가 필요하면 먼저 OpenAPI, fixture, Worker 계약 테스트를 함께 변경한다.
- 기존 Tauri iOS/Android 릴리스 설정 변경은 네이티브 전환 PR과 분리한다.

## 세션 전환 경계

- 네이티브 iOS 세션은 기기 전용 Keychain 항목에 저장한다.
- 향후 프로덕션 bundle 전환으로 기존 앱 컨테이너가 이어지는 경우, Tauri가 남긴 `session.json`을 한 번 읽어 Keychain 저장이 성공한 뒤에만 평문 파일을 삭제한다.
- 독립 개발 bundle은 다른 앱의 sandbox에 접근하지 않는다. 따라서 현재 배포 중인 Tauri 앱의 세션이나 릴리스 경로를 변경하지 않는다.
