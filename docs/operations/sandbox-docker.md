# Briar Docker sandbox

`briar sandbox`는 Briar 실행 워커를 소유 라벨이 붙은 Docker 컨테이너 안에서
돌린다. 컨테이너는 이 Mac의 Docker Desktop에 만들 수도 있고, Docker context를
통해 다른 컴퓨터(예: ARM64 GX10)의 Docker 데몬에 만들 수도 있다. 관리형 컴퓨터
(`briar managed-computer`)와 달리 서버 등록이나 AWS가 필요 없고, 워커는 일반
`briar worker`와 같은 execution worker로 등록된다.

설계는 Grok Bot의 "Use local Docker VM" 커넥터를 그대로 따른다.

- **고정 이름과 소유 라벨.** 컨테이너 이름은 `briar-sandbox-<name>`이고
  `com.briar.sandbox=1` 라벨이 없는 컨테이너는 절대 건드리지 않는다.
- **content-addressed 런타임.** Dockerfile, CLI 번들, 에이전트 러너, provider
  manifest와 lockfile을 모두 해시한 SHA-256이 이미지 태그
  (`briar-sandbox:<sha12>`)와 컨테이너 라벨이 된다. CLI가 갱신되어 digest가
  달라지면 `briar sandbox up`이 컨테이너를 교체한다.
- **포트 없음.** Briar 워커의 연결은 전부 outbound HTTPS라서 publish할 포트가
  없다. 자격 증명은 `docker exec` stdin으로만 전달되고 Docker 호스트 디스크에는
  남지 않는다.
- **볼륨 하나.** `/home/briar`가 `briar-sandbox-<name>-home` 볼륨이다. 저장소
  클론, 워커 자격 증명, provider 로그인이 여기 남아 컨테이너를 교체해도
  재부트스트랩이 빠르다.
- **동일 lifecycle.** `up`, `status`, `stop`, `recreate`, `rm`으로 관리한다.

## 디스플레이와 Computer Use

sandbox는 Grok Bot의 로컬 VM처럼 에이전트가 볼 수 있는 데스크톱을 갖는다.
구조는 관리형 컴퓨터 AMI와 같고, systemd만 없다.

- **디스플레이 `:N`**: 에이전트마다 `briar-computer-use-window N`이 Xtigervnc(loopback
  `590N`)와 XFCE 세션을 띄운다. systemd 템플릿 유닛 대신 box 서비스가 자식 프로세스로
  관리한다(`BRIAR_COMPUTER_USE_WINDOW_SUPERVISOR=process`).
- **box 서비스**: `briar sandbox box-exec`가 1337(primary)과 1339(fork router)에서
  `ComputerUseBoxService`를 돌린다. 워커와 `computer-use-mcp-server.js`가 여기 붙어
  디스플레이를 할당받고 `briar-computer-executor.py`로 스크린샷·클릭·타이핑을 실행한다.
- **워커 capability**: 이미지가 `BRIAR_SANDBOX=1`을 설정하므로 워커 등록 시 box 서비스
  health와 canary(스크린샷)를 통과하면 Computer Use를 광고한다. bootstrap은 등록 전에
  box 서비스가 뜰 때까지 최대 90초 기다린다.
- **브라우저**: Linux ARM64용 Google Chrome이 없어 Chromium을 설치하고
  `/usr/bin/google-chrome-stable` 래퍼(`--no-sandbox`)로 감싼다. `briar-open-browser`와
  데스크톱 파일은 AMI와 동일하다.
- **소유자 디스플레이 `:1`**: supervisor가 `briar-remote-desktop`으로 `:1`(loopback 5901)을
  항상 띄운다. 에이전트가 없어도 볼 수 있는 데스크톱이며, 에이전트는 `:2` 이상을 쓴다.
- **사용자가 보는 화면**: 컨테이너 안 websockify + noVNC가 6080에서 모든 디스플레이를
  `?token=displayN`으로 라우팅하고, Docker 호스트의 loopback(`--view-port`, 기본 6080)에만
  publish된다. `briar sandbox view --name <name> [--display N]`이 원격 호스트면 SSH 포트
  포워딩을 열고 브라우저에 noVNC 페이지를 띄운다. 디스플레이를 지정하지 않으면 현재
  에이전트에 할당된 첫 디스플레이를, 없으면 소유자 디스플레이 `:1`을 연다.
- **검증**: `briar sandbox verify --name <name>`이 컨테이너 안에서 디스플레이를 하나
  할당해 스크린샷을 찍고 해제한다. `status`의 `report.computerUse`에 box 서비스 health와
  현재 할당된 디스플레이 목록이 나온다.

- **앱에서 보기 (릴레이)**: bootstrap이 워커 등록 뒤 `RegisterSandboxComputer`로 이
  sandbox의 워커 디바이스를 `provider = 'sandbox'`인 managed computer 레코드로 등록하고,
  워커 credential을 `remote-agent.json`에 써 둔다. supervisor가 관리형 컴퓨터와 같은
  `ManagedComputerRemoteSessionAgent`(`briar sandbox remote-agent`)를 띄워 Worker 릴레이에
  outbound WSS로 붙는다. 앱은 이 레코드를 관리형 컴퓨터처럼 취급하므로, 에이전트의 지정
  워커가 이 sandbox이고 Computer Use가 unattended면 DM 패널에 에이전트 화면이 뜨고,
  설정의 컴퓨터 목록에는 `Sandbox <label>`로 보인다. `sandbox rm`은
  `UnregisterSandboxComputer`로 레코드를 지운다. SSH 터널이나 LAN 노출이 필요 없다.
- sandbox 레코드는 AWS 수명주기(프로비저닝, 만료, drain, 파일럿 용량 계산)에서 제외되며
  앱의 은퇴/종료 버튼 대신 `briar sandbox rm`으로만 제거한다.

관리형 컴퓨터의 sudo 정책은 sandbox에 없다. `sandbox view`의 브라우저 noVNC는 앱 없이
볼 때 쓰는 보조 경로다.

## 요구 사항

- 이 Mac: `briar login`이 끝나 있고, 연결된 팀에 agent token이 있어야
  한다. CLI 번들 옆에 `agent/` 러너가 있어야 하며(설치본 기본 배치),
  체크아웃에서 쓰려면 `bun run cli:build && bun run agent:build`를 먼저 돌린다.
- Docker 호스트: Docker 24+ 데몬. 원격이면 SSH로 접근 가능해야 하고
  (`docker context`가 `ssh://`를 사용), GPU를 붙이려면 nvidia-container-toolkit이
  설치되어 있어야 한다.
- 이미지는 `TARGETARCH`에 따라 Bun과 Node를 고르므로 amd64와 arm64 모두
  네이티브로 빌드된다. provider runtime의 `bun.lock`에는 두 아키텍처의 optional
  바이너리가 모두 고정되어 있다.

## GX10에 sandbox 만들기

```sh
briar sandbox up --name gx10 --host ssh://jay@gx10 --team <team-id> --gpus
```

첫 실행이 하는 일은 다음과 같다.

1. `briar-sandbox-gx10` Docker context를 만들거나 host가 바뀌었으면 갱신한다.
2. 빌드 컨텍스트를 임시 디렉터리에 스테이징하고 digest를 계산한다.
3. 같은 태그의 이미지가 없으면 `docker build`한다 (원격이면 컨텍스트가 SSH로
   전송된다). 첫 빌드는 Bun, Node, provider CLI 다운로드 때문에 몇 분 걸린다.
4. 컨테이너를 만들고 `briar sandbox supervise`를 PID 1(`--init` 뒤)로 띄운다.
5. `docker exec -i ... briar sandbox bootstrap`에 JSON payload를 넘긴다.
   payload에는 Briar API origin, 사용자 세션 토큰, 팀별 agent token,
   이 Mac의 global git `user.name`/`user.email`, 그리고 `~/.codex/auth.json`이
   있으면 그 내용이 들어간다. git identity는 컨테이너에 아직 없을 때만 쓴다.
6. 컨테이너 안에서 팀마다 GitHub 자격 증명을 받아 저장소를 클론하고
   (`~/Briar/projects/<org>/<project>/<repo>`), 팀을 연결하고, execution
   worker로 등록한다. 워커 label은 기본 `sandbox-<name>`이다.
7. `briar sandbox report`가 `ready: true`를 돌려줄 때까지 최대 3분 기다린다.

Docker 호스트에서 `deb.debian.org`가 느리면(GX10에서 약 170KB/s로 측정됨)
`--debian-mirror ftp.kr.debian.org`처럼 가까운 미러 호스트명을 주면 apt 단계가
수십 배 빨라진다. 값은 `sandboxes.json`에 기억되어 다음 `up`에도 적용된다.

`--team`을 생략하면 이 Mac에 연결된 모든 팀을 넘긴다. 다시 실행하면
같은 단계를 멱등하게 반복하므로 팀을 추가하거나 토큰을 갱신할 때도
`up`을 쓴다. 이미 있는 sandbox는 `--host`나 `--context` 없이 이름만으로
찾는다(`~/.config/briar/sandboxes.json`에 context 이름만 기록된다).

### provider 로그인

- **Codex**: Mac의 `~/.codex/auth.json`이 그대로 복사된다. 넘기고 싶지 않으면
  `--no-provider-auth`.
- **Claude Code**: macOS는 토큰을 Keychain에 두므로 복사할 파일이 없다.
  컨테이너 안에서 device 로그인을 한 번 한다.

  ```sh
  briar sandbox login --name gx10 --provider claude
  ```

  `codex`, `grok`, `opencode`도 같은 명령으로 로그인할 수 있다.
- 로그인 상태는 `briar sandbox status`의 `report.providers`에서 확인한다.

## 일상 운영

```sh
briar sandbox status --name gx10      # 존재/실행/준비 여부와 컨테이너 안 report
briar sandbox logs --name gx10 --follow
briar sandbox shell --name gx10       # 컨테이너 안 bash
briar sandbox recreate --name gx10    # 컨테이너 재시작
briar sandbox stop --name gx10
briar sandbox rm --name gx10          # 워커 등록 해제 + 컨테이너 제거, 볼륨은 유지
briar sandbox rm --name gx10 --purge  # 볼륨, 이미지, Briar가 만든 Docker context까지 제거
briar sandbox verify --name gx10      # 디스플레이 할당 + 스크린샷 canary
briar sandbox view --name gx10        # 에이전트 화면을 브라우저 noVNC로 보기
```

`rm`은 먼저 컨테이너 안에서 `briar sandbox unregister`를 실행해 이 sandbox가
등록한 워커를 서버에서 모두 unbind한 뒤 컨테이너를 지운다. 멈춰 있는
컨테이너는 unbind를 위해 잠시 시작한다. 서버에 닿지 못하면 팀별 실패를
경고로 출력하고 삭제는 계속 진행하므로, 그 경우 앱 fleet 화면에서 offline
워커를 정리한다. 워커 등록을 남겨 두려면 `--keep-workers`를 준다.

`--purge`가 지우는 Docker context는 `--host`로 Briar가 만든
`briar-sandbox-<name>`뿐이다. `--context`로 직접 지정한 context는 건드리지
않는다.

## 보안 경계

- 컨테이너는 `briar` 일반 사용자로만 돌고 sudo가 없다. 관리형 컴퓨터의
  관리자 sudoers 정책은 적용하지 않는다.
- payload에는 사용자 세션 토큰이 들어간다. 컨테이너 안 `config.json`에 관리형
  컴퓨터의 `worker-credential.json`과 같은 위치·권한(0600)으로 저장되고, Docker
  호스트의 파일이나 `docker inspect` 출력에는 나타나지 않는다.
- Docker 호스트 관리자는 볼륨을 읽을 수 있다. 신뢰하지 않는 호스트에는
  sandbox를 만들지 않는다.
- 이미지는 Bun과 Node를 버전 고정으로 받지만 arm64 아카이브의 SHA는 아직
  검증하지 않는다. 관리형 컴퓨터 AMI 수준의 공급망 검증이 필요하면
  `image-lock.env`에 arm64 해시를 추가하고 Dockerfile 생성기를 확장한다.

## 코드 구조

| 파일 | 역할 |
| --- | --- |
| `apps/briar/src-cli/sandbox-image.ts` | Dockerfile 템플릿, 빌드 컨텍스트 스테이징, digest |
| `apps/briar/src-cli/sandbox-runtime-assets.ts` | 생성 파일. provider runtime manifest/lock과 Bun/Node 버전 (`bun run sandbox:generate`) |
| `apps/briar/src-cli/sandbox-docker.ts` | 호스트 쪽 Docker 커넥터 (Grok Bot 포팅) |
| `apps/briar/src-cli/sandbox-host-config.ts` | `~/.config/briar/sandboxes.json` |
| `apps/briar/src-cli/sandbox-bootstrap.ts` | 컨테이너 쪽 bootstrap, report, supervisor |
| `apps/briar/src-cli/sandbox-commands.ts` | `briar sandbox` 핸들러 |
| `apps/briar/src-cli/project-repository-bootstrap.ts` | 관리형 셋업과 공유하는 클론 헬퍼 |

`infrastructure/managed-computers/provider-runtime/`나 `image-lock.env`의
Bun/Node 버전을 바꾸면 `bun run sandbox:generate`로 자산을 다시 생성해야 하며
`bun run check`의 `sandbox:check`가 이를 강제한다.
