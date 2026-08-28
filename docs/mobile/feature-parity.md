# Briar Companion iOS/Android 기능 동등성

상태 값은 `제공`, `기반`, `계획`, `해당 없음`을 사용한다. 네이티브 iOS 열이 `제공`으로 바뀌는 PR은 Android 동작과 API 계약을 함께 검토해야 한다.

| 사용자 기능 | Tauri Android | SwiftUI iOS | 공유 계약/결정 |
| --- | --- | --- | --- |
| 앱 실행 및 독립 설치 | 제공 | 제공 | iOS 개발 scheme은 프로덕션 앱과 다른 bundle ID를 사용 |
| Device Authorization 로그인 | 제공 (`briar-android`) | 제공 (`briar-mobile`) | iOS는 `ASWebAuthenticationSession`, 두 플랫폼 모두 device code 시작/폴링과 4개 종료·대기 오류를 사용 |
| 현재 사용자 조회 | 제공 | 제공 | `GET /me`, bearer token, `401` 시 저장 세션을 비우고 재로그인 |
| 프로젝트 목록 조회 | 제공 | 제공 | 사용자·조직·프로젝트 저장소가 선택 상태를 관리 |
| Home/Tasks/DMs/Inbox 앱 셸 | 제공 | 제공 | Android React와 SwiftUI iOS에서 같은 4개 주요 탭을 유지 |
| DM 목록·검색·대화 생성 | 제공 | 제공 | 조직 채널 카탈로그의 `kind=dm`, 참가자, 최근 메시지, 읽지 않음 메타데이터를 사용하고 기존 채널 대화 읽기·쓰기를 재사용 |
| DM 대화 헤더 상대 표시·프로필 | 제공 | 제공 | 뒤로가기 옆에 상대 아바타·이름을 두고, 1:1은 탭하면 프로필 모달, 그룹은 참여자 드롭다운 후 프로필 모달을 연다 |
| 작업 목록·상태 필터·검색 | 제공 | 제공 | All/Active/Attention/Completed 필터와 제목·설명·진행·결과 통합 검색 |
| 이슈 설명 및 결과 상세 | 제공 | 제공 | dashboard snapshot/delta의 Markdown 설명, structured result, 리뷰 필드를 읽기 전용으로 사용 |
| 실행 진행 상황 | 제공 | 제공 | snapshot/delta 공유 계약, 15초 polling, foreground·오프라인 복귀, cursor 만료 시 snapshot 복구 |
| 이벤트 및 증빙 | 제공 | 제공 | 인증된 GET 경로만 사용하며 증빙 이미지는 두 앱의 상세 화면에 표시하고 원본 확대용 임시 파일로 다운로드 |
| 이슈 대화 및 첨부 | 제공 | 제공 | 이미지 첨부와 본문 인라인 이미지는 인증 다운로드로 표시하며, 비이미지 파일은 기존 미리보기를 유지한다. 메시지·답글, Agent reply polling, multipart 업로드를 공유하며 전송 실패 시 본문·멘션·첨부를 복원함 |
| 메시지 텍스트 범위 선택·복사 | 제공 | 제공 | iOS는 편집 불가 UITextView, Android는 메시지 본문에 `user-select: text`를 사용 |
| 채널·DM 스레드 진입 | 제공 | 제공 | 채널 답글 요약과 스레드 진입, DM 인라인 답글 동작을 공유 |
| 이슈 생성·편집·삭제와 draft | 제공 | 제공 | 제목·설명·우선순위·backlog/queued, 5개/파일당 20MB/전체 25MB 제한, 성공 전 draft 보존 |
| 이슈를 다른 프로젝트로 이동 | 제공 | 제공 | 동일 조직 내 대상 선택, 대화·첨부·활동 기록 이전, 실행 중 이슈 거부, 의존성 해제를 공유 |
| 의존성·실행 설정 | 제공 | 제공 | 선행 이슈 DAG와 provider/model/effort 설정을 dashboard 및 공통 쓰기 API로 사용 |
| 실행·복구·검수 제어 | 제공 | 제공 | 상태 이동, 즉시 실행, Worker 선택·재할당, retry/cancel, 결과 review와 checkpoint 정합성 검증을 공유 |
| 아이디어 문서·대화·이슈 계획 | 제공 | 제공 | D1 아이디어 계약, 온라인 실행 워커, 모바일 대화/문서 전환 UI를 공유 |
| 채널 Agent 실시간 활동 | 제공 | 제공 | 권한 확인 WebSocket과 휘발성 Durable Object를 공유하고 연결 실패 시 기존 입력 중 표시로 대체 |
| 알림 및 딥 링크 | 제공 | 제공 | `briar-companion` 딥링크, Universal Link, Inbox 읽음, WebSocket 알림, 복구 polling, app badge를 공유 |
| Agent·Session 목록/상세 | 제공 | 제공 | `GET /projects/{id}/agents`, `GET /projects/{id}/agent-sessions` 원격 snapshot 동기화 |
| 대체 앱 아이콘 | 제공 | 제공 | purple/gray/pink/green alternate icons |
| 공유·클립보드 링크 | 제공 | 제공 | 플랫폼 공유 UI와 이슈/세션 HTTPS 링크 복사 |
| 앱 설정/테마 | 제공 | 제공 | system/light/dark를 로컬 저장하고 읽기 전용 권한 경계를 설정 화면에 명시 |
| 쓰기 요청 안전장치 | 제공 | 제공 | 실행 단위 requestId와 진행 중 action gate로 재전송과 중복 탭을 방지하고 성공 후 snapshot을 갱신 |
| App/Unit/UI 자동 검증 | 해당 없음 | 제공 | iOS 로그인→프로젝트→검색→상세, 대표 상태 필터, 오프라인 재시도 UI 테스트 포함 |
| 플랫폼 회귀 빌드 | 제공 | 제공 | `mobile:ci`가 Tauri Android 빌드와 SwiftUI iOS App/Unit/UI 테스트를 검사 |
| 프로덕션 릴리즈 | 제공 | 제공 | Android는 Tauri 경로를 유지하고 iOS는 SwiftUI Production scheme만 사용 |

## 병합 기준

- 네이티브 iOS 기능은 Android에서 대응 기능이 이미 제공되는지 확인하고 표를 갱신한다.
- 서버 필드가 필요하면 `@briar/mobile-contracts`의 Effect Schema와 operation descriptor를 먼저 변경한다. OpenAPI와 Swift DTO/client는 여기서 생성한다.
- 읽기·쓰기 계약은 두 모바일 client ID에 공통이며, 생성물 currentness와 실제 Worker 라우트·클라이언트 decoder의 핵심 테스트 및 `mobile:ci`로 검증한다.
- Android Tauri 릴리스 설정을 변경할 때는 Android 회귀 빌드와 공통 계약을 함께 검증한다.

## 세션 전환 경계

- 네이티브 iOS 세션은 기기 전용 Keychain 항목에 저장한다.
- 프로덕션 업데이트에서 기존 앱 컨테이너가 이어지므로, Tauri가 남긴 `session.json`을 한 번 읽어 Keychain 저장이 성공한 뒤에만 평문 파일을 삭제한다.
- 독립 개발 bundle은 프로덕션 앱 sandbox에 접근하지 않는다.
- 프로덕션 scheme은 기존 `app.briar.companion`을 사용하므로 인플레이스 업그레이드에서 같은 앱 컨테이너를 이어받는다. 마이그레이션 뒤에는 평문 토큰을 다시 만들지 않으며 이후 iOS 릴리즈도 SwiftUI 구현만 사용한다.
