const workflowSteps = [
  {
    number: "01",
    title: "Intake",
    description:
      "이슈, 피드백, 에러를 하나의 실행 가능한 작업 큐로 모읍니다.",
  },
  {
    number: "02",
    title: "Run",
    description:
      "Codex와 Claude가 실제 저장소에서 컨텍스트를 읽고 작업을 시작합니다.",
  },
  {
    number: "03",
    title: "Observe",
    description:
      "분석부터 구현, QA까지 모든 진행 상태와 판단 근거를 한눈에 봅니다.",
  },
  {
    number: "04",
    title: "Ship",
    description:
      "검증 결과와 PR을 연결하고, 완료 조건을 충족한 작업만 배포로 보냅니다.",
  },
] as const;

const agents = [
  { name: "Codex", state: "3 running", tone: "violet" },
  { name: "Claude", state: "1 reviewing", tone: "amber" },
  { name: "Human", state: "2 approvals", tone: "blue" },
] as const;

// Stable redirect that always resolves to the current Production DMG.
const MAC_DOWNLOAD_URL =
  "https://briar-api.wbai.workers.dev/releases/latest/mac-aarch64.dmg";
const GITHUB_URL = "https://github.com/wordbricks/briar";

function Brand() {
  return (
    <a className="brand" href="#top" aria-label="Briar 홈">
      <span className="brand-mark">
        <img src="/briar-mark.svg" alt="" />
      </span>
      <span>briar</span>
    </a>
  );
}

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function ProductStage() {
  return (
    <div className="product-stage" aria-label="Briar 작업 대시보드 미리보기">
      <div className="stage-glow" />
      <div className="product-window">
        <div className="window-topbar">
          <div className="window-traffic" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="window-project">
            <span className="window-project-mark">B</span>
            wordbricks / briar
          </div>
          <div className="window-live">
            <span />
            Live
          </div>
        </div>
        <div className="window-body">
          <aside className="stage-sidebar">
            <div className="sidebar-brand">
              <img src="/briar-mark.svg" alt="" />
              <strong>briar</strong>
            </div>
            <p>Workspace</p>
            <a className="sidebar-active" href="#workflow">
              <span>⌁</span> Auto Hunt
              <em>6</em>
            </a>
            <a href="#workflow">
              <span>◇</span> Inbox
              <em>3</em>
            </a>
            <a href="#workflow">
              <span>◎</span> Projects
            </a>
            <p>Agents</p>
            <a href="#agents">
              <span>✦</span> Codex
              <i className="status-dot status-live" />
            </a>
            <a href="#agents">
              <span>✣</span> Claude
              <i className="status-dot" />
            </a>
            <div className="sidebar-user">
              <span>JK</span>
              <div>
                <strong>Jay Kim</strong>
                <small>Wordbricks</small>
              </div>
            </div>
          </aside>

          <main className="stage-main">
            <div className="stage-heading">
              <div>
                <span className="stage-eyebrow">AUTO HUNT</span>
                <h2>Agent runs</h2>
              </div>
              <button type="button">+ New issue</button>
            </div>

            <div className="stage-metrics">
              <div>
                <span>Active</span>
                <strong>04</strong>
                <small>↑ 2 today</small>
              </div>
              <div>
                <span>Ready to review</span>
                <strong>07</strong>
                <small>3 PRs linked</small>
              </div>
              <div>
                <span>Success rate</span>
                <strong>94%</strong>
                <small>last 30 runs</small>
              </div>
            </div>

            <div className="run-table">
              <div className="run-table-head">
                <span>Issue</span>
                <span>Stage</span>
                <span>Agent</span>
                <span>Updated</span>
              </div>
              <div className="run-row run-row-active">
                <span>
                  <i className="priority priority-high" />
                  <b>BRI-124</b>
                  Agent event stream 연결
                </span>
                <span className="stage-pill">
                  <i />
                  Implementing
                </span>
                <span className="agent-cell">
                  <i>C</i> Codex
                </span>
                <time>now</time>
              </div>
              <div className="run-row">
                <span>
                  <i className="priority priority-mid" />
                  <b>BRI-121</b>
                  작업 상세 패널 개선
                </span>
                <span className="stage-pill review-pill">
                  <i />
                  Review
                </span>
                <span className="agent-cell">
                  <i className="claude-cell">C</i> Claude
                </span>
                <time>8m</time>
              </div>
              <div className="run-row">
                <span>
                  <i className="priority priority-low" />
                  <b>BRI-118</b>
                  세션 복원 회귀 테스트
                </span>
                <span className="stage-pill qa-pill">
                  <i />
                  Local QA
                </span>
                <span className="agent-cell">
                  <i>C</i> Codex
                </span>
                <time>24m</time>
              </div>
              <div className="run-row">
                <span>
                  <i className="priority priority-done" />
                  <b>BRI-116</b>
                  D1 이벤트 스키마
                </span>
                <span className="stage-pill done-pill">
                  <i />
                  Completed
                </span>
                <span className="agent-cell">
                  <i className="human-cell">J</i> Jay
                </span>
                <time>1h</time>
              </div>
            </div>
          </main>

          <aside className="stage-activity">
            <div className="activity-head">
              <span>Live activity</span>
              <i />
            </div>
            <div className="activity-item active-activity">
              <span className="activity-icon">C</span>
              <div>
                <strong>Codex</strong>
                <p>이벤트 스트림 어댑터를 구현하고 있습니다.</p>
                <small>Thinking · now</small>
              </div>
            </div>
            <div className="activity-line" />
            <div className="activity-item">
              <span className="activity-icon tool-icon">⌘</span>
              <div>
                <strong>Local QA passed</strong>
                <p>142 tests · typecheck · build</p>
                <small>8 minutes ago</small>
              </div>
            </div>
            <div className="activity-line" />
            <div className="activity-item">
              <span className="activity-icon pr-icon">↗</span>
              <div>
                <strong>PR #124 opened</strong>
                <p>Ready for human review</p>
                <small>12 minutes ago</small>
              </div>
            </div>
            <div className="activity-command">
              <span>@briar</span>
              <p>모든 검증을 마치면 리뷰를 요청해줘</p>
              <button type="button" aria-label="에이전트에게 전송">
                ↑
              </button>
            </div>
          </aside>
        </div>
      </div>
      <div className="floating-note floating-note-left">
        <span className="note-icon">✓</span>
        <div>
          <strong>Local QA passed</strong>
          <small>142 tests · 0 failures</small>
        </div>
      </div>
      <div className="floating-note floating-note-right">
        <span className="note-icon pr-note">↗</span>
        <div>
          <strong>PR #124 ready</strong>
          <small>3 files · +186 −24</small>
        </div>
      </div>
    </div>
  );
}

function WorkflowVisual() {
  return (
    <div className="workflow-visual">
      <div className="workflow-toolbar">
        <div>
          <span>BRI-124</span>
          <strong>Agent event stream 연결</strong>
        </div>
        <span className="running-badge">
          <i /> Running
        </span>
      </div>
      <div className="workflow-grid">
        <div className="workflow-summary">
          <span>WORKFLOW</span>
          <div className="workflow-progress">
            <div className="progress-step step-complete">
              <i>✓</i>
              <div>
                <strong>Context</strong>
                <small>Velen context loaded</small>
              </div>
            </div>
            <div className="progress-line line-complete" />
            <div className="progress-step step-complete">
              <i>✓</i>
              <div>
                <strong>Analyze</strong>
                <small>Repository mapped</small>
              </div>
            </div>
            <div className="progress-line line-live" />
            <div className="progress-step step-live">
              <i>3</i>
              <div>
                <strong>Implement</strong>
                <small>Codex working</small>
              </div>
            </div>
            <div className="progress-line" />
            <div className="progress-step">
              <i>4</i>
              <div>
                <strong>Local QA</strong>
                <small>Waiting</small>
              </div>
            </div>
            <div className="progress-line" />
            <div className="progress-step">
              <i>5</i>
              <div>
                <strong>Review</strong>
                <small>Waiting</small>
              </div>
            </div>
          </div>
        </div>
        <div className="workflow-log">
          <div className="log-head">
            <span>Live execution</span>
            <small>Connected</small>
          </div>
          <pre>
            <span className="log-muted">10:42:08</span>{" "}
            <span className="log-accent">codex</span> Reading repository context
            {"\n"}
            <span className="log-muted">10:42:12</span>{" "}
            <span className="log-green">✓</span> AGENTS.md loaded
            {"\n"}
            <span className="log-muted">10:42:19</span>{" "}
            <span className="log-green">✓</span> 24 related files mapped
            {"\n"}
            <span className="log-muted">10:42:31</span>{" "}
            <span className="log-accent">codex</span> Implementing adapter
            {"\n"}
            <span className="log-muted">10:43:02</span>{" "}
            <span className="log-purple">●</span> Writing regression tests
            {"\n"}
            <span className="log-muted">10:43:07</span>{" "}
            <span className="cursor-block"> </span>
          </pre>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main id="top">
      <header className="site-header">
        <div className="shell nav-shell">
          <Brand />
          <nav aria-label="주요 메뉴">
            <a href="#product">제품</a>
            <a href="#workflow">워크플로</a>
            <a href="#security">보안</a>
            <a href="#agents">에이전트</a>
          </nav>
          <a
            className="header-cta header-download"
            href={MAC_DOWNLOAD_URL}
            aria-label="Mac용 Briar 최신 버전 다운로드"
          >
            Mac용 다운로드 <span aria-hidden="true">↓</span>
          </a>
        </div>
      </header>

      <section className="hero shell">
        <div className="hero-kicker">
          <span />
          Agent Development Environment
        </div>
        <h1>
          이슈에서 PR까지.
          <br />
          에이전트 작업을 운영하세요.
        </h1>
        <p>
          Briar는 사람과 코딩 에이전트가 실제 저장소에서 함께 일하는 과정을
          연결하고, 관찰하고, 끝까지 완료하는 로컬 우선 개발 환경입니다.
        </p>
        <div className="hero-actions">
          <a
            className="button button-primary"
            href={MAC_DOWNLOAD_URL}
            aria-label="Mac용 Briar 최신 버전 다운로드"
          >
            Mac용 Briar 다운로드 <span aria-hidden="true">↓</span>
          </a>
          <a className="button button-secondary" href="#workflow">
            작동 방식 보기 <span aria-hidden="true">↓</span>
          </a>
        </div>
        <div className="hero-meta">
          <span>
            <i>⌘</i> macOS Apple Silicon
          </span>
          <span>
            <i>✓</i> Repository-agnostic
          </span>
          <span>
            <i>✓</i> Codex + Claude
          </span>
          <span>
            <i>✓</i> Local-first
          </span>
        </div>
      </section>

      <section className="hero-product shell" id="product">
        <ProductStage />
      </section>

      <section className="principles shell">
        <div className="section-intro section-intro-wide">
          <span className="section-index">01 / PRODUCT</span>
          <h2>
            에이전트 개발을
            <br />
            운영 가능한 시스템으로.
          </h2>
          <p>
            단발성 자동화를 넘어, 실제 제품팀이 신뢰할 수 있는 실행 흐름으로
            바꿉니다.
          </p>
        </div>
        <div className="principle-grid">
          <article>
            <span className="card-figure">01</span>
            <div className="principle-symbol symbol-local">
              <i />
              <i />
              <i />
            </div>
            <h3>코드는 로컬에</h3>
            <p>
              저장소 소스는 기기를 떠나지 않습니다. Briar는 필요한 작업 상태와
              Git 메타데이터만 안전하게 동기화합니다.
            </p>
          </article>
          <article>
            <span className="card-figure">02</span>
            <div className="principle-symbol symbol-agents">
              <span>C</span>
              <span>C</span>
              <span>H</span>
            </div>
            <h3>사람과 에이전트가 함께</h3>
            <p>
              Codex, Claude, 그리고 팀의 승인을 하나의 타임라인과 워크플로로
              연결합니다.
            </p>
          </article>
          <article>
            <span className="card-figure">03</span>
            <div className="principle-symbol symbol-flow">
              <i />
              <i />
              <i />
              <i />
            </div>
            <h3>끝까지 닫히는 흐름</h3>
            <p>
              컨텍스트 수집, 구현, QA, 리뷰, 배포까지 완료 조건을 명확히
              기록합니다.
            </p>
          </article>
        </div>
      </section>

      <section className="workflow-section" id="workflow">
        <div className="shell">
          <div className="section-intro workflow-intro">
            <span className="section-index">02 / WORKFLOW</span>
            <h2>작업이 스스로 앞으로 나아가도록.</h2>
            <p>
              대화와 이슈를 실행 가능한 작업으로 바꾸고, 지금 어디까지
              진행됐는지 놓치지 마세요.
            </p>
          </div>
          <div className="workflow-layout">
            <ol className="workflow-steps">
              {workflowSteps.map((step, index) => (
                <li className={index === 2 ? "is-active" : ""} key={step.number}>
                  <span>{step.number}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
            <WorkflowVisual />
          </div>
        </div>
      </section>

      <section className="agents-section shell" id="agents">
        <div className="section-intro section-intro-centered">
          <span className="section-index">03 / AGENTS</span>
          <h2>선호하는 에이전트는 그대로.</h2>
          <p>
            도구를 바꾸지 않아도 됩니다. Briar가 서로 다른 에이전트의 실행을
            같은 운영 모델로 연결합니다.
          </p>
        </div>
        <div className="agent-board">
          <div className="agent-board-top">
            <span>Active collaborators</span>
            <small>
              <i /> All systems operational
            </small>
          </div>
          <div className="agent-list">
            {agents.map((agent, index) => (
              <div className="agent-row" key={agent.name}>
                <span className={`agent-avatar ${agent.tone}`}>
                  {agent.name.charAt(0)}
                </span>
                <div>
                  <strong>{agent.name}</strong>
                  <small>
                    {index === 0
                      ? "Implementation & local QA"
                      : index === 1
                        ? "Review & reasoning"
                        : "Direction & approval"}
                  </small>
                </div>
                <span className="agent-state">{agent.state}</span>
                <span className="agent-pulse">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="security-section" id="security">
        <div className="shell security-layout">
          <div className="security-copy">
            <span className="section-index">04 / SECURITY</span>
            <h2>
              코드는 로컬에.
              <br />
              신뢰는 기본값으로.
            </h2>
            <p>
              에이전트는 연결된 Git 루트에서만 실행됩니다. 소스 코드는 로컬에
              남고, 토큰은 해시로 저장되며, 위험한 작업에는 사람의 승인을
              요구할 수 있습니다.
            </p>
            <div className="security-points">
              <span>
                <i>✓</i> Repository path never leaves your device
              </span>
              <span>
                <i>✓</i> Permission-aware agent execution
              </span>
              <span>
                <i>✓</i> Auditable, retry-safe event history
              </span>
            </div>
          </div>
          <div className="security-visual" aria-label="Briar 보안 구조">
            <div className="secure-device">
              <div className="device-top">
                <span />
                <small>YOUR DEVICE</small>
                <i>Secure</i>
              </div>
              <div className="repo-card">
                <span className="repo-icon">⌘</span>
                <div>
                  <strong>Local repository</strong>
                  <small>/Users/team/product</small>
                </div>
                <em>Private</em>
              </div>
              <div className="secure-agent-row">
                <span>C</span>
                <div>
                  <strong>Agent execution</strong>
                  <small>cwd locked to Git root</small>
                </div>
                <i>✓</i>
              </div>
              <div className="secure-agent-row">
                <span>⌁</span>
                <div>
                  <strong>Source code</strong>
                  <small>never uploaded</small>
                </div>
                <i>✓</i>
              </div>
            </div>
            <div className="secure-bridge">
              <span>Encrypted state sync</span>
              <i />
            </div>
            <div className="secure-cloud">
              <span>B</span>
              <div>
                <strong>Briar Cloud</strong>
                <small>Task state + Git metadata</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="final-cta shell">
        <div className="cta-mark">
          <img src="/briar-mark.svg" alt="" />
        </div>
        <span className="section-index">READY WHEN YOU ARE</span>
        <h2>
          에이전트에게 일을 맡기고,
          <br />
          결과에는 확신을 가지세요.
        </h2>
        <p>Briar로 사람과 에이전트가 함께 일하는 개발 흐름을 시작하세요.</p>
        <div className="final-actions">
          <a
            className="button button-primary"
            href={MAC_DOWNLOAD_URL}
            aria-label="Mac용 Briar 최신 버전 다운로드"
          >
            Mac용 Briar 다운로드 <span aria-hidden="true">↓</span>
          </a>
          <a
            className="button button-secondary"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
          >
            GitHub에서 보기 <Arrow />
          </a>
        </div>
        <small className="download-note">
          최신 릴리즈 · macOS Apple Silicon · 서명 및 공증 완료
        </small>
      </section>

      <footer>
        <div className="shell footer-shell">
          <Brand />
          <p>Agent development, with a clear line of sight.</p>
          <div>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
            <a href="#security">Security</a>
            <a href="#top">Back to top ↑</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
