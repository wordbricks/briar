export type GithubCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type GithubCommandRunner = (
  command: string[],
) => GithubCommandResult;

type GithubPullRequestTarget = {
  owner: string;
  repository: string;
  number: string;
};

export type GithubPullRequestIdentity = {
  repositoryId: number;
  repository: string;
  pullRequestId: number;
  pullRequestNodeId: string;
  pullRequestNumber: number;
};

type GithubPullRequestInspection = GithubPullRequestIdentity & {
  body: string;
};

export function briarIssueUrl(
  apiUrl: string,
  projectId: string,
  runId: string,
) {
  const url = new URL(apiUrl);
  url.pathname = `/open/issues/${encodeURIComponent(projectId)}/${encodeURIComponent(runId)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function githubPullRequestTarget(
  value: string,
): GithubPullRequestTarget | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    return null;
  }
  const match = url.pathname.match(
    /^\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)\/?$/u,
  );
  return match
    ? { owner: match[1], repository: match[2], number: match[3] }
    : null;
}

export function appendBriarIssueLink(body: string, issueUrl: string) {
  if (body.includes(issueUrl)) return body;
  const existing = body.trimEnd();
  return `${existing}${existing ? "\n\n" : ""}[Briar issue](${issueUrl})\n`;
}

const runGithubCommand: GithubCommandRunner = (command) => {
  const result = Bun.spawnSync({
    cmd: command,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

function parseGithubPullRequestInspection(
  stdout: string,
  target: GithubPullRequestTarget,
): GithubPullRequestInspection {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error("GitHub PR metadata response was not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("GitHub PR metadata response was invalid");
  }
  const record = value as Record<string, unknown>;
  const repository = typeof record.repository === "string"
    ? record.repository.trim().toLowerCase()
    : "";
  const expectedRepository =
    `${target.owner}/${target.repository}`.toLowerCase();
  if (
    typeof record.body !== "string" ||
    !Number.isSafeInteger(record.repositoryId) ||
    Number(record.repositoryId) <= 0 ||
    repository !== expectedRepository ||
    !Number.isSafeInteger(record.pullRequestId) ||
    Number(record.pullRequestId) <= 0 ||
    typeof record.pullRequestNodeId !== "string" ||
    record.pullRequestNodeId.trim().length === 0 ||
    !Number.isSafeInteger(record.pullRequestNumber) ||
    Number(record.pullRequestNumber) !== Number(target.number)
  ) {
    throw new Error("GitHub PR metadata response did not match the requested PR");
  }
  return {
    body: record.body,
    repositoryId: Number(record.repositoryId),
    repository,
    pullRequestId: Number(record.pullRequestId),
    pullRequestNodeId: record.pullRequestNodeId.trim(),
    pullRequestNumber: Number(record.pullRequestNumber),
  };
}

export function ensureBriarIssueLinkInGithubPullRequest(
  input: {
    pullRequestUrl: string;
    issueUrl: string;
  },
  run: GithubCommandRunner = runGithubCommand,
) {
  const target = githubPullRequestTarget(input.pullRequestUrl);
  if (!target) return { updated: false, reason: "not_github" as const };

  const endpoint =
    `repos/${target.owner}/${target.repository}/pulls/${target.number}`;
  const current = run([
    "gh",
    "api",
    endpoint,
    "--jq",
    "{body: (.body // \"\"), repositoryId: .base.repo.id, repository: .base.repo.full_name, pullRequestId: .id, pullRequestNodeId: .node_id, pullRequestNumber: .number}",
  ]);
  if (current.exitCode !== 0) {
    throw new Error(
      `GitHub PR description could not be read: ${current.stderr.trim() || "gh api failed"}`,
    );
  }
  const inspection = parseGithubPullRequestInspection(current.stdout, target);

  const body = appendBriarIssueLink(inspection.body, input.issueUrl);
  if (body === inspection.body) {
    return {
      updated: false,
      reason: "already_linked" as const,
      identity: {
        repositoryId: inspection.repositoryId,
        repository: inspection.repository,
        pullRequestId: inspection.pullRequestId,
        pullRequestNodeId: inspection.pullRequestNodeId,
        pullRequestNumber: inspection.pullRequestNumber,
      },
    };
  }

  const updated = run([
    "gh",
    "api",
    "--method",
    "PATCH",
    endpoint,
    "--raw-field",
    `body=${body}`,
  ]);
  if (updated.exitCode !== 0) {
    throw new Error(
      `Briar issue link could not be added to the GitHub PR description: ${
        updated.stderr.trim() || "gh api failed"
      }`,
    );
  }
  return {
    updated: true,
    reason: "linked" as const,
    identity: {
      repositoryId: inspection.repositoryId,
      repository: inspection.repository,
      pullRequestId: inspection.pullRequestId,
      pullRequestNodeId: inspection.pullRequestNodeId,
      pullRequestNumber: inspection.pullRequestNumber,
    },
  };
}
