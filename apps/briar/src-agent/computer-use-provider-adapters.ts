import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import * as Schema from "effect/Schema";
import type { StdioMcpServer } from "./computer-use-mcp-config";

export type AcpStdioMcpServer = {
  readonly name: string;
  readonly command: string;
  readonly args: string[];
  readonly env: Array<{ readonly name: string; readonly value: string }>;
};

export const acpComputerUseServers = (
  servers: readonly StdioMcpServer[],
): AcpStdioMcpServer[] => servers.map((server) => ({
  name: server.name,
  command: server.command,
  args: [...server.args],
  env: Object.entries(server.env).map(([name, value]) => ({ name, value })),
}));

export const claudeComputerUseServers = (
  servers: readonly StdioMcpServer[],
): Record<string, McpServerConfig> => Object.fromEntries(
  servers.map((server) => [
    server.name,
    {
      type: "stdio" as const,
      command: server.command,
      args: [...server.args],
      env: { ...server.env },
      alwaysLoad: true,
    },
  ]),
);

const tomlKey = (value: string): string =>
  /^[A-Za-z0-9_-]+$/u.test(value) ? value : JSON.stringify(value);

const tomlInlineStringTable = (
  values: Readonly<Record<string, string>>,
): string => `{${Object.entries(values).map(([key, value]) =>
  `${tomlKey(key)}=${JSON.stringify(value)}`
).join(",")}}`;

export const codexComputerUseArgs = (
  servers: readonly StdioMcpServer[],
): string[] => servers.flatMap((server) => {
  const prefix = `mcp_servers.${tomlKey(server.name)}`;
  return [
    "--config",
    `${prefix}.command=${JSON.stringify(server.command)}`,
    "--config",
    `${prefix}.args=${JSON.stringify(server.args)}`,
    "--config",
    `${prefix}.env=${tomlInlineStringTable(server.env)}`,
    "--config",
    `${prefix}.required=true`,
  ];
});

const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown);
const decodeUnknownRecord = Schema.decodeUnknownSync(UnknownRecord);

export const openCodeComputerUseEnvironment = (
  environment: NodeJS.ProcessEnv,
  servers: readonly StdioMcpServer[],
): NodeJS.ProcessEnv => {
  if (servers.length === 0) return environment;
  const rawConfig = environment.OPENCODE_CONFIG_CONTENT?.trim() || "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch {
    throw new Error("OPENCODE_CONFIG_CONTENT must contain valid JSON");
  }
  const config = decodeUnknownRecord(parsed);
  const configuredMcp = config.mcp === undefined
    ? {}
    : decodeUnknownRecord(config.mcp);
  const computerMcp = Object.fromEntries(servers.map((server) => [
    server.name,
    {
      type: "local",
      command: [server.command, ...server.args],
      environment: { ...server.env },
      enabled: true,
    },
  ]));
  return {
    ...environment,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...config,
      mcp: { ...configuredMcp, ...computerMcp },
    }),
  };
};
