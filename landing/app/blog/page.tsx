import type { Metadata } from "next";
import { copy, type Locale } from "../i18n";
import { LanguageSwitcher } from "../language-switcher";
import { getRequestLocale } from "../request-locale";
import { ThemeToggle } from "../theme-toggle";

const WEB_APP_URL = "/app/";

const blogCopy = {
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

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return blogCopy[locale].metadata;
}

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

export default async function BlogPage() {
  const locale = await getRequestLocale();
  const c = copy[locale];
  const b = blogCopy[locale];

  return (
    <main className="blog-page" id="top">
      <header className="site-header blog-header">
        <div className="shell nav-shell">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="brand" href="/" aria-label={c.aria.brandHome}>
            <span className="brand-mark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/briar-app-icon.png" alt="" />
            </span>
            <span>briar</span>
          </a>
          <nav aria-label={c.aria.mainMenu}>
            <a href="/tutorial">{c.nav.tutorial}</a>
            <a className="is-current" href="/blog" aria-current="page">
              {c.nav.blog}
            </a>
            <a href="/download">{c.nav.download}</a>
          </nav>
          <div className="header-actions">
            <ThemeToggle
              label={c.theme.label}
              darkLabel={c.theme.dark}
              lightLabel={c.theme.light}
              darkName={c.theme.darkName}
              lightName={c.theme.lightName}
            />
            <LanguageSwitcher
              locale={locale}
              label={c.language.label}
              englishLabel={c.language.english}
              koreanLabel={c.language.korean}
            />
            <a className="header-cta header-download" href={WEB_APP_URL}>
              {c.nav.openWebApp} <Arrow />
            </a>
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
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="brand" href="/" aria-label={c.aria.brandHome}>
            <span className="brand-mark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/briar-app-icon.png" alt="" />
            </span>
            <span>briar</span>
          </a>
          <p>{c.footer.tagline}</p>
          <div>
            <a href="/">{b.home}</a>
            <a href="/tutorial">{c.nav.tutorial}</a>
            <a href="/download">{c.nav.download}</a>
            <a href="#top">{b.backTop}</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
