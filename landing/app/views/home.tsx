import {
  type LandingCopy,
  type Locale,
  copy,
  localizedHrefs,
  localizedPath,
} from "../i18n";
import { DesktopDownloadLink } from "../desktop-download-link";
import { resolveOrigin } from "../seo";
import { Arrow, SiteFooter, SiteHeader } from "../site-chrome";
import {
  GITHUB_LATEST_RELEASE_URL,
  GITHUB_URL,
  MAC_DOWNLOAD_URL,
  WEB_APP_URL,
} from "../site-links";

function ProductStage({ c }: { c: LandingCopy }) {
  return (
    <div
      className="product-stage product-stage-video"
      role="img"
      aria-label={c.aria.productPreview}
    >
      <video
        className="product-demo-video"
        aria-hidden="true"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
      >
        <source src="/briar-issue-to-complete-demo.mp4" type="video/mp4" />
      </video>
    </div>
  );
}

function WorkflowVisual({ c }: { c: LandingCopy }) {
  const d = c.mockup.detail;
  return (
    <div
      className="workflow-visual detail-window"
      role="img"
      aria-label={c.aria.workflowPreview}
    >
      <div className="detail-toolbar">
        <span>←</span>
        <small>AH-24</small>
        <strong>{c.workflow.issueTitle}</strong>
        <i>•••</i>
      </div>
      <div className="detail-layout">
        <div className="detail-content">
          <div className="detail-tabs">
            <span>{d.description}</span>
            <strong>☷ {d.evidence}</strong>
          </div>

          <div className="evidence-section">
            <div className="evidence-heading">
              <div>
                <strong>{c.workflow.analyze}</strong>
                <span>{d.analyzing}</span>
              </div>
              <small>1 / 1</small>
            </div>
            <article className="evidence-card is-passed">
              <div className="evidence-card-head">
                <strong>repository_findings</strong>
                <span>{d.passed}</span>
              </div>
              <p>{c.workflow.repositoryMapped}</p>
              <small>{d.command}</small>
              <code>rg -n &quot;AgentEvent|HuntDashboard&quot; src</code>
              <footer>
                <span>{d.attemptRevision}</span>
                <span>briar-workflow · {c.dashboard.now}</span>
              </footer>
            </article>
          </div>

          <div className="evidence-section implement-section">
            <div className="evidence-heading">
              <div>
                <strong>{c.workflow.implement}</strong>
                <span>{d.implementing}</span>
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
            <span>{d.leaveComment}</span>
            <div>
              <i>⌕</i>
              <strong>↑</strong>
            </div>
          </div>
        </div>

        <aside className="detail-properties">
          <h3>{d.properties}</h3>
          <div>
            <span>⌁</span>
            <strong>{c.workflow.implement}</strong>
            <i>⌄</i>
          </div>
          <div>
            <span>◒</span>
            <strong>{d.highPriority}</strong>
          </div>
          <div>
            <span>◎</span>
            <strong>Codex</strong>
          </div>
          <div>
            <span>↻</span>
            <strong>{d.attemptRevision}</strong>
          </div>
          <h3>{d.repository}</h3>
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

const PATH = "/" as const;

export default async function HomeView({ locale }: { locale: Locale }) {
  const c = copy[locale];
  const origin = await resolveOrigin();
  const hrefs = localizedHrefs(PATH);
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "Briar",
        url: origin,
        logo: `${origin}/briar-app-icon.png`,
        sameAs: [GITHUB_URL],
      },
      {
        "@type": "SoftwareApplication",
        name: "Briar",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "macOS, Android, Web",
        url: origin,
        description: c.metadata.description,
      },
    ],
  };
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
      name: c.agents.humanName,
      state: c.agents.states[2],
      role: c.agents.roles[2],
      tone: "blue",
    },
  ] as const;

  return (
    <main id="top">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <a className="skip-link" href="#main-content">
        {c.aria.skipToContent}
      </a>
      <SiteHeader
        brandHref="#top"
        copy={c}
        ctaLabel={c.nav.openWebApp}
        currentPath={PATH}
        hrefs={hrefs}
        locale={locale}
      />

      <section className="hero" id="main-content" tabIndex={-1}>
        <div className="hero-content shell">
          <div className="hero-kicker">
            <span />
            {c.hero.kicker}
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
              href={WEB_APP_URL}
              aria-label={c.aria.openWebApp}
            >
              {c.hero.openWebApp} <Arrow />
            </a>
            <DesktopDownloadLink
              className="button button-secondary hero-action-download"
              href={MAC_DOWNLOAD_URL}
              aria-label={c.aria.macDownload}
              locale={locale}
              trackingLabel={c.hero.macDownload}
              trackingLocation="home_hero"
            >
              {c.hero.macDownload} <span aria-hidden="true">↓</span>
            </DesktopDownloadLink>
          </div>
          <div className="hero-actions-compact">
            <a href={localizedPath(locale, "/download")}>
              {c.hero.allDownloads} <span aria-hidden="true">↓</span>
            </a>
            <a href="#workflow">
              {c.hero.howItWorks} <span aria-hidden="true">↓</span>
            </a>
          </div>
          <div className="hero-meta">
            <span>
              <i>⌘</i> {c.hero.meta[0]}
            </span>
            <span>
              <i>●</i> {c.hero.meta[1]}
            </span>
            <span>
              <i>✓</i> {c.hero.meta[2]}
            </span>
            <span>
              <i>✓</i> {c.hero.meta[3]}
            </span>
            <span>
              <i>✓</i> {c.hero.meta[4]}
            </span>
          </div>
        </div>
      </section>

      <section className="hero-product shell" id="product">
        <ProductStage c={c} />
      </section>

      <section className="differentiators-section shell" id="why-briar">
        <div className="section-intro section-intro-centered">
          <span className="section-index">{c.differentiators.index}</span>
          <h2>{c.differentiators.title}</h2>
          <p>{c.differentiators.description}</p>
        </div>
        <ol className="workflow-steps differentiator-list">
          {c.differentiators.items.map((item, index) => (
            <li key={item.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="differentiators-access">
          <strong>{c.differentiators.accessLabel}</strong>{" "}
          {c.differentiators.accessDescription}
        </p>
      </section>

      <section className="principles shell">
        <div className="section-intro section-intro-wide">
          <span className="section-index">01 / {c.nav.product.toUpperCase()}</span>
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
            <span className="section-index">02 / {c.nav.workflow.toUpperCase()}</span>
            <h2>{c.workflow.title}</h2>
            <p>{c.workflow.description}</p>
          </div>
          <div className="workflow-layout">
            <ol className="workflow-steps">
              {c.workflow.steps.map((step, index) => (
                <li key={step.title}>
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
          <span className="section-index">03 / {c.nav.agents.toUpperCase()}</span>
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
            <span className="section-index">04 / {c.nav.security.toUpperCase()}</span>
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
          <div
            className="security-visual"
            role="img"
            aria-label={c.aria.securityVisual}
          >
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
            href={WEB_APP_URL}
            aria-label={c.aria.openWebApp}
          >
            {c.final.openWebApp} <Arrow />
          </a>
          <DesktopDownloadLink
            className="button button-secondary"
            href={MAC_DOWNLOAD_URL}
            aria-label={c.aria.macDownload}
            locale={locale}
            trackingLabel={c.final.macDownload}
            trackingLocation="home_final"
          >
            {c.final.macDownload} <span aria-hidden="true">↓</span>
          </DesktopDownloadLink>
          <a
            className="button button-secondary"
            href={GITHUB_LATEST_RELEASE_URL}
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

      <SiteFooter
        brandHref="#top"
        copy={c}
        links={[
          { external: true, href: GITHUB_URL, label: "GitHub" },
          { href: "#security", label: c.footer.security },
          { href: localizedPath(locale, "/tutorial"), label: c.nav.tutorial },
          { href: localizedPath(locale, "/changelog"), label: c.nav.changelog },
          { href: localizedPath(locale, "/blog"), label: c.nav.blog },
          { href: "#top", label: c.footer.backToTop },
        ]}
      />
    </main>
  );
}
