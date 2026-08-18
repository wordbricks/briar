import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  prepareReadOnlyAgentEnvironment,
  readOnlyAgentEnvironment,
} from "./read-only-agent-environment";

describe("read-only Agent environment", () => {
  it("keeps provider auth and OS basics but drops execution credentials", () => {
    expect(
      readOnlyAgentEnvironment("codex", {
        HOME: "/Users/worker",
        PATH: "/usr/bin:/bin",
        OPENAI_API_KEY: "provider-secret",
        CODEX_ACCESS_TOKEN: "access-token",
        CODEX_HOME: "/Users/worker/.codex",
        CODEX_SQLITE_HOME: "/Users/worker/shared-state",
        BRIAR_WORKER_TOKEN: "worker-secret",
        BRIAR_USER_TOKEN: "user-secret",
        GITHUB_TOKEN: "github-secret",
        DATABASE_URL: "database-secret",
      }),
    ).toEqual({
      HOME: "/Users/worker",
      PATH: "/usr/bin:/bin",
      OPENAI_API_KEY: "provider-secret",
      CODEX_ACCESS_TOKEN: "access-token",
    });
  });

  it("does not pass one provider's credentials to another provider", () => {
    expect(
      readOnlyAgentEnvironment("grok", {
        XAI_API_KEY: "xai-secret",
        OPENAI_API_KEY: "openai-secret",
        ANTHROPIC_API_KEY: "anthropic-secret",
      }),
    ).toEqual({ XAI_API_KEY: "xai-secret" });
  });

  it("keeps only Cursor credentials in the Cursor environment", () => {
    expect(
      readOnlyAgentEnvironment("cursor", {
        HOME: "/Users/worker",
        CURSOR_API_KEY: "cursor-secret",
        CURSOR_TRACE_ID: "trace",
        OPENAI_API_KEY: "openai-secret",
        BRIAR_WORKER_TOKEN: "worker-secret",
      }),
    ).toEqual({
      HOME: "/Users/worker",
      CURSOR_API_KEY: "cursor-secret",
      CURSOR_TRACE_ID: "trace",
    });
  });

  it("isolates Cursor configuration while preserving CLI authentication", async () => {
    const sourceHome = await mkdtemp(join(tmpdir(), "briar-cursor-source-"));
    const sourceCursorHome = join(sourceHome, ".cursor");
    await mkdir(sourceCursorHome, { recursive: true });
    await writeFile(join(sourceCursorHome, "cli-config.json"), '{"userEmail":"test@example.com"}');
    await writeFile(join(sourceCursorHome, "rules.json"), '{"unsafe":true}');

    const prepared = await prepareReadOnlyAgentEnvironment("cursor", {
      workspaceRoot: "/repo",
      environment: { HOME: sourceHome, CURSOR_API_KEY: "cursor-secret" },
    });
    const isolatedHome = prepared.environment.HOME!;
    try {
      expect(isolatedHome).not.toBe(sourceHome);
      expect(await readFile(join(isolatedHome, ".cursor", "cli-config.json"), "utf8"))
        .toBe('{"userEmail":"test@example.com"}');
      await expect(access(join(isolatedHome, ".cursor", "rules.json")))
        .rejects.toMatchObject({ code: "ENOENT" });
      expect(prepared.environment.CURSOR_API_KEY).toBe("cursor-secret");
    } finally {
      await prepared.cleanup();
      await rm(sourceHome, { recursive: true, force: true });
    }
  });

  it("isolates Codex configuration while preserving authentication", async () => {
    const sourceCodexHome = await mkdtemp(
      join(tmpdir(), "briar-codex-source-"),
    );
    await writeFile(join(sourceCodexHome, "auth.json"), '{"token":"test"}');
    await writeFile(
      join(sourceCodexHome, "config.toml"),
      'sandbox_mode = "danger-full-access"',
    );

    const prepared = await prepareReadOnlyAgentEnvironment("codex", {
      workspaceRoot: "/repo",
      environment: {
        HOME: "/Users/worker",
        PATH: "/usr/bin:/bin",
        CODEX_HOME: sourceCodexHome,
        CODEX_SQLITE_HOME: "/Users/worker/shared-state",
        OPENAI_API_KEY: "provider-secret",
        BRIAR_WORKER_TOKEN: "worker-secret",
      },
    });
    const isolatedCodexHome = prepared.environment.CODEX_HOME;

    try {
      expect(isolatedCodexHome).toBeTruthy();
      expect(isolatedCodexHome).not.toBe(sourceCodexHome);
      expect(prepared.environment.CODEX_SQLITE_HOME).toBe(isolatedCodexHome);
      expect(
        await readFile(join(isolatedCodexHome!, "auth.json"), "utf8"),
      ).toBe('{"token":"test"}');
      await expect(
        access(join(isolatedCodexHome!, "config.toml")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(prepared.environment.BRIAR_WORKER_TOKEN).toBeUndefined();
    } finally {
      await prepared.cleanup();
      await rm(sourceCodexHome, { recursive: true, force: true });
    }

    await expect(access(isolatedCodexHome!)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("isolates Claude configuration while preserving cached credentials", async () => {
    const sourceClaudeHome = await mkdtemp(
      join(tmpdir(), "briar-claude-source-"),
    );
    await writeFile(
      join(sourceClaudeHome, ".credentials.json"),
      '{"token":"test"}',
    );
    await writeFile(join(sourceClaudeHome, "settings.json"), '{"hooks":{}}');

    const prepared = await prepareReadOnlyAgentEnvironment("claude", {
      workspaceRoot: "/repo",
      environment: {
        HOME: "/Users/worker",
        CLAUDE_CONFIG_DIR: sourceClaudeHome,
        CLAUDE_CODE_OAUTH_TOKEN: "oauth-token",
      },
    });
    const isolatedClaudeHome = prepared.environment.CLAUDE_CONFIG_DIR!;
    try {
      expect(isolatedClaudeHome).not.toBe(sourceClaudeHome);
      expect(prepared.environment.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe(
        isolatedClaudeHome,
      );
      expect(
        await readFile(join(isolatedClaudeHome, ".credentials.json"), "utf8"),
      ).toBe('{"token":"test"}');
      await expect(
        access(join(isolatedClaudeHome, "settings.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await prepared.cleanup();
      await rm(sourceClaudeHome, { recursive: true, force: true });
    }
  });

  it("copies Claude Keychain authentication when no credential file exists", async () => {
    const sourceClaudeHome = await mkdtemp(
      join(tmpdir(), "briar-claude-keychain-source-"),
    );
    const keychainCredential = vi.fn(() =>
      JSON.stringify({ claudeAiOauth: { accessToken: "keychain-token" } })
    );
    const prepared = await prepareReadOnlyAgentEnvironment("claude", {
      workspaceRoot: "/repo",
      environment: {
        HOME: "/Users/worker",
        USER: "worker",
        CLAUDE_CONFIG_DIR: sourceClaudeHome,
      },
      claudeKeychainCredential: keychainCredential,
    });
    try {
      expect(keychainCredential).toHaveBeenCalledWith(
        expect.objectContaining({ USER: "worker" }),
        sourceClaudeHome,
      );
      expect(
        JSON.parse(
          await readFile(
            join(prepared.environment.CLAUDE_CONFIG_DIR!, ".credentials.json"),
            "utf8",
          ),
        ),
      ).toEqual({ claudeAiOauth: { accessToken: "keychain-token" } });
    } finally {
      await prepared.cleanup();
      await rm(sourceClaudeHome, { recursive: true, force: true });
    }
  });

  it("builds a fail-closed Grok sandbox from authentication only", async () => {
    const root = await mkdtemp(join(tmpdir(), "briar-grok-source-"));
    const sourceGrokHome = join(root, "home");
    const workspaceRoot = join(root, "repo");
    await Promise.all([
      mkdir(sourceGrokHome),
      mkdir(join(workspaceRoot, ".grok"), { recursive: true }),
    ]);
    await writeFile(join(sourceGrokHome, "auth.json"), '{"token":"test"}');
    await writeFile(
      join(workspaceRoot, ".grok", "config.toml"),
      '[plugins]\nenabled = ["unsafe"]',
    );
    await writeFile(join(workspaceRoot, "AGENT.md"), "untrusted");

    const prepared = await prepareReadOnlyAgentEnvironment("grok", {
      workspaceRoot,
      environment: {
        HOME: "/Users/worker",
        GROK_HOME: sourceGrokHome,
        GROK_SANDBOX: "off",
        XAI_API_KEY: "xai-secret",
      },
    });
    const isolatedGrokHome = prepared.environment.GROK_HOME!;
    try {
      expect(isolatedGrokHome).not.toBe(sourceGrokHome);
      expect(prepared.environment.HOME).toBe(isolatedGrokHome);
      expect(prepared.environment.TMPDIR).toBe(isolatedGrokHome);
      expect(prepared.environment.GROK_SANDBOX).toBe("briar_read_only");
      expect(prepared.environment.GROK_SUBAGENTS).toBe("0");
      expect(prepared.environment.DISABLE_EMBEDDED_SEARCH_TOOLS).toBe("1");
      expect(
        await readFile(join(isolatedGrokHome, "auth.json"), "utf8"),
      ).toBe('{"token":"test"}');
      const sandbox = await readFile(
        join(isolatedGrokHome, "sandbox.toml"),
        "utf8",
      );
      expect(sandbox).toContain('extends = "strict"');
      expect(sandbox).toContain(JSON.stringify(workspaceRoot));
      expect(sandbox).toContain(JSON.stringify(join(workspaceRoot, ".grok")));
      expect(sandbox).toContain(JSON.stringify(join(workspaceRoot, "AGENT.md")));
      await expect(
        access(join(isolatedGrokHome, "plugins")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await prepared.cleanup();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("isolates OpenCode state and disables project configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "briar-opencode-source-"));
    const sourceDataRoot = join(root, "data");
    await mkdir(join(sourceDataRoot, "opencode"), { recursive: true });
    await writeFile(
      join(sourceDataRoot, "opencode", "auth.json"),
      '{"provider":"test"}',
    );

    const prepared = await prepareReadOnlyAgentEnvironment("opencode", {
      workspaceRoot: join(root, "repo"),
      environment: {
        HOME: "/Users/worker",
        XDG_DATA_HOME: sourceDataRoot,
        OPENCODE_CONFIG_CONTENT: '{"plugin":["unsafe"]}',
        OPENAI_API_KEY: "provider-secret",
      },
    });
    const isolatedDataRoot = prepared.environment.XDG_DATA_HOME!;
    const isolatedRoot = prepared.environment.HOME!;
    try {
      expect(isolatedDataRoot).not.toBe(sourceDataRoot);
      expect(isolatedRoot).not.toBe("/Users/worker");
      expect(prepared.environment.TMPDIR).toBe(isolatedRoot);
      expect(prepared.environment.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
      expect(prepared.environment.OPENCODE_DISABLE_CLAUDE_CODE).toBe("1");
      expect(prepared.environment.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBe("1");
      expect(prepared.environment.OPENCODE_CONFIG_CONTENT).toBeUndefined();
      expect(
        await readFile(
          join(isolatedDataRoot, "opencode", "auth.json"),
          "utf8",
        ),
      ).toBe('{"provider":"test"}');
    } finally {
      await prepared.cleanup();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps only the OpenRouter key and generated OpenCode config", async () => {
    const prepared = await prepareReadOnlyAgentEnvironment("openrouter", {
      workspaceRoot: "/repo",
      environment: {
        HOME: "/Users/worker",
        OPENROUTER_API_KEY: "sk-or-v1-provider-secret",
        OPENCODE_CONFIG_CONTENT: '{"provider":{"openrouter":{}}}',
        OPENAI_API_KEY: "unrelated-secret",
        BRIAR_WORKER_TOKEN: "worker-secret",
      },
    });
    try {
      expect(prepared.environment.OPENROUTER_API_KEY)
        .toBe("sk-or-v1-provider-secret");
      expect(prepared.environment.OPENCODE_CONFIG_CONTENT)
        .toBe('{"provider":{"openrouter":{}}}');
      expect(prepared.environment.OPENAI_API_KEY).toBeUndefined();
      expect(prepared.environment.BRIAR_WORKER_TOKEN).toBeUndefined();
      expect(prepared.environment.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
    } finally {
      await prepared.cleanup();
    }
  });

  it("isolates Antigravity state while preserving Google subscription OAuth", async () => {
    const sourceHome = await mkdtemp(join(tmpdir(), "briar-agy-source-"));
    await Promise.all([
      mkdir(join(sourceHome, ".gemini", "config"), { recursive: true }),
      mkdir(join(sourceHome, ".gemini", "antigravity-cli", "cache"), {
        recursive: true,
      }),
    ]);
    await writeFile(
      join(sourceHome, ".gemini", "oauth_creds.json"),
      '{"access_token":"subscription-oauth"}',
    );
    await writeFile(
      join(sourceHome, ".gemini", "settings.json"),
      '{"unsafeHook":true}',
    );

    const prepared = await prepareReadOnlyAgentEnvironment("agy", {
      workspaceRoot: join(sourceHome, "repo"),
      environment: {
        HOME: sourceHome,
        AGY_ADC_AUTH: "1",
        GEMINI_API_KEY: "must-not-leak",
        BRIAR_WORKER_TOKEN: "must-not-leak",
      },
    });
    const isolatedRoot = prepared.environment.HOME!;
    try {
      expect(isolatedRoot).not.toBe(sourceHome);
      expect(prepared.environment.AGY_ADC_AUTH).toBeUndefined();
      expect(prepared.environment.GEMINI_API_KEY).toBeUndefined();
      expect(prepared.environment.BRIAR_WORKER_TOKEN).toBeUndefined();
      expect(
        await readFile(join(isolatedRoot, ".gemini", "oauth_creds.json"), "utf8"),
      ).toBe('{"access_token":"subscription-oauth"}');
      await expect(
        access(join(isolatedRoot, ".gemini", "settings.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await prepared.cleanup();
      await rm(sourceHome, { recursive: true, force: true });
    }
  });
});
