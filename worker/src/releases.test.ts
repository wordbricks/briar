import { describe, expect, it } from "vitest";
import { serveRelease } from "./releases";

function bucketWith(body: string | null) {
  return {
    get: async () =>
      body === null
        ? null
        : {
            body,
            httpEtag: '"release-etag"',
            writeHttpMetadata: () => undefined,
          },
  } as unknown as Pick<R2Bucket, "get">;
}

describe("release distribution", () => {
  it("serves the mutable update manifest with short caching", async () => {
    const response = await serveRelease(
      new Request("https://briar-api.example/releases/latest.json"),
      bucketWith('{"version":"1.0.0"}'),
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Cache-Control")).toContain("max-age=60");
    await expect(response?.json()).resolves.toEqual({ version: "1.0.0" });
  });

  it("serves versioned artifacts as immutable and supports HEAD", async () => {
    const response = await serveRelease(
      new Request("https://briar-api.example/releases/v1.0.0/Briar.app.tar.gz", {
        method: "HEAD",
      }),
      bucketWith("archive"),
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Cache-Control")).toContain("immutable");
    expect(await response?.text()).toBe("");
  });

  it("rejects traversal-shaped and mutating requests", async () => {
    const bucket = bucketWith("secret");
    expect(
      (await serveRelease(
        new Request("https://briar-api.example/releases/v1.0.0/not/allowed"),
        bucket,
      ))?.status,
    ).toBe(404);
    expect(
      (await serveRelease(
        new Request("https://briar-api.example/releases/latest.json", { method: "PUT" }),
        bucket,
      ))?.status,
    ).toBe(405);
  });
});
