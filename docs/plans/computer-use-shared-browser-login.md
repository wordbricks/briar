# Computer Use 공유 브라우저 로그인 저장소

관리형 컴퓨터와 Docker sandbox에서 Agent들이 쓰는 Chrome 로그인 상태를 한 컴퓨터 안에서
공유하고 turn 경계를 넘어 유지하기 위한 설계다. [computer-use-spec.md](computer-use-spec.md)
5.8 shared desktop manager를 확장한다.

## 1. 문제

현재 구현은 display마다 별도 Chrome 프로필을 쓰고, provider turn이 끝나면 그 프로필을 지운다.

- `briar-computer-use-window N`이 `BRIAR_BROWSER_PROFILE_DIRECTORY`를
  `/var/lib/briar-computer-use/profiles/display-N`으로 고정하고 `briar-open-browser`가 그
  경로를 `--user-data-dir`로 넘긴다.
- display는 `ComputerUseDesktopManager`가 agentId 단위로 배정하므로 Agent A와 B는 서로 다른
  프로필을 쓴다. 프로필 사이에 쿠키나 로그인 데이터를 옮기는 단계가 없다.
- `runDetachedProviderTurn`은 turn 시작 시 display를 assign하고 `finally`에서 release한다.
  release는 `stopWindow`를 부르고, 그 안에서 `browserProfileCleaner.remove`가 display 프로필을
  삭제한다. 같은 Agent라도 다음 turn은 로그인이 없는 새 프로필로 시작한다.

그 결과 사용자가 takeover로 한 사이트에 로그인해도 그 turn이 끝나면 사라지고, 다른 Agent는
처음부터 다시 로그인을 요청한다. Grok Bot은 한 box 안에서 `/home/box/chrome-profile` 하나를
모든 Agent가 쓰고 fork display Chrome에는 쿠키를 capture/restore해서 이 문제를 피한다.

## 2. 목표와 범위

목표:

- 한 컴퓨터(관리형 컴퓨터 인스턴스 또는 sandbox 컨테이너) 안에서 어느 Agent의 화면에서든 한
  번 로그인한 사이트는 모든 Agent의 Chrome에서 로그인 상태로 보인다.
- 로그인 상태는 display release, provider turn 종료, box 서비스 재시작을 넘어 유지된다.
- 동시에 끝나는 두 Agent의 release가 서로의 새 로그인을 지우지 않는다.

범위 밖(후속):

- Mac에서 도는 DM Agent의 브라우저(ego, Aside, agent-browser)에는 적용하지 않는다.
- primary display `:1`의 기본 Chrome 프로필을 로그인 원본으로 쓰는 것은 후속으로 남긴다.
  사용자의 정상 로그인 경로는 Agent display의 takeover다.
- 컴퓨터 사이 동기화(Grok Bot의 box-store-sync에 해당)는 다루지 않는다.
- 로그아웃 전파는 보장하지 않는다. 한 display에서 지워진 쿠키는 공유 저장소에서 지워지지
  않으며, 서버가 만료된 세션을 거절하는 데 맡긴다.

## 3. 설계

### 3.1 공유 로그인 저장소

`/var/lib/briar-computer-use/profiles/shared`에 `briar` 계정만 읽을 수 있는(0700) Chrome
user-data-dir 골격을 둔다. 이 디렉터리에서 Chrome을 직접 실행하지는 않는다. `briar-open-browser`의
경로 검증은 그대로 `display-N`만 허용한다.

저장소에는 로그인 상태에 해당하는 항목만 화이트리스트로 담는다. 경로는 user-data-dir 기준이다.

| 항목 | 종류 | 반영 방식 |
| --- | --- | --- |
| `Default/Network/Cookies` | SQLite | 행 단위 병합 |
| `Default/Cookies` | SQLite(구형 위치, 있을 때만) | 행 단위 병합 |
| `Default/Login Data` | SQLite | 파일 교체 |
| `Default/Login Data For Account` | SQLite | 파일 교체 |
| `Default/Web Data` | SQLite | 파일 교체 |
| `Default/Local Storage` | 디렉터리(leveldb) | 디렉터리 교체 |
| `Default/IndexedDB` | 디렉터리 | 디렉터리 교체 |

SQLite 파일은 `-journal`, `-wal`, `-shm` sidecar가 있으면 함께 복사한다. Cache, Code Cache,
GPUCache, Service Worker, Session Storage, Sessions, Preferences, History, Extensions 등 나머지는
복사하지 않는다. Chrome은 빠진 파일을 새로 만들고 기존 DB 파일은 그대로 연다.

### 3.2 display 생명주기에 끼우기

두 window supervisor(`SystemdComputerUseWindowSupervisor`, `ProcessComputerUseWindowSupervisor`)
가 같은 `ComputerUseBrowserLoginStore`를 사용한다.

- `ensureWindow`: display 프로필 디렉터리가 없을 때만 seed한다. 공유 저장소의 화이트리스트
  항목을 `display-N.seed-<pid>` 임시 디렉터리에 복사한 뒤 `display-N`으로 rename한다. 실패하면
  임시 디렉터리를 지우고 프로필 없이 window를 띄운다. 이미 window가 떠 있거나 프로필이 있는
  경우(같은 Agent의 재연결, 재부팅 후 `restoreAssignments`)에는 건드리지 않는다.
- `stopWindow`: window를 내려 Chrome이 종료된 뒤, 프로필을 지우기 전에 capture한다. display
  프로필의 화이트리스트 항목을 공유 저장소에 반영하고 나서 기존대로 display 프로필을 삭제한다.
  capture 실패는 release를 막지 않는다. 결과는 stderr 로그로 남긴다.

seed와 capture는 모두 desktop manager의 `runExclusive` 안에서 실행되므로 한 box 서비스 안에서
직렬화된다. 저장소 구현도 자체 promise mutex를 가져 다른 호출 경로에서도 안전하다.

### 3.3 Cookies 행 단위 병합

두 Agent가 비슷한 시점에 release되면 뒤에 끝난 Agent의 Cookies가 먼저 끝난 Agent의 새 로그인을
덮어쓸 수 있다. Cookies는 로그인 그 자체이므로 파일 교체가 아니라 `node:sqlite`의
`DatabaseSync`로 행 단위 병합을 한다.

1. 공유 저장소 Cookies를 열고 display Cookies를 `ATTACH`한다.
2. 두 DB의 `cookies` 컬럼 목록(`PRAGMA table_info`)과 `meta.version`이 같고 `last_update_utc`
   컬럼이 있는지 확인한다. 다르면 병합을 포기하고 파일 교체로 폴백한다.
3. `PRAGMA index_list('cookies')`에서 unique index를 찾아 그 컬럼(`PRAGMA index_info`)으로
   join 키를 만든다. Chrome은 `host_key`, `top_frame_site_key`, `name`, `path`, `source_scheme`,
   `source_port` 계열을 unique로 잡으며 버전에 따라 컬럼이 추가된다. unique index가 없으면
   파일 교체로 폴백한다.
4. 한 트랜잭션에서 `INSERT OR REPLACE INTO main.cookies SELECT s.* FROM src.cookies s LEFT JOIN
   main.cookies d ON <join 키> WHERE d.rowid IS NULL OR s.last_update_utc >= d.last_update_utc`를
   실행한다. 새 행은 추가되고, 더 최근에 갱신된 행만 기존 행을 대체한다.
5. `DETACH`하고 닫는다. 공유 저장소에 Cookies가 아직 없으면 파일을 복사한다.

`node:sqlite`는 Node 22.13 이상과 Bun 1.4에서 모두 동작하므로 vitest(Node)와 관리형 컴퓨터
runtime(Bun)이 같은 코드를 쓴다.

### 3.4 나머지 항목의 교체

SQLite 파일은 `<이름>.tmp-<pid>`로 복사한 뒤 rename으로 덮어쓴다. 디렉터리는 `.tmp-<pid>`로
복사한 뒤 기존 디렉터리를 `.old-<pid>`로 rename, 임시를 본래 이름으로 rename, `.old`를 삭제한다.
box 서비스가 중간에 죽어도 절반만 복사된 항목이 본래 이름으로 남지 않는다. 시작 시 남은
`.tmp-*`, `.old-*`는 지운다.

### 3.5 암호화 키 고정

Linux Chrome은 쿠키 값과 저장된 비밀번호를 OS 키링 키 또는 기본 키(`v10`)로 암호화한다.
프로필을 display 사이에서 옮겨도 복호화되도록 `briar-open-browser`가 프로필 디렉터리를 쓸 때
`--password-store=basic`을 함께 넘긴다. 관리형 이미지와 sandbox에는 키링이 없어 이미 기본 키가
쓰이지만, 플래그로 결정적으로 만든다. 기본 키는 고정값이므로 공유 저장소는 사실상 평문에
가깝다. 저장소와 display 프로필은 0700이고 `briar` 계정만 접근한다. 이 점을 운영 문서의 안전
경계에 적는다.

이 스크립트는 관리형 AMI 파일이므로 기존 컴퓨터에는 AMI 재빌드 후 적용된다. seed/capture 로직은
`briar-box-exec.js`에 있어 runtime updater로 먼저 배포된다. 플래그가 없는 기존 이미지에서도
키링이 없으므로 동작은 같다.

### 3.6 Agent 안내

- parent Computer Use 안내(`agent-runner.ts`)에 이 컴퓨터의 브라우저 로그인이 모든 Agent 화면에
  공유되며 turn을 넘어 유지되니 다시 로그인을 요청하기 전에 기존 세션을 먼저 확인하라고 적는다.
- child responsibility(`computer-use-mcp-server.ts`)에 이전 takeover에서 로그인한 사이트는 보통
  로그인 상태이니 먼저 시도하고 사람이 꼭 필요할 때만 멈추라고 적는다.
- `RequestHumanTakeover` 설명에 takeover 중 완료한 로그인은 이 컴퓨터의 모든 Agent에 유지된다고
  덧붙인다.

## 4. 변경 지점

- 신규 `apps/briar/src-cli/computer-use-browser-login-store.ts`: 화이트리스트 상수, 공유 저장소
  경로, `ComputerUseBrowserLoginStore` 인터페이스(`seed`, `capture`), 파일 구현, Cookies 병합.
- `apps/briar/src-cli/computer-use-window-supervisor.ts`: 두 supervisor에 `browserLoginStore`
  옵션 추가. `ensureWindow` 앞에 seed, `stopWindow`의 remove 앞에 capture.
- `infrastructure/managed-computers/briar-open-browser`: `--password-store=basic`.
  `verify-managed-image`에 플래그 검사 추가. `bun run sandbox:generate`로
  `apps/briar/src-cli/sandbox-runtime-assets.ts` 재생성.
- `apps/briar/src-cli/agent-runner.ts`, `apps/briar/src-agent/computer-use-mcp-server.ts`: 안내 문구.
- 문서: 이 문서, `computer-use-spec.md` 5.8과 9.3, `docs/operations/sandbox-docker.md` 브라우저
  항목, `docs/operations/managed-computer-pilot.md` 안전 경계.

## 5. 검증

- seed: 공유 저장소가 있으면 화이트리스트만 0700 display 프로필로 복사한다. display 프로필이
  이미 있으면 건드리지 않는다. 공유 저장소가 없으면 아무것도 만들지 않는다. 복사 중 실패하면
  임시 디렉터리가 남지 않는다.
- capture: 공유 저장소에 없던 Cookies는 파일로 들어간다. 있던 Cookies에는 새 행이 추가되고,
  `last_update_utc`가 더 큰 행만 기존 행을 대체하며, 더 오래된 행은 기존 행을 덮지 않는다.
  스키마가 다르거나 unique index가 없으면 파일 교체로 폴백한다. Local Storage와 IndexedDB는
  통째로 교체된다. display 프로필이 없으면 아무 일도 하지 않는다. 어떤 실패도 예외로 나가지
  않는다.
- supervisor: `ensureWindow`가 start 전에 seed를, `stopWindow`가 stop 뒤 remove 앞에 capture를
  부른다. 기존 systemd/process 테스트는 그대로 통과한다.
- Bun 1.4에서 `node:sqlite` 병합이 동작하는지 스크립트로 한 번 확인한다.
- `sandbox:check`, `typecheck`, `lint`, `lint:type-aware`, `agent:build`가 통과한다.

## 6. primary display `:1`을 로그인 원본으로

### 6.1 문제

`:1`은 컴퓨터 소유자의 데스크톱이다. 관리형 컴퓨터는 `briar-remote-desktop.service`가 항상
띄우고 앱의 원격 화면으로 들어가며, sandbox는 supervisor가 `primaryDisplayCommand`로 항상
띄우고 `briar sandbox view`로 본다. 여기서 Chrome을 열면 `briar-open-browser`가 프로필 환경변수
없이 실행되어 Chrome 기본 프로필(관리형 `~/.config/google-chrome`, sandbox Chromium
`~/.config/chromium`)을 쓴다. 이 프로필은 유지되지만 Agent는 보지 못한다. Agent는 `:1` 사용이
거절되고, 이 프로필을 공유 저장소로 옮기는 코드가 없다.

사용자가 Agent를 기다리지 않고 "내 컴퓨터 화면"에서 미리 로그인해 두면 모든 Agent가 그 로그인을
쓰게 하는 것이 목표다. `:1`은 원본(source)이고, 공유 저장소에서 `:1`로 seed하지는 않는다.

### 6.2 `:1` 프로필 고정

`:1`의 Chrome도 `/var/lib/briar-computer-use/profiles/display-1`을 `--user-data-dir`로 쓴다.
그래야 감시할 경로가 환경(Chrome/Chromium, HOME)에 따라 달라지지 않고, `--password-store=basic`이
프로필 분기에서 함께 적용된다.

- 관리형: `briar-remote-desktop.service`에
  `Environment=BRIAR_BROWSER_PROFILE_DIRECTORY=/var/lib/briar-computer-use/profiles/display-1`을
  추가한다. `verify-managed-image`가 `systemctl cat`으로 이 줄을 확인한다.
- sandbox: `runSandboxSupervisor`가 `primaryDisplayCommand`를 띄울 때 같은 환경변수를 넘긴다.
  `keepChildAlive`에 env 옵션을 추가한다.
- `briar-open-browser`의 경로 검증 case에 `display-1`을 허용한다. `briar-computer-use-window`는
  그대로 2..100만 받는다.
- 저장소 모듈에 `COMPUTER_USE_PRIMARY_DISPLAY_INDEX = 1`과
  `computerUsePrimaryBrowserProfileDirectory(profilesDirectory)`를 추가한다. Agent display용
  `computerUseBrowserProfileDirectory`의 2..100 guard는 유지한다.
- 기존 `:1` 기본 프로필의 로그인은 이전하지 않는다. 운영 문서에 "이미지 갱신 후 `:1`에서 한 번
  다시 로그인"을 적는다.

### 6.3 살아 있는 프로필 capture

`:1`의 Chrome은 사용자가 계속 쓰는 프로세스이고 종료 hook이 없다. Chrome은 SQLite 파일을 배타
잠금으로 열기 때문에 `ATTACH` 행 병합을 바로 걸 수 없다. 그래서 먼저 스냅샷을 만들고 그 스냅샷을
기존 capture 경로의 소스로 쓴다.

저장소에 `captureLive(sourceDirectory, { sqliteOnly })`를 추가한다. 각 SQLite 화이트리스트 항목에
대해:

1. 소스를 `DatabaseSync(path, { readOnly: true })`로 열고 `PRAGMA busy_timeout = 100` 뒤
   `VACUUM INTO '<tmp>'`를 시도한다.
2. 잠김이나 다른 오류로 실패하면 main 파일과 `-journal`, `-wal`, `-shm` sidecar를 `<tmp>`로
   raw copy한다. Chrome이 쓰는 중이어도 journal이 함께 있으면 SQLite가 열 때 복구한다.
3. `<tmp>`를 열어 `PRAGMA quick_check`가 `ok`인지 확인한다. 아니면 그 항목은 skip하고 사유를
   report에 남긴다.
4. 스냅샷을 소스로 기존 로직을 태운다. Cookies는 행 병합, 나머지는 파일 교체다.
5. 임시 스냅샷을 지운다.

디렉터리 항목(Local Storage, IndexedDB)은 live copy가 불안정하므로 `sqliteOnly: false`일 때만
best-effort로 교체한다. 변경 감지 트리거는 `sqliteOnly: true`로, 주기 사이클과 시작 시에는
`sqliteOnly: false`로 부른다. 모든 실패는 report와 로그에만 남고 예외로 나가지 않는다.

### 6.4 감시자

새 모듈 `computer-use-primary-login-watcher.ts`의 `ComputerUsePrimaryLoginWatcher`가 box 서비스
안에서 돈다. `ComputerUseBoxService.start()`가 `restoreAssignments()` 뒤에 시작하고 `stop()`이
정지한다. 관리형과 sandbox 모두 box 서비스가 같은 코드를 돌린다.

- `display-1/Default/Network`와 `display-1/Default`를 `fs.watch`(`persistent: false`)로 본다.
  파일명이 화이트리스트 basename으로 시작하면 5초 debounce 뒤 `captureLive({ sqliteOnly: true })`.
- 디렉터리가 아직 없으면(첫 Chrome 실행 전) 30초마다 다시 arm을 시도한다.
- 시작 직후 1회, 이후 10분마다 `captureLive({ sqliteOnly: false })`를 돈다. fs.watch가 놓친
  변경의 backstop이기도 하다.
- clock, timer, watch 함수는 주입 가능해야 테스트할 수 있다.
- 동시성은 저장소의 내부 mutex가 처리한다. Agent display의 seed/capture와 같은 큐를 탄다.

### 6.5 안내와 문서

- parent Computer Use 안내에 사용자가 이 컴퓨터의 소유자 화면(`:1`)에서 미리 로그인해 둘 수도
  있다는 한 문장을 더한다.
- `computer-use-spec.md` §5.8의 display 1 설명에 "로그인 원본"을 추가한다.
- `managed-computer-pilot.md`와 `sandbox-docker.md`의 소유자 디스플레이 항목에 `:1` 로그인이 모든
  Agent에 전파된다는 것과 프로필 경로 변경을 적는다.

### 6.6 검증

- `captureLive`: 잠기지 않은 DB는 `VACUUM INTO` 경로로 병합된다. 주입한 vacuum이 throw하면 raw
  copy로 폴백한다. `quick_check` 실패는 skip으로 보고된다. `sqliteOnly: true`면 디렉터리를 건드리지
  않는다. 임시 스냅샷이 남지 않는다.
- 감시자: 가짜 fs 이벤트가 debounce 뒤 한 번만 capture를 부른다. 관련 없는 파일명은 무시한다.
  디렉터리가 없으면 재시도 후 arm된다. 주기 사이클이 `sqliteOnly: false`로 돈다. `stop()` 뒤에는
  아무 것도 부르지 않는다.
- `briar-open-browser`가 `display-1`을 받고 `display-0`이나 `shared`는 거절한다.
- sandbox bootstrap이 `:1` 프로세스에 프로필 환경변수를 넘긴다.

## 7. 저장소 이전

### 7.1 sandbox: 두 번째 볼륨

sandbox 볼륨은 `/home/briar` 하나뿐이어서 `/var/lib/briar-computer-use`는 컨테이너 쓰기 레이어에
남고, `sandbox recreate`나 이미지가 바뀌는 `sandbox up`에서 컨테이너가 교체되면 저장소와 `:1`
프로필이 사라진다.

- `sandboxComputerUseVolume(name)` = `briar-sandbox-<name>-computer-use`를 추가하고
  `docker run`에 `--volume <그 이름>:/var/lib/briar-computer-use`를 넘긴다. 빈 named volume은
  첫 마운트에서 이미지의 디렉터리 내용과 소유권(briar, 0700)을 복사한다.
- `SANDBOX_SCHEMA_VERSION`을 올려 기존 컨테이너가 다음 `up`에서 교체되게 한다.
- `sandbox rm --purge`가 홈 볼륨과 함께 이 볼륨도 지운다. `volumeRemoved`는 둘 다 지워졌을 때
  true다.
- `sandbox-docker.md`의 "볼륨 하나"를 두 볼륨으로 고친다.

### 7.2 관리형: 인플레이스 유지와 교체 시 export/import

같은 인스턴스를 재시작하는 업그레이드 경로는 root EBS를 그대로 쓰므로
`/var/lib/briar-computer-use`도 `/home/briar`와 함께 남는다. 이를 운영 문서에 명시한다.

새 AMI로 인스턴스를 교체할 때는 운영자가 로그인 저장소만 옮길 수 있는 CLI를 둔다. Worker
credential, 저장소 clone, provider 인증은 옮기지 않는다.

- `briar computer-use login-store export --out <file.tar.gz> [--force] [--json]`:
  `shared`와 `display-1`의 화이트리스트 항목을 임시 디렉터리에 모은다. `display-1`은 Chrome이
  살아 있을 수 있으므로 6.3의 스냅샷 로직을 쓴다. 레이아웃은 `shared/Default/...`,
  `display-1/Default/...`다. `/usr/bin/tar -C <tmp> -czf <out> .`로 묶고 0600으로 남긴다. 기존
  파일은 `--force` 없이는 덮어쓰지 않는다.
- `briar computer-use login-store import <file.tar.gz> [--json]`: 임시 디렉터리에 풀고 항목이
  화이트리스트 경로 안인지 검증한다(`..`, 절대 경로, 화이트리스트 밖 경로는 거절). `shared/*`와
  `display-1/*`를 모두 공유 저장소에 capture 경로로 반영한다. Cookies는 행 병합, 나머지는 교체다.
  살아 있는 `:1` 프로필에는 쓰지 않는다. 다음 Agent display seed와 `:1`의 새 로그인이 합쳐진다.
- 둘 다 `briar` 계정으로 실행하며 `--profiles-directory` 옵션으로 경로를 바꿀 수 있다(테스트용).
- `managed-computer-pilot.md` "기존 컴퓨터 업그레이드" 절에 교체 절차를 추가한다. 중지 전 export,
  SSM으로 파일 이동, 새 컴퓨터 enrollment 뒤 import, 아카이브 삭제. "다른 컴퓨터의 홈이나 credential을
  복사하지 않는다"는 문장은 소유자가 동의한 브라우저 로그인 저장소 이전만 예외로 둔다고 고친다.

### 7.3 검증

- export → import 왕복이 임시 디렉터리에서 동작한다. import 후 Cookies 행이 병합되고 Local Storage가
  교체된다.
- `..`나 화이트리스트 밖 경로가 든 아카이브는 거절되고 저장소가 바뀌지 않는다.
- `--force` 없이 기존 출력 파일을 덮어쓰지 않는다.
- sandbox `docker run` 인자에 두 볼륨이 들어가고 `rm --purge`가 둘을 지운다.

## 8. 후속

- Mac DM Agent의 agent-browser 로그인 공유는 상태 파일 방식으로 별도 설계한다:
  [agent-browser-shared-login-state.md](agent-browser-shared-login-state.md).
- 컴퓨터 사이 자동 동기화(Grok Bot box-store-sync)는 export/import로 운영 요구가 확인된 뒤 검토한다.
