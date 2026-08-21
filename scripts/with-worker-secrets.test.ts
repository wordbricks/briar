import { describe, expect, it, vi } from "vitest";
import { readWorkerSecrets, runWorkerDeploy } from "./with-worker-secrets";

describe("Worker deployment", () => {
  it("passes the App publisher credentials only through the server secret file", () => {
    const previous = { ...process.env };
    Object.assign(process.env, {
      BETTER_AUTH_SECRET: "auth",
      GOOGLE_CLIENT_ID: "google-id",
      GOOGLE_CLIENT_SECRET: "google-secret",
      GITHUB_APP_CLIENT_ID: "client-id",
      GITHUB_APP_CLIENT_SECRET: "client-secret",
      GITHUB_APP_SLUG: "briar",
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY_PKCS8: "private-key",
      GITHUB_CALLBACK_ORIGIN: "https://briar.example",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
    });
    try {
      const secrets = readWorkerSecrets();
      expect(secrets).toMatchObject({
        GITHUB_APP_ID: "12345",
        GITHUB_APP_PRIVATE_KEY_PKCS8: "private-key",
      });
      expect(JSON.stringify(secrets)).not.toContain("BRIAR_WORKER_TOKEN");
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in previous)) delete process.env[key];
      }
      Object.assign(process.env, previous);
    }
  });

  it("applies remote D1 migrations before deploying the Worker", async () => {
    const runner = vi.fn(async () => 0);
    const migrate = vi.fn(async () => 0);

    await expect(
      runWorkerDeploy("/tmp/secrets.json", runner, migrate),
    ).resolves.toBe(0);
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls).toEqual([
      [["deploy", "--secrets-file", "/tmp/secrets.json"]],
    ]);
  });

  it("does not deploy when migration fails", async () => {
    const runner = vi.fn(async () => 0);
    const migrate = vi.fn(async () => 17);

    await expect(
      runWorkerDeploy("/tmp/secrets.json", runner, migrate),
    ).resolves.toBe(17);
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(runner).not.toHaveBeenCalled();
  });
});
