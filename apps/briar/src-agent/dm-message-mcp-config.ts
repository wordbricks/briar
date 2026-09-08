import { Buffer } from "node:buffer";
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { RunnerRequest } from "./runner-request";
import type { StdioMcpServer } from "./computer-use-mcp-config";

export type DmMessageMcpConfig = {
  readonly version: 1;
  readonly invocationId: string;
  readonly socketPath: string;
  readonly capability: string;
  readonly expiresAt: string;
};

export type PreparedDmMessageMcp = {
  readonly servers: StdioMcpServer[];
  cleanup(): Promise<void>;
};

const assertAbsolutePath = (path: string, field: string) => {
  if (!isAbsolute(path)) throw new Error(`${field} must be an absolute path`);
};

const decodeConfig = (value: unknown): DmMessageMcpConfig => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("DM message MCP config is invalid");
  }
  const config = value as Record<string, unknown>;
  if (config.version !== 1 || typeof config.invocationId !== "string" ||
      typeof config.socketPath !== "string" || typeof config.capability !== "string" ||
      !/^[A-Za-z0-9_-]{22,128}$/u.test(config.capability) ||
      typeof config.expiresAt !== "string") {
    throw new Error("DM message MCP config is invalid");
  }
  assertAbsolutePath(config.socketPath, "socketPath");
  const expiresAt = new Date(config.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw new Error("DM message MCP config is expired");
  }
  return config as DmMessageMcpConfig;
};

export const prepareDmMessageMcp = async (
  request: RunnerRequest,
): Promise<PreparedDmMessageMcp> => {
  const serverPath = request.dmMessageMcpServerPath?.trim() ?? "";
  const binding = request.dmMessagePublicationBinding;
  if (!serverPath && binding === undefined) {
    return { servers: [], cleanup: async () => undefined };
  }
  if (!serverPath || binding === undefined || binding.protocol !== 1 ||
      !binding.expiresAt || !binding.invocationId || binding.capability.length < 16) {
    throw new Error("DM message MCP binding is incomplete");
  }
  assertAbsolutePath(serverPath, "dm_message_mcp_server_path");
  assertAbsolutePath(binding.socketPath, "dm_message_publication_binding.socket_path");
  const expiresAt = timestampDate(binding.expiresAt);
  const config = decodeConfig({
    version: 1,
    invocationId: binding.invocationId,
    socketPath: binding.socketPath,
    capability: Buffer.from(binding.capability).toString("base64url"),
    expiresAt: expiresAt.toISOString(),
  });
  const directory = await mkdtemp(join(tmpdir(), "briar-dm-message-"));
  await chmod(directory, 0o700);
  const configPath = join(directory, "mcp.json");
  await writeFile(configPath, `${JSON.stringify(config)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return {
    servers: [{
      name: "briar-dm-message",
      command: process.execPath,
      args: [serverPath, "--config", configPath],
      env: {},
    }],
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
};

export const readDmMessageMcpConfig = async (path: string) => {
  assertAbsolutePath(path, "DM message MCP config path");
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new Error("DM message MCP config must be a private regular file");
  }
  return decodeConfig(JSON.parse(await readFile(path, "utf8")));
};
