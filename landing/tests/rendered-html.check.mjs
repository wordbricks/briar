import assert from "node:assert/strict";
import test from "node:test";

async function render({ acceptLanguage, cookie } = {}) {
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
    new Request("http://localhost/", {
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
  assert.match(html, /class="kanban-board"/);
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
  assert.match(html, /class="kanban-board"/);
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
