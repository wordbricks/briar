import { copy, type LandingCopy } from "./i18n";
import { LanguageSwitcher } from "./language-switcher";
import { getRequestLocale } from "./request-locale";
import { ThemeToggle } from "./theme-toggle";

// Stable redirect that always resolves to the current Production DMG.
const MAC_DOWNLOAD_URL =
  "https://briar-api.wbai.workers.dev/releases/latest/mac-aarch64.dmg";
const GITHUB_URL = "https://github.com/wordbricks/briar";
const ANDROID_DOWNLOAD_URL = `${GITHUB_URL}/releases/latest`;

function Brand({ c }: { c: LandingCopy }) {
  return (
    <a className="brand" href="#top" aria-label={c.aria.brandHome}>
      <span className="brand-mark">
        <img src="/briar-app-icon.png" alt="" />
      </span>
      <span>briar</span>
    </a>
  );
}

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function ProductStage({ c }: { c: LandingCopy }) {
  const columns = [
    {
      name: "Backlog",
      tone: "slate",
      cards: [
        { id: "AH-18", title: c.dashboard.issues[3], meta: "Issue · 1h" },
        { id: "AH-21", title: c.dashboard.issues[2], meta: "Feedback · 36m" },
      ],
    },
    {
      name: "Queued",
      tone: "amber",
      cards: [
        { id: "AH-23", title: c.dashboard.issues[1], meta: "Issue · 14m" },
      ],
    },
    {
      name: "Analyze",
      tone: "blue",
      cards: [
        { id: "AH-24", title: c.dashboard.issues[0], meta: "Issue · 4m" },
      ],
    },
    {
      name: "Implement",
      tone: "violet",
      cards: [
        {
          id: "AH-24",
          title: c.workflow.issueTitle,
          meta: `Codex · ${c.dashboard.now}`,
          active: true,
        },
        { id: "AH-19", title: c.workflow.writingTests, meta: "Claude · 9m" },
      ],
    },
  ] as const;

  return (
    <div className="product-stage" aria-label={c.aria.productPreview}>
      <div className="stage-glow" />
      <div className="product-window board-window">
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

        <div className="board-shell">
          <aside className="board-rail" aria-hidden="true">
            <img src="/briar-app-icon.png" alt="" />
            <span>⌁</span>
            <span>▦</span>
            <span>⌕</span>
            <i />
            <span className="rail-active">◆</span>
            <span>◇</span>
            <span>＋</span>
          </aside>

          <aside className="board-sidebar">
            <div className="board-sidebar-brand">
              <strong>Briar</strong>
              <span>⌄</span>
            </div>
            <a href="#workflow">
              <span>⌂</span> Inbox <i>3</i>
            </a>
            <p>Projects</p>
            <div className="board-project">
              <div>
                <span>⌘</span>
                <strong>Briar</strong>
                <i />
              </div>
              <a className="board-project-active" href="#product">
                <span>⌁</span> Issues <em>6</em>
              </a>
              <a href="#agents">
                <span>✦</span> Agents
              </a>
              <a href="#workflow">
                <span>□</span> Schedule
              </a>
            </div>
            <div className="board-profile">
              <span>J</span>
              <div>
                <strong>Jay</strong>
                <small>demo@briar.local</small>
              </div>
            </div>
          </aside>

          <section className="board-main">
            <div className="board-toolbar">
              <div>
                <strong>Task queue</strong>
                <small>6 tasks</small>
              </div>
              <div className="board-toolbar-actions">
                <button type="button">＋ {c.dashboard.newIssue.replace("+ ", "")}</button>
                <span>⌕ Search tasks</span>
                <i>▦ Board</i>
              </div>
            </div>
            <div className="board-filters">
              <span className="is-selected">All <i>6</i></span>
              <span>In progress <i>3</i></span>
              <span>Needs attention <i>1</i></span>
              <span>Completed <i>12</i></span>
            </div>
            <div className="kanban-board">
              {columns.map((column) => (
                <div className="kanban-column" key={column.name}>
                  <div className="kanban-column-head">
                    <span className={`column-dot ${column.tone}`} />
                    <strong>{column.name}</strong>
                    <i>{column.cards.length}</i>
                  </div>
                  <div className="kanban-card-list">
                    {column.cards.map((card, index) => (
                      <article
                        className={`kanban-card ${"active" in card && card.active ? "is-running" : ""}`}
                        key={`${card.id}-${index}`}
                      >
                        <div className="kanban-card-meta">
                          <span>{card.id}</span>
                          <i>Issue</i>
                        </div>
                        <strong>{card.title}</strong>
                        {"active" in card && card.active ? (
                          <div className="kanban-progress">
                            <span>
                              <i />
                            </span>
                            <em>Implement · 72%</em>
                          </div>
                        ) : null}
                        <small>{card.meta}</small>
                      </article>
                    ))}
                    {column.cards.length < 2 ? (
                      <div className="kanban-empty">
                        <span>⌁</span>
                        Drop task here
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="board-statusbar">
          <div>
            <span>✦ Claude · Signed in</span>
            <span>◉ Codex · Signed in</span>
          </div>
          <div>
            <span>v1.2.22</span>
            <strong>
              <i /> {c.dashboard.active}
            </strong>
          </div>
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
    <div className="workflow-visual detail-window" aria-label={c.workflow.title}>
      <div className="detail-toolbar">
        <span>←</span>
        <small>AH-24</small>
        <strong>{c.workflow.issueTitle}</strong>
        <i>•••</i>
      </div>
      <div className="detail-layout">
        <div className="detail-content">
          <div className="detail-tabs">
            <span>Description</span>
            <strong>☷ Evidence</strong>
          </div>

          <div className="evidence-section">
            <div className="evidence-heading">
              <div>
                <strong>{c.workflow.analyze}</strong>
                <span>analyzing</span>
              </div>
              <small>1 / 1</small>
            </div>
            <article className="evidence-card is-passed">
              <div className="evidence-card-head">
                <strong>repository_findings</strong>
                <span>Passed</span>
              </div>
              <p>{c.workflow.repositoryMapped}</p>
              <small>Command</small>
              <code>rg -n &quot;AgentEvent|HuntDashboard&quot; src</code>
              <footer>
                <span>Attempt 1 · Revision 1</span>
                <span>briar-workflow · {c.dashboard.now}</span>
              </footer>
            </article>
          </div>

          <div className="evidence-section implement-section">
            <div className="evidence-heading">
              <div>
                <strong>{c.workflow.implement}</strong>
                <span>implementing</span>
              </div>
              <small>0 / 1</small>
            </div>
            <div className="implementation-track">
              <span className="activity-icon">C</span>
              <div>
                <strong>Codex</strong>
                <p>{c.dashboard.activityWorking}</p>
                <small>{c.workflow.writingTests}</small>
              </div>
              <i />
            </div>
          </div>

          <div className="detail-composer">
            <span>Leave a comment…</span>
            <div>
              <i>⌕</i>
              <strong>↑</strong>
            </div>
          </div>
        </div>

        <aside className="detail-properties">
          <h3>Properties</h3>
          <div>
            <span>⌁</span>
            <strong>{c.workflow.implement}</strong>
            <i>⌄</i>
          </div>
          <div>
            <span>◒</span>
            <strong>High priority</strong>
          </div>
          <div>
            <span>◎</span>
            <strong>Codex</strong>
          </div>
          <div>
            <span>↻</span>
            <strong>Attempt 1 · Revision 1</strong>
          </div>
          <h3>Repository</h3>
          <div>
            <span>⌘</span>
            <strong>wordbricks/briar</strong>
          </div>
          <div>
            <span>⑂</span>
            <strong>feat/agent-event-stream</strong>
          </div>
          <div>
            <span>◇</span>
            <strong>8e13ac4</strong>
          </div>
        </aside>
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
            <ThemeToggle
              label={c.theme.label}
              darkLabel={c.theme.dark}
              lightLabel={c.theme.light}
            />
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

      <section className="hero">
        <div className="hero-art" aria-hidden="true">
          <img
            src="/briar-hero-orchestration.webp"
            alt=""
            width="1899"
            height="828"
            fetchPriority="high"
          />
        </div>
        <div className="hero-content shell">
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
          <img src="/briar-app-icon.png" alt="" />
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
