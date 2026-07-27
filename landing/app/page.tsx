import { copy, type LandingCopy } from "./i18n";
import { LanguageSwitcher } from "./language-switcher";
import { getRequestLocale } from "./request-locale";

// Stable redirect that always resolves to the current Production DMG.
const MAC_DOWNLOAD_URL =
  "https://briar-api.wbai.workers.dev/releases/latest/mac-aarch64.dmg";
const GITHUB_URL = "https://github.com/wordbricks/briar";
const ANDROID_DOWNLOAD_URL = `${GITHUB_URL}/releases/latest`;

function Brand({ c }: { c: LandingCopy }) {
  return (
    <a className="brand" href="#top" aria-label={c.aria.brandHome}>
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

function ProductStage({ c }: { c: LandingCopy }) {
  return (
    <div className="product-stage" aria-label={c.aria.productPreview}>
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
                <h2>{c.dashboard.agentRuns}</h2>
              </div>
              <button type="button">{c.dashboard.newIssue}</button>
            </div>

            <div className="stage-metrics">
              <div>
                <span>{c.dashboard.active}</span>
                <strong>04</strong>
                <small>{c.dashboard.today}</small>
              </div>
              <div>
                <span>{c.dashboard.readyToReview}</span>
                <strong>07</strong>
                <small>{c.dashboard.prsLinked}</small>
              </div>
              <div>
                <span>{c.dashboard.successRate}</span>
                <strong>94%</strong>
                <small>{c.dashboard.lastRuns}</small>
              </div>
            </div>

            <div className="run-table">
              <div className="run-table-head">
                <span>{c.dashboard.issue}</span>
                <span>{c.dashboard.stage}</span>
                <span>{c.dashboard.agent}</span>
                <span>{c.dashboard.updated}</span>
              </div>
              <div className="run-row run-row-active">
                <span>
                  <i className="priority priority-high" />
                  <b>BRI-124</b>
                  {c.dashboard.issues[0]}
                </span>
                <span className="stage-pill">
                  <i />
                  {c.dashboard.implementing}
                </span>
                <span className="agent-cell">
                  <i>C</i> Codex
                </span>
                <time>{c.dashboard.now}</time>
              </div>
              <div className="run-row">
                <span>
                  <i className="priority priority-mid" />
                  <b>BRI-121</b>
                  {c.dashboard.issues[1]}
                </span>
                <span className="stage-pill review-pill">
                  <i />
                  {c.dashboard.review}
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
                  {c.dashboard.issues[2]}
                </span>
                <span className="stage-pill qa-pill">
                  <i />
                  {c.dashboard.localQa}
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
                  {c.dashboard.issues[3]}
                </span>
                <span className="stage-pill done-pill">
                  <i />
                  {c.dashboard.completed}
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
              <span>{c.dashboard.liveActivity}</span>
              <i />
            </div>
            <div className="activity-item active-activity">
              <span className="activity-icon">C</span>
              <div>
                <strong>Codex</strong>
                <p>{c.dashboard.activityWorking}</p>
                <small>{c.dashboard.thinkingNow}</small>
              </div>
            </div>
            <div className="activity-line" />
            <div className="activity-item">
              <span className="activity-icon tool-icon">⌘</span>
              <div>
                <strong>{c.dashboard.qaPassed}</strong>
                <p>142 tests · typecheck · build</p>
                <small>{c.dashboard.minutesAgo8}</small>
              </div>
            </div>
            <div className="activity-line" />
            <div className="activity-item">
              <span className="activity-icon pr-icon">↗</span>
              <div>
                <strong>{c.dashboard.prOpened}</strong>
                <p>{c.dashboard.readyForHumanReview}</p>
                <small>{c.dashboard.minutesAgo12}</small>
              </div>
            </div>
            <div className="activity-command">
              <span>@briar</span>
              <p>{c.dashboard.command}</p>
              <button type="button" aria-label={c.aria.sendCommand}>
                ↑
              </button>
            </div>
          </aside>
        </div>
      </div>
      <div className="floating-note floating-note-left">
        <span className="note-icon">✓</span>
        <div>
          <strong>{c.dashboard.qaPassed}</strong>
          <small>142 tests · 0 failures</small>
        </div>
      </div>
      <div className="floating-note floating-note-right">
        <span className="note-icon pr-note">↗</span>
        <div>
          <strong>{c.dashboard.prReady}</strong>
          <small>3 files · +186 −24</small>
        </div>
      </div>
    </div>
  );
}

function WorkflowVisual({ c }: { c: LandingCopy }) {
  return (
    <div className="workflow-visual">
      <div className="workflow-toolbar">
        <div>
          <span>BRI-124</span>
          <strong>{c.workflow.issueTitle}</strong>
        </div>
        <span className="running-badge">
          <i /> {c.workflow.running}
        </span>
      </div>
      <div className="workflow-grid">
        <div className="workflow-summary">
          <span>WORKFLOW</span>
          <div className="workflow-progress">
            <div className="progress-step step-complete">
              <i>✓</i>
              <div>
                <strong>{c.workflow.context}</strong>
                <small>{c.workflow.contextLoaded}</small>
              </div>
            </div>
            <div className="progress-line line-complete" />
            <div className="progress-step step-complete">
              <i>✓</i>
              <div>
                <strong>{c.workflow.analyze}</strong>
                <small>{c.workflow.repositoryMapped}</small>
              </div>
            </div>
            <div className="progress-line line-live" />
            <div className="progress-step step-live">
              <i>3</i>
              <div>
                <strong>{c.workflow.implement}</strong>
                <small>{c.workflow.codexWorking}</small>
              </div>
            </div>
            <div className="progress-line" />
            <div className="progress-step">
              <i>4</i>
              <div>
                <strong>{c.workflow.localQa}</strong>
                <small>{c.workflow.waiting}</small>
              </div>
            </div>
            <div className="progress-line" />
            <div className="progress-step">
              <i>5</i>
              <div>
                <strong>{c.workflow.review}</strong>
                <small>{c.workflow.waiting}</small>
              </div>
            </div>
          </div>
        </div>
        <div className="workflow-log">
          <div className="log-head">
            <span>{c.workflow.liveExecution}</span>
            <small>{c.workflow.connected}</small>
          </div>
          <pre>
            <span className="log-muted">10:42:08</span>{" "}
            <span className="log-accent">codex</span>{" "}
            {c.workflow.readingContext}
            {"\n"}
            <span className="log-muted">10:42:12</span>{" "}
            <span className="log-green">✓</span> {c.workflow.agentsLoaded}
            {"\n"}
            <span className="log-muted">10:42:19</span>{" "}
            <span className="log-green">✓</span> {c.workflow.filesMapped}
            {"\n"}
            <span className="log-muted">10:42:31</span>{" "}
            <span className="log-accent">codex</span>{" "}
            {c.workflow.implementingAdapter}
            {"\n"}
            <span className="log-muted">10:43:02</span>{" "}
            <span className="log-purple">●</span> {c.workflow.writingTests}
            {"\n"}
            <span className="log-muted">10:43:07</span>{" "}
            <span className="cursor-block"> </span>
          </pre>
        </div>
      </div>
    </div>
  );
}

export default async function Home() {
  const locale = await getRequestLocale();
  const c = copy[locale];
  const agents = [
    {
      name: "Codex",
      state: c.agents.states[0],
      role: c.agents.roles[0],
      tone: "violet",
    },
    {
      name: "Claude",
      state: c.agents.states[1],
      role: c.agents.roles[1],
      tone: "amber",
    },
    {
      name: "Human",
      state: c.agents.states[2],
      role: c.agents.roles[2],
      tone: "blue",
    },
  ] as const;

  return (
    <main id="top">
      <header className="site-header">
        <div className="shell nav-shell">
          <Brand c={c} />
          <nav aria-label={c.aria.mainMenu}>
            <a href="#product">{c.nav.product}</a>
            <a href="#workflow">{c.nav.workflow}</a>
            <a href="#security">{c.nav.security}</a>
            <a href="#agents">{c.nav.agents}</a>
          </nav>
          <div className="header-actions">
            <LanguageSwitcher
              locale={locale}
              label={c.language.label}
              englishLabel={c.language.english}
              koreanLabel={c.language.korean}
            />
            <a
              className="header-cta header-download"
              href={MAC_DOWNLOAD_URL}
              aria-label={c.aria.macDownload}
            >
              {c.nav.macDownload} <span aria-hidden="true">↓</span>
            </a>
          </div>
        </div>
      </header>

      <section className="hero shell">
        <div className="hero-kicker">
          <span />
          Agent Development Environment
        </div>
        <h1>
          {c.hero.line1}
          <br />
          {c.hero.line2}
        </h1>
        <p>{c.hero.description}</p>
        <div className="hero-actions">
          <a
            className="button button-primary"
            href={MAC_DOWNLOAD_URL}
            aria-label={c.aria.macDownload}
          >
            {c.hero.macDownload} <span aria-hidden="true">↓</span>
          </a>
          <a
            className="button button-secondary"
            href={ANDROID_DOWNLOAD_URL}
            aria-label={c.aria.androidDownload}
          >
            {c.hero.androidDownload} <span aria-hidden="true">↓</span>
          </a>
          <a className="button button-secondary" href="#workflow">
            {c.hero.howItWorks} <span aria-hidden="true">↓</span>
          </a>
        </div>
        <div className="hero-meta">
          <span>
            <i>⌘</i> macOS Apple Silicon
          </span>
          <span>
            <i>●</i> Android companion
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
        <ProductStage c={c} />
      </section>

      <section className="principles shell">
        <div className="section-intro section-intro-wide">
          <span className="section-index">01 / PRODUCT</span>
          <h2>
            {c.principles.line1}
            <br />
            {c.principles.line2}
          </h2>
          <p>{c.principles.description}</p>
        </div>
        <div className="principle-grid">
          <article>
            <span className="card-figure">01</span>
            <div className="principle-symbol symbol-local">
              <i />
              <i />
              <i />
            </div>
            <h3>{c.principles.cards[0].title}</h3>
            <p>{c.principles.cards[0].description}</p>
          </article>
          <article>
            <span className="card-figure">02</span>
            <div className="principle-symbol symbol-agents">
              <span>C</span>
              <span>C</span>
              <span>H</span>
            </div>
            <h3>{c.principles.cards[1].title}</h3>
            <p>{c.principles.cards[1].description}</p>
          </article>
          <article>
            <span className="card-figure">03</span>
            <div className="principle-symbol symbol-flow">
              <i />
              <i />
              <i />
              <i />
            </div>
            <h3>{c.principles.cards[2].title}</h3>
            <p>{c.principles.cards[2].description}</p>
          </article>
        </div>
      </section>

      <section className="workflow-section" id="workflow">
        <div className="shell">
          <div className="section-intro workflow-intro">
            <span className="section-index">02 / WORKFLOW</span>
            <h2>{c.workflow.title}</h2>
            <p>{c.workflow.description}</p>
          </div>
          <div className="workflow-layout">
            <ol className="workflow-steps">
              {c.workflow.steps.map((step, index) => (
                <li className={index === 2 ? "is-active" : ""} key={step.title}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
            <WorkflowVisual c={c} />
          </div>
        </div>
      </section>

      <section className="agents-section shell" id="agents">
        <div className="section-intro section-intro-centered">
          <span className="section-index">03 / AGENTS</span>
          <h2>{c.agents.title}</h2>
          <p>{c.agents.description}</p>
        </div>
        <div className="agent-board">
          <div className="agent-board-top">
            <span>{c.agents.activeCollaborators}</span>
            <small>
              <i /> {c.agents.operational}
            </small>
          </div>
          <div className="agent-list">
            {agents.map((agent) => (
              <div className="agent-row" key={agent.name}>
                <span className={`agent-avatar ${agent.tone}`}>
                  {agent.name.charAt(0)}
                </span>
                <div>
                  <strong>{agent.name}</strong>
                  <small>{agent.role}</small>
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
              {c.security.line1}
              <br />
              {c.security.line2}
            </h2>
            <p>{c.security.description}</p>
            <div className="security-points">
              {c.security.points.map((point) => (
                <span key={point}>
                  <i>✓</i> {point}
                </span>
              ))}
            </div>
          </div>
          <div className="security-visual" aria-label={c.aria.securityVisual}>
            <div className="secure-device">
              <div className="device-top">
                <span />
                <small>{c.security.yourDevice}</small>
                <i>{c.security.secure}</i>
              </div>
              <div className="repo-card">
                <span className="repo-icon">⌘</span>
                <div>
                  <strong>{c.security.localRepository}</strong>
                  <small>/Users/team/product</small>
                </div>
                <em>{c.security.private}</em>
              </div>
              <div className="secure-agent-row">
                <span>C</span>
                <div>
                  <strong>{c.security.agentExecution}</strong>
                  <small>{c.security.cwdLocked}</small>
                </div>
                <i>✓</i>
              </div>
              <div className="secure-agent-row">
                <span>⌁</span>
                <div>
                  <strong>{c.security.sourceCode}</strong>
                  <small>{c.security.neverUploaded}</small>
                </div>
                <i>✓</i>
              </div>
            </div>
            <div className="secure-bridge">
              <span>{c.security.encryptedSync}</span>
              <i />
            </div>
            <div className="secure-cloud">
              <span>B</span>
              <div>
                <strong>Briar Cloud</strong>
                <small>{c.security.cloudDetail}</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="final-cta shell">
        <div className="cta-mark">
          <img src="/briar-mark.svg" alt="" />
        </div>
        <span className="section-index">{c.final.eyebrow}</span>
        <h2>
          {c.final.line1}
          <br />
          {c.final.line2}
        </h2>
        <p>{c.final.description}</p>
        <div className="final-actions">
          <a
            className="button button-primary"
            href={MAC_DOWNLOAD_URL}
            aria-label={c.aria.macDownload}
          >
            {c.final.macDownload} <span aria-hidden="true">↓</span>
          </a>
          <a
            className="button button-secondary"
            href={ANDROID_DOWNLOAD_URL}
            aria-label={c.aria.androidDownload}
          >
            {c.final.androidDownload} <span aria-hidden="true">↓</span>
          </a>
          <a
            className="button button-secondary"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
          >
            {c.final.github} <Arrow />
          </a>
        </div>
        <small className="download-note">
          {c.final.note}
        </small>
      </section>

      <footer>
        <div className="shell footer-shell">
          <Brand c={c} />
          <p>{c.footer.tagline}</p>
          <div>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
            <a href="#security">{c.footer.security}</a>
            <a href="#top">{c.footer.backToTop}</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
