import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createGithubAppJwt,
  createGithubInstallationToken,
  GithubAppApiError,
  getProjectGithubMergeActivity,
  listGithubInstallationRepositories,
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
  it("lists installation repositories with a metadata-only token across pages", async () => {
    const repository = (id: number) => ({
      id,
      name: `repo-${id}`,
      full_name: `wordbricks/repo-${id}`,
      owner: { login: "wordbricks" },
    });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ token: "ghs_installation", expires_at: "2026-09-03T09:00:00Z" }))
      .mockResolvedValueOnce(Response.json({
        total_count: 101,
        repositories: Array.from({ length: 100 }, (_, index) => repository(index + 1)),
      }))
      .mockResolvedValueOnce(Response.json({ total_count: 101, repositories: [repository(101)] }));

    const repositories = await listGithubInstallationRepositories(
      { GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: privateKeyPem }, 91, fetchImpl,
    );

    expect(repositories).toHaveLength(101);
    expect(repositories.at(-1)).toEqual({
      id: 101, owner: "wordbricks", name: "repo-101", fullName: "wordbricks/repo-101",
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      permissions: { metadata: "read" },
    });
    expect(fetchImpl.mock.calls[2][0]).toContain("page=2");
  });

  it("fails rather than reporting a truncated installation repository listing", async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      name: `repo-${index + 1}`,
      full_name: `wordbricks/repo-${index + 1}`,
      owner: { login: "wordbricks" },
    }));
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("/access_tokens")
        ? Response.json({ token: "ghs_installation", expires_at: "2026-09-03T09:00:00Z" })
        : Response.json({ total_count: 5_000, repositories: page })
    );

    // A caller replaces its stored snapshot with this list, so a truncated
    // answer would read as "every other repository was removed".
    await expect(listGithubInstallationRepositories(
      { GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: privateKeyPem }, 91, fetchImpl,
    )).rejects.toMatchObject({ status: 503 });
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
