import assert from "node:assert/strict";
import test from "node:test";

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

test("server-renders Korean for a Korean browser", async () => {
  const response = await render({ acceptLanguage: "ko-KR,ko;q=0.9" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko">/i);
  assert.match(html, /Briar — 에이전트 개발의 운영체제/);
  assert.match(html, /이슈에서 PR까지/);
  assert.match(html, /에이전트 작업을 운영하세요/);
  assert.match(html, /코드는 로컬에/);
  assert.match(html, /에이전트 이벤트 스트림 연결/);
  assert.match(html, /briar-hero-orchestration\.webp/);
  assert.match(html, /<video[^>]*autoplay[^>]*loop[^>]*muted[^>]*playsinline/i);
  assert.match(html, /briar-x-demo-20s\.mp4/);
  assert.match(html, /class="product-stage product-stage-video"/);
  assert.match(html, /class="detail-properties"/);
  assert.match(html, /Mac용 Briar 다운로드/);
  assert.match(html, /macOS Apple Silicon/);
  assert.match(html, /Android용 다운로드/);
  assert.match(html, /Android companion/);
  assert.match(html, /aria-label="언어"/);
  assert.match(html, /aria-label="테마: 다크 모드로 전환"/);
  assert.match(html, />라이트</);
  assert.match(html, />다크</);
  assert.match(html, /briar-theme/);
  assert.match(html, /aria-pressed="true"[^>]*aria-label="한국어"/);
  assert.match(
    html,
    /https:\/\/briar-api\.wbai\.workers\.dev\/releases\/latest\/mac-aarch64\.dmg/,
  );
  assert.match(
    html,
    /https:\/\/github\.com\/wordbricks\/briar\/releases\/latest/,
  );
  assert.match(html, /최신 릴리즈 · macOS Apple Silicon · Android companion/);
  assert.match(html, /https:\/\/github\.com\/wordbricks\/briar/);
  assert.match(html, /http:\/\/localhost\/og-briar-workflow\.png/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("server-renders English for an English browser", async () => {
  const response = await render({ acceptLanguage: "en-US,en;q=0.9" });
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<html lang="en">/i);
  assert.match(
    html,
    /Briar — The operating system for agent development/,
  );
  assert.match(html, /From issue to PR\./);
  assert.match(html, /Operate your agent work\./);
  assert.match(html, /Turn agent development/);
  assert.match(html, /briar-hero-orchestration\.webp/);
  assert.match(html, /<video[^>]*autoplay[^>]*loop[^>]*muted[^>]*playsinline/i);
  assert.match(html, /briar-x-demo-20s\.mp4/);
  assert.match(html, /class="product-stage product-stage-video"/);
  assert.match(html, /class="detail-properties"/);
  assert.match(html, /Download Briar for Mac/);
  assert.match(html, /aria-label="Language"/);
  assert.match(html, /aria-label="Theme: Switch to dark mode"/);
  assert.match(html, />Light</);
  assert.match(html, />Dark</);
  assert.match(html, /aria-pressed="true"[^>]*aria-label="English"/);
});

test("falls back to English when the browser language is unsupported", async () => {
  const response = await render({ acceptLanguage: "ja-JP,ko;q=0.9" });
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<html lang="en">/i);
  assert.match(html, /From issue to PR\./);
});

test("saved language choice overrides the browser language", async () => {
  const response = await render({
    acceptLanguage: "en-US,en;q=0.9",
    cookie: "briar-locale=ko",
  });
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<html lang="ko">/i);
  assert.match(html, /이슈에서 PR까지/);
});

test("server-renders the localized tutorial with captured product screens", async () => {
  const response = await render({
    acceptLanguage: "ko-KR,ko;q=0.9",
    path: "/tutorial",
  });
  assert.equal(response.status, 200);

  const html = await response.text();
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
});

test("server-renders the localized download catalog", async () => {
  const response = await render({
    acceptLanguage: "ko-KR,ko;q=0.9",
    path: "/download",
  });
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<html lang="ko">/i);
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
});

test("landing header links to tutorial, changelog, blog, and download without section navigation", async () => {
  const response = await render({ acceptLanguage: "en-US,en;q=0.9" });
  const html = await response.text();
  const header = html.match(/<header class="site-header">([\s\S]*?)<\/header>/)?.[1] ?? "";

  assert.match(header, /href="\/tutorial"/);
  assert.match(header, /href="\/changelog"/);
  assert.match(header, /href="\/blog"/);
  assert.match(header, /href="\/download"/);
  assert.doesNotMatch(header, /href="#(?:product|workflow|security|agents)"/);
});

test("server-renders the localized changelog from published releases", async () => {
  const koreanResponse = await render({
    acceptLanguage: "ko-KR,ko;q=0.9",
    path: "/changelog",
  });
  assert.equal(koreanResponse.status, 200);

  const koreanHtml = await koreanResponse.text();
  assert.match(koreanHtml, /<html lang="ko">/i);
  assert.match(koreanHtml, /Briar 변경 기록/);
  assert.match(koreanHtml, /현재 안정 버전/);
  assert.match(koreanHtml, /조직 에이전트와 채널 실행 흐름을 확장했습니다/);
  assert.match(koreanHtml, /v1\.2\.87/);
  assert.match(koreanHtml, /v1\.2\.86/);
  assert.match(koreanHtml, /v1\.2\.85/);
  assert.match(koreanHtml, /v1\.2\.80/);
  assert.match(koreanHtml, /aria-current="page"[^>]*>변경 기록</);
  assert.match(
    koreanHtml,
    /href="https:\/\/github\.com\/wordbricks\/briar\/releases\/tag\/v1\.2\.87"/,
  );

  const englishResponse = await render({
    acceptLanguage: "en-US,en;q=0.9",
    path: "/changelog",
  });
  assert.equal(englishResponse.status, 200);

  const englishHtml = await englishResponse.text();
  assert.match(englishHtml, /<html lang="en">/i);
  assert.match(englishHtml, /Briar changelog/);
  assert.match(englishHtml, /Organization agents and channel execution, connected/);
  assert.match(englishHtml, /Current stable release/);
});

test("server-renders the localized empty blog", async () => {
  const response = await render({
    acceptLanguage: "ko-KR,ko;q=0.9",
    path: "/blog",
  });
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<html lang="ko">/i);
  assert.match(html, /Briar 블로그/);
  assert.match(html, /첫 글을 준비하고 있어요/);
  assert.match(html, /aria-current="page"[^>]*>블로그</);
  assert.match(
    html,
    /href="https:\/\/github\.com\/wordbricks\/briar"[^>]*target="_blank"/,
  );
});
