import { describe, expect, it, vi } from "vitest";
import {
  publishGitHubAppCommitStatus,
  StaleGitHubMergeGroupError,
  verifyAuthoritativeMergeGroup,
  verifySealedMergeGroup,
} from "./github-app";

const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const authorityInput = {
  accessToken: "scoped-installation-token",
  repository: "wordbricks/briar",
  baseRef: "refs/heads/main",
  baseSha,
  headRef: "refs/heads/gh-readonly-queue/main/pr-42-deadbeef",
  headSha,
};

describe("GitHub App merge-group boundary", () => {
  it("paginates and accepts only the exact consecutive sealed active window", async () => {
    const members = [1, 2, 3].map((number) => ({
      projectId: "project",
      runId: `run-${number}`,
      attempt: 1,
      revision: 1,
      installationId: 1,
      repositoryId: 2,
      repository: "wordbricks/briar",
      pullRequestId: 100 + number,
      pullRequestNodeId: `PR_${number}`,
      pullRequestNumber: number,
      headSha: number.toString().repeat(40),
      baseSha,
      readyAt: `2026-08-21T00:0${number}:00.000Z`,
    }));
    let graphqlPage = 0;
    const entry = (number: number, position: number, syntheticSha?: string) => ({
      id: `MQE_${number}`,
      position,
      enqueuedAt: `2026-08-21T00:0${number}:00.000Z`,
      state: "AWAITING_CHECKS",
      headCommit: { oid: syntheticSha ?? number.toString().repeat(40) },
      pullRequest: {
        id: `PR_${number}`,
        databaseId: 100 + number,
        number,
        headRefOid: number.toString().repeat(40),
      },
    });
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("gh-readonly-queue")) {
        return Response.json({ object: { sha: headSha } });
      }
      if (target.endsWith("/git/ref/heads/main")) {
        return Response.json({ object: { sha: baseSha } });
      }
      graphqlPage += 1;
      return Response.json({
        data: {
          repository: {
            mergeQueue: {
              entries: graphqlPage === 1
                ? {
                    nodes: [entry(3, 12, headSha), entry(2, 11)],
                    pageInfo: { hasNextPage: true, endCursor: "page-2" },
                  }
                : {
                    nodes: [entry(1, 10)],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
            },
          },
        },
      });
    });
    await expect(verifySealedMergeGroup({
      accessToken: "token",
      repository: "wordbricks/briar",
      baseRef: "refs/heads/main",
      baseSha,
      headRef: `refs/heads/gh-readonly-queue/main/pr-3-${members[2]!.headSha.slice(0, 8)}`,
      headSha,
      expectedMembers: members,
      fetcher: fetcher as typeof fetch,
    })).resolves.toMatchObject({ tail: { pullRequestNumber: 3 } });
    expect(graphqlPage).toBe(2);
  });

  it("accepts only the exact live ref, base, and authoritative queue tail", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("gh-readonly-queue")) {
        return Response.json({ object: { sha: headSha } });
      }
      if (target.endsWith("/git/ref/heads/main")) {
        return Response.json({ object: { sha: baseSha } });
      }
      return Response.json({
        data: {
          repository: {
            mergeQueue: {
              entries: {
                nodes: [{
                  position: 3,
                  enqueuedAt: "2026-08-21T00:00:00.000Z",
                  state: "AWAITING_CHECKS",
                  headCommit: { oid: `deadbeef${"c".repeat(32)}` },
                  pullRequest: { number: 42 },
                }, {
                  position: 4,
                  enqueuedAt: "2026-08-21T00:01:00.000Z",
                  state: "QUEUED",
                  headCommit: { oid: `feedface${"d".repeat(32)}` },
                  pullRequest: { number: 43 },
                }],
              },
            },
          },
        },
      });
    });
    await expect(verifyAuthoritativeMergeGroup({
      ...authorityInput,
      fetcher: fetcher as typeof fetch,
    })).resolves.toEqual({
      tailPullRequestNumber: 42,
      tailPosition: 3,
      tailEnqueuedAt: "2026-08-21T00:00:00.000Z",
    });
  });

  it("rejects an earlier cumulative head once GitHub exposes a newer active tail", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("gh-readonly-queue")) {
        return Response.json({ object: { sha: headSha } });
      }
      if (target.endsWith("/git/ref/heads/main")) {
        return Response.json({ object: { sha: baseSha } });
      }
      return Response.json({
        data: {
          repository: {
            mergeQueue: {
              entries: {
                nodes: [{
                  position: 3,
                  enqueuedAt: "2026-08-21T00:00:00.000Z",
                  state: "AWAITING_CHECKS",
                  headCommit: { oid: `deadbeef${"c".repeat(32)}` },
                  pullRequest: { number: 42 },
                }, {
                  position: 4,
                  enqueuedAt: "2026-08-21T00:01:00.000Z",
                  state: "AWAITING_CHECKS",
                  headCommit: { oid: `feedface${"d".repeat(32)}` },
                  pullRequest: { number: 43 },
                }],
              },
            },
          },
        },
      });
    });
    await expect(verifyAuthoritativeMergeGroup({
      ...authorityInput,
      fetcher: fetcher as typeof fetch,
    })).rejects.toBeInstanceOf(StaleGitHubMergeGroupError);
  });

  it("binds the merge ref suffix to the current queue entry head commit", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("gh-readonly-queue")) {
        return Response.json({ object: { sha: headSha } });
      }
      if (target.endsWith("/git/ref/heads/main")) {
        return Response.json({ object: { sha: baseSha } });
      }
      return Response.json({
        data: {
          repository: {
            mergeQueue: {
              entries: {
                nodes: [{
                  position: 3,
                  enqueuedAt: "2026-08-21T00:00:00.000Z",
                  state: "AWAITING_CHECKS",
                  headCommit: { oid: `feedface${"d".repeat(32)}` },
                  pullRequest: { number: 42 },
                }],
              },
            },
          },
        },
      });
    });
    await expect(verifyAuthoritativeMergeGroup({
      ...authorityInput,
      fetcher: fetcher as typeof fetch,
    })).rejects.toBeInstanceOf(StaleGitHubMergeGroupError);
  });

  it("classifies only live-ref absence or authority mismatch as stale", async () => {
    const missingHead = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(verifyAuthoritativeMergeGroup({
      ...authorityInput,
      fetcher: missingHead as typeof fetch,
    })).rejects.toBeInstanceOf(StaleGitHubMergeGroupError);

    const outage = vi.fn(async () => new Response(null, { status: 503 }));
    await expect(verifyAuthoritativeMergeGroup({
      ...authorityInput,
      fetcher: outage as typeof fetch,
    })).rejects.not.toBeInstanceOf(StaleGitHubMergeGroupError);
  });

  it("publishes a fixed result to the claimed SHA using only the supplied App token", async () => {
    const fetcher = vi.fn(async (
      _url: string | URL | Request,
      _init?: RequestInit,
    ) => Response.json({
      id: 99,
      context: "signoff/security",
      state: "success",
      created_at: "2026-08-21T00:00:00.000Z",
      creator: { id: 12345, login: "briar[bot]" },
    }));
    await expect(publishGitHubAppCommitStatus({
      accessToken: "short-lived-app-token",
      repository: "wordbricks/briar",
      headSha,
      context: "signoff/security",
      passed: true,
      targetUrl: `https://github.com/wordbricks/briar/commit/${headSha}`,
      fetcher: fetcher as typeof fetch,
    })).resolves.toMatchObject({ id: 99, creator: { id: 12345 } });
    expect(fetcher).toHaveBeenCalledWith(
      `https://api.github.com/repos/wordbricks/briar/statuses/${headSha}`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer short-lived-app-token",
        }),
      }),
    );
    const body = JSON.parse(
      (fetcher.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body).toMatchObject({
      state: "success",
      context: "signoff/security",
    });
  });
});
