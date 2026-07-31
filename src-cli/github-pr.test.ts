import { describe, expect, it, vi } from "vitest";
import {
  appendBriarIssueLink,
  briarIssueUrl,
  ensureBriarIssueLinkInGithubPullRequest,
  githubPullRequestTarget,
} from "./github-pr";

const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const issueUrl =
  `https://briar-api.example/open/issues/${projectId}/${runId}`;

describe("GitHub PR Briar issue link", () => {
  it("builds the public Briar issue URL from the configured API", () => {
    expect(
      briarIssueUrl(
        "https://briar-api.example/api?stale=true",
        projectId,
        runId,
      ),
    ).toBe(issueUrl);
  });

  it("recognizes canonical GitHub pull request URLs", () => {
    expect(
      githubPullRequestTarget(
        "https://github.com/wordbricks/briar/pull/417",
      ),
    ).toEqual({
      owner: "wordbricks",
      repository: "briar",
      number: "417",
    });
    expect(
      githubPullRequestTarget(
        "https://gitlab.com/wordbricks/briar/pull/417",
      ),
    ).toBeNull();
    expect(
      githubPullRequestTarget(
        "https://github.com/wordbricks/briar/issues/417",
      ),
    ).toBeNull();
  });

  it("appends the Briar issue link without replacing the existing description", () => {
    expect(appendBriarIssueLink("## Summary\n\nShipped.", issueUrl)).toBe(
      `## Summary\n\nShipped.\n\n[Briar issue](${issueUrl})\n`,
    );
    const linked = `Existing\n\n[Briar issue](${issueUrl})\n`;
    expect(appendBriarIssueLink(linked, issueUrl)).toBe(linked);
  });

  it("adds a missing Briar issue link through the GitHub API", () => {
    const run = vi.fn()
      .mockReturnValueOnce({
        exitCode: 0,
        stdout: "## Summary\n\nShipped.\n",
        stderr: "",
      })
      .mockReturnValueOnce({ exitCode: 0, stdout: "{}", stderr: "" });

    expect(
      ensureBriarIssueLinkInGithubPullRequest(
        {
          pullRequestUrl:
            "https://github.com/wordbricks/briar/pull/417",
          issueUrl,
        },
        run,
      ),
    ).toEqual({ updated: true, reason: "linked" });
    expect(run).toHaveBeenNthCalledWith(2, [
      "gh",
      "api",
      "--method",
      "PATCH",
      "repos/wordbricks/briar/pulls/417",
      "--raw-field",
      `body=## Summary\n\nShipped.\n\n[Briar issue](${issueUrl})\n`,
    ]);
  });

  it("does not update a PR that already links the Briar issue", () => {
    const run = vi.fn().mockReturnValue({
      exitCode: 0,
      stdout: `[Briar issue](${issueUrl})\n`,
      stderr: "",
    });

    expect(
      ensureBriarIssueLinkInGithubPullRequest(
        {
          pullRequestUrl:
            "https://github.com/wordbricks/briar/pull/417",
          issueUrl,
        },
        run,
      ),
    ).toEqual({ updated: false, reason: "already_linked" });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
