# Team 명칭 정리 계획

계층은 BR-6392 이후 **Workspace → Team → Project**다. Team이 저장소와 실행의
경계이고, Project는 Team 아래 계획 작업 묶음(`PlanningProject`,
`briar_planning_projects`)이다. 그런데 코드 대부분은 아직 Team을 `project`라고
부른다. 이 문서는 남은 정리 범위를 단계별로 기록한다. 1단계는 1.2.202에서
끝났고 2~4단계는 미착수다.

## 원칙

- 이름을 바꿀 때 별칭이나 숨은 호환 플래그를 남기지 않는다. 호환이 필요한
  곳은 아래 3단계처럼 **명시적 호환 창**을 두고, 창이 닫히는 릴리스를 문서에
  적는다.
- `project`가 하위 Project(계획 묶음)를 뜻하는 곳은 그대로 둔다.
  예: `briar issue update create --project`, `listTeamPlanningProjects`,
  `PlanningProject*`, 조직 agent context manifest의 `projects`.
- 각 단계는 독립적으로 릴리스 가능해야 한다. 한 단계 안에서도 영역별 PR로
  나누되, 같은 PR 안에서 이름이 반쯤만 바뀐 상태를 만들지 않는다.

## 1단계 (완료, 1.2.202): CLI 플래그 · 로컬 config · 문서

- `--project` → `--team`, `--project-id` → `--team-id`. 구 플래그는 삭제했다.
  `briar project` 별칭 명령군도 삭제했다.
- 워커 자식 프로세스 환경 변수 `BRIAR_PROJECT_ID` → `BRIAR_TEAM_ID`.
- 로컬 config 계약(`briar.local.v1`): `LocalConfig.projects` → `teams`,
  `LocalProjectConfig` → `LocalTeamConfig`, `LocalProjectLlmConfig` →
  `LocalTeamLlmConfig`. 필드 번호는 그대로다. CLI(`decodeLegacyConfigJson`)와
  데스크톱(`migrate_pre_protojson_local_config`) 모두 `projects` 키를 읽으면
  한 번 `teams`로 옮겨 다시 쓴다. 이 마이그레이션은 1.2.174 도메인 JSON
  마이그레이션과 같은 시점에 제거한다.
- Docker sandbox의 bootstrap payload, 상태 파일, report, 호스트 레지스트리도
  `teams`/`teamIds`를 쓴다.
- 데스크톱 Rust는 새 CLI 플래그와 생성 타입만 따라갔다. 파일명과 함수명
  (`project_config.rs`, `project_execution.rs`, `project_agent.rs`)은 2단계다.

## 2단계: 내부 식별자 (wire 변경 없음)

목표는 코드 안에서 Team을 뜻하는 식별자를 전부 Team으로 바꾸되, 프로토 필드,
HTTP 경로, D1 스키마는 건드리지 않는 것이다. 기계적이지만 양이 많다.
2026-09-05 기준 `project` 문자열 출현 수:

| 영역 | 파일 | 출현 |
| --- | --- | --- |
| `apps/briar/worker/src` | 304 | 11,066 |
| `apps/briar/src` (웹/데스크톱 UI) | 439 | 8,332 |
| `apps/briar/ios` (Swift) | 38 | 2,100 |
| `apps/briar/src-cli` | 79 | 1,916 |
| `apps/briar/src-tauri/src` (Rust) | 27 | 1,226 |

권장 순서와 PR 단위:

1. **CLI 내부** — `currentProject`, `ProjectConfig` 잔여 변수명, `projectId`
   지역 변수, `config-environment.ts`의 `selectProjectForApi` 등. 1단계에서
   플래그와 config 키만 바꿨으므로 변수명은 아직 `project`다.
2. **Rust 데스크톱** — 모듈명 `project_config` → `team_config`,
   `project_execution` → `team_execution`, `agent/project_agent` →
   `agent/team_agent`, Tauri command 이름(`connect_project` 류)과 IPC payload
   키. IPC 키는 웹 UI와 같은 PR에서 바꿔야 한다.
3. **웹/데스크톱 UI** — atom·hook·컴포넌트 이름과 라우트 파라미터.
   i18n 키(`en.ts` 기준 `project`를 포함한 키 138개)는 키 이름만 바꾸고 문구는
   #1547에서 이미 정리된 상태를 유지한다. `PlanningProject`용 키와 구분한다.
4. **Worker 내부** — 애플리케이션·리포지토리 모듈의 함수와 타입 이름. 프로토
   메시지 이름은 3단계까지 유지하므로 mapper 경계에서만 이름이 갈린다.
5. **iOS Companion** — Swift 뷰모델과 상태 이름. 생성된 `BriarContracts`는
   3단계 전까지 `projectId`를 유지한다.

검증은 각 영역의 기존 테스트로 충분하다. 이름만 바뀌므로 동작 테스트를 새로
쓰지 않는다. `bun run check`와 `bun run ci:local`이 게이트다.

## 3단계: 프로토 · API (호환 창 필요)

`briar.app.v1`, `briar.worker.v1`, `briar.realtime.v1`에서 Team을 뜻하는
`project_id` 필드 163개, `Project*` 메시지·RPC(`RegisterProjectExecutionWorker`,
`ProjectGitHubService`, `ProjectAgent*`, `ProjectChanged` 등)를 Team으로 바꾼다.
`team_id` 필드 25개는 이미 맞다.

호환이 문제다. 데스크톱·웹 앱은 Connect **JSON**을 쓰므로 필드 이름이 곧
wire 키다. 구버전 앱이 새 Worker에 `projectId`를 보내면 값이 버려진다. CLI의
worker-control 경로는 binary라 필드 번호만 지키면 된다.

방식:

1. Worker가 **두 이름을 함께 받는** 호환 창을 연다. 프로토에 새 필드
   `team_id`를 새 번호로 추가하고 `project_id`는 `deprecated = true`로 남긴다.
   요청 디코더는 둘 중 하나를 채택하고, 응답은 둘 다 채운다. 창을 여는
   릴리스와 닫는 릴리스를 이 문서에 기록한다(예: 1.2.2xx 열고 최소 두 정식
   릴리스 뒤 닫음).
2. 클라이언트(앱, CLI, iOS)는 같은 릴리스에서 `team_id`만 보내도록 바꾼다.
   iOS는 앱스토어 심사 지연이 있으므로 창 길이를 iOS 배포 완료 기준으로 잡는다.
3. 창이 닫히면 `project_id` 필드와 `Project*` 메시지 이름을 제거·개명하고
   contract fingerprint를 갱신한다. 이때 CLI·Worker는 같은 릴리스로 배포한다
   (지금도 프로토 변경은 그렇게 한다).
4. 공개 URL `/open/issues/<teamId>/<issueId>`, `/open/sessions/*`는 경로에
   이름이 없어 영향이 없다. 앱 내부 라우트(`/projects/...`)가 있으면 2단계에서
   바꾼다.
5. Slack/Linear/GitHub 통합의 외부 payload 키에 `project`가 노출되는지 3단계
   착수 전에 목록화한다.

## 4단계: D1 스키마

Team 의미의 테이블 15개: `briar_project_agent_schedule_runs`,
`briar_project_agent_schedules`, `briar_project_agent_session_*` 4개,
`briar_project_agent_sessions`, `briar_project_agent_task_completion_receipts`,
`briar_project_agent_task_jobs`, `briar_project_agent_tokens`,
`briar_project_execution_worker_allowlist`,
`briar_project_execution_worker_policies`, `briar_project_members`,
`briar_project_settings`, 그리고 `briar_teams`의 `project_id` 류 컬럼.

- SQLite/D1은 `ALTER TABLE ... RENAME TO`가 가능하지만 FK 참조, 트리거, 인덱스
  이름은 따로 다시 만들어야 한다. 이 저장소는 트리거로 불변 조건을 강제하므로
  마이그레이션 한 파일에서 테이블·인덱스·트리거를 한꺼번에 재정의한다.
- 프로덕션 마이그레이션은 `bun run worker:deploy`가 D1 lease를 잡고 순서대로
  적용한다. 테이블 개명은 되돌리기 어려우므로 3단계가 끝나 이름이 안정된 뒤
  마지막에 한다.
- `bun run d1:snapshot`으로 스키마 스냅샷을 갱신하고 `test:d1:migrations`가
  이를 검사한다.
- 컬럼명은 테이블과 같은 PR에서 바꾸지 않는다. 테이블 개명 → 컬럼 개명 순으로
  두 릴리스에 나눈다.

## 하지 않는 것

- `briar_planning_projects`, `PlanningProject*`, `issue update create --project`
  는 진짜 Project이므로 유지한다.
- Google Vertex AI `project_id`(GCP 프로젝트)와 Antigravity 프로젝트 ID는 외부
  개념이라 유지한다.
