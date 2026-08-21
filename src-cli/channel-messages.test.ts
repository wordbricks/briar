import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const projectId = "11111111-1111-4111-8111-111111111111";
const channelId = "22222222-2222-4222-8222-222222222222";
const parentMessageId = "33333333-3333-4333-8333-333333333333";
const cursor = "44444444-4444-4444-8444-444444444444";
const temporaryDirectories: string[] = [];
const servers: Server[] = [];

async function cliConfig(apiUrl: string) {
  const directory = await mkdtemp(join(tmpdir(), "briar-channel-cli-"));
  temporaryDirectories.push(directory);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify({
      apiUrl,
      projects: [{
        id: projectId,
        repositoryPath: process.cwd(),
        agentToken: "briar_agent_channel_cli_test",
        apiUrl,
      }],
    })}\n`,
  );
  return directory;
}

async function runCli(configDirectory: string, command: string[]) {
  const environment = { ...process.env };
  for (const name of [
    "BRIAR_API_URL",
    "BRIAR_CONFIG_HOME",
    "BRIAR_PROJECT_ID",
    "BRIAR_AGENT_TOKEN",
    "BRIAR_WORKER_TOKEN",
  ]) {
    delete environment[name];
  }
  const child = spawn("bun", ["run", "src-cli/index.ts", ...command], {
    cwd: process.cwd(),
    env: { ...environment, BRIAR_CONFIG_HOME: configDirectory },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
  });
  return { stdout, stderr, exitCode };
}

async function startServer(
  handler: (request: {
    method: string;
    url: string;
    authorization: string | undefined;
  }) => { status: number; body: unknown },
) {
  const server = createServer((request, response) => {
    const result = handler({
      method: request.method ?? "GET",
      url: `http://${request.headers.host}${request.url}`,
      authorization: request.headers.authorization,
    });
    response.writeHead(result.status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(result.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("channel messages CLI", () => {
  it("documents the history and thread options in command help", async () => {
    const apiUrl = await startServer(() => ({ status: 500, body: {} }));
    const directory = await cliConfig(apiUrl);

    const result = await runCli(directory, ["channel", "messages", "--help"]);

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("--channel-id uuid");
    expect(result.stdout).toContain("--cursor message-uuid");
    expect(result.stdout).toContain("--parent-message-id root-message-uuid");
  });

  it("requests a paginated thread with the connected Project Agent token", async () => {
    let received: {
      method: string;
      url: string;
      authorization: string | undefined;
    } | null = null;
    const responseBody = {
      channel: { id: channelId, name: "History" },
      messages: [{ id: cursor, body: "Earlier reply", attachments: [] }],
      nextCursor: null,
    };
    const apiUrl = await startServer((request) => {
      received = request;
      return { status: 200, body: responseBody };
    });
    const directory = await cliConfig(apiUrl);

    const result = await runCli(directory, [
      "channel",
      "messages",
      "--channel-id",
      channelId,
      "--parent-message-id",
      parentMessageId,
      "--limit",
      "25",
      "--cursor",
      cursor,
    ]);

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toEqual(responseBody);
    expect(received).toEqual({
      method: "GET",
      url:
        `${apiUrl}/projects/${projectId}/channels/${channelId}/messages` +
        `?limit=25&cursor=${cursor}&parentMessageId=${parentMessageId}`,
      authorization: "Bearer briar_agent_channel_cli_test",
    });
  });

  it("surfaces channel access errors and validates the page size locally", async () => {
    let requests = 0;
    const apiUrl = await startServer(() => {
      requests += 1;
      return {
        status: 403,
        body: {
          message: "No Project Agent for this project has access to the channel",
        },
      };
    });
    const directory = await cliConfig(apiUrl);

    const forbidden = await runCli(directory, [
      "channel",
      "messages",
      "--channel-id",
      channelId,
    ]);
    expect(forbidden.exitCode).toBe(1);
    expect(forbidden.stderr).toContain(
      "No Project Agent for this project has access to the channel",
    );

    const invalid = await runCli(directory, [
      "channel",
      "messages",
      "--channel-id",
      channelId,
      "--limit",
      "101",
    ]);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toContain("Too big");
    expect(requests).toBe(1);
  });
});
