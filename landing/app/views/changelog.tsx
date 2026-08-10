import { type Locale, copy, localizedPath } from "../i18n";
import { Arrow, SiteFooter, SiteHeader } from "../site-chrome";
import { GITHUB_RELEASES_URL } from "../site-links";

export const changelogCopy = {
  ko: {
    metadata: {
      title: "Briar 변경 기록 — 새로운 기능과 개선 사항",
      description:
        "Briar의 최신 데스크톱, 채널, 모바일, 에이전트 워크플로 업데이트를 확인하세요.",
    },
    eyebrow: "PRODUCT UPDATES",
    title: "Briar 변경 기록",
    description:
      "사람과 에이전트가 더 선명하게 협업할 수 있도록 바뀐 기능과 개선 사항을 기록합니다.",
    current: "현재 안정 버전",
    latest: "최신",
    released: "출시",
    openApp: "Briar 열기",
    allReleases: "전체 릴리즈 보기",
    releaseNotes: "GitHub 릴리즈 열기",
    home: "홈",
    backTop: "맨 위로 ↑",
    entries: [
      {
        version: "1.2.99",
        date: "2026년 8월 10일",
        title: "동시 작업과 긴 대화를 더 안정적으로 처리합니다",
        summary:
          "같은 프로젝트 에이전트에서 여러 작업을 동시에 시작할 수 있고, 긴 링크·코드·표가 이슈 대화 패널 너비를 넘지 않도록 표시를 안정화했습니다.",
        items: [
          "첫 번째 작업이 실행 중이어도 같은 프로젝트 에이전트에서 다른 스킬 작업을 시작할 수 있습니다.",
          "동시에 실행하는 작업을 별도 세션으로 추적해 각 작업의 진행과 결과를 독립적으로 확인합니다.",
          "긴 URL, 코드 블록과 Markdown 표를 이슈 대화 패널 안에서 줄바꿈하거나 내부 스크롤로 표시해 가로 스크롤을 방지합니다.",
        ],
      },
      {
        version: "1.2.98",
        date: "2026년 8월 10일",
        title: "대화와 실행 상태를 더 정확하게 확인합니다",
        summary:
          "답글 참여자, 실제 실행 상태와 인라인 편집을 더 분명하게 보여주고, 채널 이모지 선택과 에이전트 인증 실패를 더 안전하게 처리합니다.",
        items: [
          "대화 답글에 참여한 사람을 요약해 누가 대화에 참여했는지 바로 확인합니다.",
          "이슈 내용을 화면에서 바로 수정하고, 알림 제목에도 실제 실행 상태를 표시합니다.",
          "채널 이모지 피커가 화면 밖으로 잘리지 않도록 위치를 조정합니다.",
          "선택 사항인 MCP 인증 실패를 전체 에이전트 실행 실패로 확장하지 않도록 격리합니다.",
          "iOS 작업 화면에서 중복으로 표시되던 로딩 스피너를 제거했습니다.",
        ],
      },
      {
        version: "1.2.97",
        date: "2026년 8월 10일",
        title: "채널 메시지에 이모지로 바로 반응합니다",
        summary:
          "채널 대화에서 빠른 이모지와 전체 피커를 사용해 메시지에 반응하고, 데스크탑·Companion·iOS 어디서든 같은 반응을 확인할 수 있습니다.",
        items: [
          "메시지에 마우스를 올려 👍, ❤️, 😂, 🎉 빠른 반응을 남기거나 전체 이모지 피커에서 원하는 반응을 선택합니다.",
          "반응 칩에 참여 인원과 내가 남긴 반응을 표시하고, 같은 이모지를 다시 누르면 반응을 취소합니다.",
          "채널 델타 동기화가 반응 추가와 삭제를 즉시 전달해 여러 기기에서 메시지 상태를 일관되게 유지합니다.",
          "데스크탑과 Companion 웹, iOS Companion이 같은 반응 모델과 토글 동작을 사용합니다.",
        ],
      },
      {
        version: "1.2.96",
        date: "2026년 8월 10일",
        title: "실행 비용과 Worker 상태를 더 정확하게 운영합니다",
        summary:
          "에이전트 사용량 원장을 실제 운영 화면에 연결하고, 제공자 비용이 없는 실행도 현재 요금으로 추정해 Worker별 사용량과 비용을 한눈에 확인할 수 있습니다.",
        items: [
          "설정의 사용량 화면에서 실행 원장에 저장된 토큰과 제공자 비용을 Worker·제공자·모델별로 집계해 보여줍니다.",
          "제공자가 비용을 보고하지 않은 실행은 현재 모델 요금표로 계산해 누락된 운영 비용을 보완합니다.",
          "Worker 환경 패널에서 설치된 Briar 버전과 업데이트 가능 여부를 확인하고 원격 업데이트를 바로 요청할 수 있습니다.",
          "이슈를 만들 때 Full Auto를 켜면 모든 체크포인트를 건너뛰고 중단 없이 처리하며, 데스크탑과 iOS에서 같은 설정을 사용합니다.",
          "Inbox의 채널 답글 알림을 열면 채널 화면의 정확한 대화로 이동해 답글 맥락을 바로 확인할 수 있습니다.",
          "프로젝트 에이전트 작업을 전달한 뒤 실행 대화상자가 즉시 닫혀 중복 요청 없이 결과 화면으로 자연스럽게 이어집니다.",
        ],
      },
      {
        version: "1.2.95",
        date: "2026년 8월 10일",
        title: "에이전트 사용량과 비용을 실행별로 확인합니다",
        summary:
          "Codex, Claude, Grok, OpenCode 실행의 토큰 사용량과 제공자 비용을 서버에 기록해 Worker 상태와 운영 비용을 더 정확하게 파악할 수 있습니다.",
        items: [
          "실행별 입력·출력·캐시·추론 토큰과 제공자가 보고한 비용을 사용량 원장에 영구 저장합니다.",
          "기존 Codex와 Claude에 더해 OpenCode와 Grok 사용량을 수집하고, 한도를 소진한 제공자는 Worker 실행 가능 목록에서 제외합니다.",
          "직접 실행, 예약과 이슈 처리에서 사용할 에이전트 스킬을 명시적으로 선택해 작업마다 의도한 설정을 안정적으로 유지합니다.",
          "이슈의 상태와 우선순위 배지를 바로 눌러 변경할 수 있고, 에이전트 오류는 화면을 가리는 배너 대신 토스트로 표시합니다.",
          "채널과 이슈의 첨부 파일 처리, 멘션 입력, 패널 크기 조절과 모바일 화면의 공통 동작을 정리해 협업 흐름을 안정화했습니다.",
        ],
      },
      {
        version: "1.2.94",
        date: "2026년 8월 10일",
        title: "모든 에이전트의 작업 과정을 같은 흐름으로 보여줍니다",
        summary:
          "Codex, Claude, Grok, OpenCode가 보내는 진행 이벤트를 하나의 형식으로 맞춰 메시지와 도구 활동을 더 일관되고 안정적으로 표시합니다.",
        items: [
          "에이전트의 답변 시작·진행·완료와 턴 종료 상태를 제공자에 관계없이 같은 이벤트 흐름으로 처리합니다.",
          "명령 실행, 파일 변경, 웹 검색과 기타 도구 활동의 시작·출력·완료 상태를 공통 형식으로 보여줍니다.",
          "Worker에서 이어받은 활동 ID를 세션별로 분리해 여러 실행의 진행 이벤트가 서로 섞이지 않습니다.",
          "아주 긴 활동 제목과 출력도 UTF-8 문자를 안전하게 보존하며 제한해 실시간 실행 화면을 안정적으로 유지합니다.",
        ],
      },
      {
        version: "1.2.93",
        date: "2026년 8월 10일",
        title: "에이전트마다 여러 스킬을 만들고 알맞은 작업에 사용합니다",
        summary:
          "하나의 에이전트에 목적별 스킬을 구성하고, 직접 실행·예약·이슈 처리·채널 대화에서 작업에 맞는 스킬을 선택해 실행할 수 있습니다.",
        items: [
          "프로젝트와 조직 에이전트에 여러 스킬을 만들고 각각 이름, 지침, 제공자, 모델과 추론 강도를 설정할 수 있습니다.",
          "에이전트를 직접 실행할 때마다 원하는 스킬을 선택하고, 이슈 처리에는 전용 스킬을 사용하며 예약 실행에는 전체 스킬 목록을 전달합니다.",
          "채널에서 에이전트와 저장된 스킬 이름을 함께 언급하면 해당 스킬로 답변하고, 일치하는 이름이 없으면 에이전트의 책임과 전체 스킬 목록 안에서 판단합니다.",
          "대기 중이거나 실행 중인 작업이 선택한 스킬을 안전하게 보존해 이름이나 실행 설정을 바꿔도 실행 맥락이 유지됩니다.",
        ],
      },
      {
        version: "1.2.92",
        date: "2026년 8월 9일",
        title: "에이전트 작업을 이어가고 사용량을 더 선명하게 확인합니다",
        summary:
          "완료된 에이전트 세션에도 후속 요청을 이어서 보낼 수 있고, 사용량 현황과 첨부 파일 전달 흐름을 더 일관되게 확인할 수 있습니다.",
        items: [
          "완료된 프로젝트 에이전트 세션에서 같은 대화와 작업 공간을 유지한 채 후속 작업을 시작할 수 있습니다.",
          "설정의 사용량 대시보드에서 에이전트 사용량을 더 자세히 확인할 수 있습니다.",
          "지원되는 에이전트 실행 경로가 대화 첨부 파일을 같은 방식으로 전달해 이미지와 파일 입력의 연결을 안정화했습니다.",
          "iOS에서 접근성 글자 크기에서도 프로젝트 전환 메뉴를 유지하고, 채널 메시지 이미지 첨부 흐름을 개선했습니다.",
        ],
      },
      {
        version: "1.2.91",
        date: "2026년 8월 8일",
        title: "중요한 실행 순간만 놓치지 않도록 알림을 정리했습니다",
        summary:
          "진행 중인 상태 변화로 Inbox가 붐비지 않도록 알림을 결정과 종료 시점에 집중하고, 에이전트 실행 연결과 칸반 카드 표시를 더 정확하게 다듬었습니다.",
        items: [
          "백로그, 대기, 실행 중, 단계 변경은 새 Inbox 메시지나 알림을 만들지 않습니다.",
          "일시정지, 완료, 실패, 차단처럼 확인이나 대응이 필요한 실행 상태만 Inbox에 표시합니다.",
          "데스크톱과 iOS에서 에이전트 실행 ID를 같은 소문자 형식으로 보내 실행 요청이 안정적으로 연결됩니다.",
          "칸반 카드에 배정된 Worker 아바타를 복원하고 중복된 단계 아이콘을 제거했습니다.",
        ],
      },
      {
        version: "1.2.90",
        date: "2026년 8월 8일",
        title: "워크플로와 에이전트 실행을 더 안정적으로 이어갑니다",
        summary:
          "워크플로 체크포인트를 하나의 v2 규칙으로 정리하고, 에이전트 작업과 스레드 답글이 중간에 끊기거나 잘못 연결되지 않도록 실행 흐름을 강화했습니다.",
        items: [
          "프로젝트와 실행 워크플로를 표준 v2 체크포인트 모델로 통합해 승인과 재개 상태를 일관되게 관리합니다.",
          "에이전트가 한 번의 응답으로 작업을 마치지 못해도 같은 대화와 작업 공간에서 활성 실행을 계속 진행합니다.",
          "에이전트 작업 요청 경로를 정적 자산보다 먼저 정확히 처리해 Worker가 작업을 안정적으로 가져옵니다.",
          "데스크톱과 iOS의 스레드 답글이 서버에 저장된 기준 메시지 ID를 사용해 에이전트 응답을 올바른 대화에 연결합니다.",
          "칸반 카드의 이슈 출처와 Worker 배지를 바로잡아 실행 정보를 더 정확하게 표시합니다.",
        ],
      },
      {
        version: "1.2.89",
        date: "2026년 8월 8일",
        title: "에이전트 실행 결과를 더 정확하게 반영합니다",
        summary:
          "저장된 에이전트가 맡은 책임을 실제 완료 목표로 수행하고, 실행 결과와 세션 상태를 일치시켜 진행 상황을 더 신뢰할 수 있습니다.",
        items: [
          "저장된 에이전트의 책임을 역할 설명이 아니라 끝까지 달성해야 할 명시적인 실행 목표로 전달합니다.",
          "해결 가능한 사전 조건과 복구 작업을 에이전트가 직접 처리하고, 결과를 검증한 뒤 완료로 보고합니다.",
          "즉시 실행과 예약 실행 모두 구조화된 결과가 완료일 때만 세션을 완료 상태로 표시합니다.",
          "부분 완료, 차단, 실패 또는 결과 누락을 성공으로 표시하지 않아 실행 이력을 더 정확하게 확인할 수 있습니다.",
        ],
      },
      {
        version: "1.2.88",
        date: "2026년 8월 8일",
        title: "원하는 Worker에서 에이전트를 바로 실행합니다",
        summary:
          "저장된 에이전트를 선택한 Worker의 최신 코드에서 실행하고, 데스크톱과 iOS에서 진행 상태와 결과를 더 안정적으로 이어서 확인할 수 있습니다.",
        items: [
          "저장된 에이전트 작업을 선택한 Worker에서 실행하고, 매 실행을 최신 main의 새 worktree에서 시작합니다.",
          "프로젝트 에이전트 작업 잡을 서버에서 추적해 실행 상태와 결과를 안정적으로 동기화합니다.",
          "iOS에서 프로젝트 에이전트를 실행하고 진행 상태와 결과를 확인할 수 있습니다.",
          "채널 알림, 멘션 링크, 이슈 자동완성, 메시지 전송 동작과 채널 상세 헤더를 개선했습니다.",
          "랜딩을 하나의 밝은 테마와 명시적인 한국어·영어 경로로 전면 개편했습니다.",
        ],
      },
      {
        version: "1.2.87",
        date: "2026년 8월 7일",
        title: "조직 에이전트와 채널 실행 흐름을 확장했습니다",
        summary:
          "조직 단위 에이전트를 직접 관리하고, 채널의 멘션과 이슈 제안 흐름을 데스크톱과 모바일에서 더 매끄럽게 이어갈 수 있습니다.",
        items: [
          "조직 설정에서 저장소에 속하지 않은 에이전트를 만들고 조회하거나 삭제할 수 있습니다.",
          "에이전트를 만들 때 제공자, 모델, 추론 강도와 담당 역할을 함께 설정할 수 있습니다.",
          "채널에서 @를 입력하면 전체 멤버와 에이전트 후보가 다시 빠짐없이 표시됩니다.",
          "모바일 웹과 iOS에서 채널의 이슈 생성 제안을 승인하고 대상 프로젝트와 생성된 이슈로 바로 이동할 수 있습니다.",
          "랜딩의 제품 미리보기를 실제 Briar 작업 흐름을 보여주는 데모 영상으로 개선했습니다.",
        ],
      },
      {
        version: "1.2.86",
        date: "2026년 8월 7일",
        title: "사람과 Worker를 더 선명하게 연결합니다",
        summary:
          "프로필과 멘션의 맥락을 풍부하게 만들고, 원격 Worker 업데이트와 데스크톱 종료 흐름을 더 안전하게 다듬었습니다.",
        items: [
          "채널 멘션에서 사람과 에이전트의 프로필을 열어 이름, 역할, 활동 정보를 확인할 수 있습니다.",
          "조직 Worker의 원격 업데이트 상태를 확인하고 새 버전을 더 안전하게 적용할 수 있습니다.",
          "Cmd+Q로 앱을 종료하기 전에 확인해 실수로 작업 창을 닫는 일을 방지합니다.",
          "이슈 카드 배지에서 불필요한 소스 점 아이콘을 제거해 상태 정보를 간결하게 표시합니다.",
        ],
      },
      {
        version: "1.2.85",
        date: "2026년 8월 7일",
        title: "채널 협업이 더 풍부해졌습니다",
        summary:
          "이미지, 초대, 메시지 관리, 계획 문서를 채널 안에서 자연스럽게 다룰 수 있도록 협업 흐름을 확장했습니다.",
        items: [
          "채널 메시지에 이미지를 첨부하고 에이전트 비전 입력으로 전달할 수 있습니다.",
          "채널 초대 대화상자와 메시지 편집·삭제 기능을 추가했습니다.",
          "Ideas를 채널 계획 문서로 통합해 대화와 실행 계획을 한곳에 모았습니다.",
          "이슈 이미지 편집, 오류 토스트, 담당자·Worker 아바타와 실행 버튼을 개선했습니다.",
          "Briar를 Apache License 2.0으로 공개했습니다.",
        ],
      },
      {
        version: "1.2.84",
        date: "2026년 8월 7일",
        title: "데스크톱 채널 대화를 새롭게 설계했습니다",
        summary:
          "채널 목록부터 대화 스레드까지 정보 밀도와 읽기 흐름을 다듬어 팀 대화를 더 빠르게 파악할 수 있습니다.",
        items: [
          "데스크톱 채널 대화 화면의 구조와 시각적 계층을 전면 개선했습니다.",
          "채널과 프로젝트 맥락을 오가며 대화 내용을 더 쉽게 추적할 수 있습니다.",
        ],
      },
      {
        version: "1.2.83",
        date: "2026년 8월 7일",
        title: "멘션 선택이 더 빠르고 정확해졌습니다",
        summary:
          "채널에서 사람과 에이전트를 호출할 때 필요한 대상을 더 쉽게 찾고 선택할 수 있습니다.",
        items: [
          "채널 멘션 선택기의 탐색과 선택 경험을 개선했습니다.",
          "PR 전 빠른 검증 절차를 문서에 명확히 정리했습니다.",
        ],
      },
      {
        version: "1.2.82",
        date: "2026년 8월 7일",
        title: "모바일 이슈 식별자를 더 간결하게 표시합니다",
        summary:
          "작은 화면에서도 이슈 번호와 상태를 빠르게 읽을 수 있도록 불필요한 표기를 정리했습니다.",
        items: [
          "모바일 이슈 키의 천 단위 쉼표를 제거했습니다.",
          "이슈 키 옆의 중복 단계 아이콘을 제거해 목록 가독성을 높였습니다.",
        ],
      },
      {
        version: "1.2.81",
        date: "2026년 8월 7일",
        title: "이슈 생성과 프로젝트 동기화를 안정화했습니다",
        summary:
          "언어별 제목 규칙과 프로젝트 선택을 바로잡고 앱 시작 시 로컬 워크플로 상태를 신뢰할 수 있게 맞췄습니다.",
        items: [
          "언어 특성을 고려해 이슈 제목 길이 제한을 적용합니다.",
          "클릭한 프로젝트가 새 이슈 대화상자에 정확히 선택됩니다.",
          "앱 시작 시 로컬 프로젝트 워크플로를 자동으로 동기화합니다.",
        ],
      },
      {
        version: "1.2.80",
        date: "2026년 8월 7일",
        title: "모바일과 데스크톱 채널 화면을 넓게 다듬었습니다",
        summary:
          "기기 크기에 맞춰 채널 대화가 자연스럽게 확장되도록 레이아웃과 빌드 호환성을 개선했습니다.",
        items: [
          "모바일 채널 대화 화면의 탐색과 메시지 레이아웃을 개선했습니다.",
          "데스크톱 채널 UI가 사용 가능한 셸 너비를 모두 활용합니다.",
          "iOS 채널 빌드 호환성을 복구했습니다.",
        ],
      },
    ],
  },
  en: {
    metadata: {
      title: "Briar changelog — New features and improvements",
      description:
        "See the latest updates to Briar desktop, channels, mobile, and agent workflows.",
    },
    eyebrow: "PRODUCT UPDATES",
    title: "Briar changelog",
    description:
      "A running record of the features and improvements that make collaboration between people and agents clearer.",
    current: "Current stable release",
    latest: "Latest",
    released: "Released",
    openApp: "Open Briar",
    allReleases: "View all releases",
    releaseNotes: "Open GitHub release",
    home: "Home",
    backTop: "Back to top ↑",
    entries: [
      {
        version: "1.2.99",
        date: "August 10, 2026",
        title: "Handle concurrent runs and long conversations more reliably",
        summary:
          "Start multiple tasks from the same project agent at once, while keeping long links, code, and tables inside the issue conversation pane.",
        items: [
          "Start another Skill task from a project agent while an earlier task is still running.",
          "Track concurrent tasks as separate sessions so each run's progress and result remain independent.",
          "Wrap long URLs and content, and scroll code blocks or Markdown tables inside the issue conversation pane instead of expanding the page horizontally.",
        ],
      },
      {
        version: "1.2.98",
        date: "August 10, 2026",
        title: "See conversations and run status more clearly",
        summary:
          "Reply participants, real execution states, and inline issue editing are easier to see, while emoji positioning and optional agent authentication failures are handled more safely.",
        items: [
          "Summarize the people who participated in a conversation reply so its context is visible at a glance.",
          "Edit issue content inline and show the actual execution state in notification titles.",
          "Keep the channel emoji picker within the viewport instead of letting it open off-screen.",
          "Isolate optional MCP authentication failures so they do not turn into a full agent-run failure.",
          "Remove the duplicate loading spinner from the iOS task view.",
        ],
      },
      {
        version: "1.2.97",
        date: "August 10, 2026",
        title: "React to channel messages with any emoji",
        summary:
          "Use quick reactions or the full emoji picker in channel conversations, with the same synchronized reactions across desktop, Companion, and iOS.",
        items: [
          "Hover over a message to add a quick 👍, ❤️, 😂, or 🎉 reaction, or choose any reaction from the full emoji picker.",
          "See participant counts and your own state on reaction chips, then select the same emoji again to remove your reaction.",
          "Propagate reaction additions and removals through channel delta sync so message state stays current across devices.",
          "Use the same reaction model and toggle behavior on desktop, Companion web, and iOS Companion.",
        ],
      },
      {
        version: "1.2.96",
        date: "August 10, 2026",
        title: "Operate with clearer run costs and worker health",
        summary:
          "The execution ledger now powers the operating views, while runs without provider-reported cost are priced from current rates for a clearer picture of usage and spend by worker.",
        items: [
          "Aggregate ledger tokens and provider-reported cost by worker, provider, and model in the usage settings view.",
          "Estimate runs that do not report cost from the current model price table so operating totals include previously uncovered usage.",
          "See each Worker's installed Briar version and update availability in the environment panel, then request a remote update directly.",
          "Enable Full Auto when creating an issue to skip every checkpoint and run without pausing, with matching behavior on desktop and iOS.",
          "Open a channel-reply Inbox notification on the Channels page at the exact conversation that produced it.",
          "Close the project-agent task dialog immediately after dispatch so the interface proceeds to the run without inviting duplicate requests.",
        ],
      },
      {
        version: "1.2.95",
        date: "August 10, 2026",
        title: "See agent usage and cost for every run",
        summary:
          "Token usage and provider-reported costs from Codex, Claude, Grok, and OpenCode are now recorded on the server for clearer worker health and operating-cost visibility.",
        items: [
          "Persist input, output, cache, and reasoning tokens plus provider-reported cost in a durable ledger for each execution.",
          "Collect OpenCode and Grok usage alongside Codex and Claude, and stop advertising providers whose usage allowance is exhausted.",
          "Select an agent skill explicitly for direct runs, schedules, and issue processing so each job keeps the intended configuration.",
          "Change issue status and priority directly from their badges, while agent failures appear as unobtrusive toasts instead of blocking banners.",
          "Stabilize collaboration by sharing attachment handling, mention composition, pane resizing, and mobile presentation behavior across surfaces.",
        ],
      },
      {
        version: "1.2.94",
        date: "August 10, 2026",
        title: "Every agent now reports work through one consistent flow",
        summary:
          "Progress events from Codex, Claude, Grok, and OpenCode now share one format, making messages and tool activity more consistent and reliable.",
        items: [
          "Process message start, progress, completion, and final turn status through the same event flow across providers.",
          "Present command runs, file changes, web searches, and other tools with common start, output, and completion states.",
          "Qualify restored worker activity IDs by session so progress from concurrent runs cannot collide.",
          "Bound unusually large activity titles and output on safe UTF-8 boundaries to keep live execution views responsive.",
        ],
      },
      {
        version: "1.2.93",
        date: "August 10, 2026",
        title: "Give every agent the right skill for each job",
        summary:
          "Configure purpose-built skills on one agent, then select the right skill for direct runs, schedules, issue processing, and channel conversations.",
        items: [
          "Create multiple skills for project and organization agents, each with its own name, instructions, provider, model, and reasoning effort.",
          "Choose a skill for every direct agent run, while issue processing uses its dedicated skill and schedules see the agent's full skill roster.",
          "Mention an agent and a saved skill name in a channel to invoke that skill; unmatched requests stay within the agent's responsibility and full skill roster.",
          "Queued and running work keeps a durable reference to its selected skill, preserving execution context across renames and edits.",
        ],
      },
      {
        version: "1.2.92",
        date: "August 9, 2026",
        title: "Agent work can continue, with clearer usage visibility",
        summary:
          "Follow-up requests can now continue from completed agent sessions, while usage reporting and attachment delivery are more consistent.",
        items: [
          "Start follow-up work from a completed project-agent session while keeping the same conversation and workspace.",
          "Review agent usage in greater detail from the usage dashboard in Settings.",
          "Supported agent execution paths now hand off conversation attachments consistently, making image and file inputs more reliable.",
          "The iOS project menu remains available at accessibility text sizes, with improved channel-message image attachments.",
        ],
      },
      {
        version: "1.2.91",
        date: "August 8, 2026",
        title: "Inbox notifications now focus on moments that matter",
        summary:
          "Routine in-progress changes no longer crowd the Inbox, while agent execution links and kanban card details are more accurate across clients.",
        items: [
          "Backlog, queued, running, and workflow-stage changes no longer create new Inbox messages or notifications.",
          "The Inbox surfaces only paused, completed, failed, and blocked runs that need attention or mark an outcome.",
          "Desktop and iOS send agent execution IDs in the same lowercase format for reliable task dispatch.",
          "Kanban cards once again show assigned worker avatars and omit the redundant workflow-stage icon.",
        ],
      },
      {
        version: "1.2.90",
        date: "August 8, 2026",
        title: "Workflows and agent runs keep moving reliably",
        summary:
          "Workflow checkpoints now follow one v2 contract, while agent tasks and threaded replies stay connected through longer-running work.",
        items: [
          "Standardized project and run workflows on the canonical v2 checkpoint model for consistent approval and resume behavior.",
          "Active agent runs continue in the same conversation and worktree when the provider needs more than one turn to finish.",
          "Agent task claim routes are matched exactly and handled before static assets so workers can claim work reliably.",
          "Desktop and iOS threaded replies use the canonical stored message ID, keeping agent responses attached to the right conversation.",
          "Corrected issue source indicators and worker badges on kanban cards for more accurate execution context.",
        ],
      },
      {
        version: "1.2.89",
        date: "August 8, 2026",
        title: "Agent sessions now reflect the real outcome",
        summary:
          "Saved agents treat their responsibility as an outcome to complete, while session status now stays aligned with the structured execution result.",
        items: [
          "Pass each saved agent's responsibility as an explicit execution objective instead of a role description.",
          "Agents handle reasonable prerequisites and recovery work themselves, then verify the result before reporting completion.",
          "Both immediate and scheduled runs mark a session complete only when the structured outcome is completed.",
          "Partial, blocked, failed, or missing outcomes no longer appear as successful sessions, making execution history more reliable.",
        ],
      },
      {
        version: "1.2.88",
        date: "August 8, 2026",
        title: "Run agents on the worker you choose",
        summary:
          "Run saved agents against the latest code on a selected worker, with more reliable progress and result tracking across desktop and iOS.",
        items: [
          "Run saved-agent tasks on a selected worker, with every run starting in a fresh worktree from the latest main branch.",
          "Track project-agent task jobs on the server so execution state and results stay synchronized.",
          "Run project agents from iOS and follow their progress and results.",
          "Improved channel notifications, mention links, issue autocomplete, message sending, and the channel detail header.",
          "Redesigned the landing site around one light theme with explicit English and Korean routes.",
        ],
      },
      {
        version: "1.2.87",
        date: "August 7, 2026",
        title: "Organization agents and channel execution, connected",
        summary:
          "Manage organization-level agents directly and carry mentions and issue proposals through smoother desktop and mobile channel workflows.",
        items: [
          "Create, review, and delete organization agents that are not tied to a repository.",
          "Choose each agent's provider, model, reasoning effort, and responsibility when creating it.",
          "Typing @ in a channel once again shows the complete roster of people and agents.",
          "Approve channel issue proposals on mobile web and iOS, select a project, and open the resulting issue directly.",
          "Updated the landing product preview with a demo video of the real Briar workflow.",
        ],
      },
      {
        version: "1.2.86",
        date: "August 7, 2026",
        title: "Clearer connections between people and workers",
        summary:
          "Profiles and mentions now carry richer context, while remote worker updates and desktop quitting are safer and more deliberate.",
        items: [
          "Open profiles from channel mentions to see a person or agent's name, role, and activity context.",
          "Check remote organization worker update status and apply new versions more safely.",
          "Confirm before quitting with Cmd+Q to avoid closing active work by mistake.",
          "Removed the redundant source-dot icon from issue card badges for cleaner status information.",
        ],
      },
      {
        version: "1.2.85",
        date: "August 7, 2026",
        title: "Richer collaboration in channels",
        summary:
          "Channels now bring images, invitations, message controls, and planning documents into one connected collaboration flow.",
        items: [
          "Attach images to channel messages and pass them into agent vision input.",
          "Invite members to channels and edit or delete channel messages.",
          "Plans have moved from Ideas into channel documents, keeping discussion and execution together.",
          "Improved issue image editing, error toasts, and assignee and worker controls.",
          "Briar is now available under the Apache License 2.0.",
        ],
      },
      {
        version: "1.2.84",
        date: "August 7, 2026",
        title: "A redesigned desktop channel conversation",
        summary:
          "The channel list and conversation thread now use a clearer hierarchy so teams can understand active discussions faster.",
        items: [
          "Redesigned the structure and visual hierarchy of desktop channel conversations.",
          "Made it easier to follow conversations across channel and project context.",
        ],
      },
      {
        version: "1.2.83",
        date: "August 7, 2026",
        title: "Faster, more precise mentions",
        summary:
          "Finding and selecting the right person or agent in a channel is now more direct.",
        items: [
          "Improved navigation and selection in the channel mention picker.",
          "Clarified the fastest pre-PR verification path in the documentation.",
        ],
      },
      {
        version: "1.2.82",
        date: "August 7, 2026",
        title: "Cleaner mobile issue identifiers",
        summary:
          "Issue numbers and state are easier to scan on smaller screens with redundant formatting removed.",
        items: [
          "Removed thousands separators from mobile issue keys.",
          "Removed the duplicate stage icon beside issue keys for a cleaner list.",
        ],
      },
      {
        version: "1.2.81",
        date: "August 7, 2026",
        title: "More reliable issue creation and project sync",
        summary:
          "Language-aware title rules, project selection, and startup synchronization now behave consistently.",
        items: [
          "Apply issue title limits that account for the writing language.",
          "Preselect the project that opened the new issue dialog.",
          "Synchronize local project workflows when the app starts.",
        ],
      },
      {
        version: "1.2.80",
        date: "August 7, 2026",
        title: "Roomier channel views across mobile and desktop",
        summary:
          "Channel conversations now adapt more naturally to each screen size, with improved layout and build compatibility.",
        items: [
          "Improved mobile channel navigation and message layout.",
          "Let the desktop channel UI fill the available shell width.",
          "Restored iOS channel build compatibility.",
        ],
      },
    ],
  },
} as const satisfies Record<Locale, unknown>;

const PATH = "/changelog" as const;

export default function ChangelogView({ locale }: { locale: Locale }) {
  const c = copy[locale];
  const changelog = changelogCopy[locale];
  const hrefs = {
    en: localizedPath("en", PATH),
    ko: localizedPath("ko", PATH),
  } as const;

  return (
    <main className="changelog-page" id="top">
      <SiteHeader
        brandHref={localizedPath(locale, "/")}
        className="changelog-header"
        copy={c}
        ctaLabel={changelog.openApp}
        currentPath={PATH}
        hrefs={hrefs}
        locale={locale}
        mobileCtaLabel={c.nav.openWebApp}
      />

      <section className="changelog-hero shell">
        <div>
          <span className="section-index">{changelog.eyebrow}</span>
          <h1>{changelog.title}</h1>
          <p>{changelog.description}</p>
        </div>
        <a href="#v1-2-99" className="changelog-current">
          <span>{changelog.current}</span>
          <strong>v1.2.99</strong>
          <i aria-hidden="true">↓</i>
        </a>
      </section>

      <section className="changelog-list shell" aria-label={changelog.title}>
        {changelog.entries.map((entry, index) => {
          const tagUrl = `${GITHUB_RELEASES_URL}/tag/v${entry.version}`;
          const entryId = `v${entry.version.replaceAll(".", "-")}`;
          return (
            <article
              className={`changelog-entry${index === 0 ? " is-latest" : ""}`}
              id={entryId}
              key={entry.version}
            >
              <div className="changelog-entry-index" aria-hidden="true">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <i />
              </div>
              <div className="changelog-entry-body">
                <div className="changelog-entry-meta">
                  <strong>v{entry.version}</strong>
                  {index === 0 ? <span>{changelog.latest}</span> : null}
                  <time
                    dateTime={
                      entry.version === "1.2.99" ||
                      entry.version === "1.2.98" ||
                      entry.version === "1.2.97" ||
                      entry.version === "1.2.96" ||
                      entry.version === "1.2.95" ||
                      entry.version === "1.2.94" ||
                      entry.version === "1.2.93" ||
                      entry.version === "1.2.92" ||
                      entry.version === "1.2.91" ||
                      entry.version === "1.2.90" ||
                      entry.version === "1.2.89" ||
                      entry.version === "1.2.88"
                        ? entry.version === "1.2.99" ||
                          entry.version === "1.2.98" ||
                          entry.version === "1.2.97" ||
                          entry.version === "1.2.96" ||
                          entry.version === "1.2.95" ||
                          entry.version === "1.2.94" ||
                          entry.version === "1.2.93"
                          ? "2026-08-10"
                          : entry.version === "1.2.92"
                            ? "2026-08-09"
                            : "2026-08-08"
                        : "2026-08-07"
                    }
                  >
                    {changelog.released} · {entry.date}
                  </time>
                </div>
                <h2>{entry.title}</h2>
                <p>{entry.summary}</p>
                <ul>
                  {entry.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <a href={tagUrl} target="_blank" rel="noreferrer">
                  {changelog.releaseNotes} <Arrow />
                </a>
              </div>
            </article>
          );
        })}
      </section>

      <section className="changelog-archive shell">
        <span className="section-index">RELEASE ARCHIVE</span>
        <a href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer">
          {changelog.allReleases} <Arrow />
        </a>
      </section>

      <SiteFooter
        brandHref={localizedPath(locale, "/")}
        copy={c}
        links={[
          { href: localizedPath(locale, "/"), label: changelog.home },
          { href: localizedPath(locale, "/tutorial"), label: c.nav.tutorial },
          { href: localizedPath(locale, "/download"), label: c.nav.download },
          { href: "#top", label: changelog.backTop },
        ]}
      />
    </main>
  );
}
