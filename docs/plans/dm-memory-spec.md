# Briar DM 기억 관리 SPEC (대체됨)

> **대체됨 (2026-10-14).** DM 기억은 Cloudflare Artifacts의 memory vault가
> 맡는다: [memory-vault-spec.md](memory-vault-spec.md),
> [운영 문서](../operations/memory-vault.md). 이 문서가 정의한 D1 원본 문서,
> Vectorize 조각 인덱스, `memory_search`·`memory_get`, 기본 요약(brief), 자동
> 학습(제안·검증 파이프라인)은 migration `0222_remove_legacy_dm_memory.sql`과
> 함께 코드와 D1에서 제거됐다. 이전 전문은 git 기록에 있다
> (`git show dc40e2cc:docs/plans/dm-memory-spec.md`).
>
> 아래는 아직 코드가 따르는 부분만 남긴 것이다.

## 기억 공간과 권한 (현행)

### 기억 공간

기억 공간 `memorySpaceId`는 다음 신원에 속한다.

`organizationId + channelId + ownerUserId + agentId + rosterEpoch`

서버가 실제 DM 참여자를 확인해 이 조합을 만든다. 모델이나 클라이언트가
임의의 `ownerUserId`, `agentId`, 검색 namespace를 권한의 근거로 제공하지 않는다.
프로젝트 Agent와의 DM도 기억 자체는 그 DM 안에 머문다.

Agent의 조회·기록은 다음 조건을 모두 만족해야 한다.

1. 채널이 활성 상태의 DM이며 실제 참여자가 사용자 1명과 Agent 1명이다.
2. 사용자가 조직·DM에 여전히 접근할 수 있고 Agent도 해당 DM에 참여 중이다.
3. reply claim의 조직·DM·Agent가 기억 공간과 일치한다.
4. 프로젝트 Agent인 경우 기존 프로젝트 실행 권한도 유효하다.
5. 기억 기능이 활성 상태이고 claim의 권한 세대가 현재 값과 일치한다.

이 조건은 Agent의 자동 조회·기록 조건이다. 사용자가 요청한 저장은
[memory-vault-spec.md](memory-vault-spec.md) §4의 `--user-requested` 규칙을 따른다.

사용자의 관리 권한은 Agent 조회 권한과 구분한다. 기억 공간의 원래 소유자가
현재 조직 구성원임을 확인하면 기능 OFF나 공간 닫힘 상태에서도 자신의 기록을
조회·삭제·내보낼 수 있다. 닫힌 공간에는 새 기억을 쓰지 않는다. 관리 목록은
사용자 소유 공간만 반환하고, 다른 참여자는 이 경로로 개인 기억을 읽을 수 없다.

조직 관리자라는 이유만으로 개인 DM 기억을 읽게 하지 않는다. 운영자 접근 정책은 별도 감사 대상이다.

### 참여자 변경

그룹으로 전환하거나 사용자·Agent가 교체되면 기존 기억 공간을 닫고 접근을
중단한다. 기존 공간을 새 참여자에게 재사용하지 않는다. 나중에 다시 1:1이
되더라도 이전 공간을 자동 복원하지 않고, 명시적인 별도 복원 절차로 다룬다.

이 규칙은 기억과 그 기억이 들어간 모델 세션에 적용된다. 기존 DM 원문을
새 참여자에게 보여주는 정책 자체를 이 기능에서 변경하거나 보장하지 않는다.

### Agent별 소유와 향후 공유

Grok의 Agent별 기억 분리와 작성자 추적을 가져오되 v1의 범위는 `dm`으로 고정한다.
`profile`이라는 분류가 사용자 전체의 공유 프로필이라는 뜻은 아니다. 같은 사용자와
대화하는 다른 Agent도 별도 기억 공간을 사용한다. 출처의 작성 Agent와 현재 읽는
Agent가 다르다는 이유로 읽기 권한이 생기지 않는다.

공유 사용자·프로젝트 기억은 후속 SPEC에서 다룬다. 추가할 때는 사용자가 공유할
항목·대상·근거 포함 범위를 선택하고, 수신 공간의 권한을 별도로 확인해야 한다.
DM의 본문·근거 메시지를 공용 기억에 자동 복사하거나 각 Agent가 공유 문서를
직접 덮어쓰게 하지 않는다. 읽기 우선순위는 권한 검사나 사용자 정정을 대신하지 않는다.

## 남아 있는 D1 구조

- `briar_dm_memory_spaces`와 `briar_dm_memory_live_rosters` 뷰가 위의 기억
  공간이다. 소유자의 두 스위치 `use_enabled`(회상)·`auto_enabled`(Agent의 자율
  기록)와 권한 세대 `revocation_epoch`를 가진다. 참여자·조직 역할·프로젝트 접근
  변경과 채널 삭제는 트리거가 공간을 닫거나 세대를 올린다. 설정 변경의 요청 ID
  중복 처리는 `briar_dm_memory_setting_requests`가 맡는다.
- DM reply claim은 `briar_dm_memory_reply_fences`로 공간과 그 세대에 묶인다.
  vault는 DM claim의 범위를 이 fence로 찾고, 세대가 바뀌면(잊기, 설정 변경,
  참여자 변경) 실행 중인 답변과 재개할 대화가 끝난다
  (`briar_dm_memory_activity_revocations`가 그 답변의 활동 표시를 지운다).
- `briar_dm_memory_exclusions`: 이전 D1 기억에서 소유자가 삭제한 기억의 근거
  메시지는 계속 Agent 스냅샷에서 제외된다. vault의 잊기는 이 표에 쓰지 않는다
  (memory-vault-spec §10).
