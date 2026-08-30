import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  GetGitHubIntegrationResponseSchema,
  GitHubInstallationRepositorySchema,
  GitHubPullRequestSchema,
  GitHubPullRequestState,
  ProjectGitHubCredentialSchema,
} from "@briar/contracts/gen/briar/app/v1/github_pb";
import { describe, expect, it } from "vitest";
import {
  githubIntegrationFromProto,
  githubPullRequestFromProto,
  projectGithubCredentialFromProto,
} from "./github-mappers";

const observedAt = timestampFromDate(new Date("2026-08-31T05:06:07.000Z"));

describe("GitHub Connect boundary", () => {
  it("preserves uint64 installation identity without narrowing it", () => {
    const integration = githubIntegrationFromProto(create(
      GetGitHubIntegrationResponseSchema,
      {
        configured: true,
        canManage: true,
        connected: true,
        installationId: 9_007_199_254_740_993n,
        accountLogin: "briar-workspace",
        connectedAt: observedAt,
        repositories: [create(GitHubInstallationRepositorySchema, {
          id: 18_446_744_073_709_551_615n,
          owner: "briar",
          name: "app",
          fullName: "briar/app",
        })],
      },
    ));

    expect(integration.installationId).toBe("9007199254740993");
    expect(integration.repositories[0]?.id).toBe("18446744073709551615");
    expect(integration.connectedAt).toBe("2026-08-31T05:06:07.000Z");
  });

  it("fails closed on incomplete identity and unsafe or inconsistent values", () => {
    expect(() => githubIntegrationFromProto(create(
      GetGitHubIntegrationResponseSchema,
      { connected: true },
    ))).toThrow("identity is incomplete");

    expect(() => projectGithubCredentialFromProto(create(
      ProjectGitHubCredentialSchema,
      {
        repositoryId: 9_007_199_254_740_993n,
        expiresAt: observedAt,
      },
    ))).toThrow("safe integer range");

    expect(() => githubPullRequestFromProto(create(GitHubPullRequestSchema, {
      repositoryId: 1n,
      pullRequestId: 2n,
      pullRequestNumber: 3n,
      state: GitHubPullRequestState.MERGED,
      merged: false,
    }))).toThrow("merge state is inconsistent");
  });
});
