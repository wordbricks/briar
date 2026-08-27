import { describe, expect, it } from "vitest";
import { fetchChannelLinkPreview, safeExternalUrl } from "./link-preview";

describe("channel link preview fetching", () => {
  it("parses Open Graph metadata and resolves relative assets", async () => {
    let requestedUrl = "";
    const response = await fetchChannelLinkPreview(
      "https://news.example.com/articles/42",
      async (input, init) => {
        requestedUrl = String(input);
        expect(init?.redirect).toBe("manual");
        expect(new Headers(init?.headers).get("accept")).toContain("text/html");
        return new Response(`
          <html><head>
            <title>Fallback title</title>
            <meta property="og:title" content="&quot;Open&quot; News">
            <meta property="og:description" content="A useful summary.">
            <meta property="og:site_name" content="News &amp; Co.">
            <meta property="og:image" content="/images/hero.png">
            <link rel="icon" href="//cdn.example.org/favicon.ico">
          </head></html>
        `, { headers: { "content-type": "text/html; charset=utf-8" } });
      },
    );

    expect(requestedUrl).toBe("https://news.example.com/articles/42");
    expect(response).toEqual({
      url: "https://news.example.com/articles/42",
      title: '"Open" News',
      description: "A useful summary.",
      imageUrl: "https://news.example.com/images/hero.png",
      faviconUrl: "https://cdn.example.org/favicon.ico",
      siteName: "News & Co.",
    });
  });

  it("revalidates redirects before requesting the next URL", async () => {
    const requested: string[] = [];
    const response = await fetchChannelLinkPreview(
      "https://news.example.com/articles/42",
      async (input) => {
        requested.push(String(input));
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        });
      },
    );

    expect(response).toBeNull();
    expect(requested).toEqual(["https://news.example.com/articles/42"]);
  });

  it("rejects local, private, credential-bearing, and non-web targets", () => {
    expect(safeExternalUrl("http://127.0.0.1/")).toBeNull();
    expect(safeExternalUrl("http://[::1]/")).toBeNull();
    expect(safeExternalUrl("http://169.254.169.254/")).toBeNull();
    expect(safeExternalUrl("https://user:secret@news.example.com/"))
      .toBeNull();
    expect(safeExternalUrl("http://news.example.com:8080/"))
      .toBeNull();
    expect(safeExternalUrl("file:///etc/passwd")).toBeNull();
    expect(safeExternalUrl("https://news.example.com/"))
      ?.toEqual(new URL("https://news.example.com/"));
  });
});
