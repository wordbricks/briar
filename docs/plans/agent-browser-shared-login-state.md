# agent-browser 공유 로그인 상태 파일

Mac에서 도는 Briar Agent(DM 답변, Auto Hunt 이슈 실행)가 브라우저 도구로 `agent-browser`를 쓸 때
로그인 상태를 Agent와 run 사이에서 공유하고 유지하기 위한 설계다. 관리형 컴퓨터와 sandbox의
Chrome은 [computer-use-shared-browser-login.md](computer-use-shared-browser-login.md)가 다룬다.

## 1. 문제

Briar Settings → Browser에서 고른 도구가 Agent의 브라우저다. ego (lite)와 Aside는 도구 자체가
사용자 로그인 상태를 공유하도록 설계되어 있다. 기본값인 `agent-browser`는 자기가 설치한 Chrome을
run별 `--session briar-<run-id>`로 띄우므로 세션이 닫히면 로그인이 사라지고, 다른 Agent의 세션과도
공유되지 않는다. 사용자는 사이트마다, run마다 다시 로그인을 요청받는다.

`agent-browser` 0.32 이상은 `state save <file>`로 현재 세션의 쿠키와 storage를 Playwright
storageState JSON으로 저장하고, `--state <file>`(또는 `AGENT_BROWSER_STATE`)로 시작 시 불러올 수
있다. `--profile <dir>` 지속 프로필도 있지만 Chrome은 한 user-data-dir에 프로세스 하나만 허용하므로
동시에 도는 Agent들이 충돌한다. 그래서 상태 파일 방식을 택한다. 세션마다 브라우저는 따로 뜨고,
로그인 상태만 공유 파일로 오간다.

## 2. 목표와 범위

- Mac 한 대에서 어느 Briar Agent가 어느 run에서든 한 번 로그인한 사이트는 이후 모든 Agent의
  `agent-browser` 세션에서 로그인 상태로 시작한다.
- 동시에 끝나는 두 run이 서로의 새 로그인을 지우지 않는다.
- 사용자의 실제 Chrome 프로필(`--profile Default`, `--auto-connect`)은 쓰지 않는다. 그 용도는 ego와
  Aside가 담당한다.
- 로그아웃 전파는 보장하지 않는다. 만료된 쿠키는 병합 시 버린다.

## 3. 설계

### 3.1 공유 상태 파일

경로는 `~/.local/share/briar/agent-browser/shared-state.json`이다. 디렉터리 0700, 파일 0600. 내용은
Playwright storageState 모양이다.

```json
{ "cookies": [ { "name": "...", "value": "...", "domain": "...", "path": "/", "expires": 0,
                 "httpOnly": false, "secure": true, "sameSite": "Lax" } ],
  "origins": [ { "origin": "https://example.com", "localStorage": [ { "name": "...", "value": "..." } ] } ] }
```

경로는 환경변수 `BRIAR_AGENT_BROWSER_STATE_FILE`로 덮어쓸 수 있다. Auto Hunt run은 Tauri 앱이
`HOME`과 `XDG_CONFIG_HOME`을 임시 sandbox 디렉터리로 바꾼 wrapper로 CLI를 실행하므로, `~` 기준
기본값은 그 안에서 틀린 경로가 된다. 따라서 Briar가 실제 홈으로 계산한 절대 경로를 항상 환경변수로
넘긴다.

### 3.2 CLI

`briar browser-state` 명령 그룹을 추가한다. 구현은 `apps/briar/src-cli/browser-state.ts`(로직)와
`browser-state-commands.ts`(핸들러), 등록은 `cli-app.ts`다.

- `briar browser-state ensure [--json]`: 파일이 없으면 빈 상태로 만들고(0700/0600) 경로를 출력한다.
  `--json`이면 `{ "path", "cookies", "origins" }`(개수)를 출력한다.
- `briar browser-state merge <file> [--json]`: `agent-browser state save`가 만든 파일을 공유 파일에
  병합한다.
  - 입력은 Effect Schema로 검증한다. 모양이 다르면 거절하고 공유 파일은 바뀌지 않는다.
  - 쿠키는 `(name, domain, path)` 키로 병합한다. 들어오는 쪽이 이긴다. `expires`가 0보다 크고 현재
    시각보다 과거인 쿠키는 양쪽 모두 버린다.
  - origins는 `origin` 키로 병합하고 `localStorage` 항목은 `name` 키로 병합한다. 들어오는 쪽이 이긴다.
  - 쓰기는 `<file>.tmp-<pid>`에 쓰고 rename한다.
  - 프로세스 간 잠금은 `<file>.lock` 디렉터리를 `mkdir`로 잡는다. 최대 10초 재시도하고, lock의
    mtime이 60초보다 오래되면 stale로 보고 가져간다.
  - `--json`이면 `{ "path", "cookies", "origins", "added", "replaced", "expired" }`를 출력한다.
- `briar browser-state clear [--json]`: 빈 상태로 되돌린다. 사용자가 "모든 Agent 브라우저에서
  로그아웃"하고 싶을 때 쓴다.

### 3.3 환경변수 전달

- Worker 경로: `command-support.ts`의 `providerExecutionEnvironment`가
  `config.appSettings.browserAutomationProvider === "agent-browser"`일 때
  `BRIAR_AGENT_BROWSER_STATE_FILE`을 실제 `homedir()` 기준 기본 경로로 넣는다. DM 답변과 Worker가
  실행하는 이슈 run이 이 경로를 탄다.
- Tauri Auto Hunt 경로: `project_agent.rs`의 `AutoHuntCliEnvironment::prepare_with_binaries`가
  `environment` Vec에 `("BRIAR_AGENT_BROWSER_STATE_FILE", <실제 home>/.local/share/briar/agent-browser/shared-state.json)`
  를 추가한다. 이 Vec은 Agent 프로세스 환경으로 전달되므로 Agent 셸의 `agent-browser` 호출과
  `briar` wrapper 모두 같은 값을 본다. provider와 무관하게 항상 넣어도 해가 없다.
- `browser-state` 명령은 환경변수가 있으면 그 경로를, 없으면 `homedir()` 기준 기본값을 쓴다.

### 3.4 가이드

`apps/briar/src-cli/guides/browser.md`의 "Verification with agent-browser" 절을 고치고
`bun run skills:generate`로 `bundled-skill-guides.ts`를 재생성한다. 요지:

```sh
state="$($BRIAR_CLI browser-state ensure)"
session="briar-<run-id>"
agent-browser --session "$session" --state "$state" open '<url>'
agent-browser --session "$session" snapshot -i
# ... work, screenshot ...
tmp="$(mktemp)"
agent-browser --session "$session" state save "$tmp" && $BRIAR_CLI browser-state merge "$tmp"
rm -f "$tmp"
agent-browser --session "$session" close
```

- run이 끝날 때 항상 `state save` → `browser-state merge`를 하고 나서 `close`한다. 그래야 이 run에서
  생긴 로그인이 다음 run과 다른 Agent에 전달된다.
- 사이트가 로그인을 요구하면 자격 증명을 절대 입력하지 않는다. 세션을 `close`하고
  `agent-browser --session "$session" --headed --state "$state" open '<login url>'`로 창을 띄운 뒤,
  답변에서 사용자에게 "이 Mac에 열린 브라우저 창에서 로그인하고 끝나면 알려 달라"고 말하고 세션을
  닫지 않은 채 turn을 끝낸다. 사용자가 끝났다고 하면 다음 turn에서 `state save` → `merge`를 하고
  작업을 이어간다.
- 공유 상태는 이 Mac 사용자의 모든 Briar Agent가 함께 쓴다. 작업에 필요할 때만 인증된 상태를 쓰고,
  관련 없는 계정이나 사이트는 건드리지 않는다.
- Safety 절에 상태 파일이 평문 쿠키를 담으므로 로그, 스크린샷, 결과에 경로 내용이 노출되지 않게
  한다는 항목을 더한다.

### 3.5 설정 화면 문구

`browser.agentChoiceDescription`(en, ko, zh)을 "별도 Chrome 런타임을 쓰고 로그인 상태는 Briar 공유
상태 파일로 유지한다"는 뜻으로 고친다.

## 4. 변경 지점

- 신규 `apps/briar/src-cli/browser-state.ts`, `browser-state-commands.ts`, 테스트.
- `apps/briar/src-cli/cli-app.ts`: `browser-state` 명령 그룹 등록.
- `apps/briar/src-cli/command-support.ts`: 환경변수.
- `apps/briar/src-tauri/src/agent/project_agent.rs`(+ `tests.rs` 단언): 환경변수.
- `apps/briar/src-cli/guides/browser.md` → `bundled-skill-guides.ts` 재생성.
- `apps/briar/src/i18n/messages/{en,ko,zh}.ts`.
- 이 문서.

## 5. 검증

- merge: 새 쿠키 추가, 같은 키는 들어오는 쪽이 이김, 만료 쿠키 제거, origins/localStorage 병합,
  모양이 다른 입력 거절 시 공유 파일 불변, tmp+rename으로 임시 파일이 남지 않음, lock 경합 시 대기,
  stale lock 회수.
- ensure: 없는 파일 생성(0600), 있는 파일 유지, 환경변수 경로 우선.
- `providerExecutionEnvironment`: agent-browser일 때만 환경변수를 넣는다.
- Rust: `AutoHuntCliEnvironment` 환경에 `BRIAR_AGENT_BROWSER_STATE_FILE`이 실제 홈 기준으로 들어간다.
- `skills:check`, `typecheck`, `lint`, `lint:type-aware`, 관련 vitest 통과.
