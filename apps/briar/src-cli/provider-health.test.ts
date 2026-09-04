import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  claudeAuthenticated,
  grokAuthenticated,
  healthyWorkerProviders,
  inspectWorkerProviderHealth,
  opencodeAuthenticated,
  parseClaudeAuthStatus,
  parseCursorAboutEmail,
  providerHealthReadinessDetail,
  type WorkerProvider,
  type WorkerProviderHealthMap,
} from "./provider-health";

const enabled = {
  codex: true,
  claude: true,
  cursor: true,
  grok: true,
  agy: true,
  opencode: true,
  openrouter: true,
  vertex: true,
  pi: true,
};

describe("inspectWorkerProviderHealth", () => {
  it("parses Cursor's JSON and human-readable account status", () => {
    expect(parseCursorAboutEmail('{"userEmail":"jay@example.com"}')).toBe(
      "jay@example.com",
    );
    expect(parseCursorAboutEmail('{"userEmail":"Not logged in"}')).toBeNull();
    expect(parseCursorAboutEmail("User Email  jay@example.com\n")).toBe(
      "jay@example.com",
    );
  });

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
      usage: vi.fn(async () => ({
        exhausted: false,
        maxUsedPercent: 12,
        error: null,
      })),
    });

    expect(health).toEqual({
      codex: {
        installed: true,
        authenticated: true,
        healthy: true,
        reason: null,
        usageExhausted: false,
        maxUsedPercent: 12,
      },
      claude: {
        installed: true,
        authenticated: false,
        healthy: false,
        reason: "not_authenticated",
      },
      cursor: {
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
      agy: {
        installed: true,
        authenticated: false,
        healthy: false,
        reason: "not_authenticated",
      },
      opencode: {
        installed: true,
        authenticated: false,
        healthy: false,
        reason: "not_authenticated",
      },
      openrouter: {
        installed: true,
        authenticated: false,
        healthy: false,
        reason: "not_authenticated",
      },
      vertex: {
        installed: true,
        authenticated: false,
        healthy: false,
        reason: "not_authenticated",
      },
      pi: {
        installed: true,
        authenticated: false,
        healthy: false,
        reason: "not_authenticated",
      },
    });
    expect(healthyWorkerProviders(health)).toEqual(["codex"]);
  });

  it("disables providers whose usage is fully exhausted", async () => {
    const usage = vi.fn(async (provider: WorkerProvider) =>
      provider === "codex"
        ? { exhausted: true, maxUsedPercent: 100, error: null }
        : { exhausted: false, maxUsedPercent: 10, error: null },
    );
    const health = await inspectWorkerProviderHealth(enabled, {
      which: (provider) => `/usr/local/bin/${provider}`,
      authenticated: vi.fn(async () => true),
      usage,
    });

    expect(health.codex).toMatchObject({
      healthy: false,
      reason: "usage_exhausted",
      usageExhausted: true,
      maxUsedPercent: 100,
    });
    expect(health.claude.healthy).toBe(true);
    expect(healthyWorkerProviders(health)).toEqual([
      "claude",
      "cursor",
      "grok",
      "agy",
      "opencode",
      "openrouter",
      "vertex",
      "pi",
    ]);
    expect(usage).toHaveBeenCalled();
  });

  it("keeps providers healthy when usage cannot be determined", async () => {
    const health = await inspectWorkerProviderHealth(enabled, {
      which: (provider) => `/usr/local/bin/${provider}`,
      authenticated: vi.fn(async () => true),
      usage: vi.fn(async () => ({
        exhausted: false,
        maxUsedPercent: null,
        error: "probe failed",
      })),
    });

    expect(health.codex).toMatchObject({
      healthy: true,
      reason: null,
      usageExhausted: false,
      maxUsedPercent: null,
    });
    expect(healthyWorkerProviders(health)).toEqual([
      "codex",
      "claude",
      "cursor",
      "grok",
      "agy",
      "opencode",
      "openrouter",
      "vertex",
      "pi",
    ]);
  });

  it("does not probe disabled providers", async () => {
    const authenticated = vi.fn(async () => true);
    const usage = vi.fn(async () => ({
      exhausted: false,
      maxUsedPercent: 0,
      error: null,
    }));
    const health = await inspectWorkerProviderHealth(
      {
        codex: false,
        claude: true,
        cursor: false,
        grok: false,
        agy: false,
        opencode: false,
        openrouter: false,
        vertex: false,
        pi: false,
      },
      {
        which: (provider) => `/usr/local/bin/${provider}`,
        authenticated,
        usage,
        upstreamConfigured: () => false,
      },
    );

    expect(authenticated).toHaveBeenCalledTimes(1);
    expect(authenticated).toHaveBeenCalledWith(
      "claude",
      "/usr/local/bin/claude",
      expect.any(String),
      expect.any(Number),
      false,
    );
    expect(usage).toHaveBeenCalledTimes(1);
    expect(healthyWorkerProviders(health)).toEqual(["claude"]);
    expect(health.codex.reason).toBe("disabled");
    expect(health.cursor.reason).toBe("disabled");
    expect(health.grok.reason).toBe("disabled");
    expect(health.agy.reason).toBe("disabled");
    expect(health.opencode.reason).toBe("disabled");
    expect(health.openrouter.reason).toBe("disabled");
    expect(health.vertex.reason).toBe("disabled");
  });

  it("requires an API key before advertising OpenRouter as healthy", async () => {
    const onlyOpenRouter = {
      codex: false,
      claude: false,
      cursor: false,
      grok: false,
      agy: false,
      opencode: false,
      openrouter: true,
      vertex: false,
      pi: false,
    } satisfies Record<WorkerProvider, boolean>;
    const withoutKey = await inspectWorkerProviderHealth(onlyOpenRouter, {
      which: (provider) => provider === "openrouter" ? "/usr/local/bin/opencode" : null,
      upstreamConfigured: () => false,
    });
    expect(withoutKey.openrouter).toMatchObject({
      installed: true,
      authenticated: false,
      healthy: false,
      reason: "not_authenticated",
    });

    const withKey = await inspectWorkerProviderHealth(onlyOpenRouter, {
      which: (provider) => provider === "openrouter" ? "/usr/local/bin/opencode" : null,
      upstreamConfigured: (provider) => provider === "openrouter",
      usage: vi.fn(async () => ({
        exhausted: false,
        maxUsedPercent: null,
        error: null,
      })),
    });
    expect(withKey.openrouter).toMatchObject({
      installed: true,
      authenticated: true,
      healthy: true,
      reason: null,
    });
  });

  it("explains readiness when remaining providers are usage-exhausted", () => {
    const health = {
      codex: {
        installed: true,
        authenticated: true,
        healthy: false,
        reason: "usage_exhausted",
      },
      claude: {
        installed: true,
        authenticated: false,
        healthy: false,
        reason: "not_authenticated",
      },
      cursor: {
        installed: false,
        authenticated: false,
        healthy: false,
        reason: "disabled",
      },
      grok: {
        installed: false,
        authenticated: false,
        healthy: false,
        reason: "not_installed",
      },
      agy: {
        installed: false,
        authenticated: false,
        healthy: false,
        reason: "disabled",
      },
      opencode: {
        installed: false,
        authenticated: false,
        healthy: false,
        reason: "disabled",
      },
      openrouter: {
        installed: false,
        authenticated: false,
        healthy: false,
        reason: "disabled",
      },
      vertex: {
        installed: false,
        authenticated: false,
        healthy: false,
        reason: "disabled",
      },
      pi: {
        installed: false,
        authenticated: false,
        healthy: false,
        reason: "disabled",
      },
    } satisfies WorkerProviderHealthMap;
    expect(providerHealthReadinessDetail(health)).toContain("사용량 한도");
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

  it("requires at least one stored OpenCode provider credential", async () => {
    const home = await mkdtemp(join(tmpdir(), "briar-opencode-health-"));
    try {
      await expect(opencodeAuthenticated(home)).resolves.toBe(false);
      const authDirectory = join(home, ".local", "share", "opencode");
      await mkdir(authDirectory, { recursive: true });
      await writeFile(join(authDirectory, "auth.json"), "{}\n");
      await expect(opencodeAuthenticated(home)).resolves.toBe(false);
      await writeFile(
        join(authDirectory, "auth.json"),
        JSON.stringify({ opencode: { type: "api", key: "stored" } }),
      );
      await expect(opencodeAuthenticated(home)).resolves.toBe(true);
    } finally {
      await rm(home, { recursive: true });
    }
  });
});
