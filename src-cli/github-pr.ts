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
    '.body // ""',
  ]);
  if (current.exitCode !== 0) {
    throw new Error(
      `GitHub PR description could not be read: ${current.stderr.trim() || "gh api failed"}`,
    );
  }

  const body = appendBriarIssueLink(current.stdout, input.issueUrl);
  if (body === current.stdout) {
    return { updated: false, reason: "already_linked" as const };
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
  return { updated: true, reason: "linked" as const };
}
