import { describe, expect, it } from "vitest";
import { fetchChannelLinkPreview, safeExternalUrl } from "./link-preview";

const pngHeader = (width: number, height: number) => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([..."IHDR"].map((char) => char.charCodeAt(0)), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
};

const htmlResponse = (body: string) =>
  new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

describe("channel link preview fetching", () => {
  it("parses Open Graph metadata and resolves relative assets", async () => {
    const requested: string[] = [];
    const response = await fetchChannelLinkPreview(
      "https://news.example.com/articles/42",
      async (input, init) => {
        requested.push(String(input));
        expect(init?.redirect).toBe("manual");
        if (requested.length > 1) {
          return new Response(null, { status: 404 });
        }
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

    expect(requested[0]).toBe("https://news.example.com/articles/42");
    expect(response).toEqual({
      url: "https://news.example.com/articles/42",
      title: '"Open" News',
      description: "A useful summary.",
      imageUrl: "https://news.example.com/images/hero.png",
      faviconUrl: "https://cdn.example.org/favicon.ico",
      siteName: "News & Co.",
      imageWidth: null,
      imageHeight: null,
    });
  });

  it("keeps published og:image dimensions without touching the image", async () => {
    const requested: string[] = [];
    const response = await fetchChannelLinkPreview(
      "https://news.example.com/articles/42",
      async (input) => {
        requested.push(String(input));
        return htmlResponse(`
          <html><head>
            <meta property="og:title" content="Sized">
            <meta property="og:image" content="https://cdn.example.org/hero.png">
            <meta property="og:image:width" content="1200">
            <meta property="og:image:height" content="630">
          </head></html>
        `);
      },
    );

    expect(requested).toEqual(["https://news.example.com/articles/42"]);
    expect(response?.imageWidth).toBe(1_200);
    expect(response?.imageHeight).toBe(630);
  });

  it("reads the image header when the page publishes no dimensions", async () => {
    const requests: Array<{ url: string; range: string | null }> = [];
    const response = await fetchChannelLinkPreview(
      "https://news.example.com/articles/42",
      async (input, init) => {
        const url = String(input);
        requests.push({
          url,
          range: new Headers(init?.headers).get("range"),
        });
        if (url.endsWith("/hero.png")) {
          return new Response(pngHeader(1_600, 900), {
            status: 206,
            headers: { "content-type": "image/png" },
          });
        }
        return htmlResponse(`
          <html><head>
            <meta property="og:title" content="Unsized">
            <meta property="og:image" content="https://cdn.example.org/hero.png">
          </head></html>
        `);
      },
    );

    expect(requests.map(({ url }) => url)).toEqual([
      "https://news.example.com/articles/42",
      "https://cdn.example.org/hero.png",
    ]);
    expect(requests[1]?.range).toBe("bytes=0-65535");
    expect(response?.imageWidth).toBe(1_600);
    expect(response?.imageHeight).toBe(900);
  });

  it("leaves dimensions unknown when the image body cannot be parsed", async () => {
    const response = await fetchChannelLinkPreview(
      "https://news.example.com/articles/42",
      async (input) =>
        String(input).endsWith("/hero.png")
          ? new Response("<!doctype html><p>error page</p>", {
              headers: { "content-type": "text/html" },
            })
          : htmlResponse(`
              <html><head>
                <meta property="og:title" content="Broken image">
                <meta property="og:image" content="https://cdn.example.org/hero.png">
              </head></html>
            `),
    );

    expect(response?.imageUrl).toBe("https://cdn.example.org/hero.png");
    expect(response?.imageWidth).toBeNull();
    expect(response?.imageHeight).toBeNull();
  });

  it("refuses to follow an og:image redirect into a private network", async () => {
    const requested: string[] = [];
    const response = await fetchChannelLinkPreview(
      "https://news.example.com/articles/42",
      async (input) => {
        const url = String(input);
        requested.push(url);
        if (url.endsWith("/hero.png")) {
          return new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data" },
          });
        }
        return htmlResponse(`
          <html><head>
            <meta property="og:title" content="Redirecting image">
            <meta property="og:image" content="https://cdn.example.org/hero.png">
          </head></html>
        `);
      },
    );

    expect(requested).toEqual([
      "https://news.example.com/articles/42",
      "https://cdn.example.org/hero.png",
    ]);
    expect(response?.imageWidth).toBeNull();
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
