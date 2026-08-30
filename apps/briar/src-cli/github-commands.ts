import { readFile } from "node:fs/promises";
import {
  args,
  currentProject,
  executionToken,
  has,
  loadConfig,
  request,
  required,
  value,
} from "./command-support";

async function projectGithubRequest<T>(
  path: string,
  init?: RequestInit,
) {
  const config = await loadConfig();
  const project = await currentProject(config);
  return request<T>(
    config.apiUrl,
    `/projects/${project.id}/github${path}`,
    executionToken(project),
    init,
  );
}

async function optionalBody() {
  const body = value("--body");
  const bodyFile = value("--body-file");
  if (body !== undefined && bodyFile !== undefined) {
    throw new Error("Use only one of --body or --body-file");
  }
  return bodyFile ? await readFile(bodyFile, "utf8") : body;
}

export async function githubPullRequestCreateCommand() {
  const result = await projectGithubRequest<{ pullRequest: unknown }>(
    "/pull-requests",
    {
      method: "POST",
      body: JSON.stringify({
        title: required("--title"),
        head: required("--head"),
        base: value("--base") ?? "main",
        body: (await optionalBody()) ?? "",
        draft: has("--draft"),
      }),
    },
  );
  console.log(JSON.stringify(result.pullRequest));
}

export async function githubPullRequestViewCommand() {
  const number = required("--number");
  const result = await projectGithubRequest<{ pullRequest: unknown }>(
    `/pull-requests/${encodeURIComponent(number)}`,
  );
  console.log(JSON.stringify(result.pullRequest));
}

export async function githubPullRequestEditCommand() {
  const number = required("--number");
  const body = await optionalBody();
  const update = {
    ...(value("--title") ? { title: value("--title") } : {}),
    ...(body !== undefined ? { body } : {}),
    ...(value("--base") ? { base: value("--base") } : {}),
    ...(value("--state") ? { state: value("--state") } : {}),
  };
  if (Object.keys(update).length === 0) {
    throw new Error("Provide at least one PR field to update");
  }
  const result = await projectGithubRequest<{ pullRequest: unknown }>(
    `/pull-requests/${encodeURIComponent(number)}`,
    { method: "PATCH", body: JSON.stringify(update) },
  );
  console.log(JSON.stringify(result.pullRequest));
}

export async function githubPullRequestMergeCommand() {
  const number = required("--number");
  const result = await projectGithubRequest<{ merge: unknown }>(
    `/pull-requests/${encodeURIComponent(number)}/merge`,
    {
      method: "PUT",
      body: JSON.stringify({
        mergeMethod: value("--method") ?? "squash",
        ...(value("--head-sha")
          ? { expectedHeadSha: value("--head-sha") }
          : {}),
      }),
    },
  );
  console.log(JSON.stringify(result.merge));
}

export async function githubCommitStatusCommand() {
  await projectGithubRequest("/statuses", {
    method: "POST",
    body: JSON.stringify({
      sha: required("--sha"),
      state: required("--state"),
      context: required("--context"),
      ...(value("--description")
        ? { description: value("--description") }
        : {}),
      ...(value("--target-url") ? { targetUrl: value("--target-url") } : {}),
    }),
  });
  console.log(JSON.stringify({ ok: true }));
}

export async function githubRepositoryCommand() {
  const result = await projectGithubRequest<{ repository: unknown }>(
    "/repository",
  );
  console.log(JSON.stringify(result.repository));
}

export async function githubGraphqlCommand() {
  const variablesJson = value("--variables-json") ?? "{}";
  let variables: unknown;
  try {
    variables = JSON.parse(variablesJson);
  } catch {
    throw new Error("--variables-json must be valid JSON");
  }
  if (!variables || Array.isArray(variables) || typeof variables !== "object") {
    throw new Error("--variables-json must be a JSON object");
  }
  const result = await projectGithubRequest<unknown>("/graphql", {
    method: "POST",
    body: JSON.stringify({ query: required("--query"), variables }),
  });
  console.log(JSON.stringify(result));
}

type CredentialResponse = {
  project: { id: string; organizationId: string };
  repository: { id: number; fullName: string; cloneUrl: string };
  username: string;
  password: string;
  expiresAt: string;
};

const credentialInput = async () => {
  const text = await Bun.stdin.text();
  return Object.fromEntries(
    text.split("\n").flatMap((line) => {
      const separator = line.indexOf("=");
      return separator > 0
        ? [[line.slice(0, separator), line.slice(separator + 1)]]
        : [];
    }),
  );
};

export async function githubCredentialCommand() {
  const operation = args.at(-1);
  if (operation === "store" || operation === "erase") return;
  if (operation !== "get") {
    throw new Error("Git credential operation must be get, store, or erase");
  }
  const input = await credentialInput();
  if (input.protocol !== "https" || input.host !== "github.com") return;
  const credential = await projectGithubRequest<CredentialResponse>(
    "/credentials",
    { method: "POST" },
  );
  const expectedPath = `${credential.repository.fullName}.git`.toLowerCase();
  const requestedPath = input.path?.replace(/^\//u, "").toLowerCase();
  if (requestedPath && requestedPath !== expectedPath) return;
  process.stdout.write(
    `username=${credential.username}\npassword=${credential.password}\n\n`,
  );
}
