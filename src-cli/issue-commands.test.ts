import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const projectId = "11111111-1111-4111-8111-111111111111";
const dependentRunId = "22222222-2222-4222-8222-222222222222";
const prerequisiteRunId = "33333333-3333-4333-8333-333333333333";
const temporaryDirectories: string[] = [];
const servers: Server[] = [];

async function cliConfig(apiUrl: string) {
  const directory = await mkdtemp(join(tmpdir(), "briar-issue-cli-"));
  temporaryDirectories.push(directory);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "config.json"),
    `${JSON.stringify({
      apiUrl,
      userToken: "user-token",
      projects: [{
        id: projectId,
        repositoryPath: process.cwd(),
        agentToken: "briar_agent_test",
        apiUrl,
      }],
    })}\n`,
  );
  return directory;
}

async function runCli(configDirectory: string, command: string[]) {
  const environment = { ...process.env };
  for (const name of ["BRIAR_API_URL", "BRIAR_CONFIG_HOME", "BRIAR_PROJECT_ID"]) {
    delete environment[name];
  }
  const child = spawn("bun", ["run", "src-cli/index.ts", ...command], {
    cwd: process.cwd(),
    env: { ...environment, BRIAR_CONFIG_HOME: configDirectory },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
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
    body: unknown;
  }) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>,
) {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const result = await handler({
      method: request.method ?? "GET",
      url: `http://${request.headers.host}${request.url}`,
      authorization: request.headers.authorization,
      body: rawBody ? JSON.parse(rawBody) : null,
    });
    if (result.body === undefined) {
      response.writeHead(result.status).end();
      return;
    }
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

describe("issue CLI commands", () => {
  it("creates an issue in the connected project with the requested fields", async () => {
    let received: { url: string; authorization: string | null; body: unknown } | null = null;
    const apiUrl = await startServer(async (request) => {
      received = {
        url: request.url,
        authorization: request.authorization ?? null,
        body: request.body,
      };
      return {
        status: 201,
        body: {
          runId: dependentRunId,
          sourceKey: "briar-issue:new",
          stage: "queued",
          status: "backlog",
          attachments: [],
        },
      };
    });
    const directory = await cliConfig(apiUrl);

    const result = await runCli(directory, [
      "issue", "create",
      "--title", "CLI-created issue",
      "--description", "Created from automation",
      "--priority", "2",
      "--status", "backlog",
    ]);

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      runId: dependentRunId,
      status: "backlog",
    });
    expect(received).toEqual({
      url: `${apiUrl}/projects/${projectId}/issues`,
      authorization: "Bearer user-token",
      body: {
        title: "CLI-created issue",
        description: "Created from automation",
        priority: 2,
        status: "backlog",
      },
    });
  });

  it("adds and removes a prerequisite using the dependency endpoint", async () => {
    const requests: Array<{
      method: string;
      url: string;
      authorization: string | undefined;
    }> = [];
    const apiUrl = await startServer((request) => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.authorization,
      });
      if (request.method === "DELETE") return { status: 204 };
      return {
        status: 201,
        body: { dependentRunId, prerequisiteRunId, outcome: "created" },
      };
    });
    const directory = await cliConfig(apiUrl);
    const command = [
      "--dependent-run", dependentRunId,
      "--prerequisite-run", prerequisiteRunId,
    ];

    const added = await runCli(directory, ["issue", "dependency", "add", ...command]);
    const removed = await runCli(directory, [
      "issue", "dependency", "remove", ...command,
    ]);

    expect(added).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(added.stdout)).toMatchObject({ outcome: "created" });
    expect(removed).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(removed.stdout)).toEqual({
      dependentRunId,
      prerequisiteRunId,
      outcome: "removed",
    });
    const endpoint =
      `${apiUrl}/projects/${projectId}/runs/${dependentRunId}` +
      `/dependencies/${prerequisiteRunId}`;
    expect(requests).toEqual([
      { method: "PUT", url: endpoint, authorization: "Bearer user-token" },
      { method: "DELETE", url: endpoint, authorization: "Bearer user-token" },
    ]);
  });

  it("surfaces dependency validation errors returned by the API", async () => {
    const apiUrl = await startServer(() => ({
      status: 409,
      body: { message: "Dependency would create a cycle" },
    }));
    const directory = await cliConfig(apiUrl);

    const result = await runCli(directory, [
      "issue", "dependency", "add",
      "--dependent-run", dependentRunId,
      "--prerequisite-run", prerequisiteRunId,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Dependency would create a cycle");
    expect(result.stdout).toBe("");
  });

  it("rejects invalid issue input before sending a request", async () => {
    let requestCount = 0;
    const apiUrl = await startServer(() => {
      requestCount += 1;
      return { status: 200, body: {} };
    });
    const directory = await cliConfig(apiUrl);

    const result = await runCli(directory, [
      "issue", "create", "--title", "Invalid priority", "--priority", "5",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Too big");
    expect(requestCount).toBe(0);
  });
});
