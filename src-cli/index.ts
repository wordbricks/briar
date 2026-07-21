#!/usr/bin/env bun

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, join, resolve } from "node:path";
import { z } from "zod";

const stages = [
  "queued",
  "analyzing",
  "implementing",
  "pr_open",
  "staging_qa",
  "production_qa",
  "completed",
  "blocked",
  "failed",
  "cancelled",
] as const;

const configSchema = z.object({
  apiUrl: z.string().url(),
  userToken: z.string().optional(),
  projects: z
    .array(
      z.object({
        id: z.string().uuid(),
        repositoryPath: z.string(),
        agentToken: z.string(),
      }),
    )
    .default([]),
});

type Config = z.infer<typeof configSchema>;
const configDirectory = join(homedir(), ".config", "briar");
const configPath = join(configDirectory, "config.json");
const defaultApiUrl =
  process.env.BRIAR_API_URL ?? "http://127.0.0.1:8787";

const args = process.argv.slice(2);
const value = (name: string) => {
  const index = args.lastIndexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const required = (name: string) => {
  const result = value(name);
  if (!result) throw new Error(`${name} is required`);
  return result;
};

async function loadConfig(): Promise<Config> {
  try {
    return configSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
  } catch {
    return { apiUrl: defaultApiUrl, projects: [] };
  }
}

async function saveConfig(config: Config) {
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(configPath, 0o600);
}

async function request<T>(
  apiUrl: string,
  path: string,
  token: string | null,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiUrl.replace(/\/$/u, "")}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      body?.message ??
        body?.error_description ??
        body?.error ??
        `request failed (${response.status})`,
    );
  }
  return body as T;
}

async function openBrowser(url: string) {
  const command =
    platform() === "darwin"
      ? ["open", url]
      : platform() === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  const process = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
  await process.exited;
}

async function login() {
  const config = await loadConfig();
  const code = await request<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    interval?: number;
  }>(config.apiUrl, "/api/auth/device/code", null, {
    method: "POST",
    body: JSON.stringify({ client_id: "briar-cli", scope: "openid profile email" }),
  });
  console.log(`Briar 로그인 코드: ${code.user_code}`);
  console.log("시스템 브라우저에서 Google 로그인과 기기 승인을 완료하세요.");
  await openBrowser(code.verification_uri_complete ?? code.verification_uri);

  let interval = (code.interval ?? 5) * 1_000;
  for (;;) {
    await Bun.sleep(interval);
    try {
      const token = await request<{ access_token?: string }>(
        config.apiUrl,
        "/api/auth/device/token",
        null,
        {
          method: "POST",
          body: JSON.stringify({
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: code.device_code,
            client_id: "briar-cli",
          }),
        },
      );
      if (!token.access_token) continue;
      config.userToken = token.access_token;
      await saveConfig(config);
      const me = await request<{ user: { name: string; email: string } }>(
        config.apiUrl,
        "/me",
        token.access_token,
      );
      console.log(`${me.user.name} (${me.user.email}) 계정으로 로그인했습니다.`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error);
      if (message.includes("pending")) continue;
      if (message.includes("slow")) {
        interval += 5_000;
        continue;
      }
      throw error;
    }
  }
}

async function createProject() {
  const config = await loadConfig();
  if (!config.userToken) throw new Error("먼저 `briar login`을 실행하세요.");
  const repositoryPath = resolve(value("--repository") ?? process.cwd());
  const name = value("--name") ?? basename(repositoryPath);
  const result = await request<{
    project: { id: string; name: string; repositoryPath: string };
    agentToken: string;
  }>(config.apiUrl, "/projects", config.userToken, {
    method: "POST",
    body: JSON.stringify({ name, repositoryPath }),
  });
  config.projects = [
    ...config.projects.filter((project) => project.id !== result.project.id),
    {
      id: result.project.id,
      repositoryPath,
      agentToken: result.agentToken,
    },
  ];
  await saveConfig(config);
  console.log(`프로젝트 ${result.project.name}을 연결했습니다.`);
  console.log(`Project ID: ${result.project.id}`);
}

async function connectProject() {
  const config = await loadConfig();
  const projectId = required("--project-id");
  const agentToken = required("--agent-token");
  const repositoryPath = resolve(value("--repository") ?? process.cwd());
  config.projects = [
    ...config.projects.filter((project) => project.id !== projectId),
    { id: projectId, repositoryPath, agentToken },
  ];
  await saveConfig(config);
  console.log(`${repositoryPath}를 Briar 프로젝트 ${projectId}에 연결했습니다.`);
}

async function gitValue(gitArgs: string[]) {
  const result = Bun.spawnSync(["git", ...gitArgs], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "ignore",
  });
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

async function recordHunt() {
  const config = await loadConfig();
  const repositoryPath = resolve(process.cwd());
  const project = [...config.projects]
    .sort((a, b) => b.repositoryPath.length - a.repositoryPath.length)
    .find(
      (candidate) =>
        repositoryPath === candidate.repositoryPath ||
        repositoryPath.startsWith(`${candidate.repositoryPath}/`),
    );
  const agentToken = process.env.BRIAR_AGENT_TOKEN ?? project?.agentToken;
  if (!agentToken) {
    throw new Error("연결된 프로젝트가 없습니다. `briar project create` 또는 `briar connect`를 실행하세요.");
  }
  const branch = value("--branch") ?? (await gitValue(["branch", "--show-current"]));
  const commitSha = value("--commit-sha") ?? (await gitValue(["rev-parse", "HEAD"]));
  const remote = await gitValue(["remote", "get-url", "origin"]);
  const repository = value("--repository") ?? remote ?? repositoryPath;
  const input = {
    source: value("--source") ?? "issue",
    sourceKey: required("--source-key"),
    title: required("--title"),
    stage: required("--stage"),
    eventKey: required("--event-key"),
    occurredAt: value("--occurred-at") ?? new Date().toISOString(),
    actor: value("--actor") ?? "codex",
    repository,
    detail: value("--detail") ?? null,
    branch: branch || null,
    commitSha: commitSha || null,
  };
  z.object({
    source: z.enum(["issue", "error", "feedback"]),
    sourceKey: z.string().min(1),
    title: z.string().min(1),
    stage: z.enum(stages),
    eventKey: z.string().min(1),
    occurredAt: z.string().datetime({ offset: true }),
    actor: z.string().min(1),
    repository: z.string().min(1),
    detail: z.string().nullable(),
    branch: z.string().nullable(),
    commitSha: z.string().regex(/^[0-9a-f]{7,64}$/u).nullable(),
  }).parse(input);
  const result = await request<{ runId: string; stage: string }>(
    config.apiUrl,
    "/ingest/events",
    agentToken,
    { method: "POST", body: JSON.stringify(input) },
  );
  console.log(JSON.stringify(result));
}

const usage = `Briar CLI

  briar login
  briar project create [--name <name>] [--repository <path>]
  briar connect --project-id <uuid> --agent-token <token> [--repository <path>]
  briar hunt record --source-key <key> --title <title> --stage <stage> --event-key <key>

Environment:
  BRIAR_API_URL       Cloudflare Worker URL
  BRIAR_AGENT_TOKEN   Project-scoped ingest token
`;

async function main() {
  if (args[0] === "login") return login();
  if (args[0] === "project" && args[1] === "create") return createProject();
  if (args[0] === "connect") return connectProject();
  if (args[0] === "hunt" && args[1] === "record") return recordHunt();
  console.log(usage);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
