# 도메인 atom 상태 분리와 App / useBriar 모듈화

Status: implemented. Updated 2026-09-04.

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

### 기준 갱신 (2026-09-04, Phase 2A `#1584` / `#1585` 이후)

Phase 2A를 구현하며 확인한, 이후 단계에 영향을 주는 사실:

- **`AppEffects`는 데스크톱·웹 셸에만 마운트되어 있었다.** 컴패니언 분기가
  `<AppEffects />`가 있는 return 위에서 먼저 반환하므로, Phase 1이 옮긴
  `useActiveOrganizationPersistence`는 컴패니언 모드에서 돌지 않았다. 2A가
  컴패니언 셸에도 `<AppEffects />`를 넣었다. Phase 5가 셸을 분리해 마운트 지점을
  하나로 합치기 전까지, effect hook을 추가할 때 두 곳을 모두 확인한다.
- **`HuntRun.teamId`는 옵셔널이다.** 런 맵만으로는 팀 소속을 복원할 수 없어
  `teamRunIdsAtom`은 파생이 아니라 **저장**한다(계획 스케치와 다르다). 정렬 규칙도
  경로마다 다르다: 스냅샷은 서버 순서 그대로·상한 없음, 델타만 재정렬하고 팀당
  200개로 자른다. 기존 `setDashboard(snapshot)`이 `payload.runs`를 손대지 않던
  동작을 유지하려면 이 구분이 필요하다.
- **`AgentProvider`는 문자열 유니온이다.** `entities/providers.ts`에는 의미 있는
  `Map<id, T>`가 없어 팀별 목록 atom만 둔다.
- **`OrganizationMember`의 키는 `userId`다.** `upsertMany`는
  `upsertManyBy(map, incoming, identify, deletedIds?)` 위에 얹은 얇은 래퍼다.
- **멤버는 여러 팀 인덱스가 공유한다.** 조직 단위 엔티티이므로, 팀 인덱스에서 빠진
  id를 공유 맵에서 지우기 전에 다른 잔류 팀이 참조하는지 확인해야 한다.
- **옵셔널 projection의 `undefined`와 `[]`는 다르다.** 델타 병합이 "서버가 안 보낸"
  projection을 건드리지 않는 규칙이 여기에 걸려 있어, 팀 family는 부재를 `null`로
  저장하고 뷰에서 다시 `undefined`로 되돌린다.
- **커서는 둘로 나뉜다.** `mergeDashboardDelta`는 `changed: false`일 때 렌더되는
  payload의 `cursor` / `generatedAt`도 올리지 않았다. 재개용 `teamCursorAtom`은 매
  델타 페이지마다 전진하고, 렌더용 `teamPayloadCursorAtom` / `teamGeneratedAtAtom`은
  엔티티가 실제로 바뀔 때만 움직인다. 이 분리가 "무변경 폴링 틱 리렌더 0회"를
  지탱한다.
- **`Atom.withEquality`에는 타입 인자를 명시해야 한다.** 제네릭 비교 함수를 그냥
  넘기면 `A`가 `unknown`으로 추론되어 컴파일이 깨진다
  (`Atom.withEquality<HuntRun[] | null>(shallowArrayEqual)`).
  비교가 `true`면 레지스트리는 **이전 값 인스턴스를 유지**하므로, 파생 배열 atom의
  아이덴티티 보존이 여기에 기댄다.
- **`Atom.family`는 인자별 초기값을 만들 수 있다.** 데모 시드는 팀 family 안에서
  `teamId === demoDashboard.team.id`로 분기해 모듈 스코프에 둔다.
- **로더는 레지스트리당 하나여야 한다.** `useBriar`와 `useTeamSync`가 다른
  컴포넌트에 있어 in-flight 맵을 공유해야 하므로, 레지스트리 키 `WeakMap`으로
  싱글턴을 만들고 데이터 소스는 `teamSyncApiAtom`으로 주입한다.
- **남은 주입 콜백은 4개.** `bumpReconnectRequest`, `cancelLogin`(로그인 타이머),
  `clearWorkspaceViews`, `resetTeamHealth` — 전부 Phase 3(workspace / health)과
  로그인 폴링 소유권 문제이며 대시보드와 무관하다.
- **`setDashboard`는 파사드 내부 shim으로 남았다.** 로더 취소 +
  `applySyncEvent(team-snapshot)` 두 줄이며, 40여 개 낙관 갱신 호출부가 PR 묶음 B에서
  엔티티 갱신으로 재작성되면 사라진다.

### 기준 갱신 (2026-09-04, Phase 2B-1 이후)

액션과 런 상세를 옮기며 확인한 사실:

- **`demoMode`는 테스트에서 항상 `false`다.** vitest 설정이 `VITE_BRIAR_API_URL`을
  넣어 `isApiConfigured`가 참이 되므로 `state/platform.ts`의 상수는 꺼지지 않는다.
  모듈 모킹이 금지된 상태에서 데모 분기를 덮으려면 액션 팩토리가 `deps.demoMode`로
  플래그를 주입받아야 한다. `createIssueActions` / `createRunDetailActions`가 그
  이음매를 갖는다. 이후 단계도 데모 분기를 테스트하려면 같은 방식을 쓴다.
- **현재 코드에는 "낙관 갱신 후 커밋" 경로가 하나도 없었다.** 모든 액션이
  서버 응답을 기다린 뒤(또는 데모에서만) 로컬을 고친다. 그래서
  `state/sync/optimistic.ts`는 동기 패치(`applyRunPatch` / `applyRunPatches`)를
  액션들이 쓰고, 롤백 규칙을 가진 `optimisticRunUpdate`는 헬퍼와 테스트로만
  존재한다. 순서를 바꾸는 것은 눈에 보이는 동작 변화라 이 PR의 범위 밖이다.
  생성 / 삭제용 낙관 헬퍼는 쓰는 액션이 없어 만들지 않았다.
- **롤백 규칙.** 실패 시 (1) 런이 사라졌으면 복원하지 않고, (2) 저장소가 아직
  낙관 값 인스턴스를 들고 있으면 복원하며, (3) 다른 값으로 바뀌었으면
  `updatedAt`이 **더 새로울 때만** 복원을 건너뛴다. 같은 시각은 롤백이 이긴다.
- **`pendingIssueMutationAtom`의 종료는 토큰 비교다.** 네 개의 독립 플래그를 하나의
  판별 유니온으로 합치면 나중에 시작한 뮤테이션의 표시를 먼저 끝난 쪽이 지울 수
  있다. `beginIssueMutation`이 돌려주는 종료 함수는 아직 자기 값일 때만 지운다.
- **`setDashboard`가 하던 요청 취소는 남은 호출부에도 필요하다.** 팀 연결 / 워크플로
  / Velen 흐름은 `commitTeamDashboard`와 `commitTeamSettings` 두 함수로 좁혔고,
  둘 다 커밋 전에 `loader.cancelAll()`을 유지한다. Phase 3이 이 둘을
  `state/workspace`로 가져가면 useBriar에서 대시보드 쓰기가 사라진다.
- **액션이 셸 콜백을 필요로 한다.** `addIssue`의 팀 전환과 Agent Skill 승인의 세션
  입양은 `useBriar`만 줄 수 있는데, 뷰가 훅보다 훨씬 아래에서 액션을 부른다.
  레지스트리별 `WeakMap` 브리지(`setIssueActionBridge`)로 넘기며, 그래야
  `useIssueActions()`가 레지스트리 수명 동안 같은 객체를 돌려준다.
- **`useAutoHuntSessions`의 `AutoHuntSession` 타입을 `state/`가 import한다.** Phase 7이
  훅을 정리할 때 타입을 `types.ts`로 옮기는 것이 낫다.

### 기준 갱신 (2026-09-04, Phase 2B-2 이후)

뷰를 엔티티에 붙이며 확인한 사실:

- **`RunPage`는 완전한 행 단위 구독이 되었다.** `components/app/RunPageWithRun`이
  런 객체 대신 `runId`를 받고 `runAtom(runId)`을 읽는다. 열린 런이 바뀌면 셸 리렌더
  0회로 상세만 다시 그린다(`RunPageWithRun.test.tsx`가 검증).
- **`HuntDashboard`는 이 PR에서는 아직 런 객체로 그렸다.** 보드가 필터·정렬·칸반
  컬럼·에이전트 연결·카운트를 모두 런 **객체** 위에서 계산하고 있었기 때문이며,
  1,279줄 컴포넌트와 1,076줄 테스트의 재작성이라 이 PR의 범위 밖이었다. 여기서
  달성된 것은 셸이 보드에 새 프롭을 밀어 넣지 않는 것이고, 무변경 델타 틱은 이미
  리렌더 0회였다. **Phase 2C(#1604 / #1605)가 이 마지막 조각을 끝냈다.**
- **연결 래퍼가 lazy 경계를 대신 들고 있어야 한다.** App이 래퍼를 정적으로 import하고
  래퍼 안에서 `lazy(() => import(...))`를 하면 코드 스플리팅이 그대로 유지된다.
  래퍼를 lazy로 감싸면 청크가 한 번 더 겹친다.
- **`renderCounter.track`은 프롭이 밀려 들어온 렌더만 센다.** 래퍼 컴포넌트를 감싸므로
  내부 구독으로 인한 리렌더는 잡히지 않는다. 컴포넌트 자신의 리렌더를 세려면 본문에
  `useRenderCount`가 필요하다.
- **`WorkerDispatchDialog`는 대시보드가 아니라 두 family만 필요하다.**
  `teamWorkersAtom` / `teamExecutionPolicyAtom`만 읽으므로 런 변경이 다이얼로그에
  아예 닿지 않는다. Phase 5가 이중 렌더를 지울 때 래퍼 하나만 남기면 된다.
- **`briar.dashboard`는 App에 아직 남아 있다.** 인박스 상세가 어떤 뷰를 그릴지 고르고
  (`inboxDetailRun` 조회), 워크플로 자동 생성 effect가 설정을 본다. Phase 3/4가
  가져간다.

### 기준 갱신 (2026-09-04, Phase 3 `#1588` / `#1589` 이후)

workspace / workflow / integrations를 옮기며 확인한, 이후 단계에 영향을 주는 사실:

- **effect 훅에도 데이터 소스 이음매가 필요하다.** 액션은 `deps.api`로 받으면 되지만
  훅과 액션이 같은 coordinator를 공유하면 서로에게 부분 API를 건넬 수 없다.
  `workspaceApiAtom`(Partial 오버라이드)과 `workspaceModesAtom`(`demoMode` /
  `remoteMode`)을 레지스트리에 두고 `resolveWorkspaceApi(registry, overrides)`가
  호출 시점에 합친다. 이후 단계도 훅이 있는 도메인은 이 형태를 쓴다.
- **`Atom.family`의 팀별 값은 전역 레코드로 되돌릴 수 있다.** 파사드가 남긴
  `projectReadiness` 3종은 `teamsAtom` 위 파생 atom + `withEquality`로 만들었다.
  family는 열거할 수 없으므로 이런 레코드는 항상 "무엇을 순회할지"를 정해 줘야 한다.
- **`renderCounter.track`으로는 구독형 리렌더를 셀 수 없다**(Phase 2B-2 기록의 확인).
  Phase 3의 렌더 카운트 테스트는 "셸 카운터 0 + 해당 뷰의 DOM 변화"로 검증한다.
  래퍼가 `lazy()`를 들고 있어 첫 페인트가 모듈 로드를 기다리므로 고정 tick이 아니라
  조건 대기 헬퍼가 필요하다.
- **`useAtomValue`로 만든 파생은 effect 재시작 단위가 된다.** 스케줄 러너처럼
  재시작이 곧 부작용(재claim)인 effect는 배열 아이덴티티를 보존하는 writer
  (`setConnectedTeamIds`)와 `useMemo`가 함께 있어야 한다. 셸 콜백은 의존성이 아니라
  레지스트리 브리지(`setWorkspaceScheduleBridge`)로 넘긴다.
- **부팅 검사는 자기 결과로 다시 돌 수 있다.** 준비 상태 검사가 연결 목록을 채우고
  그 목록이 같은 effect의 의존성이므로, 팀별로 "어느 인벤토리에 답했는지"를 ref에
  기록해 중복 왕복을 막았다. 같은 형태의 effect를 추가할 때 확인한다.
- **`useBriar`에 남은 것은 세션·로그인·팀 선택뿐이다.** 상태는 `user` / `token` /
  `projects` / `planningProjects` / `organizations` / `activeOrganizationId` /
  `activeProjectId` / `loading` / `restoringSession` / `loginCode` / `error` /
  `projectConnection` / `isCreatingProject` / `deletingProjectId`와 ref 3개
  (`pollTimer`, `pollLoginNow`, `loginAttempt`). effect는 세션 복원, 플래닝
  프로젝트 로드, 컴패니언 인증 복귀, 액션 브리지 설치 4개. 액션은 `login` /
  `completeLogin` / `sendLoginEmailCode` / `verifyLoginEmailCode` / `cancelLogin` /
  `acceptInvitation` / `selectProject` / `ensureProjectSelected` / `refresh`.
  Phase 4 이후는 이 목록만 남기면 된다.
- **App은 아직 `briar.projectReadiness` 3종과 `connectedTeamIds`를 읽는다.**
  `Sidebar`, `AppSettings`, `TeamLobby`, `OrganizationSettings`가 프롭으로 받기
  때문이며, 그 뷰들을 옮기는 단계에서 파사드의 마지막 레코드 파생이 사라진다.

### 기준 갱신 (2026-09-04, Phase 4-1 이후)

채널을 옮기며 확인한, 이후 단계에 영향을 주는 사실:

- **채널 인덱스는 파생이 아니라 저장이다.** `entities/channels.ts`의 원래 주석은
  "채널이 `organizationId`를 들고 있으니 인덱스는 파생"이라고 적었지만, 순서가
  눈에 보이는 값이고 두 경로가 서로 다르게 만든다. 스냅샷은 **서버 순서 그대로**,
  델타는 병합 후 **이름순 재정렬**이다. Map 삽입 순서는 둘 중 어느 것도 아니라서
  `organizationChannelIdsAtom(orgId)`는 `teamRunIdsAtom`과 같은 저장 인덱스가
  되었다. 열거할 수 없는 `Atom.family`를 로그아웃 때 비우기 위해
  `channelCatalogOrganizationIdsAtom`(보유 조직 목록)도 함께 둔다.
- **순서를 바꾸는 로컬 쓰기는 "스냅샷"으로 표현한다.** 채널 생성과 뷰가 스스로
  넘기는 `onChannelsChange`는 배열 전체를 새로 만든다. 개별 채널 이벤트로는 순서를
  실어 나를 수 없어 `channel-catalog-snapshot`이 그 역할을 겸한다. 읽음 표시처럼
  순서를 건드리지 않는 갱신만 `channel-changed`다.
- **조직 스코프 리셋은 파생으로 만들 수 있지만 절반만이다.**
  `state/channels/atoms.ts`의 선택 상태는 `{organizationId, value}`를 저장하고
  현재 조직이 다르면 초기값을 돌려주는 `Atom.writable` 파생이다. 조직 전환 즉시
  리셋되지만, **되돌아오면 값이 되살아난다.** 그래서 카탈로그 훅이 전환 시
  `resetChannelSelection`으로 도장을 지운다(하나의 `Atom.batch`). 같은 형태의
  스코프 상태를 만들 때 이 한 쌍이 필요하다.
- **`lockedTeamIdAtom`은 `state/platform.ts`로 옮겼다.**
  `OrganizationActionDeps.lockedTeamId`와 중복이었고,
  `useActiveOrganizationPersistence`는 `readTeamWindowProjectId()`를 다시 읽고
  있었다. 셋을 하나의 atom으로 합쳤고 초기값이 `readTeamWindowProjectId()`이므로
  `useBriar`의 시드는 옵션을 존중하는 용도로만 남는다.
- **콜백 아이덴티티가 effect 재실행 주기였다.** `markOrganizationChannelRead`는
  `organizationChannels`에서 만들어졌기 때문에 카탈로그가 바뀔 때마다 새로
  생성되었고, 그것을 의존성에 넣은 내비게이션 조정 effect가 함께 재실행되며 열려
  있는 채널을 다시 읽음 처리했다. 액션이 안정 객체가 되면 그 주기가 사라지므로,
  액션으로 바꾼 자리마다 **그 콜백이 의존성으로서 하던 일**을 확인해야 한다.
  이 자리에서는 `organizationChannels`를 의존성에 명시해 주기를 유지했다.
- **연결 래퍼의 게이트는 조직 **id**다.** 셸은 `briar.activeOrganizationId`만으로
  대화 뷰를 그렸고 이름은 `undefined`여도 됐다. 래퍼가
  `activeOrganizationAtom`(목록에서 해석한 객체)으로 게이트하면 조직 목록이 아직
  안 온 순간에 화면이 비므로, id로 게이트하고 이름만 해석한다.
- **`Channels` / `DirectMessages` / `CompanionChannels`에는 `lazy()` 경계가 없다.**
  셸이 정적 import 하고 있었으므로 래퍼도 정적이다. `CommandPalette`는 lazy라서
  래퍼가 경계를 들고 간다.

### 기준 갱신 (2026-09-04, Phase 4-2 이후)

다이얼로그·내비게이션 상태와 훅 4종을 옮기며 확인한 사실:

- **훅 추출의 크기를 정하는 것은 코드가 아니라 파라미터다.** 옮길 블록이 읽는
  값 중 atom에 있는 것은 훅이 직접 읽고, 셸이 **결정하는** 것(현재 페이지,
  히스토리가 갈 수 있는 방향, 이동 콜백)만 파라미터로 남긴다.
  `useCommandPaletteItems`는 610줄에 파라미터 16개, `useDeepLinks`는 290줄에
  `navigation` / `session` 두 묶음이다. 이 경계를 지키면 Phase 5·6이 셸을
  쪼갤 때 훅을 다시 건드릴 필요가 없다.
- **부작용 훅에는 `deps` 오버라이드 하나면 충분하다.** `useStatusTray`처럼
  호출부가 하나뿐인 effect 훅은 레지스트리 atom 이음매(`workspaceApiAtom` 형태)
  없이 `useStatusTray(overrides)` 한 개로 테스트할 수 있다. 아울러
  `isMacDesktopTauri()` 같은 플랫폼 분기도 그 `deps`에 넣어야 vitest에서 본문에
  도달한다.
- **`useAtom`을 쓸 자리와 `useAtomSet`을 쓸 자리가 다르다.** 훅이 App에서
  호출되면 훅이 구독한 atom은 곧 App의 리렌더다. 쓰기만 하는 atom은
  반드시 `useAtomSet`으로 잡는다.
- **상태 트레이의 마운트 순서가 곧 계약이다.** 대시보드 파생 effect와 조직 폴링
  effect가 같은 배열을 쓰는데, 폴링 쪽이 시작할 때 배열을 비운다. 마운트
  시점에는 폴링이 이겨서 트레이가 잠깐 빈다 — 옮기기 전과 같은 동작이라
  테스트도 그대로 고정했다.
- **인박스 알림은 읽음 처리를 팀 전환 앞에서 한다.** 그래서 다른 팀의 알림을
  열면 `markRead`가 두 번(전환 패스, 라우팅 패스) 호출된다. 기존 동작이며
  `useDeepLinks.test.tsx`가 그대로 고정한다.
- **`WorkerDispatchDialog`의 "이중 렌더"는 중복이 아니다.** 컴패니언 분기가
  데스크톱 트리보다 먼저 return하므로 두 자리는 상호 배타적이다. 둘을 하나로
  합치는 것은 셸 통합(Phase 5)의 일이고, 4-2는 두 자리를 모두
  `<WorkerDispatchDialogWithTeam onSubmit={…} />` 한 줄로 만들어 두었다.
- **파사드에 남은 것.** `App.tsx`는 이제 `briar.` 키 45개를 읽는다. 남은 것은
  세션·조직·팀 선택과 로그인/온보딩 게이트, 그리고 `useBriar`에만 있는
  `ensureProjectSelected` / `refresh` / `addIssueMessage` 계열이다.
  `projectReadiness` 3종과 `connectedTeamIds`는 사라졌다.

### 기준 갱신 (2026-09-04, Phase 5 이후)

셸을 자르며 확인한, 이후 단계에 영향을 주는 사실:

- **`AppEffects`는 이제 한 번만 마운트된다.** 셸 선택보다 위에 있으므로 컴패니언
  모드에서도 로그아웃 상태와 팀 0개 상태에서 돈다(데스크톱은 원래 그랬다).
  Phase 2A가 두 번째 마운트로 고쳤던 "컴패니언에서 대시보드 동기화가 안 돈다"는
  문제는 이 통합으로 구조적으로 사라졌다.
- **게이트 순서는 모드마다 다르다.** 데스크톱은 복원 → 초대 → 초기 온보딩 →
  로그인 → 첫 조직 설정이고, 컴패니언은 **로그아웃일 때만** 앞의 네 개를 거친
  뒤 팀이 없으면 빈 화면으로 간다. 이전 코드에서 컴패니언 분기가 `!briar.user`
  일 때만 `content`를 반환하던 것과 같은 규칙이며, `AuthGate`가 그대로 옮겼다.
- **`briar.error`의 합이 세 곳으로 늘었다.** `AuthGate` / `CompanionShell` /
  `DesktopShell`이 각각 `sessionError ?? localInventoryError`를 다시 만든다.
  Phase 7이 파사드를 지울 때 파생 atom 하나로 합치면 세 곳이 한 줄이 된다.
- **App 자신의 리렌더는 아직 0회가 아니다.** `useBriar`가 `activeDashboardAtom`
  을 구독하고 `useInbox`가 대시보드를 인자로 받으므로 런 변경은 여전히 App을
  리렌더한다. Phase 5의 렌더 카운트 테스트는 그래서 `AuthGate` /
  `DesktopShell` / `CompanionShell` / `InboxDetailContent` 네 컴포넌트의 0회를
  고정한다. App까지 0회로 만들려면 `useInbox` 전환(현재 비목표)과 파사드
  제거(Phase 7)가 함께 필요하다.
- **셸 프롭은 묶음으로 나눈다.** `navigation` / `inbox` / `autoHunt` / `agents` /
  `repositorySetup` / `session`. 경계 규칙은 Phase 4-2와 같다: atom에 있으면
  셸이 직접 읽고, App이 **결정하는** 것만 프롭이다. `navigation` 묶음이 Phase 6이
  통째로 가져갈 블록의 인터페이스다.
- **한쪽 셸만 쓰는 훅은 그 셸로 함께 옮긴다.** `useHorizontalPaneResize`는
  데스크톱 인박스만의 것이었고, `useMobileNavigationGestures` /
  `useMobileBackHandler`는 컴패니언만의 것이었다. 후자는 등록된 핸들러가 없으면
  네이티브 뒤로가기를 통과시키므로 게이트 화면에서 빠져도 동작이 같다.
- **`navigationActiveProjectIdRef` 대입은 콜백이 되었다.** 셸이 팀을 고를 때
  `navigation.setDefaultTeam(teamId)`를 부른다. ref 자체는 Phase 6이 가져갈
  블록에 남아 있다.
- **oxlint는 미사용 import를 잡지 않고 `noUnusedLocals`도 꺼져 있다.** 5-1이
  죽은 import 13개와 `lazy()` 상수를 남겼고 5-2가 정리했다. 블록을 옮긴 뒤에는
  스크립트로 확인한다(미사용 로컬은 죽은 **구독**이기도 하다).
- **Radix 다이얼로그는 `document.body`로 포탈한다.** 오버레이를 세는 테스트는
  마운트마다 `document.body.replaceChildren()`가 필요하고, `lazy()` 오버레이는
  `beforeEach`에서 미리 `import()` 해야 `act()` 플러시 안에서 해소된다.
- **팀 창 스코프는 순수 함수로 뽑았다.** `lib/team-window-scope.ts`의
  `visibleTeams` / `visibleOrganizations` / `activeOrganizationTeams`가 셸이 세
  번 반복하던 삼항 사슬이다.

### 기준 갱신 (2026-09-04, Phase 6 이후)

내비게이션을 옮기며 확인한, Phase 7·8에 영향을 주는 사실:

- **렌더 단계 ref 두 개는 서로 다른 결말을 맞았다.** `navigationUserIdRef`는
  파생 atom이 읽어야 해서 `navigationHistoryUserIdAtom` +
  `navigationUserBoundaryChangedAtom` 한 쌍이 되었다(`undefined`가 "아직 아무도
  이 스택을 갖지 않았다"는 뜻이므로 `null`과 구분해야 한다).
  `navigationActiveProjectIdRef`는 **사라졌다**: 렌더마다 `activeTeamId`로 다시
  덮어써졌고 `setDefaultTeam` 호출부 다섯 곳이 모두 같은 동기 스텝에서 같은 팀을
  선택하므로, 액션이 호출 시점에 `activeTeamIdAtom`을 읽는 것과 결과가 같다.
  같은 형태의 "렌더 단계 미러 ref"를 만나면 먼저 이 질문을 한다.
- **파생 atom은 effect 재실행 횟수를 줄인다.** `settingsTargetFromNavigationLocation`은
  렌더마다 새 객체였고, 그것을 의존성으로 둔 설정 동기화 effect는 **매 렌더** 돌고
  있었다. `Atom.map`으로 만들면 위치가 바뀔 때만 새 값이 되어 effect가 훨씬 덜
  돈다. 그 effect들이 멱등이어야 안전한데(설정 타깃 쓰기는 같은 값이면 `current`를
  돌려주므로 멱등이다), 옮길 때마다 확인해야 한다.
- **조정 effect의 마운트 지점을 옮기면 순서가 바뀐다.** 자식의 effect가 부모보다
  먼저 돌므로, App의 훅이던 것을 `AppEffects`로 내리면 `useDeepLinks`(여전히 App)
  보다 **먼저** 돈다 — 이전과 같다. 대신 `AppEffects` 안의 다른 훅들보다는 나중에
  돌아야 이전 순서가 유지되므로 목록의 **마지막**에 둔다.
- **`lazy()` 경계가 fallback으로 떨어지면 이전 DOM은 언마운트되지 않는다.**
  React가 숨기기만 하므로 `textContent`에는 옛 화면이 그대로 남는다. 페이지 전환
  테스트는 새 페이지의 문자열을 기다려야 하고, `beforeEach`에서 그 페이지 모듈을
  미리 `import()` 해야 `act` 플러시 안에서 해소된다.
- **테스트 레지스트리에 위치를 심을 때 `resetNavigation`과 `navigateToPage`는 다르다.**
  후자는 방문을 남겨 `canGoBack`이 참이 된다. "뒤로 갈 곳이 없다"를 검사하는
  테스트는 `resetNavigation`으로 심어야 한다.
- **팀이 사라졌는데 선택은 남으면 무한 루프다.** 팀 백필(3)이 선택된 팀을 위치에
  써 넣고 팀 존재 폴백(4)이 그 팀이 없다며 지우기를 반복한다. 실제 앱에서는 팀
  목록과 선택이 함께 비므로 도달하지 않지만, 테스트에서 `teamsAtom`만 비우면
  걸린다.
- **App에 남은 `briar.` 키 28개는 전부 세션·로그인·팀 선택이다.** 내비게이션이
  나가면서 더 줄일 것이 없어졌고, 다음에 줄어드는 시점은 Phase 7의 파사드 제거다.

### 기준 갱신 (2026-09-04, Phase 7 이후)

파사드를 지우며 확인한, Phase 8에 영향을 주는 사실:

- **`useBriar`는 없다.** `apps/briar/src`에 `useBriar` 식별자 참조와 `briar.` 멤버
  접근이 0개다(과거를 설명하는 주석만 남았다). App.tsx는 661줄 → 419줄이 되었고,
  세션·로그인·팀 선택·재조회·플래닝 로드는 각각 `state/session`, `state/team`,
  `state/sync`, `state/planning`에 있다.
- **데이터 소스 시임이 하나로 합쳐졌다.** `UseBriarOptions.dataSources`가
  `state/session/api.ts`의 `sessionApiAtom`이 되었고,
  `setSessionDataSources(registry, …)` 한 번이 세션·`teamSyncApiAtom`·
  `workspaceApiAtom` 세 개를 함께 심는다. 새 테스트는 이것만 쓰면 된다.
- **데모 선택 시드는 모듈 상수다.** `state/platform.ts`가 `lockedTeamId`를 상수로
  내보내고 `demo-fixtures.ts`의 `demoSelectionApplies`가 그것을 쓰므로,
  `activeTeamIdAtom` / `activeOrganizationIdAtom`이 레지스트리별 시드 없이 맞는
  값에서 시작한다. 창을 고정한 테스트는 `lockedTeamIdAtom`을 심으면 된다.
- **`deferDefaultOrganization`은 죽은 분기였다.** App은 #1243 이후 늘 `true`를
  넘겼으므로 `ensureDefaultOrganization`은 도달 불가능했고,
  `lib/default-organization.ts`를 테스트와 함께 지웠다.
- **`AtomContext`에는 `get.registry`가 있다.** 구독형 atom이 콜백 안에서 다른
  atom을 쓸 때 `get.set`(읽기 함수 스코프)이 아니라 `get.registry.set`을 쓰면
  안전하다. `get.addFinalizer`는 구독 해제 함수를 그대로 받는다.
- **`setIdleTTL`은 `keepAlive`와 배타적이다.** 유한 duration을 주면 `keepAlive`가
  꺼진다. 레지스트리의 스윕은 `setTimeout` 버킷이고 기본 `timeoutResolution`이
  1초이므로, 해제를 검사하는 테스트는 가짜 타이머로 `TTL + 2초`를 흘려야 한다.
- **`useAtomMount(atom)`이 구독형 atom의 마운트 지점이다.** 값은 읽지 않고
  관찰만 하므로, 리스너 atom을 마운트하는 컴포넌트는 리렌더되지 않는다.
- **채널 실시간 전송은 훅으로 남겼다.** `useChannelCatalogSync`의 두 effect는
  커서 ref와 `catalogLoaded`를 공유하고, 델타 루프가 그 ref를 자기 자신과 비교해
  최신 페이지 도착을 감지한다. atom으로 옮기려면 커서와 재시도 루프까지 함께
  옮겨야 해서 카탈로그 동작이 바뀔 위험이 이득보다 크다.
- **`dashboardViewAtom`은 남겼다.** 계획의 Phase 7 항목이지만 17개 모듈이 통짜
  `DashboardPayload`를 읽고 있어, 지우려면 소비자를 전부 엔티티 atom으로 바꿔야
  한다. Phase 8의 스냅샷 직렬화가 같은 뷰를 쓰므로 그때 함께 판단한다.
  (후속 F2가 소비자를 전부 옮기고 `state/sync/view.ts`를 지웠다. 스냅샷은 이미
  엔티티 맵에서 모으고 있어서 영향이 없었다.)
- **`MessageRow`의 memo를 되살리려면 프롭 모양을 바꿔야 했다.** 인라인 클로저를
  `useCallback`으로 감싸는 것만으로는 부족하다 — 훅이 메시지 목록이 바뀔 때마다
  콜백을 다시 만들기 때문이다. 행이 **자기 메시지를 스스로 바인딩**하고 목록은
  ref로 최신 클로저를 가리키는 아이덴티티 하나를 넘긴다(액션 브리지와 같은 형태).
  `typingAgentNames(messageId)`처럼 호출마다 새 배열을 만드는 헬퍼도 내용이 같으면
  이전 값을 돌려주도록 캐시해야 memo가 산다.
- **App은 이제 런 변경에 0회 리렌더한다.** 열린 보드를 구독하는 것은
  `components/app/InboxBridge.tsx` 하나이고, 인박스 결과는 `state/inbox`로 게시된다.
  `src/App.test.tsx`가 이것을 고정한다.

### 기준 갱신 (2026-09-04, Phase 8 이후)

영속화를 붙이며 확인한, 후속 작업에 영향을 주는 사실:

- **`restoringSessionAtom`의 writer가 둘이 되었다.** 스냅샷을 찾은 부팅은
  `state/persistence/useHydration`이 게이트를 열고, 부트스트랩은 그 뒤에서 계속
  돈다. Phase 7까지 사실이던 "부트스트랩만 쓴다"는 더 이상 맞지 않는다.
- **두 부팅 경로의 순서는 명시적 게이트다.** `useHydration`이 마운트하며 동기로
  게이트를 열고(`beginHydration`), 부트스트랩이 커밋 **직전에** 기다린다. 게이트를
  연 적이 없는 레지스트리에서 `awaitHydration`은 resolved promise가 아니라 `null`을
  돌려주므로, 하이드레이션 없이 부트스트랩만 마운트하는 기존 테스트는 tick을 하나도
  더 쓰지 않는다. React effect가 훅 호출 순서대로 도는 것이 이 계약의 전부이므로
  `AppEffects`에서 `useHydration()`은 반드시 첫 줄이다.
- **부팅 시점에 저장소를 비우는 훅이 둘 있었다.** `useTeamSync`의 토큰 변경 감지는
  `null → 토큰` 전이를 계정 변경으로 보고 `session-cleared`를 쏘고,
  `useChannelCatalogSync`의 첫 effect는 무조건 현재 조직의 카탈로그를 비운다. 둘 다
  하이드레이션된 계정·조직일 때만 건너뛴다(`adoptsHydratedSession` /
  `adoptsHydratedCatalog`). 부팅 시점에 상태를 심는 기능을 또 만든다면 이 두 자리를
  먼저 확인한다.
- **팀 선택을 부트스트랩에 맡기면 화면이 튄다.** `resolveActiveAccountSelection`은
  조직의 **첫 번째** 팀을 고르므로, 마지막으로 보던 팀이 그 팀이 아니면 스냅샷을
  렌더한 직후 다른 팀으로 이동한다. 계정이 그 팀을 여전히 갖고 있고 해석된 조직에
  속하면 하이드레이션된 선택을 유지한다.
- **`Schema.Struct`는 이름 짓지 않은 속성을 버린다.** 서버 DTO를 그대로 되돌려야
  하는 엔티티는 `Schema.Record(Schema.String, Schema.Unknown)` + 식별 키 필터로
  검사한다. 봉투(schemaVersion / userId / 인덱스 모양)만 엄격히 본다.
- **`Schema.Number`는 typecheck를 깬다.** `tsc`가 TS377098 제안을 오류로 취급하므로
  유한 실수는 `Schema.Finite`, 정수는 `Schema.Int`를 쓴다.
- **jsdom에는 IndexedDB가 없다.** `defaultSnapshotStore()`가 no-op으로 떨어지므로
  기존 테스트는 영속화를 켜도 아무 영향을 받지 않고, 저장소 테스트는 가짜
  `IDBFactory`를 주입해 요청 배선만 검사한다.
- **부팅 키는 네트워크 없이 알아야 한다.** `lib/active-organization`의 조직 키는
  `userId`가 있어야 읽을 수 있어서, 마지막 계정 포인터
  (`briar.snapshot-account.v1`)를 localStorage에 따로 둔다. 팀 창은
  `useActiveOrganizationPersistence`와 같은 이유로 이 포인터를 쓰지 않는다.
- **내비게이션 위치는 여전히 저장되지 않는다.** 콜드 부팅은 마지막 **데이터**를
  즉시 렌더하지만 페이지는 기본 위치에서 시작한다. 위치 복원은 별도 결정이다.

### 기준 갱신 (2026-09-04, Phase 2C 이후)

보드를 id로 그리며 확인한, 같은 형태의 뷰를 옮길 때 쓸 사실:

- **보드는 컴포넌트 하나가 아니라 구독 경계 다섯 개다.** 크롬(`HuntBoard`),
  카운트 두 개(`BoardTaskCount` / `BoardStatusTabs`), 칸반(`BoardKanban`),
  컬럼(`BoardColumn`), 카드(`BoardCard`). 각 경계가 자기 atom만 읽어야 "런 하나
  변경 → 카드 하나"가 나온다. 카운트를 크롬 본문에서 읽으면 상태 하나 바뀔 때마다
  헤더가 다시 그려진다.
- **키보드 순서가 그룹핑에 묶여 있다.** 칸반의 이동 규칙은 "보이는 컬럼들의 id를
  이어 붙인 것"이므로 `BoardKanban`은 그룹핑 맵을 구독할 수밖에 없다. 그래서
  `boardGroupedRunIdsAtom`에는 컬럼별 배열을 **원소 단위로** 비교하는 equality가
  필수다. 없으면 제목 한 글자만 바뀌어도 매번 새 `Map`이 나와 칸반 전체가 다시
  그려진다.
- **`Atom.family`는 키가 하나다.** 팀 + 컬럼, 팀 + 런처럼 두 축이 필요한 파생은
  `boardColumnKey` / `boardRunKey`로 문자열을 합치고 `splitBoardKey`로 되돌린다.
  구분자는 `"\u0000"`인데, 파일에 **진짜 NUL 바이트**를 쓰지 않도록 이스케이프
  시퀀스로 적어야 한다(한 번 실수했다).
- **닫힌 다이얼로그는 빈 id로 읽는다.** 열린 런·편집 중인 런·삭제 확인 중인 런을
  `runAtom(id ?? "")`로 읽으면 아무것도 열려 있지 않을 때 셋 다 같은 `null`이라
  알림이 오지 않는다. 조건부 훅 없이 "지금은 구독하지 않는다"를 표현하는 방법이다.
  런 목록도 마찬가지로 `teamRunsAtom(selected ? teamId : "")`로 열었을 때만 붙는다.
- **`memo`는 프롭 묶음이 있어야 산다.** 카드가 받는 것은 `runId`와 컨텍스트 객체
  하나뿐이고, 핸들러는 **자기가 받은 런**을 인자로 되돌려 준다(`MessageRowHandlers`
  와 같은 형태). 카드마다 클로저를 만들면 컬럼이 다시 그려질 때 카드도 전부 따라
  그려진다.
- **뷰 상태의 스코프는 언마운트가 결정하고 있었다.** `query` / `source` / `status`
  / `view`는 페이지를 떠나면 초기화되고 `propertyFilters`만 팀 전환에도 초기화된다.
  전역 atom으로 올릴 때 이 두 규칙을 `resetBoardViewState`(마운트)와
  `resetBoardPropertyFilters`(팀 전환)로 명시하지 않으면 조용히 동작이 바뀐다.
- **컴패니언과 데스크톱의 상태 탭은 원래 다른 상태였다.** 하단 바가 쓰는
  `navigation/companionStatusAtom`과 보드의 `boardStatusAtom`을 하나로 합치려면 첫
  페인트에 프롭을 미러링해야 해서 화면이 튄다. 파생 atom을 둘로 나누는 편이 맞다.
- **`IssueCollection`은 남는다.** "내 이슈"는 이 창이 선택한 적 없는 팀의 대시보드를
  직접 불러오므로 그 런들은 엔티티 저장소에 없다. 행 마크업만
  `IssueListRow` / `IssueListHeader`로 뽑아 두 목록이 공유한다.
- **보드 테스트는 페이로드를 레지스트리에 심는다.** `test/board-harness.tsx`의
  `BoardHarness`가 `dashboard` 프롭을 받아 첫 렌더에서 동기로
  `applySyncEvent(team-snapshot)`을 적용하므로(그때는 구독자가 없다) 기존 36개
  렌더 지점은 컴포넌트 이름만 바꾸면 됐고, `renderToStaticMarkup`도 그대로 돈다.
  이후 페이로드는 effect에서 적용한다.
- **`renderCounter.track`은 여전히 프롭 렌더만 센다.** 구독 경계별 카운트는 같은
  atom을 읽는 프로브 컴포넌트를 형제로 두고 세며, 실제 보드는 옆에서 같은
  레지스트리로 렌더해 DOM으로 검증한다.

### 기준 갱신 (2026-09-04, 후속 F1 이후)

하이드레이션 가드를 붙이며 확인한, 부팅 시점 상태를 다루는 후속 작업에 필요한 사실:

- **하이드레이션은 `applySyncEvent`를 거치지 않는다.** `applySnapshot`이 같은 atom을
  직접 쓰므로, "서버가 답했다"를 나타내는 표시는 진입점 쪽에만 세워야 디스크 복원과
  구별된다. `teamSyncedSinceBootAtom`은 `applySyncEvent`의 `team-snapshot` /
  `team-delta`가 세우고 `clearTeamState`가 되돌린다.
- **부팅 시점 상태의 소비자는 두 종류다.** 저장된 값을 *그리는* 뷰는 그대로 두면
  되지만, 저장된 값을 보고 *서버 작업을 시작하는* effect는 확인을 기다려야 한다.
  같은 형태의 effect를 추가할 때 이 구분을 먼저 한다.
- **아무것도 바꾸지 않은 델타도 확인이다.** 재개 커서가 빈 페이지를 물고 와도 그것은
  저장된 상태가 최신이라는 서버의 답이므로 플래그를 세운다. 레지스트리가 같은 값의
  쓰기를 버리므로 조용한 폴링 틱의 알림 0회는 그대로다.
- **`hydratedAccountAtom`은 세션 내내 유지된다.** 하이드레이션된 부팅에서는 팀
  전환으로 새로 여는 팀도 같은 규칙을 받지만, 그 팀의 설정은 어차피 첫 동기화가
  채우므로 동작 차이는 없다.

### 기준 갱신 (2026-09-04, 후속 F2 이후)

`dashboardViewAtom`을 지우며 확인한, 같은 형태의 "통짜 값을 읽는 소비자"를 옮길 때
쓸 사실:

- **통짜 페이로드를 읽던 자리는 네 종류로 갈렸다.** ① 그리는 프로젝션 하나만 읽는
  뷰(대부분), ② 한 벌을 함께 쓰는 페이지의 **조합 atom**(`teamAgentBoardAtom`,
  `inboxSourceAtom` — `withEquality`가 참조 네 개를 비교하므로 안 읽는 프로젝션은
  깨우지 못한다), ③ 액션의 호출 시점 `registry.get`, ④ 와이어 응답을 그대로 쓰는
  자리(`MyIssues`). 새 소비자를 만들 때 이 넷 중 어디인지 먼저 정한다.
- **"화면에 있는 팀" 가드는 이제 하나다.** `loadedTeamIdAtom`(선택 + 로드됨)과
  `renderedTeamSettingsAtom(teamId)`이 `dashboard?.team.id === teamId` 검사 열 곳을
  대신한다.
- **콜백만 부르는 구독은 렌더가 필요 없다.** `InboxBridge`의 디스패치 조정은 보드
  전체를 필요로 하지만 값을 그리지 않으므로, effect 안의
  `registry.subscribe(atom, f, { immediate: true })`로 옮겼다. 호출 빈도는 그대로고
  리렌더만 0이 된다. `immediate`는 마운트 시 현재 값을 주는 동시에 파생 atom의
  의존 그래프를 만든다.
- **`renderCounter.track`으로는 구독 렌더를 셀 수 없다.** 래퍼는 부모가 프롭을 밀어
  넣을 때만 다시 그려지므로, 스스로 깨어나는 컴포넌트에 대한 "0회"는 언제나 참이다
  (이 사실을 모르고 쓴 기존 케이스가 하나 있었다). `renderCounter.profile`(React
  `Profiler`)이 서브트리의 **커밋**을 세므로 0회만 강한 주장이 된다. 서브트리를
  세기 때문에, 보드를 그리는 페이지에서는 "카드가 다시 그려진 것"과 "페이지가
  깨어난 것"이 구별되지 않는다 — 그런 주장은 보드가 없는 페이지에서 측정한다.
- **인박스는 알림이 될 수 있는 런만 있으면 된다.** 상태가 알림 상태이거나 대화
  알림이 가리키는 런만 실으면 메시지 결과가 같다. 진행률만 움직인 폴링 틱이
  브리지를 깨우지 않는 것은 이 필터 덕분이다.
- **스냅샷은 이미 엔티티 맵에서 모으고 있었다.** `collectSnapshot` /
  `applySnapshot`은 팀별 family를 하나씩 읽고 쓰므로 직렬화 형태가 뷰와 무관했다.
  `SNAPSHOT_SCHEMA_VERSION`은 1 그대로이고 저장된 스냅샷은 그대로 읽힌다.
- **페이로드를 다시 조립하는 곳은 테스트에만 남았다.** `src/test/team-view.ts`의
  `readTeamView` / `readActiveTeamView`가 그것이며, "서버가 보낸 것을 저장소가
  그대로 들고 있나"를 묻는 케이스(진입점·로더·스냅샷)가 쓴다. 앱 코드에서 쓰면
  F2가 되돌아온다.
- **`bun audit`이 로컬 CI의 유일한 상시 실패원이다.** 네트워크가 느리면 300초쯤에
  끊기고, 바로 앞에 손으로 한 번 돌려 두면 1초에 캐시로 끝난다. 사인오프 전에
  `bun run audit:dependencies`를 먼저 돌리는 편이 빠르다.

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
`useChannelConversation`의 전환(후속 F3 / F4 / F5가 전부 끝냈다), 서버 API 변경,
오프라인 우선과 멀티 디바이스 충돌 해결.

## 결과

계획대로 끝났다. 2026-09-04 기준 `main`의 숫자다.

- **`useBriar.ts`는 삭제되었다.** 기준 커밋에서 4,668줄이었고, `apps/briar/src`에
  `useBriar` 참조와 `briar.` 멤버 접근이 0개다.
- **`App.tsx`는 5,116줄 → 419줄이다.** 목표였던 "500줄 이하"를 지켰고, 남은 것은
  `AppEffects` + `AuthGate` + 셸 선택 + `AppDialogs` 조립이다.
- **`apps/briar/src/state/`가 25개 도메인, 소스 95개와 테스트 64개다.** 엔티티 맵과
  동기화 진입점, 도메인 액션, 부수효과 훅, 영속화가 전부 여기에 있다(후속 F3~F5-4가
  에이전트 세션·인박스·채널 대화를 더한 뒤의 숫자다).
- **PR 24개(#1581–#1605)로 나눠 머지했다.** 가장 긴 것도 하루 안에 머지 가능한
  크기였고, 두 고변경 파일과의 충돌로 되돌린 PR은 없다.
- **렌더 카운트로 고정된 보장 8가지.** 5·6은 후속 F2가, 7·8은 후속 F5가 더했고, 그것은
  `renderCounter.profile`(React `Profiler`)로 센다 — 구독이 컴포넌트 안으로 밀어
  넣은 렌더는 `track`이 볼 수 없다.
  1. 변경 없는 폴링 틱: 셸·보드·행 모두 리렌더 0회
     (`components/app/HuntDashboardWithTeam.test.tsx`).
  2. 런 하나의 내용 변경: 그 런의 카드 1회, 그 외 0회 — 다른 카드도, 컬럼 헤더도,
     보드도, 셸도 리렌더되지 않는다(같은 파일).
  3. 런 하나의 상태 변경: 그 카드와 **떠난 컬럼·도착한 컬럼**의 id 목록, 칸반의
     키보드 순서, 상태 탭 카운트만 리렌더된다(같은 파일).
  4. 열린 런이 바뀔 때 셸 리렌더 0회(`RunPageWithRun.test.tsx`), 페이지 이동 시
     크롬·상태 표시줄 리렌더 0회(`DesktopPages` 렌더 카운트 테스트).
  5. 런 하나의 변경: 보드를 그리고 있지 않은 셸(`DesktopPages` / `CompanionShell`),
     창 내비게이션 컨트롤, 인박스 브리지 모두 리렌더 0회
     (`DesktopPages.test.tsx`, `CompanionShell.test.tsx`).
  6. 팀 설정 변경: 설정을 읽는 구독만 리렌더된다(`DesktopPages.test.tsx`).
  7. 채널 메시지 하나 변경: 그 행만 리렌더되고 목록은 깨어나지 않는다
     (`Channels.message-row.test.tsx`).
  8. 에이전트 답장 틱: 그 메시지의 타이핑 스트립만 리렌더된다 — 메시지 본문도, 다른
     스트립도, 목록도 아니다(`Channels.typing-strip.test.tsx`).
- **훅이 소유한 도메인이 남아 있지 않다.** `hooks/`에 있던 `useBriar` /
  `useAutoHuntSessions` / `useInbox` / `useChannelConversation` 넷이 전부
  `state/<domain>`이 되었고, 마지막 하나(1,892줄)는 후속 F5-4가 지웠다.
  `apps/briar/src`에 `useChannelConversation` 참조가 0개다.
- **콜드 부팅은 네트워크 응답 전에 마지막 대시보드를 그린다**
  (`state/persistence/cold-boot.test.tsx`). 그 화면을 **그리는** 것과 그 화면으로
  **행동하는** 것은 후속 F1이 갈라 두었다. 디스크에서 올라온 값으로 서버 작업을
  시작하는 effect는 `teamSyncedSinceBootAtom`이 설 때까지 기다리므로, 하이드레이션된
  "pending" 워크플로 때문에 LLM 자동 생성이 한 번 더 도는 문제는 남아 있지 않다.

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

### Phase 5. 셸 분리 (M) — 완료

- `AuthGate`, `DesktopShell`, `CompanionShell`, `AppDialogs`,
  `InboxDetailContent`, `AppSettingsSidebar` 컴포넌트 추출.
  `WorkerDispatchDialog` 이중 렌더 제거, `AppEffects` 단일 마운트.
- 셸 사이에 끼어 있던 App 소유 로직은 훅 5종(`useRepositorySetup`,
  `useIssueAgents`, `useAgentDispatch`, `useInvitationFlow`, `useLaunchIntro`)
  으로 나갔다.
- App.tsx는 `AppEffects` + `AuthGate` + 셸 선택 + `AppDialogs` 조립만 남는다.
- 결과: App.tsx 3,053줄 → 783줄, `briar.` 키 42개 → 28개. Phase 6이 가져갈
  내비게이션 블록은 `hooks/useAppNavigation.ts`로 그대로 옮겨 두었다.

### Phase 6. 내비게이션 (M, 결합도 최고) — 완료

- 방문 스택을 `state/navigation/atoms.ts`의 `navigationHistoryAtom` 하나로 옮기고,
  `activePage` / `activeRunId` / 위치가 가리키는 팀·조직·채널 id / 뒤·앞 가능
  여부를 파생 atom으로 노출했다. 리듀서는 `state/navigation/history.ts`에 그대로
  남아 있다.
- 이동 콜백은 `state/navigation/actions.ts`의 레지스트리 바인딩 액션이 되었고,
  조정 effect 6개는 순서 계약을 문서화한 채
  `state/navigation/useNavigationReconciliation.ts`로 나가 `AppEffects`가
  마운트한다. `hooks/useAppNavigation.ts`와 `DesktopShellNavigation` 프롭 묶음은
  사라졌다.
- 데스크톱 셸은 창 크롬 / 사이드바 / **페이지 슬롯**(`DesktopPages`) / 상태
  표시줄로 갈라졌다. 페이지 슬롯과 사이드바만 위치를 구독하므로 이동 한 번이
  크롬과 상태 표시줄을 건드리지 않는다.
- 완료 조건 달성: 내비게이션 관련 기존 테스트(리듀서 테스트는
  `state/navigation/history.test.ts`로 이동, 키보드 커맨드 테스트) 통과.
  `Sidebar`(`SidebarWithSession`)와 `CompanionHeader`
  (`CompanionHeaderWithSession`)가 페이지 atom을 직접 구독.

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
| 스케줄 러너 effect(818)가 옵션 콜백 아이덴티티 변화마다 재시작 | 콜백 ref 고정. 후속 F3이 레지스트리 바인딩 액션으로 대체했다 |
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

- **훅이 소유한 도메인은 전부 옮겨졌다.** `useAutoHuntSessions`는 후속 F3이,
  `useInbox`는 후속 F4가(둘 다 localStorage 상태는 `Atom.kvs`가 아니라 atom의 lazy
  read가 됐다 — 이유는 아래 기준 갱신에 있다), `useChannelConversation`은 후속 F5가
  저장소를(#1631 / #1633 / #1638), 후속 F5-4가 나머지 절반 — 요청 순서, 로더, 실시간,
  액션, 답장 버전 부기 — 을 옮기고 훅을 지웠다. 남은 훅 소유 로직은 `useStatusTray`의
  i18n 의존 effect뿐이다.
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
| 2A | #1584, #1585 | 머지됨 | #1584: `state/entities`(runs / teams / workers / members / providers / channels / upsert / retention), `state/team`의 팀별 family, `state/sync`의 `events` / `apply` / `view`. #1585: `sync/loader`, `sync/useTeamSync`, `useBriar` 파사드를 `dashboardViewAtom` 위로 옮기고 `dashboardRef` / `dashboardCursor` / `dashboardRequest` / `dashboardRequestGeneration` / `dashboardCache` 제거. Phase 1의 대시보드 주입 콜백 8개 삭제. |
| 2B | #1586, #1587 | 머지됨 | #1586: `sync/optimistic`, `state/issues`(atoms / actions), `state/run-detail`(atoms / actions), `useBriar`의 `setDashboard` 제거. #1587: `components/app`의 `HuntDashboardWithTeam` / `RunPageWithRun` / `TeamViewsWithDashboard`, App.tsx의 삼중 이슈·런 프롭 블록 삭제와 렌더 카운트 테스트. 보드 목록의 id 전용 렌더는 후속. |
| 3 | #1588, #1589 | 머지됨 | #1588: `state/workspace`(atoms / api / health / readiness / actions / `useWorkspaceSync`), `state/workflow`(actions / `useWorkflowAutoGeneration`), `state/integrations`(atoms / actions), `sync/events`의 `team-settings-changed`와 `sync/commit`. `useBriar`의 workspace `useState` 7개·ref 5개와 `commitTeamDashboard` / `commitTeamSettings` 제거, Phase 1 주입 콜백 3개(`bumpReconnectRequest`, `clearWorkspaceViews`, `resetTeamHealth`) 삭제. `AutoHuntSession` 계열 타입을 `types.ts`로. #1589: `components/app/WorkspaceViews`의 연결 래퍼 4종과 `TeamSettingsWithDashboard` 확장, App.tsx 프롭 블록 삭제, 파사드에서 25개 키 제거. |
| 4 | #1590, #1591 | 머지됨 | #1590: `entities/channels` 연결(저장 인덱스), `sync`의 채널 카탈로그 이벤트 4종, `state/channels`(atoms / api / actions / `useChannelCatalogSync`), `components/app`의 `ChannelViews` 3종과 `CommandPaletteWithContext`, `lockedTeamIdAtom`을 `state/platform.ts`로 통합. #1591: `state/dialogs`와 `state/navigation` atom, `hooks`의 `useStatusTray` / `useDeepLinks` / `useCommandPaletteItems` / `useAppShortcuts` / `useWorkerDispatch`, `lib/navigation-history-items`, `AppDialogViews`와 `AppSettingsWithWorkspace` 래퍼, `Sidebar` / `OrganizationSettings` / `TeamLobby` 래퍼 확장. App.tsx 4,947줄 → 3,053줄, `briar.` 키 55개 → 42개. |
| 5 | #1592, #1593, #1594, #1595 | 머지됨 | #1592: `hooks`의 `useRepositorySetup` / `useIssueAgents` / `useAgentDispatch` / `useInvitationFlow` / `useLaunchIntro`, `components/app`의 `InboxDetailContent` / `AppSettingsSidebar`, `lib`의 `inbox-detail-label` / `team-window-scope`. #1593: `AuthGate` / `AppDialogs` / `CompanionShell`, `AppEffects` 단일 마운트, `WorkerDispatchDialog` 이중 렌더 제거, 5-1이 남긴 죽은 import 정리. #1594: `DesktopShell`과 트리가 나가며 드러난 죽은 로컬 40여 개 제거. #1595: 내비게이션 블록을 `hooks/useAppNavigation.ts`로 그대로 이동(Phase 6의 첫 항목을 미리 끝냄). App.tsx 3,053줄 → 783줄, `briar.` 키 42개 → 28개. |
| 6 | #1596, #1597, #1598 | 머지됨 | #1596: `state/navigation`의 `history` / `atoms`(방문 스택 + 파생 12종) / `actions` / `useNavigationReconciliation`, `hooks/useAppNavigation`을 호환 훅으로 축소, `setDefaultTeam` 제거. #1597: 조정 effect를 `AppEffects`로, `useAppNavigation` 삭제, `WindowNavigationControlsWithHistory` / `CompanionHeaderWithSession` 래퍼, `SidebarWithSession`의 페이지 구독, `useAppShortcuts`(11→4) / `useCommandPaletteItems`(16→5) / `useDeepLinks` / `useRepositorySetup` / `AppDialogs` / `CommandPaletteWithContext`의 내비게이션 프롭 제거. #1598: `DesktopPages` 페이지 슬롯 분리와 렌더 카운트 테스트. App.tsx 783줄 → 661줄, `briar.` 키 28개 유지(전부 세션·로그인). |
| 7 | #1599, #1600, #1601 | 머지됨 | #1599: `state/session`의 `api` / `useSessionBootstrap` / `useAuthReturnListener`와 로그인 액션 6종(폴링 상태는 registry `WeakMap`), `state/team`의 `selectTeam` / `ensureTeamSelected`와 `getTeamActions`, `state/sync/actions`의 `refreshActiveTeam`, `state/planning/usePlanningProjectsSync`, `state/action-bridges`. `IssueActionBridge.selectTeam`과 `AppEffects` / `useNavigationReconciliation`의 `selectTeam` 프롭 제거, 데모 선택 시드를 모듈 상수로, `lib/default-organization` 삭제. #1600: `useBriar.ts` 삭제, `components/app/InboxBridge`와 `state/inbox`(atoms / actions), `state/app-error`, `hooks/useOrganizationViewData`. 훅 6종과 게이트·셸·페이지가 프롭 대신 액션 훅을 쓴다. App.tsx 661줄 → 421줄, `briar.` 키 28개 → 0개. #1601: `state/status-tray`와 `state/deep-links`의 구독형 atom 5종(`addFinalizer` + `setIdleTTL`), `MessageRow` memo 복구와 렌더 카운트 테스트. |
| 8 | #1602, #1603 | 머지됨 | #1602: `state/persistence`의 `snapshot`(조직 단위 `ClientSnapshot` + Effect Schema 검증 + `collectSnapshot` / `applySnapshot`), `store`(`SnapshotStore`와 IndexedDB / 인메모리 / no-op 구현, `snapshotStoreAtom` 이음매, 예외를 삼키는 접근 래퍼), `account`(부팅 포인터), `useSnapshotWriter`(1초 창 디바운스, hidden·pagehide 즉시 기록, 조직 이탈 시 삭제). `clearSessionState`가 저장소 전체를 함께 비운다. #1603: `hydration`(게이트와 `hydratedAccountAtom`)과 `useHydration`, `AppEffects`의 첫 훅. 부트스트랩이 커밋 직전에 게이트를 기다리고 계정이 다르면 폐기하며, `useTeamSync`와 `useChannelCatalogSync`가 부팅 시점의 초기화를 건너뛴다. 저장된 커서에서 델타로 따라잡고 410이면 스냅샷으로 대체한다. |
| 2C | #1604, #1605 | 머지됨 | Phase 2 완료 조건 2를 닫는다. #1604: `components/hunt/model/filters.ts`를 `state/board/filters.ts`로 옮기고 검색 텍스트·상태 탭·목록 필터·컴패니언 정렬을 순수 함수로 뽑음. `state/board`의 `columns`(컬럼 정의와 런 배정, 체크포인트 경계), `atoms`(보드 뷰 상태와 `boardScopedRunIds` / `boardRunIds` / `boardStatusCounts` / `boardColumnDefinitions` / `boardGroupedRunIds` / `boardColumnRunIds` / `boardVisibleColumnIds` / `companionRunIds` / `boardRun`), `run-facts`(`runAgentAssociation` / `runAssignedWorker` / `runAssignee`와 게시 훅 `useBoardSources`). #1605: `HuntDashboard`에서 `dashboard` / `activeIssueProjectId` 프롭 제거, `board`의 `HuntBoard` / `BoardKanban` / `BoardColumn` / `BoardCard` / `BoardIssueList` / `BoardFilterBar` / `CompanionTaskBoard`와 공용 행 `IssueListRow` / `IssueListHeader`, `test/board-harness`. `HuntDashboardWithTeam`이 `activeDashboardAtom` 구독을 끊었다. `HuntDashboard.tsx` 1,279줄 → 737줄. |

## 후속 실행 기록

계획 범위 밖에서 뒤늦게 드러난 항목이다. 같은 규칙으로 PR 하나씩 머지하고 여기에
기록한다.

| 항목 | PR | 상태 | 비고 |
|---|---|---|---|
| F1 워크플로 자동 생성 하이드레이션 가드 + `useDeepLinks` 이름 정리 | #1607 | 머지됨 | `state/team/atoms.ts`에 팀별 `teamSyncedSinceBootAtom`을 두고 `applySyncEvent`의 `team-snapshot` / `team-delta`가 세운다(`clearTeamState`가 되돌리고, 같은 값의 쓰기는 레지스트리가 버리므로 조용한 틱의 알림은 그대로 0회다). `useWorkflowAutoGeneration`은 하이드레이션된 부팅에서 이 플래그가 서기 전까지 조건을 보지 않으므로, 디스크에서 올라온 pending 플레이스홀더로 LLM 자동 생성이 한 번 더 도는 일이 없다. 스냅샷을 읽지 않은 부팅과 팀 전환은 그대로다. `useWorkflowAutoGeneration.test.tsx`에 하이드레이션 케이스 3종 추가. `useDeepLinks`의 지역 변수 `listeners`는 실제로 리졸버를 담고 있어 `resolvers`로 고쳤다(네이티브 리스너 4종을 가리키는 주석은 그대로 둔다). |
| F2 `dashboardViewAtom` 제거 | #1608, #1615, #1618 | 머지됨 | 통짜 `DashboardPayload`를 읽던 19개 모듈을 옮기고 `state/sync/view.ts`를 지웠다. #1608: `loadedTeamIdAtom` / `renderedTeamSettingsAtom`(`state/team`)과 `activeTeamTrayRunsAtom`(`state/status-tray`), 액션 여섯 곳과 훅 다섯 개. `useCommandPaletteItems`는 팔레트가 열렸을 때만, `useDeepLinks`는 id 목록만 구독하고 `useAgentDispatch`는 구독을 아예 끊었다. `MyIssues`는 자기가 읽는 네 프로젝션(`MyIssuesTeamBoard`)만 받는다. #1615: 뷰 일곱 개와 `inboxSourceAtom` / `navigationHistoryRunLabelsAtom` / `teamAgentBoardAtom`, `InboxBridge`의 디스패치 조정을 effect 구독으로, `TeamLobby` / `TeamSettings` / `TeamAgents` 계열과 `useInbox` / `inboxDetailLabel` / `executeTeamAgentTask`의 프롭·인자 좁히기, `test/render-count.tsx`의 `profile`(React `Profiler`)과 `run-changed` / `team-settings-changed` 렌더 카운트. #1618: `state/sync/view.ts`와 그 테스트 삭제, 페이로드 단위 단언은 테스트 전용 `test/team-view.ts`로, `dashboard-view.test.tsx` → `team-sync.test.tsx`. 스냅샷은 이미 엔티티 맵에서 모으고 있어 `SNAPSHOT_SCHEMA_VERSION`은 1 그대로다. |
| F3 `useAutoHuntSessions` 전환 | #1621, #1626 | 머지됨 | 에이전트 세션을 `state/agent-sessions`로 옮기고 훅을 지웠다. #1621: `model`(순수 헬퍼 6종과 `reconcileDispatchSession`), `atoms`(`agentSessionsByIdAtom` + 저장 순서 `agentSessionIdsAtom`, `agentSessionAtom(id)` / `teamAgentSessionIdsAtom(teamId)` / `agentSessionsAtom` / `agentSessionSyncContextAtom` / `synchronizedTeamIdsAtom`), `persistence`(레거시 `briar.auto-hunt-sessions.v1` 키와 중단 세션 마이그레이션), `useAgentSessionPersistence`(250ms 디바운스 + `pagehide` flush), `sync/events`·`apply`의 `agent-sessions-changed` / `-merged` / `-synced` / `-removed`, `actions`(`createAgentSessionActions` + `agentSessionApiAtom` 이음매), `useAgentSessionSync`(configureSync·실시간 새로고침·업로드·네이티브 복구·디스패치 리스너, 그리고 `InboxBridge`에서 가져온 `reconcileWorkerDispatches` 구독). #1626: 소비자 전환. `agentSessionRowIdsAtom` / `teamRunningAgentIdsAtom` / `agentDispatchSessionIdAtom` / `runningAgentSessionsAtom` / `processingIssueIdsAtom`을 더하고 Agents 뷰 3종·사이드바·커맨드 팔레트·인박스·보드가 직접 구독한다. `state/action-bridges.ts`와 `IssueActionBridge` / `WorkspaceScheduleBridge`, `boardSessionsAtom`, `hooks/useAutoHuntSessions.ts`가 사라졌고 `App.tsx`는 세션을 구독하지 않는다. |
| F4 `useInbox` 전환 | #1629, #1630 | 머지됨 | 인박스를 `state/inbox`로 옮기고 마지막 레지스트리 콜백 브리지를 지웠다. #1629: `model`(순수 함수 13종과 타입 — `hooks/useInboxNotifications`의 순수 헬퍼 3종 포함), `persistence`(레거시 키 `briar.inbox.v1:<userId>`와 `{ messages, readVersions }` 형식 그대로), `atoms`(`inboxStateAtom`의 lazy read + 저장 키 의존, `currentInboxMessagesAtom` / `inboxMergeSourcesAtom`, 파생 `inboxMessagesAtom` / `inboxMessagesByIdAtom` / `inboxMessageAtom(id)` / `inboxUnreadCountAtom` / `visibleInboxMessagesAtom` / `visibleInboxUnreadCountAtom`, 두 동기화 신원과 그 위의 `inboxInitialSyncCompleteAtom` / `inboxNotificationBaselineIdAtom`), `api`(`inboxApiAtom` 이음매), `read-sync`(읽음 버전 왕복의 세대 객체), `actions`(네 액션이 호출 시점 레지스트리 읽기로), `useInboxSync`(읽음 왕복 · 보드→저장소 병합 구독 · 조직 피드와 실시간), `useInboxNotifications`(시스템 알림 · 앱 배지 · 클릭 라우팅, 셋 다 구독). `hooks/useInbox.ts`(1,416줄) / `hooks/useInboxNotifications.ts` / `components/app/InboxBridge.tsx`와 `setInboxCallbacks` 삭제, `AppEffects`가 두 훅을 마지막에 마운트해 브리지가 형제로 렌더되던 effect 순서를 유지한다. 테스트 헬퍼 `src/test/inbox.ts`. #1630: `visibleInboxMessageSummariesAtom`을 더하고 `Inbox`의 `messages` 프롭을 요약으로 좁혀 각 행이 `inboxMessageAtom(id)`를 구독한다. `InboxSelectionBoundary`가 연결 경계가 되고(`InboxWithSelection` / `CompanionInbox`) `DesktopPages` / `CompanionShell`이 인박스 메시지 구독을 끊었다. |
| F5 `useChannelConversation` 저장소 전환 | #1631, #1633, #1638 | 머지됨 | 채널 대화를 `state/channel-conversation`으로 옮겼다. #1631: `model`(훅 안에 있어 테스트가 없던 순수 함수 — 에이전트 답장 병합과 우선순위, 답장 요약 증감과 되돌림, 타이핑 이름과 활동 프레임, 작성자 신원, 목록 요약), `atoms`(채널별 `channelMessagesByIdAtom`과 루트·스레드 저장 인덱스, 행 단위 `channelMessageAtom(key)`, 참여자·에이전트 답장·커서·정착 답장, 목록 전용 `channelRootMessageSummariesAtom`, 채널 5개 / 채널당 스레드 5개 LRU), `sync/events`·`apply`의 대화 이벤트 8종, `entities/upsert`의 `replaceEntitiesBy`. #1633: 소비자 전환. `Channels`의 `useState` 7개와 상한 없는 `channelCache`, `CompanionChannels`의 `useState` 6개와 `CompanionChannelCache` 전체(상한 상수 3개와 캐시 함수 5개)가 사라지고 두 뷰가 같은 저장소를 읽는다. 모든 쓰기를 모은 `write.ts`와 뷰 어댑터 `useChannelConversationStore.ts`를 더했고, 레지스트리 `WeakMap` 캐시 홀더와 `channelCache` 프롭도 없앴다. #1638: 훅에서 `messages` / `messageNextCursor` 프롭을 없애 호출 시점 레지스트리 읽기로 바꾸고, 목록이 요약을 읽고 행이 `channelMessageAtom`을 구독하는 `ChannelMessageRow`를 더했다. `Channels.message-row.test.tsx`가 `profile`로 "메시지 하나 변경 → 그 행만"을 고정한다. |
| F5-4 `useChannelConversation` 삭제 | #1642, #1648, #1649 | 머지됨 | 훅에 남아 있던 요청 순서·로더·실시간·액션을 `state/channel-conversation`으로 옮기고 지웠다. **#1642**: `loader`(표면 생성 카운터·요청 버전·AbortController와 네 읽기 — 채널 상세, 이전 페이지, 스레드 스냅샷, 승인 재조회 — 를 전부 `applySyncEvent`로, 제안 이력과 승인된 제안의 대시보드 캐시 포함), `reply-ledger`(답장 관측 버전 — id 집합으로는 요청 중 종료 상태로 바뀐 답장을 지킬 수 없다), `errors`(실패 발행 atom과 구독형 토스트). `channel-conversation-snapshot`의 `members` / `agents`를 옵셔널로 만들어 이전 페이지 응답이 같은 이벤트를 쓴다. **#1648**: `actions`(쓰기 13종 + 호출 시점 컨텍스트 접근자로 받는 이미지 캐시·셸 콜백·번역), `useChannelConversationSync`(실시간 전송 수명), `incoming`(서버가 밀어 넣은 페이지의 단일 진입점, "이 실패가 새 실패인가"만 호출자에게 돌려준다), `useChannelConversationTyping`. 훅(1,387줄)과 `useChannelConversationStore`(204줄)가 사라지고 두 뷰가 뷰 상태 8종을 채널별 atom으로 구독한다. 옛 훅 테스트 20 케이스를 `actions` / `useChannelConversationSync` / `incoming` / `loader` 테스트로 옮겼다. **#1649**: 델타 루프를 하나로 합쳤다 — `useChannelCatalogSync`가 커서를 갖고 페이지를 `publishChannelDelta`로 나르면 대화가 구독한다(`state/channels/delta.ts`). `isBlocked` 가드와 `Channels`의 자체 `listChannels` 폴백, 두 뷰의 커서 ref가 사라졌다. 타이핑 스트립을 잎으로 격리했다: `channelAgentActivityAtom`과 `ChannelActivityPublisher`, 메시지별 `channelMessagePendingRepliesAtom` / `channelMessageActivityAtom`, `ChannelMessageTypingStrip` / `ChannelThreadTypingStrip`. `Channels.typing-strip.test.tsx`가 `profile`로 "답장 틱 → 그 메시지의 스트립만"을 고정한다. |
| F6-1 My issues 엔티티화 | #1655 | 머지됨 | "내 이슈"가 조직의 모든 프로젝트 대시보드를 자기 `useState` 레코드에 담고 런 객체를 그리던 것을 저장소로 옮겼다. `state/my-issues`의 `model`(그룹 분류·소유·스코프·검색 텍스트의 순수 함수), `atoms`(뷰 상태 7종과 로드 상태 5종, 파생 `myIssuesVisibleTeamIds` / `myIssuesRunTeamIds` / `myIssuesRunProject(runId)` / `myIssuesScopedRunIds` / `myIssuesFilteredRunIds` / `myIssuesCount` / `myIssuesGroupedRunIds` / `myIssuesMembers`, 칸반 전용 `myIssuesScopedRuns` / `myIssuesRunProjects` / `myIssuesRunProjectIds`), `useMyIssuesSync`(프로젝트별 응답을 `applySyncEvent`의 `team-snapshot`으로 적용하고 로드·실패·재시도 상태를 쓴다). `MyIssuesList`는 그룹별 id를 받고 각 행(`MyIssuesRow`)이 `runAtom(runId)`과 `myIssuesRunProjectAtom(runId)`을 구독한다. 칸반은 여전히 런 객체를 받는 `IssueCollection`이라 선택됐을 때만 마운트되는 `MyIssuesKanban`으로 갈랐다. `MyIssues.test.tsx`가 `run-changed` 하나에 "그 행만 1회, 목록도 헤더 카운트도 0회"를 렌더 카운트로 고정한다. **보존 규칙**: 이 화면은 LRU(8팀)보다 많은 팀을 동시에 읽으므로 `entities/retention.ts`에 `pinnedTeamIdsAtom`을 두고 `touchRetainedTeam(current, teamId, { protectedIds })`이 그것을 절대 축출하지 않는다. 핀은 화면이 살아 있는 동안만이고(언마운트 시 해제) 메모리 상한은 이 화면이 이미 갖고 있던 것과 같다. 디스크는 별개라 `collectSnapshot`은 여전히 최근 `TEAM_RETENTION_LIMIT`개만 쓴다. `useOrganizationViewData.loadOrganizationTeamDashboard`는 이제 "적용할 것이 없으면 `null`"이고 `MyIssuesTeamBoard` 타입은 사라졌다. |
| F6-2 컴패니언 채널 카탈로그 + 보드 `processingIssueIds` | #1656 | 머지됨 | F5-4가 남긴 마지막 중복 두 개를 지웠다. **컴패니언 카탈로그**: `CompanionChannels`가 자기 `listChannels` 스냅샷과 `useState` 채널 배열, 그리고 델타를 두 번째로 병합하던 `applyChannelCatalogDelta`를 갖고 있었다. 이제 `visibleOrganizationChannelsAtom`(목록) / `channelAtom(id)`(열린 채널) / `channelCatalogCursorAtom`(로딩)을 읽고, 읽음 처리는 `markOrganizationChannelRead`, 로더가 돌려준 채널은 `channel-changed`로 저장소에 들어간다. 남은 뷰 상태는 열린 채널 id 하나뿐이다. `useChannelConversationSync`의 `onCatalogDelta` 옵션(유일한 사용처였다)이 사라졌고, 데스크톱과 같은 필터를 쓰게 되면서 컴패니언 홈 목록에 섞여 나오던 DM이 빠졌다(DM은 자기 페이지가 있다). 스레드/채널 분기에 두 번 렌더되던 `ChannelActivityPublisher`도 하나로 합쳤다. **보드**: `processingIssueIds`가 `HuntDashboardWithTeam` → `HuntDashboard` → `HuntBoard` / `CompanionTaskBoard` → 카드 컨텍스트로 내려가던 프롭이었다. 런별 `runIsProcessingAtom(runId)`으로 바꿔 `BoardCard` / `BoardIssueRow` / `CompanionTaskRow`가 각자 구독하고, 런 하나짜리 소비자(`HuntDashboard`의 열린 이슈, `InboxDetailContent`)도 같은 family를 쓴다. `BoardCardContext.processingIssueIds`가 사라져 세션 하나가 시작돼도 카드 컨텍스트 객체가 새로 만들어지지 않는다. `HuntDashboardWithTeam.test.tsx`에 렌더 카운트 케이스 추가: 에이전트 세션 시작 → 그 이슈의 카드만 1회. |

### 기준 갱신 (2026-09-04, 후속 F3 이후)

에이전트 세션을 옮기며 확인한, 앞으로 훅이 소유한 도메인을 옮길 때 쓸 사실:

- **`Atom.writable`의 read 본문이 lazy 하이드레이션이다.** `localStorage`를 읽는
  파생 atom 하나를 두고 두 저장 atom이 그것을 초기값으로 삼으면, 레지스트리당 한 번
  파싱되고 **첫 읽기 시점**에 값이 선다. effect로 하이드레이션하면 첫 페인트가 빈
  목록이 되는데 이 방식은 그 창이 아예 없다. `Atom.make(value)`에는 lazy 초기값
  오버로드가 없으므로 `Atom.writable(read, (ctx, v) => ctx.setSelf(v))`를 쓴다.
- **`Atom.kvs`는 이 자리에 맞지 않았다.** Effect 런타임과 `KeyValueStore` 레이어,
  값 `Schema`를 요구하는데 정작 읽기가 해야 하는 일(중단된 세션을 `interrupted`로
  닫는 마이그레이션)은 표현하지 못한다. 평범한 코덱 + lazy read가 기계가 덜 든다.
- **세션 로그는 `ClientSnapshot`에 넣지 않는다.** 스냅샷은 한 조직의 서버 데이터라
  계정·스키마가 바뀌면 폐기되지만, 세션 로그는 이 기기가 무엇을 돌렸는지의 기록이라
  수명이 다르다. `session-cleared`도 세션 로그를 건드리지 않는다(로그아웃이 기록을
  지우지 않던 기존 동작 그대로다).
- **목록 순서는 저장이다**(`teamRunIdsAtom`과 같은 이유). 새 세션은 앞에 붙고, 조정
  패스는 자리를 안 건드리고, 서버 병합은 `startedAt`으로 전부 다시 정렬한다. `Map`
  삽입 순서는 그 셋 중 어느 것도 아니다.
- **훅이 파라미터로 받던 주입은 레지스트리 atom 이음매가 대신한다.**
  `useAutoHuntSessions(stopper, remoteTaskCanceller)`의 두 파라미터는
  `agentSessionApiAtom` 하나가 됐고, 액션과 동기화 훅이 같은 구현을 집는다.
- **브리지는 도메인이 atom이 되면 사라진다.** `state/action-bridges.ts`가 존재한
  이유는 세션이 훅 상태였기 때문이고, 이제 `state/issues/actions.ts`와 스케줄
  러너가 `createAgentSessionActions(registry)`를 직접 부른다. 남은 레지스트리
  브리지는 `state/inbox`의 콜백 홀더뿐이며 F4가 가져간다.
- **파생 하나가 셸의 마지막 구독을 끊었다.** `processingIssueIds`는 세션과
  `quickStartingRunId`의 합이라 atom으로 옮길 수 있었고, 그러고 나니 `App`이 세션을
  구독할 이유가 없어졌다. 보드 **안쪽**에서는 여전히 프롭으로 흐른다 — 카드까지
  내려가는 컨텍스트의 일부라 거기까지 바꾸는 것은 별개의 작업이다.
- **한 목록의 "행 하나만" 보장은 프로브로 잰다.** `TeamAgentSessions`는 id 배열을,
  각 행은 자기 세션을 구독한다. `profile`이 서브트리를 세므로 경계별 카운트는 같은
  atom을 읽는 형제 프로브로 재고, 실제 목록은 옆에서 DOM으로 확인한다
  (`TeamAgentSessions.test.tsx`).
- **남은 통짜 세션 목록 소비자는 셋이다.** `useInbox`(F4가 `state/inbox`의
  `currentInboxMessagesAtom`으로 가져갔다), `Sidebar`의 프로젝트별 실행 중 목록,
  커맨드 팔레트. 앞의 둘은 자기 경계에서 구독하고, 팔레트는 열렸을 때만 구독한다
  (빈 키 family 관용구).

### 기준 갱신 (2026-09-04, 후속 F4 이후)

인박스를 옮기며 확인한, 남은 훅 소유 도메인(F5의 `useChannelConversation`)에 쓸 사실:

- **`Atom.writable`의 lazy read는 의존성을 가질 수 있다.** `inboxStateAtom`의 본문이
  `inboxStorageKeyAtom`을 읽으므로, 계정이 바뀌면 본문이 다시 돌아 저장 레코드가
  통째로 교체된다. `setSelf`로 쓴 값은 그 재계산이 덮고, 이전 계정의 쓰기는 자기
  키에 남는다. F3의 `restoredAgentSessionsAtom`이 인자 없는 판이었고 이것이 인자가
  있는 판이다.
- **파생 목록의 아이덴티티는 `get.self()`로 보존한다.** `Atom.withEquality`는 배열
  **인스턴스**를 지켜 주지만 원소는 지켜 주지 않는다. 행 atom이 참조로 비교하므로,
  이전 값을 읽어 "똑같이 그려질" 메시지의 객체를 재사용하는 단계
  (`reuseInboxMessageIdentities`)가 있어야 알림 하나가 행 하나만 깨운다.
- **목록에는 통짜 값 대신 요약을 준다.** `visibleInboxMessageSummariesAtom`은 목록이
  실제로 쓰는 네 값(`id` / `projectId` / `category` / `isUnread`)만 담고 항목 객체도
  재사용한다. 그래서 알림 내용이 바뀌어도 분류와 읽음 상태가 그대로면 목록 컨테이너는
  아예 깨어나지 않고, 그 행만 다시 그려진다
  (`components/InboxSelectionBoundary.test.tsx`).
- **서버 응답이 전부 `SyncEvent`가 되지는 않는다.** 인박스 실시간 발행은 버전만
  나르고 메시지는 조직 피드의 응답으로만 존재하며, 그 응답은 로컬의 더 자세한
  복사본과 병합해야 하는 compact summary다. 서버가 보내지 않는 페이로드를 지어내는
  대신 **진입점 하나**(`startInboxFeedSync`의 `applyFeed`)를 유지했다. 단일 진입점이
  사는 성질은 "이벤트 타입이 하나"가 아니라 "병합 규칙이 한 곳"이다.
- **저장이 곧 캐시인 도메인이 있다.** 인박스 메시지는 파생이 아니라 저장이다: 보드가
  더는 싣지 않는 알림도 계정 목록에는 남아야 하고, 조직 피드가 권위이며, 읽음 버전은
  메시지보다 오래 산다. 그래서 `inboxMessagesAtom`은 `inboxStateAtom`(저장) 위의
  파생이고, 보드→저장소 병합은 구독이 하는 **쓰기**다.
- **콜백만 부르는 훅은 전부 구독으로 내릴 수 있다.** 시스템 알림·앱 배지·알림 클릭은
  값을 그리지 않으므로 `registry.subscribe`로 옮겼고, 그래서 `AppEffects`는 메시지가
  도착해도 커밋하지 않는다. i18n `t`처럼 렌더에서만 얻는 값은 ref로 넘긴다.
- **테스트는 파생 atom에 쓸 수 없다.** `registry.set(inboxMessagesAtom, ...)`이
  가능하던 자리는 저장 레코드를 심는 `src/test/inbox.ts`의 `seedInboxMessages`가
  됐다. 계정 응답 둘이 도착했다는 표시까지 심어야 읽지 않음 표시가 켜진다 — 실재하는
  게이트라서, 테스트가 그것을 매번 다시 발견하지 않도록 헬퍼가 안다.

### 기준 갱신 (2026-09-04, 후속 F5 이후)

채널 대화를 저장소로 옮기며 확인한, 남은 훅 소유 로직(F5의 뒷부분)과 F6·F7에
필요한 사실이다.

- **`useChannelConversation`은 상태를 갖고 있지 않았다.** 1,882줄이 전부 로직이고
  메시지·스레드·참여자·답장·커서는 `Channels`와 `CompanionChannels`의 `useState`
  였다. 훅은 `updateRootMessages` 같은 갱신 함수를 프롭으로 받아 부를 뿐이다.
  그래서 "훅을 옮긴다"는 두 개의 독립된 작업이다 — **저장소를 만드는 일**(F5-1/2)과
  **요청 순서 규칙을 옮기는 일**(남음). 앞의 것만으로 캐시 두 벌과 재요청이
  사라졌다.
- **캐시가 두 벌이었고 규칙이 서로 달랐다.** 데스크톱은 상한 없는 `useRef` 맵으로
  컴포넌트와 함께 사라졌고, 컴패니언은 채널 5개 / 스레드 5개 / 채널당 메시지 40개를
  스스로 자르는 100줄짜리 LRU였다. 하나로 합칠 때 메시지 상한은 **버려야 했다**:
  같은 저장소를 쓰는 데스크톱의 "이전 메시지 더 보기"가 40개를 넘겨 쌓기 때문이다.
  메모리는 채널 LRU가 묶는다. 두 뷰가 다른 상한을 갖고 있던 값은 합치기 전에
  "어느 쪽이 왜 그 수를 골랐는지"를 먼저 본다.
- **뷰 상태의 스코프는 여기서도 언마운트가 정하고 있었다.** 채널을 열 때 지워야
  하는 것(열린 스레드, 제안별 프로젝트 선택, 에이전트 답장)과 남아야 하는 것
  (메시지·참여자·커서·스레드)의 구분이 `useState` 초기화 순서에 암묵적으로 있었다.
  `resetChannelConversationViewState`가 앞의 것을 명시한다. 답장은 실행 상태라
  캐시에서 되살리면 이미 끝난 작업의 타이핑 표시가 남는다 — 컴패니언 코드의 주석이
  그 이유를 이미 적어 두고 있었다.
- **열린 스레드는 저장소에 있어야 한다.** `openThread`는 스레드 id를 쓰고 **같은
  동기 스텝에서** 그 스레드의 메시지를 쓴다. `useState` 값은 한 렌더 뒤라 두 번째
  쓰기가 이전 스레드로 간다. 레지스트리 쓰기는 동기이므로 이 순서가 성립한다.
- **채널을 여는 쓰기는 "여는 채널"에 해야 한다.** 어댑터는 현재 선택에 묶여 있고
  `openChannel`은 선택이 바뀌기 **전에** 돈다. 채널 id를 명시로 받는 writer
  (`resetChannelConversationViewState(registry, id)`)를 따로 둔 이유다.
- **updater 모양의 쓰기는 한시적 계약이다.** 훅이 아직 "다음 타임라인이 무엇인가"를
  정하므로 저장소는 결과를 받는다. 그래도 정렬·아이덴티티 보존·보존 한도는
  `state/channel-conversation/write.ts` 한 곳이며, 단일 진입점이 사는 성질은
  (F4가 인박스에서 확인한 대로) "이벤트 타입이 하나"가 아니라 "병합 규칙이 한 곳"이다.
- **컴포넌트 테스트에는 레지스트리가 필요해졌다.** `Channels` / `DirectMessages` /
  `CompanionChannels` 테스트가 프로바이더 없이 모듈 전역 레지스트리로 떨어지면
  케이스 사이로 대화가 샌다(실제로 한 케이스가 그렇게 깨졌다). 반대로 채널 전환을
  검사하는 케이스는 레지스트리를 **공유해야** 한다 — 즉시 복귀가 검사 대상이므로.
- **남은 것.** `hooks/use-channel-conversation.ts`는 아직 있다. 그 안에 남은 것은
  요청 순서(생성 카운터와 표면 무효화), 로더·실시간 전송 수명, 액션(전송·반응·삭제·
  제안·스레드 구독)과 답장 버전 부기다. 옮길 때의 이음매는 이미 있다
  (`state/channel-conversation/write.ts`의 writer들과 F5-1이 만든 이벤트 8종).
  옮기고 나면 `messages` / `replies` / `threadMessages` 프롭이 사라지고, 그때 비로소
  "메시지 하나 변경 → 그 행만" 과 "타이핑 변경 → 타이핑 스트립만"이 컴포넌트 단위로
  성립한다. 지금은 저장소 단위로만 성립한다(`atoms.test.ts`가 고정).

### 기준 갱신 (2026-09-04, 후속 F5-4 이후)

`useChannelConversation`의 남은 절반을 옮기며 확인한, 훅이 소유한 마지막 도메인(F7의
`useStatusTray`)과 F6의 정리에 필요한 사실이다.

- **훅이 상태가 아니라 순서를 갖고 있었다.** F5-1/2가 저장소를 옮긴 뒤 남은 1,892줄은
  `requestVersion` / `channelSurfaceGeneration` / `renderedSurface` 세 ref와 그 위의
  네 읽기·열세 쓰기였다. 셋 다 **훅 인스턴스별**이라 "이 응답을 아직 커밋해도 되는가"는
  요청을 시작한 뷰가 살아 있는 동안에만 답할 수 있는 질문이었다. 로더로 옮기고 나서야
  두 뷰가 같은 요청을 나눠 쓸 수 있게 됐다.
- **표면은 렌더가 알리고, 무효화는 액션이 한다.** `syncSurface`(렌더가 그리는 채널·
  스레드)와 `invalidateSurface`(요청을 버리며 옮겨 가는 쪽)를 나눠야 한다. 앞의 것을
  effect로 하면 레이아웃 effect에서 시작하는 요청이 한 렌더 늦은 표면을 보고,
  뒤의 것을 렌더에서 하면 스피너 atom을 렌더 중에 쓰게 된다.
- **저장소의 진입점은 "무엇을 남길지"를 받고, "언제 봤는지"는 밖에서 센다.**
  `channel-agent-replies-authoritative`는 `retainedReplyIds`를 받는데, 그 목록은 id
  집합으로 만들 수 없다 — 요청 중에 **종료 상태로 바뀐** 기존 답장도 남아야 하고
  그것은 관측 **횟수**로만 표현된다. `reply-ledger.ts`가 그 카운터이고, 뷰가 버전을
  그리지 않으므로 atom이 아니다.
- **레지스트리 바인딩 코드는 토스트를 띄울 수 없다.** 로더와 액션은 실패를
  `channelConversationFailureAtom`에 **발행**하고, 마운트된 훅이 그것을
  `registry.subscribe`로 받아 토스트한다. 읽지 않고 구독하므로 실패가 대화를
  리렌더하지 않는다. 같은 메시지가 두 번 오면 두 번 보여야 해서 값은 번호가 붙은
  봉투다(레지스트리가 같은 값의 쓰기를 버린다).
- **액션이 필요로 하는 "저장소에 없는 것"은 호출 시점 컨텍스트로 넘긴다.** 뷰의 이미지
  캐시, 셸 콜백(이슈 열기·Skill 세션 입양), 렌더에서만 얻는 번역 문자열 셋이 그것이다.
  ref가 들고 있는 접근자를 팩토리에 주면 액션 객체의 아이덴티티가 레지스트리 수명
  내내 고정되고, 행의 `MessageRowHandlers` memo가 그 위에서 성립한다. F3이 브리지를
  지웠던 것과 같은 문제이고, 여기서는 방향이 반대라(액션이 뷰의 것을 필요로 한다)
  브리지 대신 접근자가 됐다.
- **옵셔널 프로젝션은 이벤트에도 필요하다.** `channel-conversation-snapshot`의
  `members` / `agents`를 옵셔널로 만들어야 이전 페이지 응답이 같은 이벤트를 쓸 수
  있다. 빈 배열은 "이 채널에 멤버가 없다"이지 "이 응답은 멤버를 모른다"가 아니다.
  (2A가 팀 프로젝션에서 배운 것과 같은 구분이다.)
- **델타 루프는 하나면 된다.** 카탈로그 동기화와 대화 동기화가 같은
  `loadChannelDelta` 엔드포인트를 각자의 커서로 폴링하고 있었다(컴패니언에서는 세
  벌이었다). 커서를 가진 쪽이 페이지를 나르고, 대화는 그 페이지를 **구독**한다.
  `isBlocked` 가드는 사라졌다 — 저장소의 병합 규칙(재방문 병합, 첫 로드에서 루트
  인덱스를 만들지 않는 것)이 그것이 막던 덮어쓰기를 이미 막는다.
- **타이핑은 활동 소켓 때문에 atom이어야 한다.** 스트립을 잎으로 내리려면 각 행이
  자기 타이핑 상태를 구독해야 하는데, `useChannelAgentActivity`를 행마다 부르면
  메시지 수만큼 WebSocket이 열린다. 프레임을 채널별 atom에 싣는 퍼블리셔 훅을 한 번
  마운트하고 스트립이 그것을 읽는다. "훅이 도는 곳"과 "값을 읽는 곳"을 갈라야 하는
  구독형 파생의 일반형이다.
