import { type Locale, copy, localizedPath } from "../i18n";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { GITHUB_URL } from "../site-links";

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
      <SiteHeader
        brandHref={localizedPath(locale, "/")}
        className="blog-header"
        copy={c}
        ctaLabel={c.nav.openWebApp}
        currentPath={PATH}
        hrefs={hrefs}
        locale={locale}
        secondaryAction={{
          ariaLabel: c.aria.githubLink,
          external: true,
          href: GITHUB_URL,
          label: "GitHub",
        }}
      />

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

      <SiteFooter
        brandHref={localizedPath(locale, "/")}
        copy={c}
        links={[
          { href: localizedPath(locale, "/"), label: b.home },
          { href: localizedPath(locale, "/tutorial"), label: c.nav.tutorial },
          { href: localizedPath(locale, "/changelog"), label: c.nav.changelog },
          { href: localizedPath(locale, "/download"), label: c.nav.download },
          { href: "#top", label: b.backTop },
        ]}
      />
    </main>
  );
}
