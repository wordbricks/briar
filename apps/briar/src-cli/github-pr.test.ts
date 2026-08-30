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
const identity = {
  repositoryId: 701,
  repository: "wordbricks/briar",
  pullRequestId: 501,
  pullRequestNodeId: "PR_kwDOExample",
  pullRequestNumber: 417,
};
const githubResponse = (body: string) => ({ pullRequest: { body, ...identity } });

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

  it("adds a missing Briar issue link through the project GitHub API", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(githubResponse("## Summary\n\nShipped.\n"))
      .mockResolvedValueOnce({});

    await expect(
      ensureBriarIssueLinkInGithubPullRequest(
        {
          apiUrl: "https://briar-api.example",
          projectId,
          token: "project-token",
          pullRequestUrl:
            "https://github.com/wordbricks/briar/pull/417",
          issueUrl,
        },
        send,
      ),
    ).resolves.toEqual({ updated: true, reason: "linked", identity });
    expect(send).toHaveBeenNthCalledWith(
      2,
      `/projects/${projectId}/github/pull-requests/417`,
      {
        method: "PATCH",
        body: JSON.stringify({
          body: `## Summary\n\nShipped.\n\n[Briar issue](${issueUrl})\n`,
        }),
      },
    );
  });

  it("does not update a PR that already links the Briar issue", async () => {
    const send = vi.fn().mockResolvedValue(
      githubResponse(`[Briar issue](${issueUrl})\n`),
    );

    await expect(
      ensureBriarIssueLinkInGithubPullRequest(
        {
          apiUrl: "https://briar-api.example",
          projectId,
          token: "project-token",
          pullRequestUrl:
            "https://github.com/wordbricks/briar/pull/417",
          issueUrl,
        },
        send,
      ),
    ).resolves.toEqual({
      updated: false,
      reason: "already_linked",
      identity,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rejects immutable identity metadata for a different repository", async () => {
    const send = vi.fn().mockResolvedValue({
      pullRequest: {
        body: "",
        ...identity,
        repositoryId: 999,
        repository: "other/repository",
      },
    });

    await expect(
      ensureBriarIssueLinkInGithubPullRequest(
        {
          apiUrl: "https://briar-api.example",
          projectId,
          token: "project-token",
          pullRequestUrl:
            "https://github.com/wordbricks/briar/pull/417",
          issueUrl,
        },
        send,
      ),
    ).rejects.toThrow("did not match the requested PR");
  });
});
