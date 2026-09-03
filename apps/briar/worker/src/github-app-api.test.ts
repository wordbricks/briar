import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createGithubAppJwt,
  createGithubInstallationToken,
  GithubAppApiError,
  getProjectGithubMergeActivity,
} from "./github-app-api";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({
  format: "pem",
  type: "pkcs8",
}).toString();

const identity = {
  installationId: 91,
  repositoryId: 701,
  repository: "wordbricks/briar",
};

describe("GitHub App API", () => {
  it("paginates merge activity, deduplicates PRs, and filters by merge time rather than update time", async () => {
    const now = Date.parse("2026-09-03T08:00:00Z");
    const mergedAt = "2026-09-02T22:00:00Z";
    const entry = (number: number, merged_at: string | null = mergedAt) => ({ number, title: `PR ${number}`, merged_at, updated_at: mergedAt });
    const firstPage = Array.from({ length: 100 }, (_, index) => entry(index + 1));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ token: "installation-token", expires_at: "2026-09-03T09:00:00Z" }))
      .mockResolvedValueOnce(Response.json(firstPage))
      .mockResolvedValueOnce(Response.json([
        entry(100), entry(101), entry(102, null), entry(103, "2026-07-01T00:00:00Z"), entry(104, "2026-09-04T00:00:00Z"),
      ]));
    const result = await getProjectGithubMergeActivity(
      { GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: privateKeyPem }, identity, now, fetchImpl,
    );
    expect(result.pullRequests).toHaveLength(101);
    expect(result.generatedAt).toBe("2026-09-03T08:00:00.000Z");
    expect(result.pullRequests.at(-1)?.url).toBe("https://github.com/wordbricks/briar/pull/101");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[2][0]).toContain("page=2");
  });

  it("fails a complete activity load when a later GitHub page fails", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ token: "installation-token", expires_at: "2026-09-03T09:00:00Z" }))
      .mockResolvedValueOnce(Response.json(Array.from({ length: 100 }, (_, index) => ({
        number: index + 1, title: "PR", merged_at: "2026-09-03T07:00:00Z", updated_at: "2026-09-03T07:00:00Z",
      }))))
      .mockResolvedValueOnce(Response.json({ message: "Rate limit exceeded" }, { status: 403 }));
    await expect(getProjectGithubMergeActivity(
      { GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: privateKeyPem }, identity, Date.parse("2026-09-03T08:00:00Z"), fetchImpl,
    )).rejects.toMatchObject({ status: 403 });
  });
  it("signs a short-lived RS256 App JWT", async () => {
    const jwt = await createGithubAppJwt({
      appId: "12345",
      privateKey: privateKeyPem,
      now: Date.parse("2026-08-30T00:00:00Z"),
    });
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toMatchObject({
      iss: "12345",
    });
    expect(signature.length).toBeGreaterThan(100);
  });

  it("requests one repository with only the required write permissions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      token: "installation-token",
      expires_at: "2026-08-30T01:00:00Z",
      repositories: [{ id: 701, full_name: "wordbricks/briar" }],
    }), { status: 201 }));

    await expect(createGithubInstallationToken(
      { GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: privateKeyPem },
      identity,
      fetchImpl,
    )).resolves.toEqual({
      token: "installation-token",
      expiresAt: "2026-08-30T01:00:00Z",
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.github.com/app/installations/91/access_tokens",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      repository_ids: [701],
      permissions: {
        contents: "write",
        pull_requests: "write",
        statuses: "write",
      },
    });
    expect(String(new Headers(init.headers).get("authorization"))).toMatch(
      /^Bearer eyJ/u,
    );
  });

  it("rejects a token issued for a different immutable repository", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      token: "wrong-token",
      expires_at: "2026-08-30T01:00:00Z",
      repositories: [{ id: 999, full_name: "other/repository" }],
    }), { status: 201 }));

    await expect(createGithubInstallationToken(
      { GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: privateKeyPem },
      identity,
      fetchImpl,
    )).rejects.toEqual(expect.objectContaining({
      name: "GithubAppApiError",
      status: 409,
    }) satisfies Partial<GithubAppApiError>);
  });
});
