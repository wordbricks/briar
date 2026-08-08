import { type Locale, copy, localizedPath } from "../i18n";
import { LanguageSwitcher } from "../language-switcher";
import { MobileMenu } from "../mobile-menu";


const MAC_DOWNLOAD_URL =
  "https://briar-api.wbai.workers.dev/releases/latest/mac-aarch64.dmg";
const GITHUB_RELEASES_URL =
  "https://github.com/wordbricks/briar/releases/latest";
const WEB_APP_URL = "/app/";

export const downloadCopy = {
  ko: {
    metadata: {
      title: "Briar 다운로드 — macOS, Android, Web",
      description:
        "macOS용 Briar를 설치하거나 Android companion과 웹 앱으로 Briar를 시작하세요.",
    },
    eyebrow: "어디서든 에이전트 작업을 운영하세요",
    title: "Briar 다운로드",
    description:
      "Mac에서 에이전트를 실행하고, Android companion이나 브라우저에서 작업 흐름을 이어서 확인하세요.",
    desktop: "데스크톱",
    desktopDescription: "로컬 저장소와 에이전트를 연결하는 기본 앱",
    mac: "macOS",
    macDetail: "Apple Silicon · macOS 13 이상",
    macAction: "Apple Silicon 다운로드",
    recommended: "권장",
    mobile: "모바일",
    mobileDescription: "자리를 비운 동안에도 진행 상황과 결과를 확인하세요",
    android: "Android",
    androidDetail: "Android companion · 최신 GitHub 릴리즈",
    androidAction: "Android 릴리즈 열기",
    web: "웹",
    webDescription: "설치 없이 어떤 브라우저에서든 Briar에 연결하세요",
    webApp: "Briar Web",
    webDetail: "최신 버전 · 자동 업데이트",
    webAction: "웹 앱 열기",
    releasesPrefix: "이전 버전과 릴리즈 노트는",
    releasesLink: "GitHub Releases",
    releasesSuffix: "에서 확인할 수 있습니다.",
    home: "홈",
    backTop: "맨 위로 ↑",
  },
  en: {
    metadata: {
      title: "Download Briar — macOS, Android, and Web",
      description:
        "Install Briar for macOS, get the Android companion, or open Briar in your browser.",
    },
    eyebrow: "Operate your agent work from anywhere",
    title: "Download Briar",
    description:
      "Run agents from your Mac, then keep up with the workflow from the Android companion or any browser.",
    desktop: "Desktop",
    desktopDescription: "The primary app for connecting local repositories and agents",
    mac: "macOS",
    macDetail: "Apple Silicon · macOS 13 or later",
    macAction: "Download for Apple Silicon",
    recommended: "Recommended",
    mobile: "Mobile",
    mobileDescription: "Check progress and results while you are away from your desk",
    android: "Android",
    androidDetail: "Android companion · latest GitHub release",
    androidAction: "Open Android release",
    web: "Web",
    webDescription: "Connect to Briar from any browser with nothing to install",
    webApp: "Briar Web",
    webDetail: "Latest version · updates automatically",
    webAction: "Open web app",
    releasesPrefix: "Previous versions and release notes are available on",
    releasesLink: "GitHub Releases",
    releasesSuffix: ".",
    home: "Home",
    backTop: "Back to top ↑",
  },
} as const satisfies Record<Locale, unknown>;

function Arrow({ direction = "out" }: { direction?: "out" | "down" }) {
  return <span aria-hidden="true">{direction === "out" ? "↗" : "↓"}</span>;
}

function PlatformIcon({ platform }: { platform: "mac" | "android" | "web" }) {
  const icons = { mac: "⌘", android: "●", web: "◎" } as const;
  return (
    <span className={`download-platform-icon ${platform}`} aria-hidden="true">
      {icons[platform]}
    </span>
  );
}

const PATH = "/download" as const;

export default function DownloadView({ locale }: { locale: Locale }) {
  const c = copy[locale];
  const d = downloadCopy[locale];
  const hrefs = {
    en: localizedPath("en", PATH),
    ko: localizedPath("ko", PATH),
  } as const;

  return (
    <main className="download-page" id="top">
      <header className="site-header download-header">
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
            <a href={localizedPath(locale, "/changelog")}>{c.nav.changelog}</a>
            <a href={localizedPath(locale, "/blog")}>{c.nav.blog}</a>
            <a className="is-current" href={localizedPath(locale, "/download")} aria-current="page">
              {c.nav.download}
            </a>
          </nav>
          <div className="header-actions">
            <LanguageSwitcher
              locale={locale}
              label={c.language.label}
              englishLabel={c.language.english}
              koreanLabel={c.language.korean}
              hrefs={hrefs}
            />
            <a className="header-cta header-download" href={WEB_APP_URL}>
              <span className="header-cta-label">{c.nav.openWebApp}</span>{" "}
              <Arrow />
            </a>
            <MobileMenu
              navLabel={c.aria.mainMenu}
              navLinks={[
                { href: localizedPath(locale, "/tutorial"), label: c.nav.tutorial },
                { href: localizedPath(locale, "/blog"), label: c.nav.blog },
                {
                  href: localizedPath(locale, "/download"),
                  label: c.nav.download,
                  isCurrent: true,
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

      <section className="download-hero shell">
        <span className="section-index">{d.eyebrow}</span>
        <h1>{d.title}</h1>
        <p>{d.description}</p>
      </section>

      <div className="download-catalog shell">
        <section className="download-group" aria-labelledby="desktop-heading">
          <div className="download-group-heading">
            <div>
              <span className="download-group-index">01</span>
              <h2 id="desktop-heading">{d.desktop}</h2>
            </div>
            <p>{d.desktopDescription}</p>
          </div>
          <article className="download-card download-card-featured">
            <div className="download-card-main">
              <PlatformIcon platform="mac" />
              <div>
                <span className="download-badge">{d.recommended}</span>
                <h3>{d.mac}</h3>
                <p>{d.macDetail}</p>
              </div>
            </div>
            <a className="button button-primary" href={MAC_DOWNLOAD_URL}>
              {d.macAction} <Arrow direction="down" />
            </a>
          </article>
        </section>

        <div className="download-secondary-grid">
          <section className="download-group" id="mobile" aria-labelledby="mobile-heading">
            <div className="download-group-heading download-group-heading-stacked">
              <div>
                <span className="download-group-index">02</span>
                <h2 id="mobile-heading">{d.mobile}</h2>
              </div>
              <p>{d.mobileDescription}</p>
            </div>
            <article className="download-card download-card-compact">
              <div className="download-card-main">
                <PlatformIcon platform="android" />
                <div>
                  <h3>{d.android}</h3>
                  <p>{d.androidDetail}</p>
                </div>
              </div>
              <a
                className="button button-secondary"
                href={GITHUB_RELEASES_URL}
                target="_blank"
                rel="noreferrer"
              >
                {d.androidAction} <Arrow />
              </a>
            </article>
          </section>

          <section className="download-group" aria-labelledby="web-heading">
            <div className="download-group-heading download-group-heading-stacked">
              <div>
                <span className="download-group-index">03</span>
                <h2 id="web-heading">{d.web}</h2>
              </div>
              <p>{d.webDescription}</p>
            </div>
            <article className="download-card download-card-compact">
              <div className="download-card-main">
                <PlatformIcon platform="web" />
                <div>
                  <h3>{d.webApp}</h3>
                  <p>{d.webDetail}</p>
                </div>
              </div>
              <a className="button button-secondary" href={WEB_APP_URL}>
                {d.webAction} <Arrow />
              </a>
            </article>
          </section>
        </div>

        <p className="download-releases-note">
          {d.releasesPrefix}{" "}
          <a href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer">
            {d.releasesLink} <Arrow />
          </a>
          {d.releasesSuffix}
        </p>
      </div>

      <footer>
        <div className="shell footer-shell">
          {/* vinext currently hydrates next/link with a duplicate React instance. */}
          <a className="brand" href={localizedPath(locale, "/")} aria-label={c.aria.brandHome}>
            <span className="brand-mark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/briar-app-icon.png" alt="" />
            </span>
            <span>briar</span>
          </a>
          <p>{c.footer.tagline}</p>
          <div>
            <a href={localizedPath(locale, "/")}>{d.home}</a>
            <a href={localizedPath(locale, "/tutorial")}>{c.nav.tutorial}</a>
            <a href={localizedPath(locale, "/changelog")}>{c.nav.changelog}</a>
            <a href="#top">{d.backTop}</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
