export const supportedLocales = ["en", "ko", "zh"] as const;

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

  if (primaryLanguage === "ko" || primaryLanguage === "zh") {
    return primaryLanguage;
  }

  return defaultLocale;
}

export function isLocale(value: string | undefined): value is Locale {
  return supportedLocales.includes(value as Locale);
}

/**
 * Every crawlable landing page, keyed by its path in the default locale.
 * Single source of truth for routing, the sitemap, and robots.txt — add a
 * page here once and it is automatically routed, localized, and listed.
 */
export const routePaths = [
  "/",
  "/tutorial",
  "/docs",
  "/docs/get-started",
  "/docs/webhooks",
  "/changelog",
  "/blog",
  "/download",
] as const;

export type RoutePath = (typeof routePaths)[number];

/**
 * The stable, crawlable URL for a given locale + route.
 *
 * Scheme: the default locale (`en`) is unprefixed (`/`, `/tutorial`, ...)
 * so existing indexed URLs keep working. Every other locale is prefixed
 * with its locale code (`/ko`, `/ko/tutorial`, ...).
 */
export function localizedPath(locale: Locale, path: RoutePath | string): string {
  if (locale === defaultLocale) {
    return path;
  }

  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/** Build the language switcher's crawlable URL set for one page. */
export function localizedHrefs(path: RoutePath | string): Record<Locale, string> {
  return Object.fromEntries(
    supportedLocales.map((locale) => [locale, localizedPath(locale, path)]),
  ) as Record<Locale, string>;
}

export const copy = {
  ko: {
    metadata: {
      title: "Briar — 로컬 실행형 Agent Development Environment",
      description:
        "이슈에서 PR까지, 사람과 코딩 에이전트의 작업을 클라우드에서 조율하고 로컬 저장소에서 실행하는 Agent Development Environment.",
      socialDescription:
        "Briar는 클라우드로 조율하고 로컬에서 실행하는 Agent Development Environment입니다. 코드는 로컬에, 에이전트 작업은 이슈에서 PR까지 한눈에.",
      socialTitle: "에이전트 작업을 맡기고, 근거를 검토하고, 자신 있게 배포하세요.",
      locale: "ko_KR",
    },
    aria: {
      skipToContent: "본문으로 건너뛰기",
      brandHome: "Briar 홈",
      mainMenu: "주요 메뉴",
      productPreview: "Briar 작업 대시보드 미리보기",
      workflowPreview:
        "Briar 이슈 상세 화면 스크린샷. 저장소 매핑을 마친 분석 단계와 회귀 테스트를 작성 중인 구현 단계의 증거를 보여줍니다.",
      heroArtwork: "사람이 Briar 작업 흐름을 이끄는 리소그래프 일러스트",
      securityVisual: "Briar 보안 구조",
      sendCommand: "에이전트에게 전송",
      openWebApp: "Briar 웹 앱 열기",
      macDownload: "Mac용 Briar 최신 버전 다운로드",
      androidDownload: "Android용 Briar 최신 릴리즈 다운로드",
      iosDownload: "iOS용 Briar 컴패니언 보기",
      cliDownload: "Briar CLI 보기",
      menuOpen: "메뉴 열기",
      menuClose: "메뉴 닫기",
      githubLink: "GitHub에서 Briar 보기",
    },
    language: {
      label: "언어",
      english: "영어",
      korean: "한국어",
      chinese: "중국어",
    },
    nav: {
      product: "제품",
      workflow: "워크플로",
      security: "보안",
      agents: "에이전트",
      tutorial: "튜토리얼",
      docs: "문서",
      changelog: "변경 기록",
      blog: "블로그",
      download: "다운로드",
      openWebApp: "웹에서 열기",
      macDownload: "Mac용 다운로드",
    },
    hero: {
      kicker: "Agent Development Environment",
      line1: "이슈에서 PR까지.",
      line2: "에이전트 작업을 운영하세요.",
      description:
        "Briar는 사람과 코딩 에이전트의 작업을 클라우드에서 연결하고 조율하며, 실제 저장소의 코드 작업은 로컬에서 실행하는 Agent Development Environment입니다.",
      openWebApp: "웹에서 Briar 열기",
      macDownload: "Mac용 Briar 다운로드",
      androidDownload: "Android용 다운로드",
      howItWorks: "작동 방식 보기",
      allDownloads: "전체 다운로드 보기",
      meta: [
        "macOS Apple Silicon",
        "Android 컴패니언",
        "저장소 무관",
        "Codex + Claude",
        "로컬 실행",
      ],
    },
    downloadBar: {
      mac: "Mac용 다운로드",
      webApp: "웹 앱",
      allOptions: "모든 다운로드 옵션",
      supports: "지원",
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
        "GitHub 이슈 라벨 동기화",
        "타임라인에 diff 미리보기 표시",
        "에이전트 이벤트 페이로드 정규화",
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
      humanName: "사람",
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
      note: "최신 릴리즈 · macOS Apple Silicon · Android 컴패니언",
    },
    differentiators: {
      index: "왜 Briar인가",
      title: "이미 쓰고 있는 에이전트에 Briar가 더하는 것.",
      description:
        "Codex와 Claude Code는 이미 코드를 작성합니다. Briar는 그 작업에 큐, 기록, 그리고 사람이 승인할 자리를 더합니다.",
      items: [
        {
          title: "명확한 완료 조건",
          description:
            "이슈는 분석, 구현, 로컬 QA, 리뷰, 배포 등 직접 정의한 단계를 거칩니다. 그래서 실행이 끝났다는 것은 에이전트가 말을 멈췄다는 뜻이 아니라 조건을 충족했다는 뜻입니다.",
        },
        {
          title: "관찰 가능한 실행 타임라인",
          description:
            "각 단계는 실행한 명령과 통과 여부 같은 근거를 기록합니다. 대화를 처음부터 다시 읽지 않아도 작업 내용을 확인할 수 있습니다.",
        },
        {
          title: "재시도에 안전한 이벤트 기록",
          description:
            "상태 업데이트와 증거가 기록되므로, 중단된 실행도 처음부터가 아니라 정확한 체크포인트와 시도 지점에서 다시 시작합니다.",
        },
        {
          title: "사람의 승인 게이트",
          description:
            "리뷰를 위해 멈출 지점을 직접 선택하고, 승인한 뒤에만 실행이 이어집니다.",
        },
        {
          title: "저장소 안에서 실행되는 모델",
          description:
            "에이전트는 내 기기의 격리된 Git worktree에서 실행됩니다. Briar로 동기화되는 것은 소스 코드가 아니라 작업 상태와 Git 메타데이터뿐입니다.",
        },
      ],
      accessLabel: "무료 오픈소스입니다.",
      accessDescription:
        "Briar는 Apache-2.0 라이선스로 GitHub에 공개되어 있습니다. 저장소를 연결하려면 로그인이 필요합니다.",
    },
    footer: {
      tagline: "이슈에서 PR까지, 클라우드 조율과 로컬 실행을 결합한 Agent Development Environment.",
      security: "보안",
      backToTop: "맨 위로 ↑",
    },
    mockup: {
      detail: {
        description: "설명",
        evidence: "증빙",
        passed: "통과",
        command: "실행 명령",
        attemptRevision: "시도 1 · 리비전 1",
        leaveComment: "댓글 남기기…",
        properties: "속성",
        highPriority: "높은 우선순위",
        repository: "저장소",
        analyzing: "분석 중",
        implementing: "구현 중",
      },
    },
  },
  en: {
    metadata: {
      title: "Briar — Agent Development Environment",
      description:
        "A cloud-coordinated, local-execution Agent Development Environment that connects people and coding agents from issue to PR.",
      socialDescription:
        "Briar is a cloud-coordinated, local-execution Agent Development Environment. Keep code local and see every agent task from issue to PR.",
      socialTitle: "Delegate agent work. Review the evidence. Ship with confidence.",
      locale: "en_US",
    },
    aria: {
      skipToContent: "Skip to content",
      brandHome: "Briar home",
      mainMenu: "Main navigation",
      productPreview: "Preview of the Briar task dashboard",
      workflowPreview:
        "Screenshot of a Briar issue detail view, showing evidence for a completed analysis step and an in-progress implementation step writing regression tests.",
      heroArtwork:
        "Risograph illustration of a person guiding a Briar workflow",
      securityVisual: "Briar security architecture",
      sendCommand: "Send to agent",
      openWebApp: "Open the Briar web app",
      macDownload: "Download the latest Briar for Mac",
      androidDownload: "Download the latest Briar release for Android",
      iosDownload: "See the Briar companion for iOS",
      cliDownload: "See the Briar CLI",
      menuOpen: "Open menu",
      menuClose: "Close menu",
      githubLink: "Briar on GitHub",
    },
    language: {
      label: "Language",
      english: "English",
      korean: "Korean",
      chinese: "Chinese",
    },
    nav: {
      product: "Product",
      workflow: "Workflow",
      security: "Security",
      agents: "Agents",
      tutorial: "Tutorial",
      docs: "Docs",
      changelog: "Changelog",
      blog: "Blog",
      download: "Download",
      openWebApp: "Open web app",
      macDownload: "Download for Mac",
    },
    hero: {
      kicker: "Agent Development Environment",
      line1: "From issue to PR.",
      line2: "Operate your agent work.",
      description:
        "Briar is a cloud-coordinated, local-execution Agent Development Environment that connects and observes agent work while running code tasks in repositories on your machine.",
      openWebApp: "Open Briar on the web",
      macDownload: "Download Briar for Mac",
      androidDownload: "Download for Android",
      howItWorks: "See how it works",
      allDownloads: "See all downloads",
      meta: [
        "macOS Apple Silicon",
        "Android companion",
        "Repository-agnostic",
        "Codex + Claude",
        "Local execution",
      ],
    },
    downloadBar: {
      mac: "Download for Mac",
      webApp: "Web App",
      allOptions: "All download options",
      supports: "Supports",
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
        "Sync labels from GitHub issues",
        "Surface diff previews in the timeline",
        "Normalize agent event payloads",
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
      humanName: "Human",
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
    differentiators: {
      index: "Why Briar",
      title: "What Briar adds to the agents you already use.",
      description:
        "Codex and Claude Code already write code. Briar adds a queue, a record, and a place for a human to approve that work.",
      items: [
        {
          title: "Explicit completion criteria",
          description:
            "Issues move through the stages you define — analysis, implementation, local QA, review, release — so a run finishes because it met its criteria, not because the agent stopped talking.",
        },
        {
          title: "An observable run timeline",
          description:
            "Each stage records its evidence — the command that ran and whether it passed — so you can check the work instead of re-reading the conversation.",
        },
        {
          title: "Retry-safe event history",
          description:
            "Status updates and evidence are written so a paused or interrupted run resumes from its exact checkpoint and attempt, not from scratch.",
        },
        {
          title: "Human approval gates",
          description:
            "You choose where a run pauses for review. It continues only after you approve it.",
        },
        {
          title: "A repo-local execution model",
          description:
            "Agents run in an isolated Git worktree on your machine. Only task state and Git metadata sync to Briar — not your source.",
        },
      ],
      accessLabel: "Free and open source.",
      accessDescription:
        "Briar is released under the Apache-2.0 license on GitHub. You'll need to sign in to connect a repository.",
    },
    footer: {
      tagline: "A cloud-coordinated, local-execution Agent Development Environment, from issue to PR.",
      security: "Security",
      backToTop: "Back to top ↑",
    },
    mockup: {
      detail: {
        description: "Description",
        evidence: "Evidence",
        passed: "Passed",
        command: "Command",
        attemptRevision: "Attempt 1 · Revision 1",
        leaveComment: "Leave a comment…",
        properties: "Properties",
        highPriority: "High priority",
        repository: "Repository",
        analyzing: "analyzing",
        implementing: "implementing",
      },
    },
  },
  zh: {
    metadata: {
      title: "Briar — 本地执行的 Agent Development Environment",
      description:
        "Briar 是一个由云端协调、在本地执行的 Agent Development Environment，将人员与编码 Agent 从 issue 连接到 PR。",
      socialDescription:
        "Briar 由云端协调、在本地执行。让代码留在本地，清晰查看从 issue 到 PR 的每项 Agent 工作。",
      socialTitle: "把 Agent 工作交出去。检查证据。自信发布。",
      locale: "zh_CN",
    },
    aria: {
      skipToContent: "跳转到正文",
      brandHome: "Briar 首页",
      mainMenu: "主导航",
      productPreview: "Briar 工作仪表盘预览",
      workflowPreview:
        "Briar issue 详情界面截图，展示已完成的分析阶段证据，以及正在编写回归测试的实现阶段。",
      heroArtwork: "引导 Briar 工作流的人物版画插图",
      securityVisual: "Briar 安全架构",
      sendCommand: "发送给 Agent",
      openWebApp: "打开 Briar Web 应用",
      macDownload: "下载最新的 Mac 版 Briar",
      androidDownload: "下载最新的 Android 版 Briar",
      iosDownload: "查看 iOS 版 Briar companion",
      cliDownload: "查看 Briar CLI",
      menuOpen: "打开菜单",
      menuClose: "关闭菜单",
      githubLink: "在 GitHub 上查看 Briar",
    },
    language: {
      label: "语言",
      english: "English",
      korean: "한국어",
      chinese: "中文",
    },
    nav: {
      product: "产品",
      workflow: "工作流",
      security: "安全",
      agents: "Agent",
      tutorial: "教程",
      docs: "文档",
      changelog: "更新日志",
      blog: "博客",
      download: "下载",
      openWebApp: "打开 Web 应用",
      macDownload: "下载 Mac 版",
    },
    hero: {
      kicker: "Agent Development Environment",
      line1: "从 issue 到 PR。",
      line2: "让 Agent 工作井然有序。",
      description:
        "Briar 是一个由云端协调、在本地执行的 Agent Development Environment，将人员与编码 Agent 的工作连接起来并持续观察，同时在你的真实代码仓库中执行任务。",
      openWebApp: "在 Web 上打开 Briar",
      macDownload: "下载 Mac 版 Briar",
      androidDownload: "下载 Android 版",
      howItWorks: "了解工作方式",
      allDownloads: "查看全部下载",
      meta: [
        "macOS Apple Silicon",
        "Android companion",
        "不限制仓库",
        "Codex + Claude",
        "本地执行",
      ],
    },
    downloadBar: {
      mac: "下载 Mac 版",
      webApp: "Web 应用",
      allOptions: "全部下载选项",
      supports: "支持",
    },
    dashboard: {
      agentRuns: "Agent 运行",
      newIssue: "+ 新建 issue",
      active: "运行中",
      today: "↑ 今日 2 个",
      readyToReview: "待审核",
      prsLinked: "已关联 3 个 PR",
      successRate: "成功率",
      lastRuns: "最近 30 次",
      issue: "Issue",
      stage: "阶段",
      agent: "Agent",
      updated: "更新",
      issues: [
        "连接 Agent 事件流",
        "改进任务详情面板",
        "会话恢复回归测试",
        "D1 事件模式",
        "同步 GitHub issue 标签",
        "在时间线中展示 diff 预览",
        "规范化 Agent 事件负载",
      ],
      implementing: "实现中",
      review: "审核",
      localQa: "本地 QA",
      completed: "已完成",
      now: "刚刚",
      liveActivity: "实时活动",
      activityWorking: "正在实现事件流适配器。",
      thinkingNow: "思考中 · 刚刚",
      qaPassed: "本地 QA 通过",
      minutesAgo8: "8 分钟前",
      prOpened: "已创建 PR #124",
      readyForHumanReview: "等待人工审核",
      minutesAgo12: "12 分钟前",
      command: "全部检查通过后请求审核",
      prReady: "PR #124 已准备好",
    },
    principles: {
      line1: "将 Agent 开发",
      line2: "变成可运营的系统。",
      description:
        "超越一次性自动化，建立真实产品团队可以信赖的执行流程。",
      cards: [
        {
          title: "代码留在本地",
          description:
            "仓库源代码不会离开你的设备。Briar 只安全同步工作所需的任务状态和 Git 元数据。",
        },
        {
          title: "人与 Agent 协作",
          description:
            "在同一条时间线和工作流中连接 Codex、Claude 与团队审批。",
        },
        {
          title: "闭环完成工作",
          description:
            "从收集上下文、实现，到 QA、审核和发布，都明确记录完成条件。",
        },
      ],
    },
    workflow: {
      title: "让工作持续向前推进。",
      description:
        "把对话和 issue 变成可执行的任务，随时掌握它们进行到了哪里。",
      steps: [
        {
          title: "收集",
          description: "把 issue、反馈和错误集中到一个可执行的任务队列中。",
        },
        {
          title: "执行",
          description: "Codex 和 Claude 读取真实仓库的上下文并开始工作。",
        },
        {
          title: "观察",
          description: "从分析、实现到 QA，一眼查看每个状态和决策依据。",
        },
        {
          title: "发布",
          description: "关联验证结果与 PR，只发布满足完成条件的工作。",
        },
      ],
      issueTitle: "连接 Agent 事件流",
      running: "运行中",
      context: "上下文",
      contextLoaded: "Velen 上下文已加载",
      analyze: "分析",
      repositoryMapped: "仓库映射完成",
      implement: "实现",
      codexWorking: "Codex 工作中",
      localQa: "本地 QA",
      waiting: "等待中",
      review: "审核",
      liveExecution: "实时执行",
      connected: "已连接",
      readingContext: "正在读取仓库上下文",
      agentsLoaded: "AGENTS.md 已加载",
      filesMapped: "已映射 24 个相关文件",
      implementingAdapter: "正在实现适配器",
      writingTests: "正在编写回归测试",
    },
    agents: {
      title: "继续使用你偏好的 Agent。",
      description:
        "无需更换工具。Briar 用同一套运营模型连接不同 Agent 的执行过程。",
      activeCollaborators: "活跃协作者",
      operational: "所有系统运行正常",
      humanName: "人",
      states: ["3 个运行中", "1 个审核中", "2 个待审批"],
      roles: ["实现与本地 QA", "审核与推理", "方向与审批"],
    },
    security: {
      line1: "代码留在本地。",
      line2: "让信任成为默认设置。",
      description:
        "Agent 只在已连接的 Git 根目录内运行。源代码留在本地，令牌以哈希形式保存，高风险操作可以要求人工审批。",
      points: [
        "仓库路径不会离开你的设备",
        "感知权限的 Agent 执行",
        "可审计且支持安全重试的事件记录",
      ],
      yourDevice: "你的设备",
      secure: "安全",
      localRepository: "本地仓库",
      private: "私密",
      agentExecution: "Agent 执行",
      cwdLocked: "工作目录限制在 Git 根目录",
      sourceCode: "源代码",
      neverUploaded: "不会上传",
      encryptedSync: "加密状态同步",
      cloudDetail: "任务状态 + Git 元数据",
    },
    final: {
      eyebrow: "准备好就开始",
      line1: "把工作交给 Agent。",
      line2: "对结果充满信心。",
      description: "用 Briar 开启人与 Agent 协作的开发流程。",
      openWebApp: "在 Web 上打开 Briar",
      macDownload: "下载 Mac 版 Briar",
      androidDownload: "下载 Android 版",
      github: "在 GitHub 上查看",
      note: "最新版本 · macOS Apple Silicon · Android companion",
    },
    differentiators: {
      index: "为什么选择 Briar",
      title: "Briar 为你已经使用的 Agent 带来什么。",
      description:
        "Codex 和 Claude Code 已经可以编写代码。Briar 为这些工作增加队列、记录，以及让人审批工作的空间。",
      items: [
        {
          title: "明确的完成条件",
          description:
            "Issue 会经过你定义的分析、实现、本地 QA、审核和发布阶段。运行结束是因为满足了条件，而不是因为 Agent 停止了对话。",
        },
        {
          title: "可观察的运行时间线",
          description:
            "每个阶段都记录执行过的命令和是否通过等证据，无需重新阅读整段对话也能检查工作。",
        },
        {
          title: "安全重试的事件历史",
          description:
            "状态更新和证据都会被记录，中断的运行可以从准确的检查点和尝试位置恢复，而不是从头开始。",
        },
        {
          title: "人工审批关卡",
          description: "你可以选择运行在哪些位置暂停审核，只有批准后才会继续。",
        },
        {
          title: "仓库本地执行模型",
          description:
            "Agent 在你设备上的隔离 Git worktree 中运行。同步到 Briar 的只有任务状态和 Git 元数据，不包括源代码。",
        },
      ],
      accessLabel: "免费且开源。",
      accessDescription:
        "Briar 以 Apache-2.0 许可证发布在 GitHub。连接仓库需要登录。",
    },
    footer: {
      tagline:
        "从 issue 到 PR，将云端协调与本地执行结合起来的 Agent Development Environment。",
      security: "安全",
      backToTop: "返回顶部 ↑",
    },
    mockup: {
      detail: {
        description: "描述",
        evidence: "证据",
        passed: "已通过",
        command: "执行命令",
        attemptRevision: "尝试 1 · 修订 1",
        leaveComment: "留下评论…",
        properties: "属性",
        highPriority: "高优先级",
        repository: "仓库",
        analyzing: "分析中",
        implementing: "实现中",
      },
    },
  },
} as const;

export type LandingCopy = (typeof copy)[Locale];
