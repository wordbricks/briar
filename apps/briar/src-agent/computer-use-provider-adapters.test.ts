import { describe, expect, it } from "vitest";
import type { StdioMcpServer } from "./computer-use-mcp-config";
import {
  acpComputerUseServers,
  claudeComputerUseServers,
  codexComputerUseArgs,
  openCodeComputerUseEnvironment,
} from "./computer-use-provider-adapters";

const servers: StdioMcpServer[] = [{
  name: "briar-computer",
  command: "/usr/bin/bun",
  args: ["/opt/briar/computer.js", "--config", "/tmp/private.json"],
  env: { BRIAR_TEST: "enabled" },
}];

describe("Computer Use provider adapters", () => {
  it("converts the common descriptor to ACP", () => {
    expect(acpComputerUseServers(servers)).toEqual([{
      name: "briar-computer",
      command: "/usr/bin/bun",
      args: ["/opt/briar/computer.js", "--config", "/tmp/private.json"],
      env: [{ name: "BRIAR_TEST", value: "enabled" }],
    }]);
  });

  it("converts the common descriptor to Claude SDK config", () => {
    expect(claudeComputerUseServers(servers)).toEqual({
      "briar-computer": {
        type: "stdio",
        command: "/usr/bin/bun",
        args: ["/opt/briar/computer.js", "--config", "/tmp/private.json"],
        env: { BRIAR_TEST: "enabled" },
        alwaysLoad: true,
      },
    });
  });

  it("converts the common descriptor to Codex config overrides", () => {
    expect(codexComputerUseArgs(servers)).toEqual([
      "--config",
      'mcp_servers.briar-computer.command="/usr/bin/bun"',
      "--config",
      'mcp_servers.briar-computer.args=["/opt/briar/computer.js","--config","/tmp/private.json"]',
      "--config",
      'mcp_servers.briar-computer.env={BRIAR_TEST="enabled"}',
      "--config",
      "mcp_servers.briar-computer.required=true",
    ]);
  });

  it("merges Computer Use into an existing OpenCode config", () => {
    const environment = openCodeComputerUseEnvironment({
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        provider: { openrouter: { name: "OpenRouter" } },
        mcp: { existing: { type: "remote", url: "https://example.com" } },
      }),
    }, servers);
    expect(JSON.parse(environment.OPENCODE_CONFIG_CONTENT!)).toEqual({
      provider: { openrouter: { name: "OpenRouter" } },
      mcp: {
        existing: { type: "remote", url: "https://example.com" },
        "briar-computer": {
          type: "local",
          command: [
            "/usr/bin/bun",
            "/opt/briar/computer.js",
            "--config",
            "/tmp/private.json",
          ],
          environment: { BRIAR_TEST: "enabled" },
          enabled: true,
        },
      },
    });
  });
});
