import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  claudeAuthenticated,
  grokAuthenticated,
  healthyWorkerProviders,
  inspectWorkerProviderHealth,
  parseClaudeAuthStatus,
  type WorkerProvider,
} from "./provider-health";

const enabled = { codex: true, claude: true, grok: true, opencode: true };

describe("inspectWorkerProviderHealth", () => {
  it("uses Claude's loggedIn response even when its CLI exit code is unreliable", async () => {
    expect(parseClaudeAuthStatus('{"loggedIn":true,"authMethod":"claude.ai"}'))
      .toBe(true);
    expect(parseClaudeAuthStatus('{"loggedIn":false}')).toBe(false);
    expect(parseClaudeAuthStatus("not json")).toBe(false);

    const home = await mkdtemp(join(tmpdir(), "briar-claude-health-"));
    const binary = join(home, "claude");
    try {
      await writeFile(
        binary,
        "#!/bin/sh\nprintf '%s' '{\"loggedIn\":true}'\nexit 1\n",
        { mode: 0o755 },
      );
      await expect(claudeAuthenticated(binary)).resolves.toBe(true);

      await writeFile(
        binary,
        "#!/bin/sh\nprintf '%s' '{\"loggedIn\":false}'\nexit 0\n",
        { mode: 0o755 },
      );
      await expect(claudeAuthenticated(binary)).resolves.toBe(false);
    } finally {
      await rm(home, { recursive: true });
    }
  });

  it("advertises only installed and authenticated providers as healthy", async () => {
    const health = await inspectWorkerProviderHealth(enabled, {
      home: "/tmp/briar-provider-health",
      now: () => Date.parse("2026-07-31T00:00:00Z"),
      which: (provider) =>
        provider === "grok" ? null : `/usr/local/bin/${provider}`,
      authenticated: vi.fn(async (provider: WorkerProvider) =>
        provider === "codex",
      ),
    });

    expect(health).toEqual({
      codex: {
        installed: true,
        authenticated: true,
        healthy: true,
        reason: null,
      },
      claude: {
        installed: true,
        authenticated: false,
        healthy: false,
        reason: "not_authenticated",
      },
      grok: {
        installed: false,
        authenticated: false,
        healthy: false,
        reason: "not_installed",
      },
      opencode: {
        installed: true,
        authenticated: false,
        healthy: false,
        reason: "not_authenticated",
      },
    });
    expect(healthyWorkerProviders(health)).toEqual(["codex"]);
  });

  it("does not probe disabled providers", async () => {
    const authenticated = vi.fn(async () => true);
    const health = await inspectWorkerProviderHealth(
      { codex: false, claude: true, grok: false, opencode: false },
      {
        which: (provider) => `/usr/local/bin/${provider}`,
        authenticated,
      },
    );

    expect(authenticated).toHaveBeenCalledTimes(1);
    expect(authenticated).toHaveBeenCalledWith(
      "claude",
      "/usr/local/bin/claude",
      expect.any(String),
      expect.any(Number),
    );
    expect(healthyWorkerProviders(health)).toEqual(["claude"]);
    expect(health.codex.reason).toBe("disabled");
    expect(health.grok.reason).toBe("disabled");
    expect(health.opencode.reason).toBe("disabled");
  });

  it("rejects an expired Grok login and accepts a current one", async () => {
    const home = await mkdtemp(join(tmpdir(), "briar-grok-health-"));
    const previousGrokHome = process.env.GROK_HOME;
    process.env.GROK_HOME = home;
    try {
      await writeFile(
        join(home, "auth.json"),
        JSON.stringify({
          "https://auth.x.ai": {
            key: "token",
            expiresAt: "2026-07-31T00:04:00Z",
          },
        }),
      );
      const now = Date.parse("2026-07-31T00:00:00Z");
      await expect(grokAuthenticated(home, now)).resolves.toBe(false);

      await writeFile(
        join(home, "auth.json"),
        JSON.stringify({
          "https://auth.x.ai": {
            key: "token",
            expiresAt: "2026-07-31T00:06:00Z",
          },
        }),
      );
      await expect(grokAuthenticated(home, now)).resolves.toBe(true);
    } finally {
      if (previousGrokHome === undefined) delete process.env.GROK_HOME;
      else process.env.GROK_HOME = previousGrokHome;
      await rm(home, { recursive: true });
    }
  });
});
