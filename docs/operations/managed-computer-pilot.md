# Briar 관리형 컴퓨터 파일럿 배포

## 범위와 안전 경계

- 고객은 컴퓨터 사양, 리전, 디스크 또는 네트워크 값을 API에 전달할 수 없다. Cloudflare Worker가 고정된 Launch Template ID와 숫자 버전만 사용한다.
- `GETBRIAR` 원문은 Cloudflare secret으로만 설정한다. 클라이언트는 입력값을 서버에 보내며 서버 응답 전에는 할인을 적용하지 않는다.
- EC2 user-data에는 만료되는 enrollment nonce와 관리형 컴퓨터 ID만 들어간다. 장기 Worker credential, AWS 키, GitHub 토큰, 저장소 또는 에이전트 자격 증명은 들어가지 않는다.
- Enrollment은 nonce와 더불어 AWS가 서명한 **원본 EC2 instance identity document**를 검증한다. 파싱한 JSON을 다시 서병화하지 않아 공백 하나가 바뀌어도 서명 검증이 실패한다.
- 인바운드 보안 그룹 규칙과 SSH 키는 없다. 고객 화면은 EC2가 Briar에 먼저 연결하는 HTTPS/WSS 443 outbound 경로만 사용한다. SSM Session Manager는 운영 장애 대응에만 사용한다.
- 로컬 TigerVNC는 `briar` 사용자로 `127.0.0.1:5901`에만 바인딩한다. 브라우저는 EC2 주소를 받지 않으며, 화면·키 입력·비밀번호·세션 토큰을 D1 또는 로그에 저장하지 않는다.
- 파일럿 신청을 꺼도 생성 중·사용 중인 컴퓨터의 Workflow, 만료, drain, 중지 및 종료 처리는 계속된다.

## 1. AMI 준비

관리형 컴퓨터의 기준 운영체제는 **Debian GNU/Linux 13 (trixie) x86_64**다. Amazon Linux 또는 다른 Debian 버전의 AMI를 사용하지 않는다. 이 저장소의 AMI 빌드 스크립트와 패키지 lock은 Debian의 `apt`, `apt-cache`, `dpkg`를 전제로 하며, `assert-debian-13-x86_64`가 기준에서 벗어난 빌더를 거부한다.

버전이 고정된 AMI에 다음 항목을 설치한다.

1. Briar CLI와 Worker 서비스, Bun, 지원할 에이전트 CLI.
2. 최신 AWS Systems Manager Agent(`amazon-ssm-agent`).
3. 비특권 `briar` 사용자와 XFCE, Chromium, TigerVNC, D-Bus 패키지. `remote-desktop-packages.txt`의 각 패키지는 승인된 Debian 13 저장소 스냅샷에서 `resolve-remote-desktop-packages`로 정확한 `package=version` lock을 만든 후 설치한다. base AMI의 배포판·버전과 저장소 스냅샷을 릴리스 기록에 함께 고정한다.
4. `mise exec -- bun run agent:build`로 만든 `apps/briar/dist-cli/briar-remote-session-agent.js`와 `infrastructure/managed-computers/`의 스크립트·서비스를 AMI 빌더에 복사한 뒤, root로 `install-remote-desktop <source-dir> <package-lock> <agent-bundle>`을 실행한다.
5. 설치 스크립트는 enrollment, loopback 원격 데스크톱, outbound 원격 세션 에이전트를 `/opt/briar/bin`과 systemd에 설치하고 부팅 대상으로 활성화한다. systemd는 enrollment oneshot이 성공한 뒤 데스크톱과 원격 에이전트를 시작하며, GUI와 Worker는 모두 `/home/briar`를 사용한다.
6. `briar-worker.service`는 `/var/lib/briar/worker-credential.json`을 읽되 저장소와 모델 제공자가 설정되고 heartbeat 건강 검사를 통과하기 전에는 `acceptingWork=false`, 동시 실행 수 1을 보고해야 한다.

AMI ID, base AMI ID, source commit, Bun/Briar/에이전트 버전, `remote-desktop-packages.lock` SHA-256과 패키지 목록을 릴리스 기록에 남긴다. Chromium과 TigerVNC의 재배포·보안 고지를 검토하고, 웹 번들에 포함되는 noVNC 1.7.0의 MPL-2.0 고지를 유지한다. 기존 데스크톱 자격 증명이나 홈 디렉터리를 AMI에 포함하지 않는다.

## 2. AWS 스택

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

1. D1 migrations `0125_managed_computers.sql`과 `0127_managed_computer_remote_sessions.sql`을 순서대로 적용한다.
2. Wrangler 배포 dry-run에서 `MANAGED_COMPUTER_PROVISIONING` Workflow와 `MANAGED_COMPUTER_REMOTE` Durable Object binding을 확인한다.
3. 일반 Worker 변수:
   - `MANAGED_COMPUTER_APPLICATIONS_ENABLED=true`
   - `MANAGED_COMPUTER_ORGANIZATION_LIMIT=1`
   - `MANAGED_COMPUTER_FLEET_LIMIT=<승인된 전체 한도>`
   - `MANAGED_COMPUTER_LIFETIME_DAYS=<파일럿 수명>`
   - `MANAGED_COMPUTER_STOPPED_RETENTION_DAYS=<중지 후 보존 기간>`
   - `MANAGED_COMPUTER_ENROLLMENT_TTL_MINUTES=30`
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
   - `MANAGED_COMPUTER_PROMOTION_CODE=GETBRIAR`
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

Identity public key는 AWS의 **해당 리전 RSA 인증서**를 공식 `regions-certs` 문서에서 받아 `openssl x509 -pubkey -noout -in certificate.pem`으로 추출한다. DSA/PKCS7이 아닌 `instance-identity/signature` 검증용 RSA 키여야 한다. 리전을 바꾸면 키도 함께 바꾸고 신규 신청을 다시 켜기 전 서명 음수 테스트를 수행한다.

모든 설정과 migration이 준비되기 전에는 `MANAGED_COMPUTER_APPLICATIONS_ENABLED=false`를 유지한다. 원격 화면은 아래 스테이징 검증과 비용 승인이 끝날 때까지 별도로 `MANAGED_COMPUTER_REMOTE_DESKTOP_ENABLED=false`를 유지한다.

## 4. 스테이징 검증

조직 owner/admin 계정으로 다음을 확인한다.

1. 구매창에서 잘못된 코드가 거절되고 서버가 확인한 코드만 US$0이 된다. 결제수단 입력은 없어야 한다.
2. 동일 `requestId`와 `Idempotency-Key`를 반복해도 D1 컴퓨터·프로모션 사용·EC2 인스턴스가 각각 하나다.
3. 일반 멤버, 두 번째 사용자 사용, 두 번째 조직 컴퓨터, fleet 한도 초과가 각기 거절된다.
4. EC2의 Launch Template 버전, `HttpTokens=required`, 암호화 EBS, 네 가지 Briar 태그, 빈 inbound 규칙, SSH key 미설정을 확인한다.
5. SSM이 Online인 실제 인스턴스만 enrollment에 성공하고, nonce 만료·원본 document 변조·다른 instance identity·다른 조직 ID는 거절된다.
6. 인스턴스에서 `/opt/briar/bin/verify-remote-desktop`을 실행한다. 5901 포트가 loopback에만 열리고 데스크톱·세션 에이전트가 `briar` 사용자로 실행되며 package lock checksum이 일치해야 한다.
7. `aws ec2 describe-security-groups --group-ids <SecurityGroupId>`에서 `IpPermissions=[]`, `aws ec2 describe-instances --instance-ids <id>`에서 public IP 없음과 정확한 AMI ID를 독립적으로 확인한다. 원격 화면 서비스 때문에 SSH/VNC/RDP ingress를 추가하지 않는다.
8. 조직 owner/admin 또는 신청자가 `화면 열기`로 1280×720 이상 화면을 연다. 일반 키, Ctrl/Alt 조합키, 마우스, 화면 맞춤, 전체 화면, 브라우저 새로고침 후 재연결을 포함해 10분 이상 조작한다.
9. 같은 컴퓨터의 두 번째 제어자, 일반 멤버, 다른 조직, 60초가 지난 토큰과 한 번 사용한 토큰을 각각 거절한다. 네트워크 단절과 Durable Object 재시작에서는 재연결하거나 명시적으로 종료되어야 한다.
10. 원격 화면에서 테스트 저장소와 테스트 모델 제공자에 로그인하고 같은 `/home/briar`를 사용하는 Worker 건강 검사가 `acceptingWork=true`가 되어 `사용 가능`으로 전환되는지 확인한다.
11. D1 감사 테이블과 Cloudflare 로그에는 세션 ID, 상태, 사유 코드, 방향별 바이트 수만 남고 화면 바이트, 키 입력, 비밀번호, protocol token, Worker credential이 없음을 표본 검사한다.
12. 스테이징에서 10분 세션의 평균/최대 대역폭, 왕복 지연, Durable Object 요청·기간·메모리와 예상 월 비용을 릴리스 기록에 남긴다. 승인 기준을 넘으면 공개 플래그를 켜지 않고 WebRTC 또는 승인된 전송 계층 검토로 넘긴다.
13. 실패 후 재시도는 새 provisioning job의 EC2 `ClientToken`으로 새 인스턴스를 만들고, 이전 인스턴스는 `briar-managed` 및 컴퓨터 ID 태그를 확인한 뒤 종료하는지 확인한다. 같은 Workflow 안의 AWS 재시도에서는 동일 `ClientToken`이 중복 생성을 막는지 확인한다.
14. 만료 시간을 앞당긴 테스트 데이터로 활성 원격 세션 종료 → 새 작업 차단 → drain → stop → 보존 기간 후 terminate와 credential revoke를 확인한다.

검증을 모두 통과한 뒤에만 `MANAGED_COMPUTER_REMOTE_DESKTOP_ENABLED=true`로 다시 배포한다. 플래그를 켠 배포에서 웹과 Tauri 각각 `화면 열기`를 다시 확인한다.

## 기존 컴퓨터 업그레이드와 릴리스 기록

- 새 신청은 검증된 새 AMI ID를 넣어 CloudFormation을 갱신하고, 스택 출력의 **새 숫자 Launch Template 버전**을 Worker 설정에 기록한다. `$Latest`/`$Default`는 사용하지 않는다.
- 기존 컴퓨터는 실행 중인 작업을 drain하고 중지한 뒤 암호화 root EBS snapshot을 만든다. 같은 인스턴스를 다시 시작하여 SSM 운영 세션에서 새 번들·package lock으로 `install-remote-desktop`을 실행하면 `/home/briar`와 기존 로그인 상태를 유지할 수 있다.
- 업그레이드 후 enrollment credential을 재발급하지 않는다. 기존 credential 파일을 확인한 뒤 `systemctl start briar-remote-desktop.service briar-remote-session-agent.service`를 실행하고 `verify-remote-desktop`, Worker heartbeat, 실제 Briar 원격 연결을 확인한다. 실패하면 인스턴스를 중지하고 사전 snapshot으로 root volume을 복원한다.
- 기존 컴퓨터를 새 AMI로 교체해야 한다면 사용자에게 로그아웃/재인증을 명시적으로 안내하고 새 D1 컴퓨터 레코드와 새 credential을 발급한다. 다른 컴퓨터의 홈이나 credential을 복사하지 않는다.

릴리스 기록에는 `sourceCommit`, `amiId`, `baseAmiId`, `packageLockSha256`, `launchTemplateId`, `launchTemplateVersion`, `securityGroupId`, 검증 인스턴스 ID, 검증 시각, 10분 세션 측정값, 승인자를 모두 적는다. **실제 값과 관찰 결과가 없는 항목을 완료로 표시하지 않는다.**

## 중단과 복구

- 신규 신청 즉시 중단: `MANAGED_COMPUTER_APPLICATIONS_ENABLED=false`로 배포한다. 기존 컴퓨터 lifecycle은 유지된다.
- 원격 제어 즉시 중단: `MANAGED_COMPUTER_REMOTE_DESKTOP_ENABLED=false`로 배포한다. 컴퓨터/Worker는 유지되며 새 원격 세션만 막힌다. 컴퓨터 중지·만료·종료 또는 credential revoke 시 활성 세션도 종료된다.
- 준비 실패: UI의 제한된 재시도(최대 3회)를 사용한다. 새 시도는 현재 Launch Template 설정과 새 EC2 client token을 사용하며, 이전 인스턴스는 태그가 일치할 때만 종료한다.
- 고아 리소스: 6시간 reconciliation 결과의 `orphanInstanceIds`와 `briar-managed=true` 태그를 대조한다. 자동 종료하지 말고 D1 감사 기록과 조직 태그를 확인한 뒤 운영자가 처리한다.
- 파일럿 종료: 수명 정책을 통해 drain과 stop을 먼저 수행한다. 즉시 terminate하지 않는다.
