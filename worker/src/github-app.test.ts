import { describe, expect, it, vi } from "vitest";
import {
  publishGitHubAppCommitStatus,
  StaleGitHubMergeGroupError,
  verifyAuthoritativeMergeGroup,
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
