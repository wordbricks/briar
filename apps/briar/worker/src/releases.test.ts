import { describe, expect, it, vi } from "vitest";
import {
  releasePromotionPayload,
  signReleasePromotion,
} from "../../src/lib/release-promotion";
import { serveRelease } from "./releases";

const promotionSecret = "test-release-promotion-secret-at-least-32-chars";
const commitSha = "a".repeat(40);

async function promotionRequest(version: string) {
  const body = releasePromotionPayload({ commitSha, version });
  const signature = await signReleasePromotion(promotionSecret, body);
  return new Request("https://briar-api.example/releases/promote", {
    body,
    headers: { Authorization: `Briar-HMAC ${signature}` },
    method: "POST",
  });
}

function releaseObjects(initial: Record<string, string>) {
  const entries = { ...initial };
  let generation = 0;
  const put = vi.fn(async (
    key: string,
    value: string,
    _options?: R2PutOptions,
  ): Promise<{ etag: string } | null> => {
    generation += 1;
    entries[key] = value;
    return { etag: `etag-${generation}` };
  });
  const bucket = {
    get: async (key: string) => {
      const body = entries[key];
      if (body === undefined) return null;
      return {
        body,
        etag: key === "releases/latest.json" ? `latest-${generation}` : "versioned",
        httpEtag: '"release-etag"',
        writeHttpMetadata: () => undefined,
      };
    },
    put,
  } as unknown as R2Bucket;
  return { bucket, entries, put };
}

function promotionEntries(version: string, currentVersion: string) {
  return {
    "releases/latest.json": JSON.stringify({ version: currentVersion }),
    [`releases/v${version}/latest.json`]: JSON.stringify({ version }),
    [`releases/v${version}/release-manifest.json`]: JSON.stringify({
      channel: "stable",
      commitSha,
      product: "Briar",
      schemaVersion: 1,
      version,
    }),
  };
}

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

function bucketFrom(entries: Record<string, string>) {
  return {
    get: async (key: string) => {
      const body = entries[key];
      if (body === undefined) return null;
      return {
        body,
        httpEtag: '"release-etag"',
        writeHttpMetadata: () => undefined,
      };
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

  it("redirects the stable mac download path to the latest versioned DMG", async () => {
    const response = await serveRelease(
      new Request("https://briar-api.example/releases/latest/mac-aarch64.dmg"),
      bucketFrom({
        "releases/latest.json": '{"version":"1.1.5"}',
        "releases/v1.1.5/Briar_1.1.5_aarch64.dmg": "disk-image",
      }),
    );
    expect(response?.status).toBe(302);
    expect(response?.headers.get("Location")).toBe(
      "https://briar-api.example/releases/v1.1.5/Briar_1.1.5_aarch64.dmg",
    );
    expect(response?.headers.get("Cache-Control")).toContain("max-age=60");
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

  it("promotes verified metadata with an authenticated ETag compare-and-swap", async () => {
    const release = releaseObjects(promotionEntries("1.2.0", "1.1.0"));
    const response = await serveRelease(
      await promotionRequest("1.2.0"),
      release.bucket,
      promotionSecret,
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      currentVersion: "1.2.0",
      promoted: true,
    });
    expect(release.put).toHaveBeenCalledWith(
      "releases/latest.json",
      JSON.stringify({ version: "1.2.0" }),
      expect.objectContaining({ onlyIf: { etagMatches: "latest-0" } }),
    );
  });

  it("does not let an unauthenticated caller promote a release", async () => {
    const release = releaseObjects(promotionEntries("1.2.0", "1.1.0"));
    const response = await serveRelease(
      new Request("https://briar-api.example/releases/promote", {
        body: releasePromotionPayload({ commitSha, version: "1.2.0" }),
        method: "POST",
      }),
      release.bucket,
      promotionSecret,
    );

    expect(response?.status).toBe(401);
    expect(release.put).not.toHaveBeenCalled();
    expect(release.entries["releases/latest.json"]).toBe(
      JSON.stringify({ version: "1.1.0" }),
    );
  });

  it("cannot overwrite a newer release after losing the ETag race", async () => {
    const release = releaseObjects(promotionEntries("1.2.0", "1.1.0"));
    release.put.mockImplementationOnce(async () => {
      release.entries["releases/latest.json"] = JSON.stringify({ version: "1.3.0" });
      return null;
    });
    const response = await serveRelease(
      await promotionRequest("1.2.0"),
      release.bucket,
      promotionSecret,
    );

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toMatchObject({
      currentVersion: "1.3.0",
      message: "Release promotion would move latest backwards",
    });
    expect(release.entries["releases/latest.json"]).toBe(
      JSON.stringify({ version: "1.3.0" }),
    );
  });

  it("rejects a same-version promotion when its metadata differs", async () => {
    const release = releaseObjects(promotionEntries("1.2.0", "1.2.0"));
    release.entries["releases/latest.json"] = JSON.stringify({
      notes: "already promoted from another build",
      version: "1.2.0",
    });

    const response = await serveRelease(
      await promotionRequest("1.2.0"),
      release.bucket,
      promotionSecret,
    );

    expect(response?.status).toBe(409);
    expect(release.put).not.toHaveBeenCalled();
  });
});
