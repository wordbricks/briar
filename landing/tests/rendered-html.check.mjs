import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production Worker config retains named asset and image bindings", async () => {
  const configUrl = new URL("../dist/server/wrangler.json", import.meta.url);
  const config = JSON.parse(await readFile(configUrl, "utf8"));

  assert.equal(config.assets?.binding, "ASSETS");
  assert.equal(config.assets?.directory, "../client");
  assert.equal(config.images?.binding, "IMAGES");
  assert.ok(config.assets?.run_worker_first?.includes("/_vinext/image"));
});

async function render({ acceptLanguage, cookie, path = "/" } = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const requestHeaders = new Headers({
    accept: "text/html",
    host: "localhost",
  });

  if (acceptLanguage) {
    requestHeaders.set("accept-language", acceptLanguage);
  }

  if (cookie) {
    requestHeaders.set("cookie", cookie);
  }

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: requestHeaders,
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

function headerNavigationBlocks(html) {
  const header = html.match(
    /<header class="site-header(?: [^"]+)?">([\s\S]*?)<\/header>/,
  )?.[1] ?? "";
  return [...header.matchAll(/<nav aria-label="[^"]+">([\s\S]*?)<\/nav>/g)]
    .map((match) => match[1]);
}

function navigationHrefs(markup) {
  return [...markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>/g)]
    .map((match) => match[1]);
}

function currentNavigationHrefs(markup) {
  return [...markup.matchAll(/<a\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => /\baria-current="page"/.test(tag))
    .map((tag) => tag.match(/\bhref="([^"]+)"/)?.[1])
    .filter(Boolean);
}

/**
 * Minimal well-formedness check for the sitemap: a real stack-based tag
 * matcher (open/close balance, no dangling tags), not a substring check.
 * Good enough for our own generated XML without pulling in an XML library.
 */
function assertWellFormedXml(xml) {
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  const tagPattern = /<(\/?)([a-zA-Z0-9:_-]+)([^>]*?)(\/?)>/g;
  const stack = [];
  let match = tagPattern.exec(xml);
  while (match) {
    const [, isClosing, tagName, , isSelfClosing] = match;
    if (isClosing) {
      const last = stack.pop();
      assert.equal(
        last,
        tagName,
        `mismatched closing tag </${tagName}>, expected </${last}>`,
      );
    } else if (!isSelfClosing) {
      stack.push(tagName);
    }
    match = tagPattern.exec(xml);
  }
  assert.deepEqual(stack, [], `unclosed tags remained: ${stack.join(", ")}`);
}

test("redirects a Korean-browser visitor from / to /ko", async () => {
  const response = await render({ acceptLanguage: "ko-KR,ko;q=0.9" });
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost/ko");
});

test("server-renders Korean at /ko regardless of Accept-Language", async () => {
  // Deliberately send an English Accept-Language header: the URL alone
  // must decide the locale here, never the header.
  const response = await render({
    acceptLanguage: "en-US,en;q=0.9",
    path: "/ko",
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko"[\s>]/i);
  assert.match(html, /Briar — 로컬 실행형 Agent Development Environment/);
  assert.match(html, /이슈에서 PR까지/);
  assert.match(html, /에이전트 작업을 운영하세요/);
  assert.match(html, /코드는 로컬에/);
  assert.match(html, /에이전트 이벤트 스트림 연결/);
  assert.doesNotMatch(html, /hero-art|briar-hero-orchestration/);
  assert.match(html, /<video[^>]*autoplay[^>]*loop[^>]*muted[^>]*playsinline/i);
  assert.match(html, /briar-x-demo-20s\.mp4/);
  assert.match(html, /class="product-stage product-stage-video"/);
  assert.match(html, /class="detail-properties"/);
  assert.match(html, /Mac용 Briar 다운로드/);
  assert.match(html, /macOS Apple Silicon/);
  assert.match(html, /Android용 다운로드/);
  assert.match(html, /Android 컴패니언/);
  // Hero feature chips: previously hardcoded English that must now be
  // translated (or, for pure proper nouns, intentionally identical).
  assert.match(html, /저장소 무관/);
  assert.match(html, /Codex \+ Claude/);
  assert.match(html, /로컬 실행/);
  assert.doesNotMatch(html, /Repository-agnostic/);
  assert.doesNotMatch(html, /local-first/i);
  // Section-index eyebrows must pull from the Korean nav vocabulary
  // instead of leaking hardcoded English category words.
  assert.match(html, /01 \/ (?:<!-- -->)?제품/);
  assert.match(html, /02 \/ (?:<!-- -->)?워크플로/);
  assert.match(html, /03 \/ (?:<!-- -->)?에이전트/);
  assert.match(html, /04 \/ (?:<!-- -->)?보안/);
  assert.doesNotMatch(html, /01 \/ (?:<!-- -->)?PRODUCT/);
  assert.doesNotMatch(html, /02 \/ (?:<!-- -->)?WORKFLOW/);
  assert.doesNotMatch(html, /03 \/ (?:<!-- -->)?AGENTS/);
  assert.doesNotMatch(html, /04 \/ (?:<!-- -->)?SECURITY/);
  // Decorative issue-detail chrome mirrors the real (Korean-first) app UI.
  assert.match(html, /증빙/);
  assert.match(html, /속성/);
  assert.match(html, /높은 우선순위/);
  assert.doesNotMatch(html, />Evidence</);
  assert.doesNotMatch(html, />Properties</);
  assert.match(html, /aria-label="언어"/);
  assert.match(html, /aria-pressed="true"[^>]*aria-label="한국어"/);
  assert.match(
    html,
    /https:\/\/briar-api\.wbai\.workers\.dev\/releases\/latest\/mac-aarch64\.dmg/,
  );
  assert.match(
    html,
    /https:\/\/github\.com\/wordbricks\/briar\/releases\/latest/,
  );
  assert.match(html, /최신 릴리즈 · macOS Apple Silicon · Android 컴패니언/);
  assert.match(html, /https:\/\/github\.com\/wordbricks\/briar/);
  assert.match(html, /http:\/\/localhost\/og-briar-workflow\.png/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
  assert.doesNotMatch(html, /theme-toggle|briar-theme/i);
  // Header nav and footer must point at the /ko-prefixed pages, not the
  // unprefixed English ones.
  assert.match(html, /href="\/ko\/tutorial"/);
  assert.match(html, /href="\/ko\/blog"/);
  assert.match(html, /href="\/ko\/download"/);
});

test("server-renders English for an English browser", async () => {
  const response = await render({ acceptLanguage: "en-US,en;q=0.9" });
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<html lang="en"[\s>]/i);
  assert.match(
    html,
    /Briar — Agent Development Environment/,
  );
  assert.match(html, /From issue to PR\./);
  assert.match(html, /Operate your agent work\./);
  assert.match(html, /Turn agent development/);
  assert.doesNotMatch(html, /hero-art|briar-hero-orchestration/);
  assert.match(html, /<video[^>]*autoplay[^>]*loop[^>]*muted[^>]*playsinline/i);
  assert.match(html, /briar-x-demo-20s\.mp4/);
  assert.match(html, /class="product-stage product-stage-video"/);
  assert.match(html, /class="detail-properties"/);
  assert.match(html, /Download Briar for Mac/);
  assert.match(html, /Repository-agnostic/);
  assert.match(html, /Local execution/);
  assert.doesNotMatch(html, /local-first/i);
  assert.match(html, /01 \/ (?:<!-- -->)?PRODUCT/);
  assert.match(html, /02 \/ (?:<!-- -->)?WORKFLOW/);
  assert.match(html, /03 \/ (?:<!-- -->)?AGENTS/);
  assert.match(html, /04 \/ (?:<!-- -->)?SECURITY/);
  assert.match(html, /aria-label="Language"/);
  assert.match(html, /aria-pressed="true"[^>]*aria-label="English"/);
  assert.match(html, /data-download-platform="macos"/);
  assert.match(html, /data-download-architecture="arm64"/);
});

test("falls back to English when the browser language is unsupported", async () => {
  const response = await render({ acceptLanguage: "ja-JP,ko;q=0.9" });
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<html lang="en"[\s>]/i);
  assert.match(html, /From issue to PR\./);
});

test("a saved ko cookie convenience-redirects the unprefixed / to /ko", async () => {
  const response = await render({
    acceptLanguage: "en-US,en;q=0.9",
    cookie: "briar-locale=ko",
  });
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost/ko");
});

test("a saved en cookie keeps an English browser on the unprefixed /", async () => {
  const response = await render({
    acceptLanguage: "ko-KR,ko;q=0.9",
    cookie: "briar-locale=en",
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<html lang="en"[\s>]/i);
});

test("/ko is reachable directly without any cookie or Accept-Language", async () => {
  // A crawler or a shared link has neither — the URL alone must still work.
  const response = await render({ path: "/ko" });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<html lang="ko"[\s>]/i);
});

test("server-renders the localized tutorial at /ko/tutorial with captured product screens", async () => {
  const response = await render({ path: "/ko/tutorial" });
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<html lang="ko"[\s>]/i);
  assert.match(html, /첫 이슈부터/);
  assert.match(html, /검증된 결과까지/);
  assert.match(html, /요청을 실행 가능한 이슈로 만드세요/);
  assert.match(html, /이슈 처리 에이전트가 대기 이슈를 자동으로 처리하게 하세요/);
  assert.match(html, /이슈 상세에서 깔끔하게 정리된 결과를 확인하세요/);
  assert.match(html, /완료라는 말보다 근거를 확인하세요/);
  assert.match(html, /\/tutorial\/01-create-issue\.webp/);
  assert.match(html, /\/tutorial\/07-run-auto-hunt\.webp/);
  assert.match(html, /\/tutorial\/08-result\.webp/);
  assert.match(html, /\/tutorial\/04-evidence\.webp/);
  assert.match(html, /\/tutorial\/06-schedule\.webp/);
  assert.match(html, /briar · 로컬 데모/);
  // Body copy referencing real app UI labels must use the app's own
  // Korean terms (백로그/대기/분석/구현/작업 실행/증빙…), not the English ones.
  assert.match(html, /백로그로 둡니다/);
  assert.match(html, /(?:<!-- -->)?작업 실행(?:<!-- -->)?을 누릅니다/);
  assert.match(html, /증빙 탭은 워크플로/);
  assert.doesNotMatch(html, /New issue|Run Task|Work result|Next action|Not recorded/);
});

test("server-renders the localized download catalog at /ko/download", async () => {
  const response = await render({ path: "/ko/download" });
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<html lang="ko"[\s>]/i);
  assert.match(html, /Briar 다운로드/);
  assert.match(html, /Apple Silicon 다운로드/);
  assert.match(html, /Android 릴리즈 열기/);
  assert.match(html, /웹 앱 열기/);
  assert.match(
    html,
    /https:\/\/briar-api\.wbai\.workers\.dev\/releases\/latest\/mac-aarch64\.dmg/,
  );
  assert.match(
    html,
    /https:\/\/github\.com\/wordbricks\/briar\/releases\/latest/,
  );
  assert.match(html, /data-download-platform="macos"/);
  assert.match(html, /data-download-architecture="arm64"/);
});

test("loads the configured GA4 tag", async () => {
  const response = await render({ path: "/download" });
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(
    html,
    /https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-SQDQ3YZ6TL/,
  );
  assert.match(html, /gtag\('config',\s*"G-SQDQ3YZ6TL"\)/);
});

test("standard pages render the same canonical desktop and mobile navigation", async () => {
  const canonicalHrefs = ["/tutorial", "/changelog", "/blog", "/download"];
  const pages = [
    { path: "/", current: null, mobileExtras: [] },
    { path: "/download", current: "/download", mobileExtras: [] },
    {
      path: "/blog",
      current: "/blog",
      mobileExtras: ["https://github.com/wordbricks/briar"],
    },
    { path: "/changelog", current: "/changelog", mobileExtras: [] },
  ];

  for (const page of pages) {
    const response = await render({
      acceptLanguage: "en-US,en;q=0.9",
      path: page.path,
    });
    assert.equal(response.status, 200);
    const html = await response.text();
    const [desktopNavigation, mobileNavigation] = headerNavigationBlocks(html);

    assert.ok(desktopNavigation, `missing desktop navigation at ${page.path}`);
    assert.ok(mobileNavigation, `missing mobile navigation at ${page.path}`);
    assert.deepEqual(navigationHrefs(desktopNavigation), canonicalHrefs);
    assert.deepEqual(
      navigationHrefs(mobileNavigation),
      [...canonicalHrefs, ...page.mobileExtras],
    );
    const expectedCurrent = page.current ? [page.current] : [];
    assert.deepEqual(currentNavigationHrefs(desktopNavigation), expectedCurrent);
    assert.deepEqual(currentNavigationHrefs(mobileNavigation), expectedCurrent);
  }
});

test("tutorial keeps its custom anchor navigation on desktop and mobile", async () => {
  const response = await render({ path: "/tutorial" });
  assert.equal(response.status, 200);
  const html = await response.text();
  const [desktopNavigation, mobileNavigation] = headerNavigationBlocks(html);
  const tutorialHrefs = [
    "/",
    "#run-auto-hunt",
    "#review-result",
    "#schedule-agents",
  ];

  assert.deepEqual(navigationHrefs(desktopNavigation), tutorialHrefs);
  assert.deepEqual(navigationHrefs(mobileNavigation), tutorialHrefs);
});

test("server-renders the localized changelog from published releases", async () => {
  const koreanResponse = await render({ path: "/ko/changelog" });
  assert.equal(koreanResponse.status, 200);

  const koreanHtml = await koreanResponse.text();
  assert.match(koreanHtml, /<html lang="ko"[\s>]/i);
  assert.match(koreanHtml, /Briar 변경 기록/);
  assert.match(koreanHtml, /현재 안정 버전/);
  assert.match(koreanHtml, /프로젝트 현황과 에이전트 동기화를 한눈에 확인합니다/);
  assert.match(koreanHtml, /v1\.2\.108/);
  assert.match(koreanHtml, /모바일 채널을 자연스럽게 다듬고 반복 알림을 멈춥니다/);
  assert.match(koreanHtml, /v1\.2\.107/);
  assert.match(koreanHtml, /프로젝트를 바꿔도 모든 Inbox 알림을 놓치지 않습니다/);
  assert.match(koreanHtml, /v1\.2\.106/);
  assert.match(koreanHtml, /프로젝트 대화 에이전트가 실제 작업 환경에서 검증합니다/);
  assert.match(koreanHtml, /v1\.2\.105/);
  assert.match(koreanHtml, /실시간 협업과 에이전트 동기화를 더 가볍고 정확하게 만듭니다/);
  assert.match(koreanHtml, /프로젝트 에이전트 실행 승인을 더 안전하게 배포합니다/);
  assert.match(koreanHtml, /v1\.2\.104/);
  assert.match(koreanHtml, /v1\.2\.103/);
  assert.match(koreanHtml, /대화형 이슈와 에이전트 협업을 더 안전하게 운영합니다/);
  assert.match(koreanHtml, /v1\.2\.100/);
  assert.match(koreanHtml, /동시 작업과 긴 대화를 더 안정적으로 처리합니다/);
  assert.match(koreanHtml, /v1\.2\.99/);
  assert.match(koreanHtml, /대화와 실행 상태를 더 정확하게 확인합니다/);
  assert.match(koreanHtml, /v1\.2\.98/);
  assert.match(koreanHtml, /채널 메시지에 이모지로 바로 반응합니다/);
  assert.match(koreanHtml, /v1\.2\.97/);
  assert.match(koreanHtml, /v1\.2\.96/);
  assert.match(koreanHtml, /v1\.2\.95/);
  assert.match(koreanHtml, /v1\.2\.94/);
  assert.match(koreanHtml, /v1\.2\.93/);
  assert.match(koreanHtml, /v1\.2\.92/);
  assert.match(koreanHtml, /v1\.2\.91/);
  assert.match(koreanHtml, /v1\.2\.90/);
  assert.match(koreanHtml, /v1\.2\.89/);
  assert.match(koreanHtml, /v1\.2\.88/);
  assert.match(koreanHtml, /v1\.2\.87/);
  assert.match(koreanHtml, /v1\.2\.86/);
  assert.match(koreanHtml, /v1\.2\.85/);
  assert.match(koreanHtml, /v1\.2\.80/);
  assert.match(koreanHtml, /aria-current="page"[^>]*>변경 기록</);
  assert.match(
    koreanHtml,
    /href="https:\/\/github\.com\/wordbricks\/briar\/releases\/tag\/v1\.2\.103"/,
  );

  const englishResponse = await render({ path: "/changelog" });
  assert.equal(englishResponse.status, 200);

  const englishHtml = await englishResponse.text();
  assert.match(englishHtml, /<html lang="en"[\s>]/i);
  assert.match(englishHtml, /Briar changelog/);
  assert.match(englishHtml, /See project health and agent synchronization at a glance/);
  assert.match(englishHtml, /v1\.2\.108/);
  assert.match(englishHtml, /Refine mobile channels and stop repeated session alerts/);
  assert.match(englishHtml, /v1\.2\.107/);
  assert.match(englishHtml, /Keep every Inbox notification visible across projects/);
  assert.match(englishHtml, /v1\.2\.106/);
  assert.match(englishHtml, /Let project conversation agents verify work in a real runtime/);
  assert.match(englishHtml, /v1\.2\.105/);
  assert.match(englishHtml, /Make real-time collaboration and agent sync lighter and more precise/);
  assert.match(englishHtml, /Roll out Project Agent execution approvals safely/);
  assert.match(englishHtml, /v1\.2\.104/);
  assert.match(englishHtml, /Make conversational issues and agent collaboration safer/);
  assert.match(englishHtml, /Handle concurrent runs and long conversations more reliably/);
  assert.match(englishHtml, /See conversations and run status more clearly/);
  assert.match(englishHtml, /React to channel messages with any emoji/);
  assert.match(englishHtml, /Current stable release/);
});

test("server-renders the localized empty blog at /ko/blog", async () => {
  const response = await render({ path: "/ko/blog" });
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<html lang="ko"[\s>]/i);
  assert.match(html, /Briar 블로그/);
  assert.match(html, /첫 글을 준비하고 있어요/);
  assert.match(html, /aria-current="page"[^>]*>블로그</);
  assert.match(
    html,
    /href="https:\/\/github\.com\/wordbricks\/briar"[^>]*target="_blank"/,
  );
});

test("/ emits canonical + hreflang alternates (including x-default) for English", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(
    html,
    /<link rel="canonical" href="http:\/\/localhost\/"\s*\/>/,
  );
  assert.match(
    html,
    /<link rel="alternate" hrefLang="en" href="http:\/\/localhost\/"\s*\/>/,
  );
  assert.match(
    html,
    /<link rel="alternate" hrefLang="ko" href="http:\/\/localhost\/ko"\s*\/>/,
  );
  assert.match(
    html,
    /<link rel="alternate" hrefLang="x-default" href="http:\/\/localhost\/"\s*\/>/,
  );
});

test("/ko emits canonical + hreflang alternates pointing at each locale's own URL", async () => {
  const response = await render({ path: "/ko" });
  const html = await response.text();

  assert.match(
    html,
    /<link rel="canonical" href="http:\/\/localhost\/ko"\s*\/>/,
  );
  assert.match(
    html,
    /<link rel="alternate" hrefLang="en" href="http:\/\/localhost\/"\s*\/>/,
  );
  assert.match(
    html,
    /<link rel="alternate" hrefLang="ko" href="http:\/\/localhost\/ko"\s*\/>/,
  );
  assert.match(
    html,
    /<link rel="alternate" hrefLang="x-default" href="http:\/\/localhost\/"\s*\/>/,
  );
});

test("/tutorial and /ko/tutorial each carry their own canonical + hreflang pair", async () => {
  const en = await (await render({ path: "/tutorial" })).text();
  const ko = await (await render({ path: "/ko/tutorial" })).text();

  assert.match(
    en,
    /<link rel="canonical" href="http:\/\/localhost\/tutorial"\s*\/>/,
  );
  assert.match(
    en,
    /<link rel="alternate" hrefLang="ko" href="http:\/\/localhost\/ko\/tutorial"\s*\/>/,
  );
  assert.match(
    ko,
    /<link rel="canonical" href="http:\/\/localhost\/ko\/tutorial"\s*\/>/,
  );
  assert.match(
    ko,
    /<link rel="alternate" hrefLang="en" href="http:\/\/localhost\/tutorial"\s*\/>/,
  );
});

test("og:url and og:locale reflect the actual locale of the rendered page", async () => {
  const en = await (await render()).text();
  const ko = await (await render({ path: "/ko" })).text();

  assert.match(en, /<meta property="og:url" content="http:\/\/localhost\/"\s*\/>/);
  assert.match(en, /<meta property="og:locale" content="en_US"\s*\/>/);
  assert.match(
    en,
    /<meta property="og:locale:alternate" content="ko_KR"\s*\/>/,
  );

  assert.match(
    ko,
    /<meta property="og:url" content="http:\/\/localhost\/ko"\s*\/>/,
  );
  assert.match(ko, /<meta property="og:locale" content="ko_KR"\s*\/>/);
  assert.match(
    ko,
    /<meta property="og:locale:alternate" content="en_US"\s*\/>/,
  );
});

test("/robots.txt disallows the proxied web app and points at the sitemap", async () => {
  const response = await render({ path: "/robots.txt" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain\b/i);

  const body = await response.text();
  assert.match(body, /User-Agent: \*/);
  assert.match(body, /Allow: \//);
  assert.match(body, /Disallow: \/app/);
  assert.match(body, /Sitemap: http:\/\/localhost\/sitemap\.xml/);
});

test("/sitemap.xml is well-formed and lists every route in every locale", async () => {
  const response = await render({ path: "/sitemap.xml" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/xml\b/i);

  const xml = await response.text();
  assertWellFormedXml(xml);

  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(
    locations.sort(),
    [
      "http://localhost/",
      "http://localhost/blog",
      "http://localhost/changelog",
      "http://localhost/download",
      "http://localhost/ko",
      "http://localhost/ko/blog",
      "http://localhost/ko/changelog",
      "http://localhost/ko/download",
      "http://localhost/ko/tutorial",
      "http://localhost/tutorial",
    ].sort(),
  );

  // The proxied web app must never be listed.
  assert.doesNotMatch(xml, /\/app\//);

  // Every <url> entry carries the full hreflang set, including x-default.
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
  assert.equal(urlBlocks.length, 10);
  for (const block of urlBlocks) {
    assert.match(block, /hreflang="en"/);
    assert.match(block, /hreflang="ko"/);
    assert.match(block, /hreflang="x-default"/);
  }
});
