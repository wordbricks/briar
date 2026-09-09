import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { RunnerRequest } from "./runner-request";
import * as Schema from "effect/Schema";
import { agentProviders, type AgentProvider } from "../src/lib/agent-provider";
import { agentProviderFromProto } from "../src/lib/agent-provider-proto";

const OwnerToken = Schema.String.check(
  Schema.isLengthBetween(16, 256),
  Schema.isPattern(/^[A-Za-z0-9_-]+$/u),
);

const ComputerUseMcpConfigSchema = Schema.Struct({
  version: Schema.Literal(1),
  runKind: Schema.Literals(["parent", "computerUse"]),
  mcpServerPath: Schema.String,
  workspaceRoot: Schema.String,
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  viewport: Schema.Struct({
    width: Schema.Int.check(Schema.isGreaterThan(0)),
    height: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
  binding: Schema.Struct({
    parentRunId: Schema.String,
    childRunId: Schema.String,
    agentId: Schema.String,
    managedComputerId: Schema.String,
    displayIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(2)),
    ownerToken: OwnerToken,
    provider: Schema.Literals(agentProviders),
  }),
});

export type ComputerUseMcpConfig = typeof ComputerUseMcpConfigSchema.Type;

export type StdioMcpServer = {
  readonly name: string;
  readonly command: string;
  readonly args: string[];
  readonly env: Readonly<Record<string, string>>;
};

export type PreparedComputerUseMcp = {
  readonly servers: StdioMcpServer[];
  cleanup(): Promise<void>;
};

const decodeConfig = Schema.decodeUnknownSync(ComputerUseMcpConfigSchema);

const assertAbsolutePath = (path: string, field: string): string => {
  if (!isAbsolute(path)) throw new Error(`${field} must be an absolute path`);
  return path;
};

const computerUseViewport = (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const geometry = environment.BRIAR_COMPUTER_USE_GEOMETRY?.trim()
    || environment.BRIAR_REMOTE_DISPLAY_GEOMETRY?.trim()
    || "1280x720";
  const match = /^(?<width>[1-9][0-9]*)x(?<height>[1-9][0-9]*)$/u.exec(geometry);
  if (!match?.groups) throw new Error("Computer Use geometry must be WIDTHxHEIGHT");
  return { width: Number(match.groups.width), height: Number(match.groups.height) };
};

export const prepareComputerUseMcp = async (
  request: RunnerRequest,
): Promise<PreparedComputerUseMcp> => {
  const mcpServerPath = request.computerUseMcpServerPath?.trim() ?? "";
  const binding = request.computerUseBinding;
  if (!mcpServerPath || binding === undefined) {
    return { servers: [], cleanup: async () => undefined };
  }
  assertAbsolutePath(mcpServerPath, "computer_use_mcp_server_path");
  assertAbsolutePath(request.workspaceRoot, "workspace_root");
  const config = decodeConfig({
    version: 1,
    runKind: request.runKind ?? "parent",
    mcpServerPath,
    workspaceRoot: request.workspaceRoot,
    model: request.model ?? null,
    effort: request.effort ?? null,
    viewport: computerUseViewport(),
    binding: {
      parentRunId: binding.parentRunId,
      childRunId: binding.childRunId,
      agentId: binding.agentId,
      managedComputerId: binding.managedComputerId,
      displayIndex: binding.displayIndex,
      ownerToken: binding.ownerToken,
      provider: agentProviderFromProto(binding.provider),
    },
  });
  const directory = await mkdtemp(join(tmpdir(), "briar-computer-use-"));
  await chmod(directory, 0o700);
  const configPath = join(directory, "mcp.json");
  await writeFile(configPath, `${JSON.stringify(config)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await chmod(configPath, 0o600);
  return {
    servers: [{
      name: "briar-computer",
      command: process.execPath,
      args: [mcpServerPath, "--config", configPath],
      env: {},
    }],
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
};

export const readComputerUseMcpConfig = async (
  configPath: string,
): Promise<ComputerUseMcpConfig> => {
  assertAbsolutePath(configPath, "Computer Use MCP config path");
  const metadata = await lstat(configPath);
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || (metadata.mode & 0o077) !== 0
  ) {
    throw new Error("Computer Use MCP config must be a private regular file");
  }
  const config = decodeConfig(JSON.parse(await readFile(configPath, "utf8")));
  assertAbsolutePath(config.mcpServerPath, "mcpServerPath");
  assertAbsolutePath(config.workspaceRoot, "workspaceRoot");
  return config;
};
