import { type Locale, copy, localizedPath } from "../i18n";
import { LanguageSwitcher } from "../language-switcher";
import { MobileMenu } from "../mobile-menu";


const WEB_APP_URL = "/app/";
const MAC_DOWNLOAD_URL =
  "https://briar-api.wbai.workers.dev/releases/latest/mac-aarch64.dmg";

export const tutorialCopy = {
  ko: {
    metadata: {
      title: "Briar 튜토리얼 — 첫 이슈부터 검증된 결과까지",
      description:
        "Briar에서 이슈를 만들고, 이슈 처리 에이전트로 자동 처리하고, 정리된 결과와 검증 증거를 확인하고, 반복 업무를 자동화하는 방법을 알아보세요.",
    },
    eyebrow: "9분 제품 둘러보기",
    title: "첫 이슈부터\n검증된 결과까지.",
    description:
      "Briar의 실제 화면을 따라 이슈를 만들고, 이슈 처리 에이전트로 자동 처리하고, 정리된 결과와 검증 근거까지 확인해 보세요.",
    start: "튜토리얼 시작",
    openApp: "Briar 열기",
    captured:
      "Briar v1.2.67 로컬 데모 환경에서 직접 캡처한 화면입니다.",
    setupTitle: "시작하기 전에",
    setup: [
      ["Briar 실행", "웹 앱을 열거나 Mac 앱을 설치하고 로그인합니다."],
      ["저장소 연결", "작업할 Git 저장소를 프로젝트로 연결합니다."],
      ["에이전트 준비", "Codex, Claude 또는 Grok 중 사용할 에이전트에 로그인합니다."],
    ],
    tocTitle: "이 튜토리얼에서",
    steps: [
      {
        id: "create-issue",
        label: "01 · INTAKE",
        nav: "이슈 만들기",
        title: "요청을 실행 가능한 이슈로 만드세요.",
        description:
          "New issue에서 제목과 설명을 입력하고 담당자, 시작 상태, 우선순위를 정합니다. 화면이나 재현 영상이 있다면 첨부 파일로 함께 남길 수 있습니다.",
        bullets: [
          "설명에는 기대 결과와 완료 조건을 함께 적어 주세요.",
          "바로 시작할 일은 Queued, 나중에 다듬을 일은 Backlog로 둡니다.",
        ],
        image: "/tutorial/01-create-issue.webp",
        alt: "Briar 새 이슈 작성 대화상자",
        caption: "제목, 설명, 우선순위, 첨부 파일을 한 화면에서 정합니다.",
      },
      {
        id: "track-work",
        label: "02 · WORKFLOW",
        nav: "작업 추적하기",
        title: "보드에서 모든 작업의 현재 위치를 보세요.",
        description:
          "작업은 Backlog와 Queued에서 시작해 Analyze, Implement, Local validation, Review를 거칩니다. 막힌 작업과 완료된 작업도 같은 보드에서 놓치지 않습니다.",
        bullets: [
          "In progress와 Needs attention 필터로 지금 볼 일만 좁힙니다.",
          "카드를 열면 실행 단계와 최신 활동을 바로 확인할 수 있습니다.",
        ],
        image: "/tutorial/02-task-board.webp",
        alt: "Briar 이슈 처리 칸반 작업 보드",
        caption: "사람과 에이전트가 공유하는 하나의 작업 상태입니다.",
      },
      {
        id: "run-auto-hunt",
        label: "03 · EXECUTE",
        nav: "대기 이슈 처리하기",
        title: "이슈 처리 에이전트가 대기 이슈를 자동으로 처리하게 하세요.",
        description:
          "Agents에서 이슈 처리 에이전트의 Run Task를 열면 대기 중인 이슈를 찾아 워크플로에 따라 분석, 구현, 검증하도록 실행할 수 있습니다. 에이전트는 각 이슈를 독립된 작업으로 처리하고 진행 상태를 보드에 기록합니다.",
        bullets: [
          "요청에 “대기 중인 모든 이슈를 처리합니다.”가 들어 있는지 확인하고 Run Task를 누릅니다.",
          "실행이 시작되면 Queued 이슈가 워크플로 단계로 이동하고 필요한 검증까지 이어집니다.",
        ],
        image: "/tutorial/07-run-auto-hunt.webp",
        alt: "Briar 이슈 처리 에이전트 작업 실행 대화상자",
        caption: "이슈 처리 에이전트를 실행해 대기 이슈를 자동으로 처리합니다.",
      },
      {
        id: "collaborate",
        label: "04 · COLLABORATE",
        nav: "에이전트와 대화하기",
        title: "이슈 안에서 맥락을 이어가세요.",
        description:
          "Issue 탭의 대화에는 사람의 추가 요청과 에이전트의 응답이 함께 남습니다. 실행 도중 새로운 제약이나 확인할 사항이 생겨도 작업 맥락이 흩어지지 않습니다.",
        bullets: [
          "댓글로 추가 요구사항, 예외 조건, 리뷰 피드백을 전달합니다.",
          "Result, Evidence, Work log, Status 탭을 오가며 같은 이슈를 봅니다.",
        ],
        image: "/tutorial/03-issue-conversation.webp",
        alt: "Briar 이슈 상세와 에이전트 대화",
        caption: "작업 지시와 에이전트의 답변이 이슈에 계속 축적됩니다.",
      },
      {
        id: "review-result",
        label: "05 · RESULT",
        nav: "정리된 결과 확인하기",
        title: "이슈 상세에서 깔끔하게 정리된 결과를 확인하세요.",
        description:
          "작업이 끝나거나 검토 지점에 도달하면 Result 탭이 구현 내용, 실행 단계, 검증 결과, 다음 행동을 한눈에 볼 수 있도록 정리합니다. 긴 작업 로그를 전부 읽지 않아도 무엇이 바뀌었고 무엇을 확인해야 하는지 빠르게 판단할 수 있습니다.",
        bullets: [
          "Work result에서 구현 내용과 검증 요약을 먼저 읽습니다.",
          "Next action을 확인한 뒤 승인하거나 수정 요청을 남기고, 필요하면 Evidence로 세부 근거를 엽니다.",
        ],
        image: "/tutorial/08-result.webp",
        alt: "Briar 이슈 상세 Result 탭의 정리된 작업 결과",
        caption: "구현, 검증, 다음 행동이 이슈 상세의 Result 탭에 구조화됩니다.",
      },
      {
        id: "review-evidence",
        label: "06 · VERIFY",
        nav: "검증 근거 확인하기",
        title: "완료라는 말보다 근거를 확인하세요.",
        description:
          "Evidence 탭은 워크플로 단계별 산출물과 검증 상태를 보여 줍니다. 실행한 명령, 통과 여부, 시도와 수정 차수까지 남아 결과를 다시 확인할 수 있습니다.",
        bullets: [
          "Passed, Pending, Not recorded 상태로 빠진 검증을 찾습니다.",
          "Result에서 요약을 읽고 Evidence에서 그 결론을 뒷받침하는 기록을 확인합니다.",
        ],
        image: "/tutorial/04-evidence.webp",
        alt: "Briar 이슈의 단계별 검증 증거",
        caption: "분석, 구현, 로컬 검증의 증거가 시도·수정 차수와 함께 남습니다.",
      },
      {
        id: "create-agents",
        label: "07 · AGENTS",
        nav: "전문 에이전트 만들기",
        title: "반복되는 책임을 에이전트로 정의하세요.",
        description:
          "Agents에서 한 가지 책임, 제공자, 모델을 조합해 재사용 가능한 에이전트를 만듭니다. 대기 이슈 처리, 오류 탐지, 피드백 분석처럼 팀의 실제 역할에 맞춰 구성할 수 있습니다.",
        bullets: [
          "책임은 한 문장으로 구체적으로 적을수록 실행 범위가 선명해집니다.",
          "카드의 실행 버튼으로 필요할 때 즉시 책임을 수행시킵니다.",
        ],
        image: "/tutorial/05-agents.webp",
        alt: "Briar 프로젝트 에이전트 목록",
        caption: "서로 다른 제공자와 모델을 하나의 운영 방식으로 관리합니다.",
      },
      {
        id: "schedule-agents",
        label: "08 · AUTOMATE",
        nav: "반복 실행 예약하기",
        title: "정기적인 에이전트 업무를 예약하세요.",
        description:
          "Schedule에서 실행할 에이전트와 반복 주기, 시간, 알림 수준을 정합니다. 저장소 점검이나 피드백 분류처럼 놓치기 쉬운 업무를 팀 시간대에 맞춰 자동으로 실행할 수 있습니다.",
        bullets: [
          "Weekdays, 매일, 매주 등 업무에 맞는 주기를 선택합니다.",
          "Important updates 알림으로 사람의 판단이 필요한 순간만 받습니다.",
        ],
        image: "/tutorial/06-schedule.webp",
        alt: "Briar 에이전트 스케줄 생성 대화상자",
        caption: "에이전트, 반복 주기, 실행 시간, 알림을 하나의 스케줄로 저장합니다.",
      },
    ],
    nextEyebrow: "이제 직접 해볼 차례",
    nextTitle: "작은 이슈 하나로 시작하세요.",
    nextDescription:
      "저장소를 연결하고 완료 조건이 분명한 첫 이슈를 만들어 보세요. Briar가 실행부터 검증까지 한 흐름으로 이어 줍니다.",
    download: "Mac용 다운로드",
    backHome: "홈으로",
    backTop: "맨 위로 ↑",
  },
  en: {
    metadata: {
      title: "Briar tutorial — From first issue to verified result",
      description:
        "Learn how to create issues, process them with the issue processing agent, review structured results and evidence, and automate recurring work in Briar.",
    },
    eyebrow: "9-minute product tour",
    title: "From first issue\nto verified result.",
    description:
      "Follow real Briar screens to create an issue, process it with the issue processing agent, and review a structured result with supporting evidence.",
    start: "Start the tutorial",
    openApp: "Open Briar",
    captured:
      "Screens captured directly from a local Briar v1.2.67 demo environment.",
    setupTitle: "Before you begin",
    setup: [
      ["Open Briar", "Open the web app or install the Mac app and sign in."],
      ["Connect a repository", "Connect the Git repository you want to work on as a project."],
      ["Prepare an agent", "Sign in to Codex, Claude, or Grok for agent execution."],
    ],
    tocTitle: "In this tutorial",
    steps: [
      {
        id: "create-issue",
        label: "01 · INTAKE",
        nav: "Create an issue",
        title: "Turn a request into an executable issue.",
        description:
          "In New issue, add a title and description, then choose the assignee, starting status, and priority. Attach screenshots or a reproduction video when they clarify the work.",
        bullets: [
          "Include the expected result and completion criteria in the description.",
          "Use Queued for ready work and Backlog for requests that still need shaping.",
        ],
        image: "/tutorial/01-create-issue.webp",
        alt: "Briar new issue dialog",
        caption: "Set the title, context, priority, and attachments in one place.",
      },
      {
        id: "track-work",
        label: "02 · WORKFLOW",
        nav: "Track the work",
        title: "See where every task is on the board.",
        description:
          "Work moves from Backlog and Queued through Analyze, Implement, Local validation, and Review. Blocked and completed work stays visible in the same operating view.",
        bullets: [
          "Use In progress and Needs attention to focus on what matters now.",
          "Open a card to inspect its current stage and latest activity.",
        ],
        image: "/tutorial/02-task-board.webp",
        alt: "Briar issue processing kanban task board",
        caption: "People and agents share one source of truth for task state.",
      },
      {
        id: "run-auto-hunt",
        label: "03 · EXECUTE",
        nav: "Process queued issues",
        title: "Let the issue processing agent handle queued issues.",
        description:
          "Open Run Task for the issue processing agent in Agents to find queued issues and move each one through analysis, implementation, and validation. Briar keeps every issue isolated and records its progress on the board.",
        bullets: [
          "Confirm the request says “Process every queued issue.”, then choose Run Task.",
          "Once the run starts, queued issues move through the workflow and continue into the required checks.",
        ],
        image: "/tutorial/07-run-auto-hunt.webp",
        alt: "Briar Run Task dialog for the issue processing agent",
        caption: "Run the issue processing agent to process queued issues automatically.",
      },
      {
        id: "collaborate",
        label: "04 · COLLABORATE",
        nav: "Talk with the agent",
        title: "Keep the context inside the issue.",
        description:
          "The Issue tab keeps human follow-ups and agent replies together. New constraints and questions stay attached to the work while it is running.",
        bullets: [
          "Use comments for added requirements, edge cases, and review feedback.",
          "Move between Result, Evidence, Work log, and Status without losing the issue context.",
        ],
        image: "/tutorial/03-issue-conversation.webp",
        alt: "Briar issue detail with agent conversation",
        caption: "Instructions and agent responses accumulate on the issue.",
      },
      {
        id: "review-result",
        label: "05 · RESULT",
        nav: "Review the result",
        title: "Read a clean, structured result in the issue detail.",
        description:
          "When work finishes or reaches a review checkpoint, Result organizes the implementation, completed stages, validation summary, and next action in one view. You can understand what changed without reading the entire work log.",
        bullets: [
          "Start with Work result for the implementation and validation summary.",
          "Use Next action to approve or request changes, then open Evidence when you need the supporting detail.",
        ],
        image: "/tutorial/08-result.webp",
        alt: "Structured work result in the Briar issue detail Result tab",
        caption: "Implementation, validation, and the next action stay structured in the Result tab.",
      },
      {
        id: "review-evidence",
        label: "06 · VERIFY",
        nav: "Review evidence",
        title: "Inspect the proof behind done.",
        description:
          "Evidence organizes artifacts and verification by workflow stage. Commands, pass states, attempts, and revisions remain available for review.",
        bullets: [
          "Use Passed, Pending, and Not recorded to spot missing verification.",
          "Read the summary in Result, then confirm the supporting record in Evidence.",
        ],
        image: "/tutorial/04-evidence.webp",
        alt: "Stage-by-stage verification evidence in Briar",
        caption: "Analyze, implement, and local validation evidence stays tied to each revision.",
      },
      {
        id: "create-agents",
        label: "07 · AGENTS",
        nav: "Create specialist agents",
        title: "Define recurring responsibilities as agents.",
        description:
          "Combine one responsibility, a provider, and a model into a reusable project agent. Shape agents around real team roles such as queued issue processing, error intake, or feedback analysis.",
        bullets: [
          "A specific one-sentence responsibility keeps execution scope clear.",
          "Use the run action on a card to perform that responsibility on demand.",
        ],
        image: "/tutorial/05-agents.webp",
        alt: "Briar project agent list",
        caption: "Operate different providers and models through one shared system.",
      },
      {
        id: "schedule-agents",
        label: "08 · AUTOMATE",
        nav: "Schedule recurring runs",
        title: "Schedule routine agent work.",
        description:
          "Choose an agent, recurrence, time, and notification level in Schedule. Automate easy-to-miss work such as repository audits or feedback triage in your team's time zone.",
        bullets: [
          "Choose weekdays, daily, or weekly recurrence to match the job.",
          "Important updates keeps notifications focused on moments that need human judgment.",
        ],
        image: "/tutorial/06-schedule.webp",
        alt: "Briar create agent schedule dialog",
        caption: "Save the agent, cadence, run time, and notifications as one schedule.",
      },
    ],
    nextEyebrow: "Your turn",
    nextTitle: "Start with one small issue.",
    nextDescription:
      "Connect a repository and create a first issue with clear completion criteria. Briar will keep execution and verification in one flow.",
    download: "Download for Mac",
    backHome: "Home",
    backTop: "Back to top ↑",
  },
} as const satisfies Record<Locale, unknown>;

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

const PATH = "/tutorial" as const;

export default function TutorialView({ locale }: { locale: Locale }) {
  const c = copy[locale];
  const t = tutorialCopy[locale];
  const hrefs = {
    en: localizedPath("en", PATH),
    ko: localizedPath("ko", PATH),
  } as const;

  return (
    <main className="tutorial-page" id="top">
      <header className="site-header tutorial-header">
        <div className="shell nav-shell">
          {/* vinext currently hydrates next/link with a duplicate React instance. */}
          <a className="brand" href={localizedPath(locale, "/")} aria-label={c.aria.brandHome}>
            <span className="brand-mark">
              <img src="/briar-app-icon.png" alt="" />
            </span>
            <span>briar</span>
          </a>
          <nav aria-label={c.aria.mainMenu}>
            <a href={localizedPath(locale, "/")}>{t.backHome}</a>
            <a href="#run-auto-hunt">{t.steps[2].nav}</a>
            <a href="#review-result">{t.steps[4].nav}</a>
            <a href="#schedule-agents">{t.steps[7].nav}</a>
          </nav>
          <div className="header-actions">
            <LanguageSwitcher
              locale={locale}
              label={c.language.label}
              hrefs={hrefs}
              englishLabel={c.language.english}
              koreanLabel={c.language.korean}
            />
            <a className="header-cta header-download" href={WEB_APP_URL}>
              <span className="header-cta-label">{t.openApp}</span>{" "}
              <Arrow />
            </a>
            <MobileMenu
              navLabel={c.aria.mainMenu}
              navLinks={[
                { href: localizedPath(locale, "/"), label: t.backHome },
                { href: "#run-auto-hunt", label: t.steps[2].nav },
                { href: "#review-result", label: t.steps[4].nav },
                { href: "#schedule-agents", label: t.steps[7].nav },
              ]}
              ctaHref={WEB_APP_URL}
              ctaLabel={t.openApp}
              ctaAriaLabel={c.aria.openWebApp}
              openLabel={c.aria.menuOpen}
              closeLabel={c.aria.menuClose}
            />
          </div>
        </div>
      </header>

      <section className="tutorial-hero shell">
        <div className="tutorial-hero-copy">
          <span className="section-index">{t.eyebrow}</span>
          <h1>
            {t.title.split("\n").map((line) => (
              <span key={line}>{line}</span>
            ))}
          </h1>
          <p>{t.description}</p>
          <div className="tutorial-hero-actions">
            <a className="button button-primary" href="#create-issue">
              {t.start} <span aria-hidden="true">↓</span>
            </a>
            <a className="button button-secondary" href={WEB_APP_URL}>
              {t.openApp} <Arrow />
            </a>
          </div>
          <small>{t.captured}</small>
        </div>
        <div className="tutorial-hero-stack" aria-hidden="true">
          <div className="tutorial-stack-card stack-back">
            <img src="/tutorial/05-agents.webp" alt="" />
          </div>
          <div className="tutorial-stack-card stack-middle">
            <img src="/tutorial/08-result.webp" alt="" />
          </div>
          <div className="tutorial-stack-card stack-front">
            <img src="/tutorial/07-run-auto-hunt.webp" alt="" />
          </div>
        </div>
      </section>

      <section className="tutorial-setup shell" aria-labelledby="setup-title">
        <div>
          <span className="section-index">00 · SETUP</span>
          <h2 id="setup-title">{t.setupTitle}</h2>
        </div>
        <ol>
          {t.setup.map(([title, description], index) => (
            <li key={title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{title}</strong>
                <p>{description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="tutorial-body shell">
        <aside className="tutorial-toc">
          <strong>{t.tocTitle}</strong>
          <nav aria-label={t.tocTitle}>
            {t.steps.map((step, index) => (
              <a href={`#${step.id}`} key={step.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {step.nav}
              </a>
            ))}
          </nav>
        </aside>

        <div className="tutorial-steps">
          {t.steps.map((step, index) => (
            <article className="tutorial-step" id={step.id} key={step.id}>
              <div className="tutorial-step-copy">
                <span className="section-index">{step.label}</span>
                <div className="tutorial-step-heading">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <h2>{step.title}</h2>
                </div>
                <p>{step.description}</p>
                <ul>
                  {step.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </div>
              <figure>
                <div className="tutorial-shot-bar">
                  <span />
                  <span />
                  <span />
                  <small>briar · local demo</small>
                </div>
                <img
                  src={step.image}
                  alt={step.alt}
                  width="1036"
                  height="730"
                  loading={index === 0 ? "eager" : "lazy"}
                />
                <figcaption>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {step.caption}
                </figcaption>
              </figure>
            </article>
          ))}
        </div>
      </div>

      <section className="tutorial-next shell">
        <span className="section-index">{t.nextEyebrow}</span>
        <h2>{t.nextTitle}</h2>
        <p>{t.nextDescription}</p>
        <div>
          <a className="button button-primary" href={WEB_APP_URL}>
            {t.openApp} <Arrow />
          </a>
          <a className="button button-secondary" href={MAC_DOWNLOAD_URL}>
            {t.download} <span aria-hidden="true">↓</span>
          </a>
        </div>
      </section>

      <footer>
        <div className="shell footer-shell">
          <a className="brand" href={localizedPath(locale, "/")} aria-label={c.aria.brandHome}>
            <span className="brand-mark">
              <img src="/briar-app-icon.png" alt="" />
            </span>
            <span>briar</span>
          </a>
          <p>{c.footer.tagline}</p>
          <div>
            <a href={localizedPath(locale, "/")}>{t.backHome}</a>
            <a href="#top">{t.backTop}</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
