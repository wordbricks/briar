# Briar Companion iOS/Android 기능 동등성

상태 값은 `제공`, `기반`, `계획`, `해당 없음`을 사용한다. 네이티브 iOS 열이 `제공`으로 바뀌는 PR은 Android 동작과 API 계약을 함께 검토해야 한다.

| 사용자 기능 | 기존 Tauri iOS | 기존 Tauri Android | 네이티브 SwiftUI iOS | 공유 계약/결정 |
| --- | --- | --- | --- | --- |
| 앱 실행 및 독립 설치 | 제공 | 제공 | 제공 | 개발 앱은 기존 iOS 앱과 다른 bundle ID 사용 |
| Device Authorization 로그인 | 제공 (`briar-mobile`) | 제공 (`briar-android`) | 제공 | `ASWebAuthenticationSession`, device code 시작/폴링과 4개 종료·대기 오류를 사용 |
| 현재 사용자 조회 | 제공 | 제공 | 제공 | `GET /me`, bearer token, `401` 시 Keychain을 비우고 재로그인 |
| 프로젝트 목록 조회 | 제공 | 제공 | 제공 | 사용자·조직·프로젝트 저장소가 선택 상태를 관리 |
| Tasks/Agents/Search/Inbox 앱 셸 | 제공 | 제공 | 제공 | Android의 기존 React 탭과 네이티브 iOS 읽기 탭을 유지 |
| 작업 목록·상태 필터·검색 | 제공 | 제공 | 제공 | All/Active/Attention/Completed 필터와 제목·설명·진행·결과 통합 검색 |
| 이슈 설명 및 결과 상세 | 제공 | 제공 | 제공 | dashboard snapshot/delta의 Markdown 설명, structured result, 리뷰 필드를 읽기 전용으로 사용 |
| 실행 진행 상황 | 제공 | 제공 | 제공 | snapshot/delta 공유 계약, 15초 polling, foreground·오프라인 복귀, cursor 만료 시 snapshot 복구 |
| 이벤트 및 증빙 | 제공 | 제공 | 제공 | 인증된 GET 경로만 사용하며 증빙 이미지도 기기 임시 미리보기로 다운로드 |
| 이슈 대화 및 첨부 | 제공 | 제공 | 제공 | 메시지·답글 전송과 Agent reply polling, 인증 다운로드·Quick Look, multipart 이미지·영상 업로드를 공유 |
| 이슈 생성·편집·삭제와 draft | 제공 | 제공 | 제공 | 제목·설명·우선순위·backlog/queued, 5개/파일당 20MB/전체 25MB 제한, 성공 전 draft 보존 |
| 의존성·실행 설정 | 제공 | 제공 | 제공 | 선행 이슈 DAG와 provider/model/effort 설정을 dashboard 및 공통 쓰기 API로 사용 |
| 실행·복구·검수 제어 | 제공 | 제공 | 제공 | 상태 이동, 즉시 실행, Worker 선택·재할당, retry/cancel, 결과 review와 requestId 멱등성을 공유 |
| 아이디어 문서·대화·이슈 계획 | 제공 | 제공 | 제공 | D1 아이디어 계약, 온라인 실행 워커, 모바일 대화/문서 전환 UI를 공유 |
| 알림 및 딥 링크 | 제공 | 제공 | 제공 | `briar-companion` 딥링크와 Universal Link(`/open/issues`, `/open/sessions`), Inbox 분류·읽음, polling 로컬 알림, app badge |
| Agent·Session 목록/상세 | 제공 | 제공 | 제공 | `GET /projects/{id}/agents`, `GET /projects/{id}/agent-sessions` 원격 snapshot 동기화 |
| 대체 앱 아이콘 | 제공 | 제공 | 제공 | purple/gray/pink/green alternate icons |
| 공유·클립보드 링크 | 제공 | 제공 | 제공 | Share Sheet와 이슈/세션 HTTPS 링크 복사 |
| 앱 설정/테마 | 제공 | 제공 | 제공 | system/light/dark를 로컬 저장하고 읽기 전용 권한 경계를 설정 화면에 명시 |
| 쓰기 요청 안전장치 | 제공 | 제공 | 제공 | 실행 단위 requestId와 진행 중 action gate로 재전송과 중복 탭을 방지하고 성공 후 snapshot을 갱신 |
| App/Unit/UI 자동 검증 | 해당 없음 | 해당 없음 | 제공 | 로그인→프로젝트→검색→상세, 대표 상태 필터, 오프라인 재시도 UI 테스트 포함 |
| 기존 릴리스 회귀 빌드 | 제공 | 제공 | 제공 | Tauri iOS/Android 빌드를 명시적 `mobile:ci`에서 검사 |
| 프로덕션 전환·롤백 | 제공 | 회귀 검증 | 기반 | 기본값은 Tauri이며 native Internal TestFlight 안정화 build ID가 기록된 뒤에만 프로덕션 기본값 전환을 허용하고, Tauri 소스는 1.3.0까지 보존 |

## 병합 기준

- 네이티브 iOS 기능은 Android에서 대응 기능이 이미 제공되는지 확인하고 표를 갱신한다.
- 서버 필드가 필요하면 먼저 OpenAPI, fixture, Worker 계약 테스트를 함께 변경한다.
- 읽기·쓰기 계약은 두 모바일 client ID에 공통이며 Android의 기존 React 경로도 같은 fixture와 `mobile:ci`로 회귀 검증한다.
- 기존 Tauri iOS/Android 릴리스 설정 변경은 네이티브 전환 PR과 분리한다.

## 세션 전환 경계

- 네이티브 iOS 세션은 기기 전용 Keychain 항목에 저장한다.
- 향후 프로덕션 bundle 전환으로 기존 앱 컨테이너가 이어지는 경우, Tauri가 남긴 `session.json`을 한 번 읽어 Keychain 저장이 성공한 뒤에만 평문 파일을 삭제한다.
- 독립 개발 bundle은 다른 앱의 sandbox에 접근하지 않는다. 따라서 현재 배포 중인 Tauri 앱의 세션이나 릴리스 경로를 변경하지 않는다.
- 프로덕션 네이티브 scheme만 기존 `app.briar.companion`을 사용하므로 인플레이스 업그레이드에서 같은 앱 컨테이너를 이어받는다. 마이그레이션 뒤에는 평문 토큰을 다시 만들지 않으므로 Tauri 롤백 사용자는 한 번 다시 로그인해야 할 수 있다.
