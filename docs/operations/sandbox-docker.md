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

## 요구 사항

- 이 Mac: `briar login`이 끝나 있고, 연결된 프로젝트에 agent token이 있어야
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
briar sandbox up --name gx10 --host ssh://jay@gx10 --project <project-id> --gpus
```

첫 실행이 하는 일은 다음과 같다.

1. `briar-sandbox-gx10` Docker context를 만들거나 host가 바뀌었으면 갱신한다.
2. 빌드 컨텍스트를 임시 디렉터리에 스테이징하고 digest를 계산한다.
3. 같은 태그의 이미지가 없으면 `docker build`한다 (원격이면 컨텍스트가 SSH로
   전송된다). 첫 빌드는 Bun, Node, provider CLI 다운로드 때문에 몇 분 걸린다.
4. 컨테이너를 만들고 `briar sandbox supervise`를 PID 1(`--init` 뒤)로 띄운다.
5. `docker exec -i ... briar sandbox bootstrap`에 JSON payload를 넘긴다.
   payload에는 Briar API origin, 사용자 세션 토큰, 프로젝트별 agent token,
   이 Mac의 global git `user.name`/`user.email`, 그리고 `~/.codex/auth.json`이
   있으면 그 내용이 들어간다. git identity는 컨테이너에 아직 없을 때만 쓴다.
6. 컨테이너 안에서 프로젝트마다 GitHub 자격 증명을 받아 저장소를 클론하고
   (`~/Briar/projects/<org>/<project>/<repo>`), 프로젝트를 연결하고, execution
   worker로 등록한다. 워커 label은 기본 `sandbox-<name>`이다.
7. `briar sandbox report`가 `ready: true`를 돌려줄 때까지 최대 3분 기다린다.

`--project`를 생략하면 이 Mac에 연결된 모든 프로젝트를 넘긴다. 다시 실행하면
같은 단계를 멱등하게 반복하므로 프로젝트를 추가하거나 토큰을 갱신할 때도
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
briar sandbox rm --name gx10          # 컨테이너 제거, 볼륨은 유지
briar sandbox rm --name gx10 --purge  # 볼륨까지 제거
```

`rm`은 Briar 서버의 워커 등록을 지우지 않는다. 컨테이너가 사라지면 워커는
heartbeat가 끊겨 offline으로 보이고, 필요하면 앱의 fleet 화면에서 정리한다.

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
