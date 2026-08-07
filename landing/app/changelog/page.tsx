import type { Metadata } from "next";
import { copy, type Locale } from "../i18n";
import { LanguageSwitcher } from "../language-switcher";
import { getRequestLocale } from "../request-locale";
import { ThemeToggle } from "../theme-toggle";

const WEB_APP_URL = "/app/";
const GITHUB_RELEASES_URL = "https://github.com/wordbricks/briar/releases";

const changelogCopy = {
  ko: {
    metadata: {
      title: "Briar 변경 기록 — 새로운 기능과 개선 사항",
      description:
        "Briar의 최신 데스크톱, 채널, 모바일, 에이전트 워크플로 업데이트를 확인하세요.",
    },
    eyebrow: "PRODUCT UPDATES",
    title: "Briar 변경 기록",
    description:
      "사람과 에이전트가 더 선명하게 협업할 수 있도록 바뀐 기능과 개선 사항을 기록합니다.",
    current: "현재 안정 버전",
    latest: "최신",
    released: "출시",
    openApp: "Briar 열기",
    allReleases: "전체 릴리즈 보기",
    releaseNotes: "GitHub 릴리즈 열기",
    home: "홈",
    backTop: "맨 위로 ↑",
    entries: [
      {
        version: "1.2.85",
        date: "2026년 8월 7일",
        title: "채널 협업이 더 풍부해졌습니다",
        summary:
          "이미지, 초대, 메시지 관리, 계획 문서를 채널 안에서 자연스럽게 다룰 수 있도록 협업 흐름을 확장했습니다.",
        items: [
          "채널 메시지에 이미지를 첨부하고 에이전트 비전 입력으로 전달할 수 있습니다.",
          "채널 초대 대화상자와 메시지 편집·삭제 기능을 추가했습니다.",
          "Ideas를 채널 계획 문서로 통합해 대화와 실행 계획을 한곳에 모았습니다.",
          "이슈 이미지 편집, 오류 토스트, 담당자·Worker 아바타와 실행 버튼을 개선했습니다.",
          "Briar를 Apache License 2.0으로 공개했습니다.",
        ],
      },
      {
        version: "1.2.84",
        date: "2026년 8월 7일",
        title: "데스크톱 채널 대화를 새롭게 설계했습니다",
        summary:
          "채널 목록부터 대화 스레드까지 정보 밀도와 읽기 흐름을 다듬어 팀 대화를 더 빠르게 파악할 수 있습니다.",
        items: [
          "데스크톱 채널 대화 화면의 구조와 시각적 계층을 전면 개선했습니다.",
          "채널과 프로젝트 맥락을 오가며 대화 내용을 더 쉽게 추적할 수 있습니다.",
        ],
      },
      {
        version: "1.2.83",
        date: "2026년 8월 7일",
        title: "멘션 선택이 더 빠르고 정확해졌습니다",
        summary:
          "채널에서 사람과 에이전트를 호출할 때 필요한 대상을 더 쉽게 찾고 선택할 수 있습니다.",
        items: [
          "채널 멘션 선택기의 탐색과 선택 경험을 개선했습니다.",
          "PR 전 빠른 검증 절차를 문서에 명확히 정리했습니다.",
        ],
      },
      {
        version: "1.2.82",
        date: "2026년 8월 7일",
        title: "모바일 이슈 식별자를 더 간결하게 표시합니다",
        summary:
          "작은 화면에서도 이슈 번호와 상태를 빠르게 읽을 수 있도록 불필요한 표기를 정리했습니다.",
        items: [
          "모바일 이슈 키의 천 단위 쉼표를 제거했습니다.",
          "이슈 키 옆의 중복 단계 아이콘을 제거해 목록 가독성을 높였습니다.",
        ],
      },
      {
        version: "1.2.81",
        date: "2026년 8월 7일",
        title: "이슈 생성과 프로젝트 동기화를 안정화했습니다",
        summary:
          "언어별 제목 규칙과 프로젝트 선택을 바로잡고 앱 시작 시 로컬 워크플로 상태를 신뢰할 수 있게 맞췄습니다.",
        items: [
          "언어 특성을 고려해 이슈 제목 길이 제한을 적용합니다.",
          "클릭한 프로젝트가 새 이슈 대화상자에 정확히 선택됩니다.",
          "앱 시작 시 로컬 프로젝트 워크플로를 자동으로 동기화합니다.",
        ],
      },
      {
        version: "1.2.80",
        date: "2026년 8월 7일",
        title: "모바일과 데스크톱 채널 화면을 넓게 다듬었습니다",
        summary:
          "기기 크기에 맞춰 채널 대화가 자연스럽게 확장되도록 레이아웃과 빌드 호환성을 개선했습니다.",
        items: [
          "모바일 채널 대화 화면의 탐색과 메시지 레이아웃을 개선했습니다.",
          "데스크톱 채널 UI가 사용 가능한 셸 너비를 모두 활용합니다.",
          "iOS 채널 빌드 호환성을 복구했습니다.",
        ],
      },
    ],
  },
  en: {
    metadata: {
      title: "Briar changelog — New features and improvements",
      description:
        "See the latest updates to Briar desktop, channels, mobile, and agent workflows.",
    },
    eyebrow: "PRODUCT UPDATES",
    title: "Briar changelog",
    description:
      "A running record of the features and improvements that make collaboration between people and agents clearer.",
    current: "Current stable release",
    latest: "Latest",
    released: "Released",
    openApp: "Open Briar",
    allReleases: "View all releases",
    releaseNotes: "Open GitHub release",
    home: "Home",
    backTop: "Back to top ↑",
    entries: [
      {
        version: "1.2.85",
        date: "August 7, 2026",
        title: "Richer collaboration in channels",
        summary:
          "Channels now bring images, invitations, message controls, and planning documents into one connected collaboration flow.",
        items: [
          "Attach images to channel messages and pass them into agent vision input.",
          "Invite members to channels and edit or delete channel messages.",
          "Plans have moved from Ideas into channel documents, keeping discussion and execution together.",
          "Improved issue image editing, error toasts, and assignee and worker controls.",
          "Briar is now available under the Apache License 2.0.",
        ],
      },
      {
        version: "1.2.84",
        date: "August 7, 2026",
        title: "A redesigned desktop channel conversation",
        summary:
          "The channel list and conversation thread now use a clearer hierarchy so teams can understand active discussions faster.",
        items: [
          "Redesigned the structure and visual hierarchy of desktop channel conversations.",
          "Made it easier to follow conversations across channel and project context.",
        ],
      },
      {
        version: "1.2.83",
        date: "August 7, 2026",
        title: "Faster, more precise mentions",
        summary:
          "Finding and selecting the right person or agent in a channel is now more direct.",
        items: [
          "Improved navigation and selection in the channel mention picker.",
          "Clarified the fastest pre-PR verification path in the documentation.",
        ],
      },
      {
        version: "1.2.82",
        date: "August 7, 2026",
        title: "Cleaner mobile issue identifiers",
        summary:
          "Issue numbers and state are easier to scan on smaller screens with redundant formatting removed.",
        items: [
          "Removed thousands separators from mobile issue keys.",
          "Removed the duplicate stage icon beside issue keys for a cleaner list.",
        ],
      },
      {
        version: "1.2.81",
        date: "August 7, 2026",
        title: "More reliable issue creation and project sync",
        summary:
          "Language-aware title rules, project selection, and startup synchronization now behave consistently.",
        items: [
          "Apply issue title limits that account for the writing language.",
          "Preselect the project that opened the new issue dialog.",
          "Synchronize local project workflows when the app starts.",
        ],
      },
      {
        version: "1.2.80",
        date: "August 7, 2026",
        title: "Roomier channel views across mobile and desktop",
        summary:
          "Channel conversations now adapt more naturally to each screen size, with improved layout and build compatibility.",
        items: [
          "Improved mobile channel navigation and message layout.",
          "Let the desktop channel UI fill the available shell width.",
          "Restored iOS channel build compatibility.",
        ],
      },
    ],
  },
} as const satisfies Record<Locale, unknown>;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return changelogCopy[locale].metadata;
}

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

export default async function ChangelogPage() {
  const locale = await getRequestLocale();
  const c = copy[locale];
  const changelog = changelogCopy[locale];

  return (
    <main className="changelog-page" id="top">
      <header className="site-header changelog-header">
        <div className="shell nav-shell">
          {/* vinext currently hydrates next/link with a duplicate React instance. */}
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
            <a className="is-current" href="/changelog" aria-current="page">
              {c.nav.changelog}
            </a>
            <a href="/blog">{c.nav.blog}</a>
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
              {changelog.openApp} <Arrow />
            </a>
          </div>
        </div>
      </header>

      <section className="changelog-hero shell">
        <div>
          <span className="section-index">{changelog.eyebrow}</span>
          <h1>{changelog.title}</h1>
          <p>{changelog.description}</p>
        </div>
        <a href="#v1-2-85" className="changelog-current">
          <span>{changelog.current}</span>
          <strong>v1.2.85</strong>
          <i aria-hidden="true">↓</i>
        </a>
      </section>

      <section className="changelog-list shell" aria-label={changelog.title}>
        {changelog.entries.map((entry, index) => {
          const tagUrl = `${GITHUB_RELEASES_URL}/tag/v${entry.version}`;
          const entryId = `v${entry.version.replaceAll(".", "-")}`;
          return (
            <article
              className={`changelog-entry${index === 0 ? " is-latest" : ""}`}
              id={entryId}
              key={entry.version}
            >
              <div className="changelog-entry-index" aria-hidden="true">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <i />
              </div>
              <div className="changelog-entry-body">
                <div className="changelog-entry-meta">
                  <strong>v{entry.version}</strong>
                  {index === 0 ? <span>{changelog.latest}</span> : null}
                  <time dateTime="2026-08-07">
                    {changelog.released} · {entry.date}
                  </time>
                </div>
                <h2>{entry.title}</h2>
                <p>{entry.summary}</p>
                <ul>
                  {entry.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <a href={tagUrl} target="_blank" rel="noreferrer">
                  {changelog.releaseNotes} <Arrow />
                </a>
              </div>
            </article>
          );
        })}
      </section>

      <section className="changelog-archive shell">
        <span className="section-index">RELEASE ARCHIVE</span>
        <a href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer">
          {changelog.allReleases} <Arrow />
        </a>
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
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/">{changelog.home}</a>
            <a href="/tutorial">{c.nav.tutorial}</a>
            <a href="/download">{c.nav.download}</a>
            <a href="#top">{changelog.backTop}</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
