# 도메인 atom 상태 분리와 App / useBriar 모듈화

Status: proposed. Updated 2026-09-03.

기준 커밋 `66dd07b1`(분석 시점). 아래 줄 번호는 이 커밋 기준이며 두 파일 모두 변경이
잦으므로, 각 단계 착수 시 심볼 이름으로 다시 찾는다.

### 기준 갱신 (2026-09-03, main `b71f68f3`)

분석 이후 main에 네 커밋(#1574, #1576, #1577, #1578)이 들어와 App.tsx는 5,241줄,
useBriar.ts는 4,830줄이 되었다. 계획에 영향을 주는 변경:

- #1576: `useBriar`에 프로젝트별 대시보드 LRU 캐시(`dashboardCache`, 8개)와
  `dashboardStale` 플래그가 생겼고, 프로젝트 전환 시 캐시가 있으면 `null` 대신
  캐시를 커밋한다. 응답 커밋 지점에 `activeProjectIdRef.current !== projectId`
  가드가 추가되었다. Phase 2의 엔티티 저장소가 이 캐시를 대체한다. 캐시가 지키는
  불변식(커서는 payload에 실림, 복원 후 다음 fetch는 snapshot으로 승격, 토큰 변경
  시 전체 삭제, 조직 변경 시 prune)은 `useBriar.dashboard-cache.test.tsx`가
  검증하므로 그 테스트를 엔티티/로더 테스트로 이전한다.
- #1576: 린트 규칙 `anti-slop/no-module-mocking`이 모듈 모킹을 금지한다. useBriar는
  `UseBriarOptions.dataSources`(`BriarDataSources`)로 읽기 경로를 주입받는다. 새
  `state/` 모듈도 같은 방식으로 데이터 소스를 주입받아 인메모리 구현으로 테스트한다.
- #1577: App.tsx의 뷰 컴포넌트가 `lazy()` + `Suspense`로 코드 스플리팅되었다.
  Phase 5 셸 분리 시 lazy 경계를 유지한다.
- #1578: 런치 인트로가 별도 엔트리(`intro-main.tsx`)로 분리되었다. `main.tsx`의
  `RegistryProvider` 위치를 다시 확인한다.

### 기준 갱신 (2026-09-04, Phase 1 `#1583` 이후)

Phase 1을 구현하며 확인한, 이후 단계에 영향을 주는 사실:

- `RegistryProvider`(`@effect/atom-react`)는 레지스트리를 **직접 만들며** 기존
  레지스트리를 받는 prop이 없다. 테스트가 atom을 직접 쓰려면
  `RegistryContext.Provider value={createTestRegistry()}`를 쓴다. 프로바이더가
  아예 없으면 컴포넌트는 **모듈 전역 기본 레지스트리**로 떨어져 테스트 사이에
  상태가 샌다. atom을 읽는 훅·컴포넌트를 렌더하는 기존 테스트는 전부 프로바이더로
  감싸야 한다.
- `registry.set`에는 updater 함수 오버로드가 없다. 함수형 갱신은
  `registry.update(atom, f)`다. (`useAtom`이 돌려주는 setter는 React 헬퍼가
  풀어 주므로 둘 다 받는다.)
- `registry.subscribe(atom, f)`는 `{ immediate: true }` 없이는 파생 atom의
  의존 그래프를 만들지 않아 **알림이 오지 않는다.** 파생 atom 단위 테스트는
  `immediate: true`를 주거나 먼저 한 번 `get`해야 한다.
- `Atom.batch`는 가장 바깥 배치가 끝나는 시점에 알림을 **동기로** 흘린다.
- `main.tsx`의 `RegistryProvider`가 `defaultIdleTTL`을 넘기지 않는 것을 확인했다.
  keepAlive가 아닌 atom은 구독자가 0이 되는 즉시 노드 제거가 예약되므로, 장수
  atom의 `Atom.keepAlive`는 선택이 아니라 필수다.
- Phase 1이 "옮길 수 있다"고 본 액션 중 `addOrganization`, `renameOrganization`,
  `selectOrganization`, `changeTeam*` 3종, `logout`, `deleteAccount`,
  `removePlanningProject`은 실제로는 `dashboard` / `health` /
  `connectedTeamIds`도 함께 쓴다. 주입 콜백(`applyOrganizationSwitch`,
  `applyTeamToDashboard`, `renameDashboardOrganization`, `resetTeamViews`,
  `clearSignedOutViews`, `readDashboardTeamId`, `countDashboardIssues`,
  `movePlanningProjectIssues`)으로 분리했으니, Phase 2는 엔티티 저장소를 넣으면서
  이 콜백들을 지우는 것을 완료 조건에 넣는다.
- `useBriar()` 호출부는 `App.tsx` 한 곳뿐이라 모듈 싱글턴 atom이 안전하다.
  프로젝트 창은 별도 브라우저 창이므로 레지스트리도 별도다. 반대로
  `lockedProjectId`(`readTeamWindowProjectId()`)는 `window.location.search`에서
  읽는 창 단위 상수이므로 Phase 4 이후 `state/platform.ts`류 상수로 다뤄도 된다.
- `briar.error`는 세션 오류와 `localProjectInventoryError`(workspace, Phase 3)의
  합이다. Phase 3이 workspace atom을 만들 때까지 파사드가 이 합을 유지한다.

## 목표

1. `apps/briar/src/hooks/useBriar.ts`(4,668줄)와 `apps/briar/src/App.tsx`(5,116줄)가
   소유한 상태를 **id로 정규화된 단일 클라이언트 모델**로 옮기고, Effect
   Atom(`effect/unstable/reactivity/Atom` + `@effect/atom-react`)을 구독 원시로
   쓴다.
2. 각 뷰가 엔티티 또는 셀렉터 단위로 구독하게 해서, 대시보드 델타 틱이나 채널
   카탈로그 갱신이 App 셸 전체를 리렌더하지 않게 한다.
3. 델타 폴링과 실시간 이벤트가 하나의 진입점으로 모델을 갱신하게 하고, 모델을
   로컬에 영속화해 부팅 즉시 렌더한다.
4. `App.tsx`는 상태 소유자가 아닌 조립 레이어로 줄이고, `useBriar.ts`는 최종적으로
   삭제한다.
5. 모든 단계는 동작 변화 없이 독립 PR로 머지 가능해야 한다. 두 파일은 최근 두 달간
   각각 42회, 24회 커밋된 고변경 파일이므로 장기 브랜치를 피한다.

비목표: 라우팅 방식 변경(뷰 언마운트 정책), `useInbox` / `useAutoHuntSessions` /
`useChannelConversation`의 전환(동일 패턴으로 후속 진행), 서버 API 변경, 오프라인
우선과 멀티 디바이스 충돌 해결.

## 현재 구조 요약

| 항목 | useBriar.ts | App.tsx |
|---|---|---|
| useState | 29 | 18 |
| useRef | 19 | 5 |
| useEffect | 13 | 32 |
| useCallback | 84 | 33 |
| 상태 키 | 반환 객체 약 110키 | `briar.x` 형태로 107키 소비 |

핵심 문제:

- `useBriar()`가 매 렌더 새 객체를 반환하고(useMemo 0개) App이 이를 통째로
  소비하므로, 어떤 상태가 바뀌어도 App과 프롭으로 연결된 모든 뷰가 리렌더된다.
- 클라이언트 모델이 팀 단위 `DashboardPayload` 덩어리라 정규화되어 있지 않다. 런
  하나를 찾으려면 배열을 훑어야 하고, 실시간 이벤트로 런 하나만 패치하기 어렵다.
- 이슈/런 액션 프롭 블록(약 60개)이 `RunPage`(3535–3629), 데스크톱
  `HuntDashboard`(4461–4548), 컴패니언 `HuntDashboard`(4833–4911) 세 곳에
  중복된다.
- 이슈 콜백 약 25개가 null 가드 목적으로만 `dashboard` 전체를 의존성에 넣어 폴링
  틱마다 재생성된다.
- 스테일 클로저 회피용 ref 6개(`activeProjectIdRef`, `dashboardRef`,
  `loginAttempt`, `reconnectRequest`, `healthRequest`,
  `dashboardRequestGeneration`)와 렌더 단계 ref 대입(useBriar.ts:480)이 있다.
- `setDashboard`(useBriar.ts:512–526)는 단순 setter가 아니라 진행 중 요청 취소와
  커서 갱신까지 수행하는 암묵 계약이다.
- 낙관 갱신이 액션마다 수작업이라 롤백 규칙이 제각각이다.
- 영속화가 없어 부팅 게이트가 세션, 조직, 대시보드 요청이 모두 끝날 때까지 로고만
  보여준다.
- App.tsx는 컴포넌트 하나에 채널 카탈로그/실시간(342–544), 상태 트레이(661–773),
  내비게이션 조정 effect 6개(853–1237), 딥링크(1328–1592), 커맨드 팔레트 항목
  구성(2824–3450), 키보드 바인딩(2595–2822), 인박스 상세 렌더러(3475–3747),
  데스크톱 셸(3832–4607), 컴패니언 셸(4609–4932), 다이얼로그 레이어(4934–5115)를
  인라인으로 담고 있다.

이미 갖춰진 기반:

- `main.tsx`에 `RegistryProvider`가 있고, `lib/inbox-selection.ts` +
  `components/InboxSelectionBoundary.tsx`가 "atom은 모듈에, 읽기는 경계
  컴포넌트에서, App은 쓰기만" 패턴의 선례다. 해당 테스트는 셸 렌더 횟수를 직접
  검증한다.
- 커서 기반 델타 갱신과 HTTP 410 폴백(useBriar 615–688)은 Linear의 `lastSyncId`와
  같은 개념이다. `lib/dashboard-sync.ts`의 `mergeDashboardDelta`는 엔티티 단위로
  참조를 보존하며 병합한다.
- 실시간 transport 세 종류(`lib/channel-realtime.ts`,
  `lib/issue-activity-realtime.ts`, `lib/agent-activity-realtime.ts`)가 있다.
- `dashboard-polling.ts`, `active-organization.ts`, `default-organization.ts`,
  `session-restore.ts`, `team-agent-schedule-runner.ts` 등 순수 로직이 이미
  `lib/`에 있어 새 레이어가 그대로 재사용한다.

## 참고 아키텍처: Slack과 Linear

**Linear.** 이슈, 팀, 코멘트 같은 엔티티가 MobX observable 모델이고, 모든 모델은
uuid로 찾는 Object Pool 하나에 들어간다. 부팅 시 IndexedDB에서 풀을 하이드레이션하고,
서버와는 `lastSyncId` 기준 델타로 동기화한다. 로컬 쓰기는 즉시 풀에 반영되고
트랜잭션 큐로 서버에 전송된다. 뷰는 MobX observer라 읽은 속성만 자동 구독한다.

**Slack.** 워크스페이스마다 Redux store 하나에 데이터, 연결 상태, WebSocket까지
넣고, 거의 모든 것을 action과 thunk로 모델링한다. WebSocket 이벤트가 store를
갱신하고 뷰는 셀렉터로 구독한다. 채널 히스토리는 lazy-load하되 자주 보는 채널부터
프리로드하고, 영속화한 Redux store와 Service Worker로 1초 미만 부팅을 만들었다.

두 방식의 공통점이 이 계획의 뼈대다.

1. id로 정규화된 단일 클라이언트 모델
2. 델타와 실시간 이벤트가 그 모델을 갱신하는 하나의 진입점
3. 뷰는 엔티티 또는 셀렉터 단위로 구독
4. 모델을 로컬에 영속화해 부팅 즉시 렌더

Atom은 3번의 도구다. 1, 2, 4번은 데이터 모델 결정이고 체감 성능의 대부분을 만든다.

### 반응성 레이어 선택

| 선택지 | 장점 | 단점 | 판단 |
|---|---|---|---|
| Effect Atom + 정규화 엔티티 | 이미 설치됨. Effect Schema, Registry 테스트와 일치. `Atom.family`가 셀렉터 역할 | 정규화는 수작업. `Object.is` 등가라 참조 보존 규율 필요 | **채택** |
| MobX 객체 그래프 (Linear 그대로) | 읽은 속성만 자동 구독. 관계 탐색이 편함 | 새 의존성. Effect Atom과 반응성 시스템 두 개 공존. 클래스 모델 도입은 빅뱅에 가까움 | 비채택 |
| Redux Toolkit + reselect (Slack 그대로) | `createEntityAdapter`로 정규화가 쉬움 | 새 의존성과 보일러플레이트. Effect와 이중화 | 비채택 |
| TanStack Query | 키 단위 구독, 로딩과 재시도 내장 | 커서 델타 하나로 여러 엔티티를 갱신하는 모델과 맞지 않음. 정규화 없음 | 비채택 |
| 전용 sync engine (Replicache, Zero 등) | 오프라인과 충돌 해결까지 해결 | 서버 측 변경 필요. 현재 목표에 과함 | 후속 검토 |

Effect Atom을 고르는 이유는 이미 코드베이스에 있고 Effect 스택과 일관되며,
`Atom.family`와 `Atom.map`으로 Slack의 셀렉터와 Linear의 풀 조회를 그대로 표현할 수
있기 때문이다. `Atom.make((get) => …)`의 자동 의존성 추적은 MobX computed와 같은
역할을 한다.

참고 자료:

- [Linear's sync engine architecture](https://www.fujimon.com/blog/linear-sync-engine)
- [reverse-linear-sync-engine](https://github.com/wzhudev/reverse-linear-sync-engine)
- [When a rewrite isn't: rebuilding Slack on the desktop](https://slack.engineering/rebuilding-slack-on-the-desktop/)
- [Making Slack Faster By Being Lazy](https://slack.engineering/making-slack-faster-by-being-lazy/)
- [Service Workers at Slack](https://slack.engineering/service-workers-at-slack-our-quest-for-faster-boot-times-and-offline-support/)

## 설계 원칙

### 정규화된 단일 클라이언트 모델

- 런, 팀, 워커, 멤버, 조직 프로바이더, 채널은 `state/entities/`에 `Map<id, T>`
  atom으로 둔다. 조회는 `runAtom(id)` 같은 `Atom.family`, 목록은
  `teamRunIdsAtom(teamId)` 같은 인덱스 파생 atom이다.
- `DashboardPayload`와 `DashboardDeltaPayload`는 서버 wire 형식으로만 남는다.
  클라이언트는 이를 받자마자 엔티티로 풀어 넣는다.
- 팀 단위지만 엔티티가 아닌 값(settings, executionPolicy, notifications, cursor)은
  `state/team/`의 팀별 family로 둔다.
- 엔티티 병합은 참조를 보존한다. `mergeDashboardDelta`의 `sameValue` 로직을
  `entities/upsert.ts`로 옮겨 모든 엔티티에 같은 규칙을 적용한다. 그래야 `Object.is`
  기반 알림이 실제 바뀐 엔티티에만 간다.

### 동기화 진입점은 하나

- 스냅샷, 델타, 실시간 이벤트 세 종류 모두 `applySyncEvent(registry, event)`를
  거친다. Linear의 sync packet 적용, Slack의 WebSocket → store와 같은 구조다.
- 한 이벤트가 만드는 갱신은 `Atom.batch`로 묶어 구독자에게 한 번만 알린다.
- 팀별 커서와 generation 가드는 `state/sync/loader.ts`가 소유한다. `setDashboard`의
  암묵 계약(요청 취소 + 커서 갱신)은 여기서 명시적 API가 된다.

### 상태는 atom, 부수효과는 hook, 액션은 registry-bound 함수

- 상태: `Atom.make(initial)`(writable). 엔티티 맵과 세션 수명 atom은 반드시
  `Atom.keepAlive`를 건다. 현재 `RegistryProvider`가 `defaultIdleTTL` 없이
  마운트되어 마지막 구독자가 사라지면 atom이 즉시 폐기되기 때문이다. 팀 전환으로
  구독자가 0이 되어도 데이터는 남아야 한다.
- 파생: `Atom.map`, `Atom.family`, `Atom.make((get) => …)`.
  `useAtomValue(atom, selector)`는 selector 아이덴티티로 파생 atom을 만들므로
  selector는 모듈 스코프에 둔다. id 배열처럼 새 배열을 만드는 파생은
  `Atom.withEquality(shallowArrayEqual)`을 건다.
- 부수효과(부트스트랩, 동기화, 리스너): 도메인 hook으로 옮기고
  `components/app/AppEffects.tsx`의 null 컴포넌트에서 마운트한다. 순수 구독형은
  마지막 단계에서 `get.addFinalizer` 기반 atom으로 바꿔 구독자가 없으면 자동
  해제되게 한다.
- 액션: `createXxxActions(registry)`가 안정적인 함수 묶음을 반환한다. 최신 상태는
  `registry.get(atom)`으로 읽으므로 dep 배열과 ref가 필요 없다. 서버 쓰기는
  `state/sync/optimistic.ts`의 공통 헬퍼로 낙관 적용, 커밋, 롤백을 통일한다.
  `Atom.fn` + `AsyncResult`는 기존 Promise 호출 계약을 유지하기 위해 1차 범위에서
  제외한다.

### 루트 3종은 읽기 전용 의존

`tokenAtom`, `activeTeamIdAtom`, `connectedTeamIdsAtom`는 거의 모든 도메인이 읽는다.
다른 도메인은 이를 `get()`으로 읽기만 하고 쓰지 않는다.

### 팀 전환은 캐시를 버리지 않는다

`selectProject`(1431–1464)처럼 `setDashboard(null)`, `setHealth(null)`을 나열하는
대신, 엔티티는 그대로 두고 `activeTeamIdAtom`만 바꾼다. 팀별 family를 읽는 뷰는
자동으로 다른 팀의 값을 보고, `useTeamSync`는 새 팀의 커서로 백그라운드 델타를
돈다. 명령형 리셋이 불가피한 곳(`addOrganization`, `acceptInvitation`, 로그아웃)은
`Atom.batch` 안에서 한 번에 처리한다.

### 스트랭글러 방식

`useBriar()`를 파사드로 유지한다. 내부 `useState`를 `useAtom`으로 바꾸고,
`dashboard`는 엔티티에서 재조립한 파생 atom(`dashboardViewAtom(teamId)`)으로
돌려주면 반환 형태는 그대로라 App은 당장 바뀌지 않는다. 뷰를 하나씩 직접 구독으로
전환하고, 마지막에 파사드와 `briar.` 네임스페이스를 삭제한다. 파사드가 남아 있는
동안 App 자체의 리렌더는 줄지 않으므로, 각 단계의 성과는 "파사드에서 제거된 키
수"와 "직접 구독으로 전환된 뷰 수"로 측정한다.

## 도메인 경계

| 도메인 | 소유 상태 | 현재 위치 |
|---|---|---|
| session | user, token, restoringSession, loading, loginCode, error | useBriar 361–436 |
| organization | organizations, activeOrganizationId | useBriar 391–415 |
| team | activeTeamId, 조직별 팀 id 인덱스, teamConnection, isCreatingTeam, deletingTeamId, 팀별 settings / executionPolicy / notifications family | useBriar 363–446, 428 |
| planning | planningProjects | useBriar 366 |
| entities | runs, teams, workers, members, organizationProviders, channels를 id 기준 Map으로. family 조회와 인덱스 파생 | useBriar 428(dashboard.runs 등), App 342 |
| sync | 팀별 cursor / generatedAt, 스냅샷·델타 로더, `applySyncEvent`, 실시간 transport 수렴, 낙관 갱신 헬퍼 | useBriar 495–510, 615–688, 811–816; App 426–523; lib/*-realtime.ts |
| issues | pending mutation(create / update / delete / recover), recoveryError | useBriar 443–457 |
| run-detail | issueMessages / runEvidence / runEvents(runId별), 멱등 요청 id | useBriar 448–456, 493–494 |
| workspace | connectedTeamIds, localInventoryError, health, teamReadiness | useBriar 425–473 |
| workflow | 상태 없음. 액션과 자동 생성 effect | useBriar 2333–2509 |
| integrations | velen, linear import | useBriar 458, 2511 이후 |
| channels | activeChannelId, requested*, viewing*, catalog snapshot. 채널 엔티티 자체는 entities | App 345–380 |
| navigation | settingsTarget, requestedRun*, issueListRequestKey, agentListRequestKey, requestedSessionId, companionPage / Status | App 807–851, 1344–1383 |
| dialogs / layout | issue dialog, planning dialog, quick start, dispatch, repository setup, sidebar / palette / history / shortcuts open 상태 | App 784–791, 1357–1379, 1716 |
| persistence | 엔티티 맵 + 커서 스냅샷, 하이드레이션, 스키마 버전 | 신규 |

## 디렉터리 구성

```
apps/briar/src/state/
  registry.ts                useRegistry(), createTestRegistry()
  platform.ts                demoMode / companionMode / webMode / remoteMode (useBriar 234–240)
  demo-fixtures.ts           demoUser, demoOrganization, initialDemo* (useBriar 241–337)
  inbox-selection.ts         lib/inbox-selection.ts 이동
  entities/     runs.ts  teams.ts  workers.ts  members.ts  providers.ts  channels.ts  upsert.ts
  sync/         events.ts  apply.ts  loader.ts  optimistic.ts  useTeamSync.ts
  persistence/  snapshot.ts  useHydration.ts
  session/      atoms.ts  actions.ts  useSessionBootstrap.ts
  organization/ atoms.ts  actions.ts
  team/         atoms.ts  actions.ts
  planning/     atoms.ts  actions.ts  usePlanningProjectsSync.ts
  issues/       atoms.ts  actions.ts
  run-detail/   atoms.ts  actions.ts
  workspace/    atoms.ts  actions.ts  useWorkspaceSync.ts
  workflow/     actions.ts  useWorkflowAutoGeneration.ts
  integrations/ atoms.ts  actions.ts
  channels/     atoms.ts  actions.ts  useChannelCatalogSync.ts
  navigation/   atoms.ts
  dialogs/      atoms.ts
apps/briar/src/components/app/
  AppEffects.tsx          도메인 effect hook을 마운트하는 null 컴포넌트
  AuthGate.tsx            restoringSession / invitation / onboarding / login / first-org 분기 (App 3749–3830)
  DesktopShell.tsx        App 3832–4607
  CompanionShell.tsx      App 4609–4932
  AppDialogs.tsx          App 4934–5115
  InboxDetailContent.tsx  App 3475–3747
  AppSettingsSidebar.tsx  App 3451–3474
apps/briar/src/hooks/
  useStatusTray.ts            App 661–773
  useCommandPaletteItems.ts   App 2824–3450
  useAppShortcuts.ts          App 2595–2822
  useAppNavigation.ts         App 819–1237 (한 덩어리로)
  useDeepLinks.ts             App 1328–1592
  useBriar.ts                 파사드. Phase 7에서 삭제
```

`lib/`는 이미 200개가 넘는 평면 파일이라 상태 모듈은 `state/`로 분리한다. 각
도메인 폴더는 `atoms.ts`(상태와 파생), `actions.ts`(registry-bound 액션),
`use*.ts`(부수효과 hook), 그리고 같은 폴더의 테스트로 구성한다.

## 코드 패턴

### 엔티티와 셀렉터

```ts
// state/entities/runs.ts
import * as Atom from "effect/unstable/reactivity/Atom";

export const runsByIdAtom = Atom.make<ReadonlyMap<string, HuntRun>>(new Map()).pipe(
  Atom.keepAlive,
  Atom.withLabel("entities/runs"),
);

export const runAtom = Atom.family((runId: string) =>
  Atom.map(runsByIdAtom, (runs) => runs.get(runId) ?? null),
);

export const teamRunIdsAtom = Atom.family((teamId: string) =>
  Atom.make((get) => orderedRunIds(get(runsByIdAtom), teamId)).pipe(
    Atom.withEquality(shallowArrayEqual),
  ),
);
```

`upsert.ts`가 같은 내용의 엔티티는 기존 참조를 돌려주므로, 델타 틱에서 런이 바뀌지
않으면 `runAtom(runId)` 구독자는 알림을 받지 않고, 런 하나가 바뀌면 그 구독자만
리렌더된다. 목록 뷰는 id 배열만 구독하므로 런 내용이 바뀌어도 목록 자체는
리렌더되지 않는다.

### 동기화 진입점

```ts
// state/sync/events.ts
export type SyncEvent =
  | { kind: "team-snapshot"; teamId: string; payload: DashboardPayload }
  | { kind: "team-delta"; teamId: string; payload: DashboardDeltaPayload }
  | { kind: "run-changed"; run: HuntRun }
  | { kind: "run-deleted"; teamId: string; runId: string }
  | { kind: "channel-changed"; channel: ChannelSummary };

// state/sync/apply.ts
export function applySyncEvent(registry: AtomRegistry, event: SyncEvent) {
  Atom.batch(() => {
    switch (event.kind) {
      case "team-delta": {
        const { runs, deletedRunIds, workers, members, cursor } = event.payload;
        registry.update(runsByIdAtom, (map) => upsertMany(map, runs, deletedRunIds));
        registry.update(workersByIdAtom, (map) => upsertMany(map, workers));
        if (members) registry.update(membersByIdAtom, (map) => upsertMany(map, members));
        if (event.payload.settings) registry.set(teamSettingsAtom(event.teamId), event.payload.settings);
        registry.set(teamCursorAtom(event.teamId), cursor);
        return;
      }
      case "run-changed":
        registry.update(runsByIdAtom, (map) => upsertMany(map, [event.run]));
        return;
      // …
    }
  });
}
```

델타 폴링(`useTeamSync`), 실시간 transport 세 종류, 액션의 서버 응답이 모두 이
함수를 부른다. 병합 규칙이 한 곳에 있으므로 테스트도 한 곳이다.

### 낙관 갱신

```ts
// state/sync/optimistic.ts
export async function optimisticRunUpdate(
  registry: AtomRegistry,
  runId: string,
  patch: (run: HuntRun) => HuntRun,
  commit: () => Promise<HuntRun>,
) {
  const previous = registry.get(runAtom(runId));
  if (previous) applySyncEvent(registry, { kind: "run-changed", run: patch(previous) });
  try {
    const confirmed = await commit();
    applySyncEvent(registry, { kind: "run-changed", run: confirmed });
    return confirmed;
  } catch (error) {
    const current = registry.get(runAtom(runId));
    if (previous && current && current.updatedAt <= previous.updatedAt) {
      applySyncEvent(registry, { kind: "run-changed", run: previous });
    }
    throw error;
  }
}
```

롤백은 그 사이 서버 델타가 더 새 값을 넣지 않았을 때만 한다. Linear 트랜잭션 큐의
축소판이다.

### 액션

```ts
// state/issues/actions.ts
export function createIssueActions(registry: AtomRegistry) {
  const requireToken = () => {
    const token = registry.get(tokenAtom);
    if (!token) throw new Error("로그인이 필요합니다.");
    return token;
  };
  return {
    editIssue(runId: string, input: UpdateIssueInput) {
      const token = requireToken();
      registry.set(pendingIssueMutationAtom, { kind: "update", runId });
      return optimisticRunUpdate(
        registry,
        runId,
        (run) => ({ ...run, ...input }),
        () => updateHuntRun(token, runId, input),
      ).finally(() => registry.set(pendingIssueMutationAtom, null));
    },
    // …
  };
}

export function useIssueActions() {
  const registry = useRegistry();
  return useMemo(() => createIssueActions(registry), [registry]);
}
```

액션은 React와 무관하므로 `createTestRegistry()`로 만든 registry와 mock API만으로
테스트한다.

### 뷰의 구독

```tsx
// components/hunt/detail/RunPage.tsx (변경 후)
const run = useAtomValue(runAtom(runId));
const pending = useAtomValue(pendingIssueMutationAtom);
const { editIssue, resumeRun, readIssueMessages } = useIssueActions();

// components/hunt/HuntDashboard.tsx (변경 후)
const runIds = useAtomValue(teamRunIdsAtom(teamId));
```

App은 `RunPage`에 `runId`만 넘긴다. 세 곳에 중복된 60개 프롭 블록이 사라진다.

### 부수효과

```tsx
// components/app/AppEffects.tsx
export function AppEffects() {
  useHydration();             // persistence 스냅샷 → 엔티티 (Phase 8)
  useSessionBootstrap();      // useBriar 693–780
  useTeamSync();              // useBriar 811–816 + loader + 실시간 transport
  useWorkspaceSync();         // useBriar 958–1136, 818–885
  useChannelCatalogSync();    // App 381–523
  useStatusTray();            // App 661–773
  return null;
}
```

각 hook은 `useAtomValue`로 키(token, activeTeamId 등)를 읽고 `registry`로 쓴다.
StrictMode 이중 실행에 안전하도록 cleanup을 반드시 반환한다.

### 팀 동기화 로더

```ts
// state/sync/loader.ts
export function createTeamSyncLoader(registry: AtomRegistry) {
  const inFlight = new Map<string, { generation: number; abort: AbortController }>();
  return {
    cancel(teamId: string) { /* generation 증가, abort */ },
    async refresh(teamId: string, reason: DashboardRefreshReason) {
      // useBriar 615–688 로직. 커서는 teamCursorAtom(teamId)에서 읽고,
      // 결과는 applySyncEvent로 적용. generation 가드, 20페이지 상한, HTTP 410 폴백 유지.
    },
  };
}
```

`dashboardRef`, `dashboardCursor`, `dashboardRequest`,
`dashboardRequestGeneration` 네 ref가 로더 내부 상태로 흡수된다.
`removeProject`(1888–1905)의 가드 없는 `setDashboard(null) → load →
setDashboard(result)` 경쟁도 로더의 generation으로 해결한다.

### 영속화

```ts
// state/persistence/snapshot.ts
export type ClientSnapshot = {
  schemaVersion: 1;
  userId: string;
  organizationId: string;
  savedAt: string;
  entities: { runs: HuntRun[]; teams: Team[]; workers: ExecutionWorker[]; channels: ChannelSummary[] };
  teamCursors: Record<string, number>;
};
```

조직 단위로 IndexedDB에 저장한다. 부팅 시 `useHydration`이 스냅샷을 엔티티에
넣고, `useTeamSync`가 저장된 커서부터 델타로 따라잡는다. `userId`나
`schemaVersion`이 다르면 폐기하고, 커서가 만료되어 410이 오면 스냅샷 요청으로
대체한다. 세 모드(데스크톱, 컴패니언, 웹) 모두 IndexedDB를 쓴다.

## 단계별 계획

각 단계는 하나 이상의 작은 PR이며, 완료 조건에 기존 검증(`bun run typecheck`,
`bun run lint`, `bun run test`)과 단계별 렌더 카운트 테스트를 포함한다.
크기 표기: S(반나절), M(1–2일), L(3일 이상).

### Phase 0. 기반 (S)

- `state/registry.ts`: `useRegistry()`, `createTestRegistry()`.
- `state/platform.ts`, `state/demo-fixtures.ts`로 useBriar 모듈 상수 이동.
  `ProjectConnection` 타입을 `types.ts`로 옮기고 `TeamOnboarding.tsx`의 import를
  수정.
- `lib/inbox-selection.ts`를 `state/inbox-selection.ts`로 이동.
- `src/test/render-count.tsx`: `InboxSelectionBoundary.test.tsx`의 셸/상세 렌더
  횟수 검증 패턴을 헬퍼로 일반화.
- 완료 조건: 동작 변화 없음, 기존 테스트 통과.

### Phase 1. 루트 상태 atom화 (M)

- `state/session`, `state/organization`, `state/team`, `state/planning` atoms
  생성. useBriar 내부의 해당 `useState`를 `useAtom`으로 교체(반환 형태 동일).
- `activeProjectIdRef`(479–480) 제거. 콜백은 `registry.get(activeTeamIdAtom)`으로
  읽는다.
- `activeOrganizationId` 영속화 effect(594–597)를 `state/organization`의 hook으로
  이동.
- 액션 이동 시작: session(login/logout/deleteAccount/updateAccountProfile/
  acceptInvitation 등), organization, team, planning 액션을 `actions.ts`로 옮기고
  useBriar는 `useXxxActions()` 결과를 반환 객체에 펼친다.
- 완료 조건: `LoginScreen`, `Sidebar`, `Teams`, `OrganizationSettings`가 atom을
  직접 구독하고 App에서 해당 프롭 제거. 렌더 카운트 테스트: `organizationsAtom`
  변경 시 `Sidebar`만 리렌더.

### Phase 2. 정규화 엔티티 저장소와 동기화 진입점 (L, 가장 큰 성능 효과)

PR 묶음 A. 모델과 동기화:

- `state/entities/`: runs, teams, workers, members, providers, channels의
  `Map<id, T>` atom, `xxxAtom(id)` family, 인덱스 파생. `upsert.ts`에
  `mergeDashboardDelta`의 참조 보존 로직을 옮기고 기존 `dashboard-sync.test.ts`를
  함께 이전.
- `state/team/`: `teamSettingsAtom(teamId)`, `teamExecutionPolicyAtom(teamId)`,
  `teamNotificationsAtom(teamId)`, `teamCursorAtom(teamId)`.
- `state/sync/`: `events.ts`, `apply.ts`, `loader.ts`, `useTeamSync.ts`.
  `useTeamSync`는 `startDashboardPolling`을 재사용하고 실시간 transport 세 종류의
  이벤트를 `SyncEvent`로 변환해 `applySyncEvent`에 넘긴다.
- useBriar 파사드는 `dashboardViewAtom(teamId)`(엔티티에서 재조립한 파생)를
  `dashboard`로 돌려준다. App은 아직 바뀌지 않는다.
- `setDashboard` 호출처 전부를 로더 API 또는 `applySyncEvent`로 전환.

PR 묶음 B. 액션과 뷰:

- `state/sync/optimistic.ts` 헬퍼.
- `state/issues`: `pendingIssueMutationAtom`(isCreatingIssue / updatingIssueId /
  deletingIssueId / recoveringRunId 통합), `recoveryErrorAtom`, 이슈 액션 약 25개를
  낙관 갱신 헬퍼 위에 재작성.
- `state/run-detail`: `issueMessagesAtom`, `runEvidenceAtom`, `runEventsAtom`을
  `Atom.family(runId)`로. 지금은 ref라 렌더를 유발하지 않지만 atom이 되면
  구독자에게 알림이 가므로 `RunPage`와 대화 패널만 구독하게 한다.
  `resumeRequestIds` / `reworkRequestIds`는 액션 모듈 내부 Map으로.
- `HuntDashboard`, `RunPage`, `TeamSettings`, `WorkerDispatchDialog`, `TeamLobby`,
  `TeamAgents`가 엔티티 family와 `useIssueActions()`를 직접 사용. App의 삼중 프롭
  블록 삭제.

완료 조건:

1. 델타에 변경이 없는 폴링 틱에서 셸과 뷰 리렌더 0회.
2. 런 하나 변경 시 해당 `runAtom` 구독자만 리렌더. 목록 뷰는 리렌더되지 않음.
3. `upsert.ts` 참조 보존 테스트가 기존 `dashboard-sync.test.ts`를 대체.
4. 실시간 transport 세 종류가 모두 `applySyncEvent`를 경유.
5. 팀 전환 후 복귀 시 재요청 없이 즉시 렌더되고 백그라운드 델타만 돈다.

### Phase 3. workspace, workflow, integrations (M)

- `state/workspace`: `connectedTeamIdsAtom`, `localInventoryErrorAtom`,
  `healthAtom`({status, value, error} 단일 값), `teamReadinessAtom` family,
  `activeTeamConnectionStateAtom` 파생.
- `useWorkspaceSync.ts`: 저장소 준비 상태 검사(1112–1136), 워크플로
  미러링(958–1007), 헬스 갱신(1080–1110), 팀 에이전트 스케줄 러너(818–885).
  스케줄 러너가 옵션 콜백 아이덴티티 변경마다 재시작하는 문제는 콜백을 ref로
  고정해 해결.
- `state/workflow/actions.ts`와 `useWorkflowAutoGeneration.ts`(2476–2509).
  의존성을 `dashboard` 전체가 아닌 `teamSettingsAtom(teamId)`로 축소.
- `state/integrations`: `velenAtom`, linear import 액션.
- 완료 조건: `ConnectionHealth`, `WorkerStatusBar`, `TeamRepositorySetupDialog`,
  `TeamOnboarding`이 직접 구독. useBriar 반환 객체에서 해당 키 제거.

### Phase 4. App.tsx 소유 상태 atom화와 hook 추출 (M)

- 채널 엔티티는 `entities/channels.ts`와 `organizationChannelIdsAtom(orgId)`
  인덱스로. 채널 실시간 델타(App 426–523)는 `SyncEvent`로 변환해 `applySyncEvent`
  경유.
- `state/channels`: 선택/요청 상태(App 345–380), `useChannelCatalogSync`(381–425),
  `markOrganizationChannelRead`, 채널 CRUD(1238–1327). `activeOrganizationIdAtom`을
  키로 읽어 조직 전환 시 자동 리셋.
- `state/dialogs`, `state/navigation`(requested* / companion* 계열) atom 생성.
- `useStatusTray`, `useCommandPaletteItems`, `useAppShortcuts`, `useDeepLinks`,
  `lib/navigation-history-items.tsx` 추출.
- 완료 조건: `Channels`, `CompanionChannels`, `DirectMessages`, `CommandPalette`가
  직접 구독. App.tsx 약 3,000줄.

### Phase 5. 셸 분리 (M)

- `AuthGate`, `DesktopShell`, `CompanionShell`, `AppDialogs`,
  `InboxDetailContent`, `AppSettingsSidebar` 컴포넌트 추출.
  `WorkerDispatchDialog` 이중 렌더(4912, 5071) 제거.
- App.tsx는 `AppEffects` + `AuthGate` + 셸 선택 + `AppDialogs` 조립만 남긴다.
- 완료 조건: App.tsx 500줄 이하. 데스크톱 / 컴패니언 / 웹 모드 수동 스모크.

### Phase 6. 내비게이션 (M, 결합도 최고)

- 853–1237의 조정 effect 6개를 `useAppNavigation()` 하나로 통째로 추출(순서 계약
  유지). 그다음 `useNavigationHistory` 내부 상태를 `state/navigation` atom으로
  전환하고 `activePage`, `activeRunId` 등을 파생 atom으로 노출.
- 완료 조건: 내비게이션 관련 기존 테스트(`useNavigationHistory.test.ts`, 키보드
  커맨드 테스트) 통과. `Sidebar`와 `CompanionHeader`가 `activePageAtom`만 구독.

### Phase 7. 파사드 제거와 구독형 effect (S–M)

- `useBriar.ts` 삭제. `briar.` 참조 0개 확인. `dashboardViewAtom` 삭제.
- 채널 실시간, 상태 트레이 폴링, 딥링크 리스너처럼 순수 구독형 effect를
  `get.addFinalizer` 기반 atom으로 전환해 구독자가 없을 때 자동 해제.
- `React.memo` 감사: 액션 아이덴티티가 안정화되었으므로 `MessageRow` 등 인라인
  클로저로 무력화된 memo를 복구.
- 완료 조건: 전체 테스트 통과. 폴링 틱 프로파일에서 커밋된 컴포넌트가 변경된
  엔티티의 구독자뿐.

### Phase 8. 영속화와 즉시 부팅 (M)

Phase 2 이후 언제든 착수 가능하며 Phase 3–7과 병행할 수 있다.

- `state/persistence/snapshot.ts`: 조직 단위 `ClientSnapshot`을 IndexedDB에 저장.
  엔티티 맵이 바뀔 때 디바운스해 기록.
- `useHydration`: 부팅 시 세션 복원과 병행해 스냅샷을 엔티티에 넣는다. 스냅샷이
  있으면 `restoringSession` 게이트를 건너뛰고 마지막 화면을 즉시 렌더한다.
- `useTeamSync`는 저장된 커서부터 델타로 따라잡고, 410이면 스냅샷 요청으로 대체.
- 무효화 규칙: `userId` 불일치, `schemaVersion` 불일치, 로그아웃 시 폐기.
- 선택: 채널 프리로드 순서를 최근·빈도 기준으로(Slack의 frecency).
- 완료 조건: 콜드 부팅에서 네트워크 응답 전에 마지막 대시보드가 보인다. 부팅
  게이트는 스냅샷이 없는 첫 실행에만 나타난다. 커서 만료 시 스냅샷 재요청 후
  정상 동작.

## 검증

- 정적: `bun run typecheck`, `bun run lint`, `bun run lint:type-aware`.
- 단위: `entities/upsert.test.ts`(참조 보존), `sync/apply.test.ts`(이벤트별 갱신과
  batch 알림 1회), `sync/optimistic.test.ts`(커밋, 롤백, 델타 경쟁), 도메인별
  `atoms.test.ts`와 `actions.test.ts`(mock API + test registry).
- 렌더: `src/test/render-count.tsx` 헬퍼로 "무변경 델타 틱 → 0회", "런 1개 변경 →
  해당 구독자만", "목록 뷰는 id 배열 변경에만" 시나리오를 각 Phase 완료 조건에
  포함.
- 수동: 데스크톱(Tauri), 컴패니언(모바일), 웹 모드에서 로그인 → 조직/팀 전환 →
  이슈 편집 → 채널 이동 → 앱 재시작 스모크. React DevTools Profiler로 델타 틱 동안
  커밋된 컴포넌트 확인.

## 위험과 대응

| 위험 | 대응 |
|---|---|
| `RegistryProvider`에 idle TTL이 없어 구독자 0이 되면 atom 폐기 | 엔티티 맵과 세션 수명 atom은 전부 `Atom.keepAlive`. 구독형 atom만 `Atom.setIdleTTL`. |
| `setDashboard`의 암묵적 요청 취소 계약 | Phase 2에서 로더 API로 명시화하고 호출처를 개별 검토 |
| `removeProject`의 가드 없는 대시보드 교체 경쟁 | 로더 generation 가드 |
| 낙관 갱신과 서버 델타의 경쟁 | 롤백 전 `updatedAt` 비교. 델타가 더 새 값을 넣었으면 롤백 생략 |
| 정규화로 관계 조회 비용 증가 | 인덱스 파생 atom + `withEquality`. 런은 팀당 200개 상한이라 Map 복사 비용은 미미. 메시지처럼 큰 컬렉션은 채널별 family로 분할 |
| ref였던 런 상세 캐시가 반응형이 되면서 렌더 증가 | `RunPage` 계열만 구독, 렌더 카운트 테스트로 확인 |
| 영속 스냅샷과 스키마 드리프트 | `schemaVersion` 키. 불일치 시 폐기하고 스냅샷 요청 |
| 스케줄 러너 effect(818)가 옵션 콜백 아이덴티티 변화마다 재시작 | 콜백 ref 고정. `useAutoHuntSessions` 전환은 후속 |
| 렌더 단계 ref 대입(480)과 StrictMode | Phase 1에서 제거 |
| 고변경 파일과의 충돌 | 각 PR을 하루 이내 머지 가능한 크기로 유지, 기계적 치환은 스크립트로 |
| demo / companion / web 모드 분기 누락 | `platform.ts` 상수는 그대로 두고 액션 내부 분기를 옮길 때 테스트에 모드별 케이스 추가 |
| `useAtomValue(atom, inlineSelector)`로 인한 파생 atom 재생성 | 셀렉터는 모듈 스코프 고정. lint 규칙으로 인라인 금지 검토 |

## 기대 효과

- `useBriar.ts` 4,668줄 → 삭제, `App.tsx` 5,116줄 → 500줄 이하.
- 델타 틱에서 변경 없는 경우 리렌더 0회, 변경 시 해당 엔티티 구독자만 리렌더.
- 델타, 실시간, 액션 응답이 하나의 병합 규칙을 공유해 상태 불일치 버그가 줄어든다.
- 팀 전환 시 캐시를 버리지 않아 복귀가 즉시다.
- 콜드 부팅에서 스냅샷을 먼저 렌더하고 델타로 따라잡는다. 2026-09-03 성능
  감사에서 지적된 부팅 게이트, "모든 뷰가 내비게이션 시 언마운트", "채널 캐시가
  인스턴스별" 문제의 비용이 낮아진다.
- 액션 아이덴티티 안정화로 `React.memo`가 정상 작동.

## 후속 (범위 밖)

- `useInbox`, `useAutoHuntSessions`(localStorage 상태는 `Atom.kvs` 후보),
  `useChannelConversation`(메시지를 채널별 엔티티 family로)의 동일 패턴 전환.
- `Atom.fn` + `AsyncResult`로 pending / 에러 상태 자동화.
- 오프라인 우선과 멀티 디바이스 충돌 해결이 목표가 되면 서버 측 SyncAction 로그를
  가진 전용 sync engine(Replicache, Zero 등)을 검토한다. 그 전까지는 이 계획으로
  충분하다.
- 뷰 keep-alive 라우팅.

## 실행 기록

각 Phase는 PR 하나 이상으로 진행하며, 머지 후 여기에 기록한다.

| Phase | PR | 상태 | 비고 |
|---|---|---|---|
| 0 | #1581 | 머지됨 | `state/registry.ts`, `state/platform.ts`, `state/demo-fixtures.ts`, `state/inbox-selection.ts`, `test/render-count.tsx`. `ProjectConnection`은 `types.ts`로. |
| 1 | #1583 | 머지됨 | `state/session|organization|team|planning`의 atoms/actions, `useActiveOrganizationPersistence`, `components/app/`의 연결 래퍼 4종과 `AppEffects`. `activeProjectIdRef` 제거. |
| 2A | | 예정 | |
| 2B | | 예정 | |
| 3 | | 예정 | |
| 4 | | 예정 | |
| 5 | | 예정 | |
| 6 | | 예정 | |
| 7 | | 예정 | |
| 8 | | 예정 | |
