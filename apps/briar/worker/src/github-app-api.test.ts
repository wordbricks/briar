import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createGithubAppJwt,
  createGithubInstallationToken,
  GithubAppApiError,
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
