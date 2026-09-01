# Briar 관리형 컴퓨터 파일럿 배포

## 범위와 안전 경계

- 고객은 컴퓨터 사양, 리전, 디스크 또는 네트워크 값을 API에 전달할 수 없다. Cloudflare Worker가 고정된 Launch Template ID와 숫자 버전만 사용한다.
- `GETBRIAR` 원문은 Cloudflare secret으로만 설정한다. 클라이언트는 입력값을 서버에 보내며 서버 응답 전에는 할인을 적용하지 않는다.
- EC2 user-data에는 만료되는 enrollment nonce와 관리형 컴퓨터 ID만 들어간다. 장기 Worker credential, AWS 키, GitHub 토큰, 저장소 또는 에이전트 자격 증명은 들어가지 않는다.
- Enrollment은 nonce와 더불어 AWS가 서명한 **원본 EC2 instance identity document**를 검증한다. 파싱한 JSON을 다시 직렬화하지 않아 공백 하나가 바뀌어도 서명 검증이 실패한다.
- 인바운드 보안 그룹 규칙과 SSH 키는 없다. 고객 화면은 EC2가 Briar에 먼저 연결하는 HTTPS/WSS 443 outbound 경로만 사용한다. SSM Session Manager는 운영 장애 대응에만 사용한다.
- 로컬 TigerVNC는 `briar` 사용자로 `127.0.0.1:5901`에만 바인딩한다. 브라우저는 EC2 주소를 받지 않으며, 화면·키 입력·비밀번호·세션 토큰을 D1 또는 로그에 저장하지 않는다.
- 컴퓨터 소유자의 데스크톱과 모든 프로젝트 Worker는 같은 `briar` 계정으로 실행하며, `sudo -n`으로 비밀번호 없이 이 컴퓨터의 관리자 권한을 사용할 수 있다. Worker가 실행하는 저장소 코드도 시스템 파일·패키지·서비스와 이 컴퓨터에 저장된 자격 증명을 수정하거나 삭제할 수 있다. 서로 신뢰하지 않는 프로젝트를 한 컴퓨터에 연결하지 않는다.
- 관리자 권한은 해당 EC2의 운영체제 안에서만 부여한다. 인바운드·SSH·IMDSv2·EBS 설정이나 instance role의 AWS 권한은 확대하지 않으며, Parameter Store 조회 거부를 유지한다.
- 파일럿 신청을 꺼도 생성 중·사용 중인 컴퓨터의 Workflow, 만료, drain, 중지 및 종료 처리는 계속된다.
- 사용자가 컴퓨터 은퇴를 요청하면 새 작업을 즉시 차단하고 응답 후 중지를 시도한다. 활성 실행 lease가 없으면 EC2를 바로 중지하며, lease가 남아 있거나 AWS 호출이 실패하면 `draining` 상태를 유지한 채 기존 1분 Cron Trigger에서 다시 시도한다. 6시간 reconciliation은 만료·종료·고아 탐지 등 전체 수명주기 점검에 계속 사용한다.

## 1. AMI 준비

관리형 컴퓨터의 기준 운영체제는 **Debian GNU/Linux 13 (trixie) x86_64**다. Amazon Linux 또는 다른 Debian 버전의 AMI를 사용하지 않는다. 이 저장소의 AMI 빌드 스크립트와 패키지 lock은 Debian의 `apt`, `apt-cache`, `dpkg`를 전제로 하며, `assert-debian-13-x86_64`가 기준에서 벗어난 빌더를 거부한다.

버전이 고정된 AMI에 다음 항목을 설치한다.

1. `/opt/briar/bin/briar` CLI와 여섯 provider runner bundle. `/opt/briar/bin`에는 버전이 고정된 Bun·Node.js·Rust(`rustfmt`, `clippy`)·`cargo-audit`·`gitleaks`, Codex·Claude·Cursor Agent·Grok·Antigravity·OpenCode CLI와 `agent-browser`를 설치한다. OpenRouter는 같은 OpenCode 실행파일을 사용한다. 로그인 terminal과 managed Worker 모두 이 경로와 같은 `CARGO_HOME`·`RUSTUP_HOME`을 사용한다.
2. 승인 시점의 AWS Systems Manager Agent(`amazon-ssm-agent`). 버전과 설치 파일 SHA-256은 `image-lock.env`에 함께 고정한다.
3. sudo 관리자 권한이 있는 `briar` 사용자와 XFCE, 실제 Google Chrome, TigerVNC, D-Bus, C/C++ build toolchain과 Noto CJK 글꼴. GitHub CLI는 기본 이미지 요구사항이 아니다. XFCE Terminal은 Korean glyph를 포함하는 `Noto Sans Mono CJK KR`을 기본으로 사용한다. `remote-desktop-packages.txt`의 각 Debian 패키지는 승인된 Debian 13 snapshot에서 `resolve-remote-desktop-packages`로 정확한 `package=version` lock을 만든 후 설치한다.
4. `briar-managed-computer.target`과 health timer를 설치하고 부팅 대상으로 활성화한다. target이 enrollment, signed runtime updater, Worker supervisor, loopback 원격 데스크톱과 outbound 원격 세션 서비스를 순서대로 묶는다. 개별 서비스는 target이 관리하므로 각각을 별도 multi-user 부팅 링크로 활성화하지 않는다. Worker supervisor는 `/var/lib/briar/worker-credential.json`의 machine credential을 값으로 복사하지 않고 파일에서 읽으며, 설정된 각 프로젝트에 Worker 프로세스를 하나씩 유지한다.
5. `briar managed-computer setup`이 소유자의 사용자 세션과 이미 등록된 machine credential을 짧게 연결한다. 저장소와 provider가 준비되고 heartbeat 건강 검사를 통과하기 전에는 Worker가 `acceptingWork=false`, 동시 실행 수 1을 보고한다.

관리 사용자 shell과 데스크톱·Worker·remote-session agent 서비스는
`GH_BROWSER=/opt/briar/bin/briar-open-browser`를 기본값으로 제공한다. 사용자가
GitHub CLI를 나중에 설치해도 `gh auth login --web`이 Chrome 종료를 기다리지
않도록 브라우저를 별도로 실행한다. 전역 `BROWSER`와 다른 provider의 인증 방식은
변경하지 않으며, shell에서 명시한 `GH_BROWSER`는 유지한다. 이 설정은 GitHub CLI
설치나 인증을 대신하지 않는다. AMI에는 `~/.config/gh`와 GitHub credential을 넣지 않는다.

`image.pkr.hcl`은 공식 Debian 13 amd64 EBS AMI를 명시적인 ID로 받아 SSM communicator로만 빌드한다. 빌더에는 public IP와 SSH key가 없고, IMDSv2와 암호화된 gp3 root volume을 강제한다. 다음 검사는 실제 AWS 리소스를 만들지 않는다.

```bash
mise exec -- bun run managed-computer:image:check
packer init infrastructure/managed-computers/image.pkr.hcl
packer validate -syntax-only infrastructure/managed-computers/image.pkr.hcl
```

실제 AMI 빌드는 Packer `1.16.0`, Session Manager plugin, AWS CLI와 빌드 전용 private subnet·빈 inbound security group·SSM instance profile이 있는 승인된 환경에서 실행한다.

```bash
export AWS_REGION=us-east-1
export SOURCE_AMI_ID=<official-debian-13-amd64-ami-id>
export VPC_ID=<build-vpc-id>
export SUBNET_ID=<private-build-subnet-id>
export SECURITY_GROUP_ID=<no-inbound-build-security-group-id>
export IAM_INSTANCE_PROFILE=<ssm-instance-profile-name>

mise exec -- bun run managed-computer:image:build
```

빌드는 `verify-managed-image`를 통과해야만 AMI를 캡처하고, AMI ID·base AMI ID·source commit·Debian snapshot·Bun·Node.js·Rust·감사 도구·Briar·에이전트 버전·Google Chrome·SSM Agent 버전·패키지 lock SHA-256을 `release-artifacts/managed-computers/<source-commit>/release.json`에 남긴다. Google Chrome과 TigerVNC의 재배포·보안 고지를 검토하고, 웹 번들에 포함되는 noVNC 1.7.0의 MPL-2.0 고지를 유지한다. Worker credential, 사용자 로그인, 저장소, provider 인증, AWS 키, `.env`, shell history 또는 기존 홈 디렉터리는 AMI에 포함하지 않는다.

### 1.1 관리형 런타임 업데이트

AMI는 Briar CLI, provider runner, 원격 세션 agent와 기본 Skill을
`/opt/briar/releases/<version>`에 설치하고 `/opt/briar/current`를 현재 버전으로
연결한다. `briar-managed-runtime-updater.service`는 root로 실행되지만 Production
minisign 공개키로 검증된 `linux-x86_64` 런타임 번들만 자동 설치한다. 이 업데이트
경로에서 Worker는 서버가 보낸 request ID, 목표 버전, Worker ID만
`/run/briar-runtime-updater`에 전달한다. 소유자와 Worker의 명시적인 sudo 작업은
별개로 `/opt`를 포함한 시스템 파일을 변경할 수 있다.

조직 관리자나 Worker 소유자가 원격 업데이트를 요청하면 기존 Worker update
프로토콜이 새 claim을 중단하고 실행 중인 작업을 durable queue로 인계한다. 모든
device session이 비워진 뒤 updater가 버전 고정 URL에서 번들과 서명을 내려받아
검증하고 새 release directory를 만든 다음 `current` 링크를 원자적으로 전환한다.
새 Worker가 목표 버전 heartbeat를 보내면 완료된다. 제한 시간 안에 확인되지
않으면 이전 release 링크로 롤백하고 update request를 `failed`로 기록한다.

이 경로는 Briar CLI, runner, 원격 세션 agent와 `briar-workflow`/`browser` Skill을
업데이트한다. Debian, Chrome, Bun, Rust와 provider CLI 같은 base toolchain은 계속
AMI 교체로 배포한다. updater가 포함되기 전에 생성된 기존 managed computer는 이
기능을 스스로 설치할 수 없으므로 updater-capable AMI로 한 번 교체해야 한다.

### 1.2 부팅 순서와 자동 복구

부팅 진입점은 `briar-managed-computer.target` 하나다. target은
`briar-managed-enroll.service`가 먼저 성공한 뒤 signed runtime updater, Worker,
loopback 데스크톱, outbound remote-session agent를 시작하고 모든 서비스가 준비될
때까지 `multi-user.target` 완료를 기다린다. 개별 서비스의 `WantedBy` 링크를
만들면 부팅 순서가 다시 깨질 수 있으므로 이미지 설치기는 기존 개별 링크를
제거하고 target만 enable한다.

Enrollment는 네트워크 오류와 HTTP 408·409·425·429·5xx를 일시적 실패로 보고
systemd가 10초 후 다시 시도한다. 잘못된 요청이나 권한 오류 같은 영구적 4xx는
별도 종료 코드로 남겨 무한 재시도하지 않는다. 성공한 credential은 기존과 같은
`root:briar`, mode `0640`으로만 저장한다.

`briar-managed-computer-health.timer`는 부팅 30초 후부터 60초마다
`briar-managed-computer-health.service`를 실행한다. watchdog은 credential 파일의
존재·권한, target과 다섯 하위 서비스의 active 상태, TigerVNC의 loopback listener를
확인하고, 실패하면 enrollment를 다시 실행한 뒤 하위 서비스를 순서대로 start하고
필요한 데스크톱/agent를 restart한다. 재확인에도 실패하면 종료 코드와 서비스명만
journal에 남기고 다음 주기에 다시 시도한다. credential 값·키 입력·화면 데이터는
출력하지 않는다. remote-session agent 자체의 WSS heartbeat/reconnect와 Worker의
서버 heartbeat는 기존 애플리케이션 경로가 계속 담당하며, watchdog은 그 위의 로컬
프로세스·소켓 부팅 복구 계층이다.

## 2. AWS 스택

### 기존 컴퓨터의 관리자 권한 적용

신규 AMI는 `/etc/sudoers.d/briar-local-admin`을 root 소유·0440 권한으로 설치한다.
데스크톱, Worker, remote-session agent 서비스는 `briar`로 실행하지만 sudo를 막는
`NoNewPrivileges`, 읽기 전용 mount와 syscall 제한을 적용하지 않는다. enrollment,
runtime updater, health 서비스의 기존 제한은 유지한다. 세 사용자 서비스는 시작할 때
`verify-managed-admin`으로 비대화형 sudo와 시스템 디렉터리 쓰기를 실제 확인한다.

기존 컴퓨터는 새 AMI만 배포해서 바뀌지 않는다. SSM으로 진행 중인 작업이 없는지
확인한 뒤 sudoers 파일, `verify-managed-admin`, 세 사용자 서비스 unit을 같은 병합
커밋에서 설치한다. 기존 파일을 백업하고 `/usr/sbin/visudo --check`와 `systemd-analyze verify`를
통과시킨 뒤 daemon-reload하고 해당 서비스만 재시작한다. 적용 중 health timer를
잠깐 중지했다면 되살리고, 하위 서비스 중지로 함께 내려갈 수 있는
`briar-managed-computer.target`도 다시 start한 뒤 전체 상태를 검사한다. 재시작 중
원격 화면은 잠깐 끊긴다. 기존 프로세스의 `NoNewPrivileges`는 실행 중에 해제할 수 없어 재시작이 필요하다.
인스턴스 재부팅이나 교체는 필요하지 않으며, 은퇴 후 중지된 컴퓨터는 이 작업 때문에
다시 시작하지 않는다.

적용 후 사용자 터미널과 Worker 서비스의 실행 환경에서 `sudo -n id -u`가 `0`인지,
패키지 설치가 가능한지, SSM·원격 연결·Worker heartbeat가 유지되는지 확인한다.
운영 중인 컴퓨터에는 인증 파일이 없는지 검사하는 `verify-managed-image` 전체를
실행하지 않고 `verify-managed-admin`을 `briar`로 실행한다.

네트워크 스택과 컴퓨터 스택은 저장소의 CloudFormation 템플릿으로 순서대로 적용한다. 두 템플릿 모두 계정·리전별 값을 파라미터로 받으며, AWS 콘솔에 수동으로 리소스를 만들거나 템플릿의 실제 값을 코드에 하드코딩하지 않는다.

### 2.1 사설 네트워크

`infrastructure/managed-computers/network.yaml`은 기존 VPC의 기존 public subnet에 단일 AZ NAT Gateway를 만들고, 같은 AZ의 private subnet과 `0.0.0.0/0 → NAT Gateway` route를 만든다. Private subnet의 `MapPublicIpOnLaunch`는 `false`다. NAT Gateway는 시간·데이터 처리 비용이 발생하고 단일 AZ 구성은 고가용성이 아니므로, 파일럿 리전과 비용 한도를 승인한 뒤 적용한다. NAT Gateway를 만들지 않는 경우에는 SSM, Briar API, 저장소 및 모델 제공자에 필요한 VPC endpoint 구성을 별도로 코드화해야 한다.

`PublicSubnetId`와 `AvailabilityZone`은 반드시 같은 AZ를 지정한다. `PrivateSubnetCidr`는 VPC와 기존 subnet에 겹치지 않는 블록이어야 한다.

```bash
export AWS_REGION=us-east-1
export NETWORK_STACK=briar-managed-computer-network
export VPC_ID=<existing-vpc-id>
export PUBLIC_SUBNET_ID=<existing-public-subnet-id>
export PRIVATE_SUBNET_CIDR=<non-overlapping-cidr>
export AVAILABILITY_ZONE=<public-subnet-availability-zone>

aws cloudformation validate-template \
  --template-body file://infrastructure/managed-computers/network.yaml \
  --region "$AWS_REGION"

aws cloudformation deploy \
  --stack-name "$NETWORK_STACK" \
  --template-file infrastructure/managed-computers/network.yaml \
  --parameter-overrides \
    VpcId="$VPC_ID" \
    PublicSubnetId="$PUBLIC_SUBNET_ID" \
    PrivateSubnetCidr="$PRIVATE_SUBNET_CIDR" \
    AvailabilityZone="$AVAILABILITY_ZONE" \
  --tags \
    briar-managed=true \
    Purpose=managed-computer-network \
  --region "$AWS_REGION" \
  --no-fail-on-empty-changeset

export PRIVATE_SUBNET_ID="$(aws cloudformation describe-stacks \
  --stack-name "$NETWORK_STACK" \
  --query 'Stacks[0].Outputs[?OutputKey==`PrivateSubnetId`].OutputValue' \
  --output text \
  --region "$AWS_REGION")"
```

배포 후 `PrivateSubnetId`, `NatGatewayId`, `NatEipAllocationId`, `NatEipPublicIp` 및 route table의 default route를 확인한다. `NatEipAllocationId`는 Elastic IP allocation ID이고, `NatEipPublicIp`는 실제 public IP다.

### 2.2 관리 컴퓨터 Launch Template

전용 IAM principal을 먼저 만들고, `infrastructure/managed-computers/cloudformation.yaml`을 적용한다. 이 스택은 policy를 만들지만 principal에 자동 연결하지 않는다.

컴퓨터의 instance role은 SSM 연결을 위해 `AmazonSSMManagedInstanceCore`를 유지하되,
inline policy `DenyParameterStoreReads`로 `ssm:GetParameter*`를 명시적으로 거부한다.
이 거부는 단일·복수 파라미터 조회, 경로별 조회와 버전 이력 조회에 모두 적용된다.
컴퓨터에 필요한 자격 증명은 Briar의 enrollment와 프로젝트별 인증 경로로 전달하며,
계정의 Parameter Store에서 읽지 않는다.

이 IAM 역할을 공유하는 기존 컴퓨터에도 정책 변경이 적용된다. 역할 정책만 수정할 때는
AMI 재빌드나 컴퓨터 재부팅이 필요하지 않다. Change Set에서 역할의 정책만 변경되고
리소스 교체가 없는지 확인한 뒤 적용한다. 적용 후 파라미터 읽기 거부와 SSM 연결 유지,
실행 중인 컴퓨터의 Briar 서비스 상태를 확인한다.

```bash
export COMPUTER_STACK=briar-managed-computer
export AMI_ID=<versioned-ami-id>
export PROVISIONER_PRINCIPAL_ARN=<reviewed-iam-user-or-role-arn>

aws cloudformation validate-template \
  --template-body file://infrastructure/managed-computers/cloudformation.yaml \
  --region "$AWS_REGION"

aws cloudformation deploy \
  --stack-name "$COMPUTER_STACK" \
  --template-file infrastructure/managed-computers/cloudformation.yaml \
  --parameter-overrides \
    AmiId="$AMI_ID" \
    VpcId="$VPC_ID" \
    SubnetId="$PRIVATE_SUBNET_ID" \
    ProvisionerPrincipalArn="$PROVISIONER_PRINCIPAL_ARN" \
  --capabilities CAPABILITY_NAMED_IAM \
  --tags \
    briar-managed=true \
    Purpose=managed-computer-pilot \
  --region "$AWS_REGION" \
  --no-fail-on-empty-changeset

aws cloudformation describe-stacks \
  --stack-name "$COMPUTER_STACK" \
  --query 'Stacks[0].Outputs[].{Key:OutputKey,Value:OutputValue}' \
  --output table \
  --region "$AWS_REGION"
```

스택 출력에서 다음 값을 기록한다.

- `LaunchTemplateId`
- 숫자인 `LaunchTemplateVersion` (`$Latest` 또는 `$Default` 금지)
- `ProvisionerPolicyArn`
- `SecurityGroupId`

보안 검토 후 `ProvisionerPolicyArn`을 Cloudflare에서 사용하는 정확한 IAM principal에만 연결한다. 템플릿은 자동 연결하지 않아 잘못된 principal에 권한이 붙는 것을 방지한다.

정책 연결은 별도 검토 후 실행한다. 현재 Worker 구현이 AWS access key를 사용하므로 access key를 저장소·user-data·로그·명령 인자에 넣지 말고, 시크릿 저장 위치를 준비한 직후 한 번만 생성해 저장한다. 아직 Worker secret을 준비하지 않았다면 access key를 미리 만들지 않는다.

```bash
export PROVISIONER_POLICY_ARN="$(aws cloudformation describe-stacks \
  --stack-name "$COMPUTER_STACK" \
  --query 'Stacks[0].Outputs[?OutputKey==`ProvisionerPolicyArn`].OutputValue' \
  --output text \
  --region "$AWS_REGION")"

aws iam attach-user-policy \
  --user-name <reviewed-iam-user-name> \
  --policy-arn "$PROVISIONER_POLICY_ARN"
```

`LaunchTemplateVersion`은 반드시 스택 출력의 숫자를 Worker 설정에 기록한다. `$Latest`와 `$Default`는 사용하지 않는다. 새 AMI 또는 Launch Template 변경 후에는 새 숫자 버전을 기록하고, 실제 canary 인스턴스에서 AMI·private subnet·public IP 없음·IMDSv2·암호화 EBS·빈 inbound 규칙을 독립적으로 확인한다.

## 3. D1 및 Cloudflare

1. D1 migrations를 `0134_managed_computer_promotion_campaigns.sql`까지 순서대로 적용한다. `0131`은 setup bearer token 원문 대신 SHA-256만 저장하고, `0134`는 독립적으로 사용할 수 있는 추가 프로모션 캠페인을 등록한다.
2. Wrangler 배포 dry-run에서 `MANAGED_COMPUTER_PROVISIONING` Workflow와 `MANAGED_COMPUTER_REMOTE` Durable Object binding을 확인한다.
3. 일반 Worker 변수:
   - `MANAGED_COMPUTER_APPLICATIONS_ENABLED=true`
   - `MANAGED_COMPUTER_ORGANIZATION_LIMIT=1`
   - `MANAGED_COMPUTER_FLEET_LIMIT=<승인된 전체 한도>`
   - `MANAGED_COMPUTER_LIFETIME_DAYS=<파일럿 수명>`
   - `MANAGED_COMPUTER_STOPPED_RETENTION_DAYS=<중지 후 보존 기간>`
   - `MANAGED_COMPUTER_ENROLLMENT_TTL_MINUTES=30`
   - `MANAGED_COMPUTER_SETUP_TTL_MINUTES=10`
   - `MANAGED_COMPUTER_AWS_REGION=<스택 리전>`
   - `MANAGED_COMPUTER_AWS_LAUNCH_TEMPLATE_ID=<출력값>`
   - `MANAGED_COMPUTER_AWS_LAUNCH_TEMPLATE_VERSION=<숫자 출력값>`
   - `MANAGED_COMPUTER_INSTANCE_TYPE`, `MANAGED_COMPUTER_VOLUME_GIB`, `MANAGED_COMPUTER_VCPU`, `MANAGED_COMPUTER_MEMORY_GIB`
   - `MANAGED_COMPUTER_API_ORIGIN=https://briar-api.wbai.workers.dev`
   - `MANAGED_COMPUTER_AWS_IDENTITY_PUBLIC_KEY=<스택 리전의 AWS RSA 인증서에서 추출한 PUBLIC KEY PEM>`
   - `MANAGED_COMPUTER_REMOTE_DESKTOP_ENABLED=false` (스테이징 검증 완료 전 필수)
   - `MANAGED_COMPUTER_REMOTE_DESKTOP_ALLOWED_ORIGINS=https://briar.wordbricks.ai,tauri://localhost,http://tauri.localhost`
   - `MANAGED_COMPUTER_REMOTE_DESKTOP_TOKEN_TTL_SECONDS=60`
   - `MANAGED_COMPUTER_REMOTE_DESKTOP_MAX_SESSION_MINUTES=60`
   - `MANAGED_COMPUTER_REMOTE_DESKTOP_ORGANIZATION_SESSION_LIMIT=<승인된 조직 동시 세션 수>`
   - `MANAGED_COMPUTER_REMOTE_DESKTOP_FLEET_SESSION_LIMIT=<승인된 전체 동시 세션 수>`
   - `MANAGED_COMPUTER_REMOTE_DESKTOP_RATE_LIMIT=10`
4. Cloudflare secrets:
   - `MANAGED_COMPUTER_PROMOTION_CODE={"campaign-id":"promotion-code"}`
   - `MANAGED_COMPUTER_ENROLLMENT_SECRET=<32바이트 이상 무작위 값>`
   - `MANAGED_COMPUTER_AWS_ACCESS_KEY_ID`
   - `MANAGED_COMPUTER_AWS_SECRET_ACCESS_KEY`
   - 단기 자격 증명을 쓰는 경우 `MANAGED_COMPUTER_AWS_SESSION_TOKEN`

   이 값들은 저장소의 `.env.production`에 `dotenvx` ciphertext로만 기록한다.
   `.env.keys`는 신뢰된 배포 호스트에서만 보관하고 커밋하거나 Cloudflare에
   올리지 않는다. `bun run worker:deploy`는 위 allowlist만 복호화해 임시
   `secrets.json`으로 Wrangler에 전달한 뒤 파일을 삭제한다. 복호화된 값이나
   AWS access-key CSV를 PR, 로그, user-data, 명령 인자로 남기지 않는다.
   변경 전후에는 `bun run secrets:verify-encrypted`를 실행한다.

   여러 프로모션을 운영할 때는 같은 secret 안에 캠페인 ID별 코드를 JSON
   객체로 보관한다. 각 캠페인은 사용자와 조직마다 한 번씩만 사용할 수 있다.
   `stopped` 또는 `terminated` 컴퓨터는 동시 보유 한도에서 제외되므로, 기존
   컴퓨터가 완전히 중지된 뒤에는 사용하지 않은 다음 캠페인으로 새 컴퓨터를
   신청할 수 있다. 캠페인 ID만 migration과 감사 로그에 저장하고 코드 원문은
   저장하거나 응답하지 않는다.

Identity public key는 AWS의 **해당 리전 RSA 인증서**를 공식 `regions-certs` 문서에서 받아 `openssl x509 -pubkey -noout -in certificate.pem`으로 추출한다. DSA/PKCS7이 아닌 `instance-identity/signature` 검증용 RSA 키여야 한다. 리전을 바꾸면 키도 함께 바꾸고 신규 신청을 다시 켜기 전 서명 음수 테스트를 수행한다.

모든 설정과 migration이 준비되기 전에는 `MANAGED_COMPUTER_APPLICATIONS_ENABLED=false`를 유지한다. 원격 화면은 아래 스테이징 검증과 비용 승인이 끝날 때까지 별도로 `MANAGED_COMPUTER_REMOTE_DESKTOP_ENABLED=false`를 유지한다.

### 3.1 소유자 setup/bind

Enrollment이 끝나면 `/var/lib/briar/worker-credential.json`에는 컴퓨터 전용 machine credential만 있고 사용자·저장소·provider 로그인은 없다. 소유자는 Briar에서 `설정하기`를 누르고 프로젝트와 provider를 고른다. setup agent는 서버가 발급한 저장소 범위의 단기 GitHub App installation token으로 clone한 뒤 provider 인증과 Worker bind를 수행한다.

Codex·Grok은 화면에 표시된 device URL과 일회용 코드를 사용한다. Claude는 브라우저 로그인이 반환한 authorization code를, OpenCode는 계정에서 만든 API key를 설정창에 입력한다. 입력값은 기존 setup WebSocket relay를 통해 관리형 컴퓨터에만 전달하며 D1, 감사 로그, Durable Object storage에 저장하지 않는다.

setup agent는 고정된 provider 명령만 pseudo-terminal에서 실행한다. Git clone은 임시 `GIT_ASKPASS`에만 installation token을 넘기고 즉시 삭제하며, clone URL·`.git/config`·로그에 토큰을 남기지 않는다.

사용자 인증으로 만든 10분짜리 setup ticket은 setup WebSocket과 machine context 요청을 승인하고 Worker bind 때 한 번만 소비한다. machine context는 immutable `githubRepositoryId`와 `owner/repo`, 단기 credential을 반환한다. setup agent는 `~/Briar/projects/<organization-id>/<project-id>/<repo>`를 사용하며 다른 원격이나 다른 ID가 있는 폴더를 덮어쓰지 않는다. 설정이 저장되면 Worker가 시작하고, 정상 heartbeat가 관찰된 뒤에만 `ready`가 된다.

원격 화면과 기존 `briar managed-computer setup` 명령은 장애 분석용 고급 경로로 유지한다. 정상 사용자 setup에는 Briar 사용자 로그인, SSH, AWS 권한, 인바운드 포트가 필요하지 않다.

## 4. 스테이징 검증

조직 owner/admin 계정으로 다음을 확인한다.

1. 구매창에서 잘못된 코드가 거절되고 서버가 확인한 코드만 US$0이 된다. 결제수단 입력은 없어야 한다.
2. 동일 `requestId`와 `Idempotency-Key`를 반복해도 D1 컴퓨터·프로모션 사용·EC2 인스턴스가 각각 하나다.
3. 일반 멤버, 두 번째 사용자 사용, 두 번째 조직 컴퓨터, fleet 한도 초과가 각기 거절된다.
4. EC2의 Launch Template 버전, `HttpTokens=required`, 암호화 EBS, 네 가지 Briar 태그, 빈 inbound 규칙, SSH key 미설정을 확인한다.
5. SSM이 Online인 실제 인스턴스만 enrollment에 성공하고, nonce 만료·원본 document 변조·다른 instance identity·다른 조직 ID는 거절된다.
6. 인스턴스에서 `/opt/briar/bin/verify-remote-desktop`을 실행한다. 관리 컴퓨터 target과 health timer가 enable·active이고, 5901 포트가 loopback에만 열리며 데스크톱·세션 에이전트가 `briar` 사용자로 실행되고 package lock checksum이 일치해야 한다. 인스턴스를 한 번 재부팅한 뒤 target이 모든 하위 서비스를 올리고 health timer의 첫 실행이 성공하는지도 확인한다.
7. `sudo -u briar -H bash -lc 'command -v bun node cargo rustc cargo-audit gitleaks codex claude cursor-agent grok agy opencode agent-browser'`에서 모든 실행파일이 `/opt/briar/bin`으로 해석되는지 확인한다. GitHub CLI는 설치되지 않아도 된다. 버전은 `/opt/briar/image-manifest.json`과 같아야 하며 provider는 아직 인증되지 않은 상태여야 한다.
   GitHub CLI를 시험 설치했다면 Chrome이 없는 상태와 이미 열린 상태에서 모두
   브라우저 실행 명령이 즉시 반환하고 Chrome이 계속 살아 있는지 확인한다.
   실제 device auth에서는 Chrome 창을 닫지 않고 CLI 인증이 완료되어야 한다.
8. 빈 테스트 저장소를 새 worktree로 clone한 뒤 `bun run ci:local`을 실행한다. `bun install --frozen-lockfile`로 `node_modules`를 bootstrap하고 C linker, Rust, `cargo-audit`, `gitleaks` 누락 없이 완료되는지 확인한다. `node_modules`나 사용자 저장소를 AMI 자체에 미리 넣지 않는다.
9. 원격 Terminal과 Chrome에서 한글 안내 문구와 한글 파일명이 네모 상자 없이 보이는지 확인하고 `fc-match ':lang=ko'`가 Noto CJK KR 글꼴을 고르는지 확인한다.
10. `aws ec2 describe-security-groups --group-ids <SecurityGroupId>`에서 `IpPermissions=[]`, `aws ec2 describe-instances --instance-ids <id>`에서 public IP 없음과 정확한 AMI ID를 독립적으로 확인한다. 원격 화면 서비스 때문에 SSH/VNC/RDP ingress를 추가하지 않는다.
11. 조직 owner/admin 또는 신청자가 `화면 열기`로 1280×720 이상 화면을 연다. 일반 키, Ctrl/Alt 조합키, 마우스, 화면 맞춤, 전체 화면, 브라우저 새로고침 후 재연결을 포함해 10분 이상 조작한다.
12. 같은 컴퓨터의 두 번째 제어자, 일반 멤버, 다른 조직, 60초가 지난 토큰과 한 번 사용한 토큰을 각각 거절한다. 네트워크 단절과 Durable Object 재시작에서는 재연결하거나 명시적으로 종료되어야 한다.
13. `설정하기`에서 Codex, Claude, Grok, OpenCode가 처음부터 모두 표시되는지 확인한다. 각 provider를 한 번씩 선택해 외부 브라우저 인증, GitHub clone, Worker bind와 `사용 가능` 전환을 검증한다. 실제 작은 이슈 하나를 claim·수정·검증·완료해 CLI 설치 확인과 실제 Agent 실행을 구분한다.
14. setup ticket, Claude authorization code, OpenCode API key 원문이 D1·Cloudflare 로그·Durable Object storage·systemd unit에 없고, 만료된 ticket·다른 컴퓨터의 machine credential·다른 조직 프로젝트가 모두 거절되는지 확인한다. setup relay가 binary frame과 64 KiB 초과 text frame을 거절하는지도 확인한다.
15. D1 감사 테이블과 Cloudflare 로그에는 세션 ID, 상태, 사유 코드, 방향별 바이트 수만 남고 화면 바이트, 키 입력, 비밀번호, protocol token, Worker credential이 없음을 표본 검사한다.
16. 스테이징에서 10분 세션의 평균/최대 대역폭, 왕복 지연, Durable Object 요청·기간·메모리와 예상 월 비용을 릴리스 기록에 남긴다. 승인 기준을 넘으면 공개 플래그를 켜지 않고 WebRTC 또는 승인된 전송 계층 검토로 넘긴다.
17. 실패 후 재시도는 새 provisioning job의 EC2 `ClientToken`으로 새 인스턴스를 만들고, 이전 인스턴스는 `briar-managed` 및 컴퓨터 ID 태그를 확인한 뒤 종료하는지 확인한다. 같은 Workflow 안의 AWS 재시도에서는 동일 `ClientToken`이 중복 생성을 막는지 확인한다.
18. 만료 시간을 앞당긴 테스트 데이터로 활성 원격 세션 종료 → 새 작업 차단 → drain → stop → 보존 기간 후 terminate와 credential revoke를 확인한다.

검증을 모두 통과한 뒤에만 `MANAGED_COMPUTER_REMOTE_DESKTOP_ENABLED=true`로 다시 배포한다. 플래그를 켠 배포에서 웹과 Tauri 각각 `화면 열기`를 다시 확인한다.

## 기존 컴퓨터 업그레이드와 릴리스 기록

- 새 신청은 검증된 새 AMI ID를 넣어 CloudFormation을 갱신하고, 스택 출력의 **새 숫자 Launch Template 버전**을 Worker 설정에 기록한다. `$Latest`/`$Default`는 사용하지 않는다.
- 기존 컴퓨터는 실행 중인 작업을 drain하고 중지한 뒤 암호화 root EBS snapshot을 만든다. 같은 인스턴스를 다시 시작하여 검증된 같은 source commit의 이미지 artifact로 런타임·서비스를 갱신하면 `/home/briar`와 기존 로그인 상태를 유지할 수 있다. AMI 빌드 전용 `install-image-runtime`을 운영 인스턴스에 직접 실행하지 않는다.
- 업그레이드 후 enrollment credential을 재발급하지 않는다. 기존 credential 파일을 확인한 뒤 `systemctl start briar-managed-computer.target`을 실행하고 `verify-remote-desktop`, health timer, Worker heartbeat, 실제 Briar 원격 연결을 확인한다. 실패하면 인스턴스를 중지하고 사전 snapshot으로 root volume을 복원한다.
- 기존 컴퓨터를 새 AMI로 교체해야 한다면 사용자에게 로그아웃/재인증을 명시적으로 안내하고 새 D1 컴퓨터 레코드와 새 credential을 발급한다. 다른 컴퓨터의 홈이나 credential을 복사하지 않는다.

릴리스 기록에는 `sourceCommit`, `amiId`, `baseAmiId`, `packageLockSha256`, `launchTemplateId`, `launchTemplateVersion`, `securityGroupId`, 검증 인스턴스 ID, 검증 시각, 10분 세션 측정값, 승인자를 모두 적는다. **실제 값과 관찰 결과가 없는 항목을 완료로 표시하지 않는다.**

## 중단과 복구

- 신규 신청 즉시 중단: `MANAGED_COMPUTER_APPLICATIONS_ENABLED=false`로 배포한다. 기존 컴퓨터 lifecycle은 유지된다.
- 원격 제어 즉시 중단: `MANAGED_COMPUTER_REMOTE_DESKTOP_ENABLED=false`로 배포한다. 컴퓨터/Worker는 유지되며 새 원격 세션만 막힌다. 컴퓨터 중지·만료·종료 또는 credential revoke 시 활성 세션도 종료된다.
- 준비 실패: UI의 제한된 재시도(최대 3회)를 사용한다. 새 시도는 현재 Launch Template 설정과 새 EC2 client token을 사용하며, 이전 인스턴스는 태그가 일치할 때만 종료한다.
- 고아 리소스: 6시간 reconciliation 결과의 `orphanInstanceIds`와 `briar-managed=true` 태그를 대조한다. 자동 종료하지 말고 D1 감사 기록과 조직 태그를 확인한 뒤 운영자가 처리한다.
- 파일럿 종료: 수명 정책을 통해 drain과 stop을 먼저 수행한다. 즉시 terminate하지 않는다.
