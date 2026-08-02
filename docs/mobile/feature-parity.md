# Briar Companion iOS/Android 기능 동등성

상태 값은 `제공`, `기반`, `계획`, `해당 없음`을 사용한다. 네이티브 iOS 열이 `제공`으로 바뀌는 PR은 Android 동작과 API 계약을 함께 검토해야 한다.

| 사용자 기능 | 기존 Tauri iOS | 기존 Tauri Android | 네이티브 SwiftUI iOS | 공유 계약/결정 |
| --- | --- | --- | --- | --- |
| 앱 실행 및 독립 설치 | 제공 | 제공 | 기반 | 개발 앱은 기존 iOS 앱과 다른 bundle ID 사용 |
| Device Authorization 로그인 | 제공 (`briar-mobile`) | 제공 (`briar-android`) | 계획 | device code 시작/폴링 응답과 4개 종료·대기 오류를 OpenAPI에 고정 |
| 현재 사용자 조회 | 제공 | 제공 | 계획 | `GET /me`, bearer token, `401` 시 재로그인 |
| 프로젝트 목록 조회 | 제공 | 제공 | 계획 | `GET /projects`, 조직·역할·아이콘 필드 포함 |
| 이슈 목록 및 상세 | 제공 | 제공 | 계획 | 다음 계약 확장 전에는 네이티브 앱에서 호출하지 않음 |
| 실행 진행 상황 | 제공 | 제공 | 계획 | dashboard/delta 계약을 이후 단계에서 추가 |
| 이슈 대화 및 첨부 | 제공 | 제공 | 계획 | 메시지/첨부 생명주기를 이후 단계에서 추가 |
| 알림 및 딥 링크 | 제공 | 제공 | 계획 | 플랫폼별 권한·복구 동작을 별도 ADR에서 정의 |
| 앱 설정/테마 | 제공 | 제공 | 계획 | 로컬 설정은 플랫폼별 저장, 서버 설정만 계약화 |
| App/Unit/UI 자동 검증 | 해당 없음 | 해당 없음 | 기반 | SwiftUI 3개 target과 개발 scheme을 CI에서 실행 |
| 기존 릴리스 회귀 빌드 | 제공 | 제공 | 제공 | Tauri iOS/Android 빌드를 모바일 CI에서 계속 검사 |

## 병합 기준

- 네이티브 iOS 기능은 Android에서 대응 기능이 이미 제공되는지 확인하고 표를 갱신한다.
- 서버 필드가 필요하면 먼저 OpenAPI, fixture, Worker 계약 테스트를 함께 변경한다.
- 기존 Tauri iOS/Android 릴리스 설정 변경은 네이티브 전환 PR과 분리한다.
