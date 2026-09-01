import { create } from "@bufbuild/protobuf";
import {
  GitHubPullRequestIdentitySchema,
} from "@briar/contracts/gen/briar/types/v1/github_identity_pb";
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
const identity = create(GitHubPullRequestIdentitySchema, {
  repositoryId: 701n,
  pullRequestId: 501n,
  pullRequestNodeId: "PR_kwDOExample",
  pullRequestNumber: 417n,
});
const githubResponse = (body: string) => ({
  body,
  identity,
  repository: "wordbricks/briar",
});

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
    const api = {
      getPullRequest: vi.fn()
        .mockResolvedValue(githubResponse("## Summary\n\nShipped.\n")),
      updatePullRequest: vi.fn().mockResolvedValue(undefined),
    };

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
        api,
      ),
    ).resolves.toEqual({ updated: true, reason: "linked", identity });
    expect(api.updatePullRequest).toHaveBeenCalledWith({
      projectId,
      pullRequestNumber: 417n,
      body: `## Summary\n\nShipped.\n\n[Briar issue](${issueUrl})\n`,
    });
  });

  it("does not update a PR that already links the Briar issue", async () => {
    const api = {
      getPullRequest: vi.fn().mockResolvedValue(
        githubResponse(`[Briar issue](${issueUrl})\n`),
      ),
      updatePullRequest: vi.fn().mockResolvedValue(undefined),
    };

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
        api,
      ),
    ).resolves.toEqual({
      updated: false,
      reason: "already_linked",
      identity,
    });
    expect(api.getPullRequest).toHaveBeenCalledTimes(1);
    expect(api.updatePullRequest).not.toHaveBeenCalled();
  });

  it("rejects immutable identity metadata for a different repository", async () => {
    const api = {
      getPullRequest: vi.fn().mockResolvedValue({
        body: "",
        repository: "other/repository",
        identity: create(GitHubPullRequestIdentitySchema, {
          ...identity,
          repositoryId: 999n,
        }),
      }),
      updatePullRequest: vi.fn().mockResolvedValue(undefined),
    };

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
        api,
      ),
    ).rejects.toThrow("did not match the requested PR");
    expect(api.updatePullRequest).not.toHaveBeenCalled();
  });
});
