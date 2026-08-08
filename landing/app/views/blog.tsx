import { type Locale, copy, localizedPath } from "../i18n";
import { LanguageSwitcher } from "../language-switcher";
import { MobileMenu } from "../mobile-menu";


const WEB_APP_URL = "/app/";
const GITHUB_URL = "https://github.com/wordbricks/briar";

export const blogCopy = {
  ko: {
    metadata: {
      title: "Briar 블로그 — 제품과 에이전트 개발 이야기",
      description:
        "Briar의 제품 소식과 사람과 코딩 에이전트가 함께 일하는 방법을 전합니다.",
    },
    eyebrow: "BRIAR JOURNAL",
    title: "Briar 블로그",
    description:
      "제품 소식과 사람과 코딩 에이전트가 함께 일하는 방법을 기록합니다.",
    emptyTitle: "첫 글을 준비하고 있어요.",
    emptyDescription: "곧 Briar의 새로운 이야기로 찾아올게요.",
    home: "홈",
    backTop: "맨 위로 ↑",
  },
  en: {
    metadata: {
      title: "Briar Blog — Product and agent development",
      description:
        "News from Briar and notes on how people and coding agents work together.",
    },
    eyebrow: "BRIAR JOURNAL",
    title: "Briar Blog",
    description:
      "Product news and notes on how people and coding agents work together.",
    emptyTitle: "Our first post is in the works.",
    emptyDescription: "Check back soon for new stories from Briar.",
    home: "Home",
    backTop: "Back to top ↑",
  },
} as const satisfies Record<Locale, unknown>;

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

const PATH = "/blog" as const;

export default function BlogView({ locale }: { locale: Locale }) {
  const c = copy[locale];
  const b = blogCopy[locale];
  const hrefs = {
    en: localizedPath("en", PATH),
    ko: localizedPath("ko", PATH),
  } as const;

  return (
    <main className="blog-page" id="top">
      <header className="site-header blog-header">
        <div className="shell nav-shell">
          <a className="brand" href={localizedPath(locale, "/")} aria-label={c.aria.brandHome}>
            <span className="brand-mark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/briar-app-icon.png" alt="" />
            </span>
            <span>briar</span>
          </a>
          <nav aria-label={c.aria.mainMenu}>
            <a href={localizedPath(locale, "/tutorial")}>{c.nav.tutorial}</a>
            <a className="is-current" href={localizedPath(locale, "/blog")} aria-current="page">
              {c.nav.blog}
            </a>
            <a href={localizedPath(locale, "/download")}>{c.nav.download}</a>
          </nav>
          <div className="header-actions">
            <LanguageSwitcher
              locale={locale}
              label={c.language.label}
              englishLabel={c.language.english}
              koreanLabel={c.language.korean}
              hrefs={hrefs}
            />
            <a
              className="header-cta header-github"
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              aria-label={c.aria.githubLink}
            >
              GitHub <Arrow />
            </a>
            <a className="header-cta header-download" href={WEB_APP_URL}>
              <span className="header-cta-label">{c.nav.openWebApp}</span>{" "}
              <Arrow />
            </a>
            <MobileMenu
              navLabel={c.aria.mainMenu}
              navLinks={[
                { href: localizedPath(locale, "/tutorial"), label: c.nav.tutorial },
                { href: localizedPath(locale, "/blog"), label: c.nav.blog, isCurrent: true },
                { href: localizedPath(locale, "/download"), label: c.nav.download },
                {
                  href: GITHUB_URL,
                  label: "GitHub",
                  external: true,
                },
              ]}
              ctaHref={WEB_APP_URL}
              ctaLabel={c.nav.openWebApp}
              ctaAriaLabel={c.aria.openWebApp}
              openLabel={c.aria.menuOpen}
              closeLabel={c.aria.menuClose}
            />
          </div>
        </div>
      </header>

      <section className="blog-hero shell">
        <span className="section-index">{b.eyebrow}</span>
        <h1>{b.title}</h1>
        <p>{b.description}</p>
      </section>

      <section className="blog-empty shell" aria-labelledby="blog-empty-title">
        <span aria-hidden="true">01</span>
        <div>
          <h2 id="blog-empty-title">{b.emptyTitle}</h2>
          <p>{b.emptyDescription}</p>
        </div>
      </section>

      <footer>
        <div className="shell footer-shell">
          <a className="brand" href={localizedPath(locale, "/")} aria-label={c.aria.brandHome}>
            <span className="brand-mark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/briar-app-icon.png" alt="" />
            </span>
            <span>briar</span>
          </a>
          <p>{c.footer.tagline}</p>
          <div>
            <a href={localizedPath(locale, "/")}>{b.home}</a>
            <a href={localizedPath(locale, "/tutorial")}>{c.nav.tutorial}</a>
            <a href={localizedPath(locale, "/download")}>{c.nav.download}</a>
            <a href="#top">{b.backTop}</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
