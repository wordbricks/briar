import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production Worker keeps the bindings required by the rendered site", async () => {
  const configUrl = new URL("../dist/server/wrangler.json", import.meta.url);
  const config = JSON.parse(await readFile(configUrl, "utf8"));

  assert.equal(config.assets?.binding, "ASSETS");
  assert.equal(config.images?.binding, "IMAGES");
  assert.ok(config.assets?.run_worker_first?.includes("/_vinext/image"));
  assert.ok(config.assets?.run_worker_first?.includes("/docs/*"));
});

async function render({ acceptLanguage, cookie, path = "/" } = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const requestHeaders = new Headers({
    accept: "text/html",
    host: "localhost",
  });

  if (acceptLanguage) requestHeaders.set("accept-language", acceptLanguage);
  if (cookie) requestHeaders.set("cookie", cookie);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: requestHeaders }),
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

test("locale routing respects the URL, browser language, and saved preference", async () => {
  const browserRedirect = await render({ acceptLanguage: "ko-KR,ko;q=0.9" });
  assert.equal(browserRedirect.status, 307);
  assert.equal(browserRedirect.headers.get("location"), "http://localhost/ko");

  const explicitLocale = await render({
    acceptLanguage: "en-US,en;q=0.9",
    path: "/zh",
  });
  assert.equal(explicitLocale.status, 200);
  assert.match(await explicitLocale.text(), /<html lang="zh"[\s>]/i);

  const savedPreference = await render({
    acceptLanguage: "ko-KR,ko;q=0.9",
    cookie: "briar-locale=en",
  });
  assert.equal(savedPreference.status, 200);
  assert.match(await savedPreference.text(), /<html lang="en"[\s>]/i);

  const unsupportedLocale = await render({ acceptLanguage: "ja-JP" });
  assert.equal(unsupportedLocale.status, 200);
  assert.match(await unsupportedLocale.text(), /<html lang="en"[\s>]/i);
});

test("every public route server-renders in every supported locale", async () => {
  const routes = [
    "",
    "/tutorial",
    "/docs",
    "/docs/get-started",
    "/docs/webhooks",
    "/changelog",
    "/blog",
    "/download",
  ];

  for (const locale of ["en", "ko", "zh"]) {
    for (const route of routes) {
      const prefix = locale === "en" ? "" : `/${locale}`;
      const response = await render({ path: `${prefix}${route}` || "/" });
      assert.equal(response.status, 200, `${locale}${route}`);
      assert.match(
        await response.text(),
        new RegExp(`<html lang="${locale}"[\\s>]`, "i"),
      );
    }
  }
});

function assertWellFormedXml(xml) {
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  const stack = [];
  const tagPattern = /<(\/?)([a-zA-Z0-9:_-]+)([^>]*?)(\/?)>/g;
  let match = tagPattern.exec(xml);
  while (match) {
    const [, isClosing, tagName, , isSelfClosing] = match;
    if (isClosing) {
      assert.equal(stack.pop(), tagName, `mismatched closing tag </${tagName}>`);
    } else if (!isSelfClosing) {
      stack.push(tagName);
    }
    match = tagPattern.exec(xml);
  }
  assert.deepEqual(stack, []);
}

test("robots and sitemap keep crawlers out of the app while indexing public routes", async () => {
  const robotsResponse = await render({ path: "/robots.txt" });
  assert.equal(robotsResponse.status, 200);
  const robots = await robotsResponse.text();
  assert.match(robots, /Disallow: \/app/);
  assert.match(robots, /Sitemap: http:\/\/localhost\/sitemap\.xml/);

  const sitemapResponse = await render({ path: "/sitemap.xml" });
  assert.equal(sitemapResponse.status, 200);
  const sitemap = await sitemapResponse.text();
  assertWellFormedXml(sitemap);
  assert.doesNotMatch(sitemap, /<loc>[^<]*\/app/);

  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => match[1],
  );
  assert.equal(locations.length, 24);
  assert.equal(new Set(locations).size, locations.length);

  const urlBlocks = sitemap.match(/<url>[\s\S]*?<\/url>/g) ?? [];
  assert.equal(urlBlocks.length, locations.length);
  for (const block of urlBlocks) {
    for (const locale of ["en", "ko", "zh", "x-default"]) {
      assert.match(block, new RegExp(`hreflang="${locale}"`));
    }
  }
});
