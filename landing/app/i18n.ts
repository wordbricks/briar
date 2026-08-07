export const supportedLocales = ["en", "ko"] as const;

export type Locale = (typeof supportedLocales)[number];

export const defaultLocale: Locale = "en";
export const localeCookieName = "briar-locale";

export function resolveBrowserLocale(acceptLanguage: string | null): Locale {
  const primaryLanguage = acceptLanguage
    ?.split(",", 1)[0]
    ?.trim()
    .split(";", 1)[0]
    ?.toLowerCase()
    .split("-", 1)[0];

  return primaryLanguage === "ko" ? "ko" : defaultLocale;
}

export function isLocale(value: string | undefined): value is Locale {
  return supportedLocales.includes(value as Locale);
}

export const copy = {
  ko: {
    metadata: {
      title: "Briar — 에이전트 개발의 운영체제",
      description:
        "이슈에서 PR까지, 사람과 코딩 에이전트가 함께 일하는 과정을 연결하고 관찰하는 로컬 우선 Agent Development Environment.",
      socialDescription:
        "코드는 로컬에. 에이전트 작업은 이슈에서 PR까지 한눈에.",
      locale: "ko_KR",
    },
    aria: {
      brandHome: "Briar 홈",
      mainMenu: "주요 메뉴",
      productPreview: "Briar 작업 대시보드 미리보기",
      heroArtwork: "사람이 Briar 작업 흐름을 이끄는 리소그래프 일러스트",
      securityVisual: "Briar 보안 구조",
      sendCommand: "에이전트에게 전송",
      openWebApp: "Briar 웹 앱 열기",
      macDownload: "Mac용 Briar 최신 버전 다운로드",
      androidDownload: "Android용 Briar 최신 릴리즈 다운로드",
      menuOpen: "메뉴 열기",
      menuClose: "메뉴 닫기",
    },
    language: {
      label: "언어",
      english: "영어",
      korean: "한국어",
    },
    nav: {
      product: "제품",
      workflow: "워크플로",
      security: "보안",
      agents: "에이전트",
      tutorial: "튜토리얼",
      blog: "블로그",
      download: "다운로드",
      openWebApp: "웹에서 열기",
      macDownload: "Mac용 다운로드",
    },
    hero: {
      line1: "이슈에서 PR까지.",
      line2: "에이전트 작업을 운영하세요.",
      description:
        "Briar는 사람과 코딩 에이전트가 실제 저장소에서 함께 일하는 과정을 연결하고, 관찰하고, 끝까지 완료하는 로컬 우선 개발 환경입니다.",
      openWebApp: "웹에서 Briar 열기",
      macDownload: "Mac용 Briar 다운로드",
      androidDownload: "Android용 다운로드",
      howItWorks: "작동 방식 보기",
      allDownloads: "전체 다운로드 보기",
    },
    dashboard: {
      agentRuns: "에이전트 실행",
      newIssue: "+ 새 이슈",
      active: "실행 중",
      today: "↑ 오늘 2건",
      readyToReview: "리뷰 대기",
      prsLinked: "PR 3개 연결",
      successRate: "성공률",
      lastRuns: "최근 30회",
      issue: "이슈",
      stage: "단계",
      agent: "에이전트",
      updated: "업데이트",
      issues: [
        "에이전트 이벤트 스트림 연결",
        "작업 상세 패널 개선",
        "세션 복원 회귀 테스트",
        "D1 이벤트 스키마",
      ],
      implementing: "구현 중",
      review: "리뷰",
      localQa: "로컬 QA",
      completed: "완료",
      now: "지금",
      liveActivity: "실시간 활동",
      activityWorking: "이벤트 스트림 어댑터를 구현하고 있습니다.",
      thinkingNow: "작업 중 · 지금",
      qaPassed: "로컬 QA 통과",
      minutesAgo8: "8분 전",
      prOpened: "PR #124 생성",
      readyForHumanReview: "사람의 리뷰를 기다리는 중",
      minutesAgo12: "12분 전",
      command: "모든 검증을 마치면 리뷰를 요청해줘",
      prReady: "PR #124 준비 완료",
    },
    principles: {
      line1: "에이전트 개발을",
      line2: "운영 가능한 시스템으로.",
      description:
        "단발성 자동화를 넘어, 실제 제품팀이 신뢰할 수 있는 실행 흐름으로 바꿉니다.",
      cards: [
        {
          title: "코드는 로컬에",
          description:
            "저장소 소스는 기기를 떠나지 않습니다. Briar는 필요한 작업 상태와 Git 메타데이터만 안전하게 동기화합니다.",
        },
        {
          title: "사람과 에이전트가 함께",
          description:
            "Codex, Claude, 그리고 팀의 승인을 하나의 타임라인과 워크플로로 연결합니다.",
        },
        {
          title: "끝까지 닫히는 흐름",
          description:
            "컨텍스트 수집, 구현, QA, 리뷰, 배포까지 완료 조건을 명확히 기록합니다.",
        },
      ],
    },
    workflow: {
      title: "작업이 스스로 앞으로 나아가도록.",
      description:
        "대화와 이슈를 실행 가능한 작업으로 바꾸고, 지금 어디까지 진행됐는지 놓치지 마세요.",
      steps: [
        {
          title: "수집",
          description:
            "이슈, 피드백, 에러를 하나의 실행 가능한 작업 큐로 모읍니다.",
        },
        {
          title: "실행",
          description:
            "Codex와 Claude가 실제 저장소에서 컨텍스트를 읽고 작업을 시작합니다.",
        },
        {
          title: "관찰",
          description:
            "분석부터 구현, QA까지 모든 진행 상태와 판단 근거를 한눈에 봅니다.",
        },
        {
          title: "배포",
          description:
            "검증 결과와 PR을 연결하고, 완료 조건을 충족한 작업만 배포로 보냅니다.",
        },
      ],
      issueTitle: "에이전트 이벤트 스트림 연결",
      running: "실행 중",
      context: "컨텍스트",
      contextLoaded: "Velen 컨텍스트 로드 완료",
      analyze: "분석",
      repositoryMapped: "저장소 매핑 완료",
      implement: "구현",
      codexWorking: "Codex 작업 중",
      localQa: "로컬 QA",
      waiting: "대기 중",
      review: "리뷰",
      liveExecution: "실시간 실행",
      connected: "연결됨",
      readingContext: "저장소 컨텍스트 읽는 중",
      agentsLoaded: "AGENTS.md 로드 완료",
      filesMapped: "관련 파일 24개 매핑 완료",
      implementingAdapter: "어댑터 구현 중",
      writingTests: "회귀 테스트 작성 중",
    },
    agents: {
      title: "선호하는 에이전트는 그대로.",
      description:
        "도구를 바꾸지 않아도 됩니다. Briar가 서로 다른 에이전트의 실행을 같은 운영 모델로 연결합니다.",
      activeCollaborators: "활성 협업자",
      operational: "모든 시스템 정상",
      states: ["3개 실행 중", "1개 리뷰 중", "승인 2개"],
      roles: ["구현 및 로컬 QA", "리뷰 및 추론", "방향 설정 및 승인"],
    },
    security: {
      line1: "코드는 로컬에.",
      line2: "신뢰는 기본값으로.",
      description:
        "에이전트는 연결된 Git 루트에서만 실행됩니다. 소스 코드는 로컬에 남고, 토큰은 해시로 저장되며, 위험한 작업에는 사람의 승인을 요구할 수 있습니다.",
      points: [
        "저장소 경로는 기기를 떠나지 않음",
        "권한을 인식하는 에이전트 실행",
        "감사 가능하고 재시도에 안전한 이벤트 기록",
      ],
      yourDevice: "내 기기",
      secure: "안전",
      localRepository: "로컬 저장소",
      private: "비공개",
      agentExecution: "에이전트 실행",
      cwdLocked: "작업 경로를 Git 루트로 제한",
      sourceCode: "소스 코드",
      neverUploaded: "업로드되지 않음",
      encryptedSync: "암호화된 상태 동기화",
      cloudDetail: "작업 상태 + Git 메타데이터",
    },
    final: {
      eyebrow: "시작할 준비가 되셨나요",
      line1: "에이전트에게 일을 맡기고,",
      line2: "결과에는 확신을 가지세요.",
      description:
        "Briar로 사람과 에이전트가 함께 일하는 개발 흐름을 시작하세요.",
      openWebApp: "웹에서 Briar 열기",
      macDownload: "Mac용 Briar 다운로드",
      androidDownload: "Android용 다운로드",
      github: "GitHub에서 보기",
      note: "최신 릴리즈 · macOS Apple Silicon · Android companion",
    },
    footer: {
      tagline: "에이전트 개발의 모든 과정을 한눈에.",
      security: "보안",
      backToTop: "맨 위로 ↑",
    },
  },
  en: {
    metadata: {
      title: "Briar — The operating system for agent development",
      description:
        "A local-first Agent Development Environment that connects and observes how people and coding agents work together, from issue to PR.",
      socialDescription:
        "Keep code local and see every agent task from issue to PR.",
      locale: "en_US",
    },
    aria: {
      brandHome: "Briar home",
      mainMenu: "Main navigation",
      productPreview: "Preview of the Briar task dashboard",
      heroArtwork:
        "Risograph illustration of a person guiding a Briar workflow",
      securityVisual: "Briar security architecture",
      sendCommand: "Send to agent",
      openWebApp: "Open the Briar web app",
      macDownload: "Download the latest Briar for Mac",
      androidDownload: "Download the latest Briar release for Android",
      menuOpen: "Open menu",
      menuClose: "Close menu",
    },
    language: {
      label: "Language",
      english: "English",
      korean: "Korean",
    },
    nav: {
      product: "Product",
      workflow: "Workflow",
      security: "Security",
      agents: "Agents",
      tutorial: "Tutorial",
      blog: "Blog",
      download: "Download",
      openWebApp: "Open web app",
      macDownload: "Download for Mac",
    },
    hero: {
      line1: "From issue to PR.",
      line2: "Operate your agent work.",
      description:
        "Briar is a local-first development environment that connects, observes, and completes the work people and coding agents do together in real repositories.",
      openWebApp: "Open Briar on the web",
      macDownload: "Download Briar for Mac",
      androidDownload: "Download for Android",
      howItWorks: "See how it works",
      allDownloads: "See all downloads",
    },
    dashboard: {
      agentRuns: "Agent runs",
      newIssue: "+ New issue",
      active: "Active",
      today: "↑ 2 today",
      readyToReview: "Ready to review",
      prsLinked: "3 PRs linked",
      successRate: "Success rate",
      lastRuns: "last 30 runs",
      issue: "Issue",
      stage: "Stage",
      agent: "Agent",
      updated: "Updated",
      issues: [
        "Connect agent event stream",
        "Improve task detail panel",
        "Session recovery regression test",
        "D1 event schema",
      ],
      implementing: "Implementing",
      review: "Review",
      localQa: "Local QA",
      completed: "Completed",
      now: "now",
      liveActivity: "Live activity",
      activityWorking: "Implementing the event stream adapter.",
      thinkingNow: "Thinking · now",
      qaPassed: "Local QA passed",
      minutesAgo8: "8 minutes ago",
      prOpened: "PR #124 opened",
      readyForHumanReview: "Ready for human review",
      minutesAgo12: "12 minutes ago",
      command: "Request a review when every check passes",
      prReady: "PR #124 ready",
    },
    principles: {
      line1: "Turn agent development",
      line2: "into an operable system.",
      description:
        "Move beyond one-off automation to an execution flow that real product teams can trust.",
      cards: [
        {
          title: "Keep code local",
          description:
            "Repository source never leaves your device. Briar securely syncs only the task state and Git metadata it needs.",
        },
        {
          title: "People and agents, together",
          description:
            "Connect Codex, Claude, and team approvals in one timeline and workflow.",
        },
        {
          title: "Close the loop",
          description:
            "Make completion criteria explicit from context gathering and implementation through QA, review, and deployment.",
        },
      ],
    },
    workflow: {
      title: "Keep work moving forward.",
      description:
        "Turn conversations and issues into executable tasks, and never lose sight of their progress.",
      steps: [
        {
          title: "Intake",
          description:
            "Collect issues, feedback, and errors in one actionable task queue.",
        },
        {
          title: "Run",
          description:
            "Codex and Claude read context and start work in the real repository.",
        },
        {
          title: "Observe",
          description:
            "See every status and decision from analysis through implementation and QA.",
        },
        {
          title: "Ship",
          description:
            "Connect verification results and PRs, then deploy only work that meets its completion criteria.",
        },
      ],
      issueTitle: "Connect agent event stream",
      running: "Running",
      context: "Context",
      contextLoaded: "Velen context loaded",
      analyze: "Analyze",
      repositoryMapped: "Repository mapped",
      implement: "Implement",
      codexWorking: "Codex working",
      localQa: "Local QA",
      waiting: "Waiting",
      review: "Review",
      liveExecution: "Live execution",
      connected: "Connected",
      readingContext: "Reading repository context",
      agentsLoaded: "AGENTS.md loaded",
      filesMapped: "24 related files mapped",
      implementingAdapter: "Implementing adapter",
      writingTests: "Writing regression tests",
    },
    agents: {
      title: "Keep the agents you prefer.",
      description:
        "No need to change tools. Briar connects different agents through one operating model.",
      activeCollaborators: "Active collaborators",
      operational: "All systems operational",
      states: ["3 running", "1 reviewing", "2 approvals"],
      roles: [
        "Implementation & local QA",
        "Review & reasoning",
        "Direction & approval",
      ],
    },
    security: {
      line1: "Keep code local.",
      line2: "Make trust the default.",
      description:
        "Agents run only inside the connected Git root. Source code stays local, tokens are stored as hashes, and risky actions can require human approval.",
      points: [
        "Repository path never leaves your device",
        "Permission-aware agent execution",
        "Auditable, retry-safe event history",
      ],
      yourDevice: "Your device",
      secure: "Secure",
      localRepository: "Local repository",
      private: "Private",
      agentExecution: "Agent execution",
      cwdLocked: "cwd locked to Git root",
      sourceCode: "Source code",
      neverUploaded: "never uploaded",
      encryptedSync: "Encrypted state sync",
      cloudDetail: "Task state + Git metadata",
    },
    final: {
      eyebrow: "Ready when you are",
      line1: "Delegate the work.",
      line2: "Trust the result.",
      description:
        "Start a development flow where people and agents work together with Briar.",
      openWebApp: "Open Briar on the web",
      macDownload: "Download Briar for Mac",
      androidDownload: "Download for Android",
      github: "View on GitHub",
      note: "Latest release · macOS Apple Silicon · Android companion",
    },
    footer: {
      tagline: "Agent development, with a clear line of sight.",
      security: "Security",
      backToTop: "Back to top ↑",
    },
  },
} as const;

export type LandingCopy = (typeof copy)[Locale];
