import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { channelReplyClaimTokenHeader } from "../src/lib/channels-contract";
import {
  cleanupOrphanedOrganizationAgentWorkspaces,
  downloadOrganizationAgentContext,
  downloadOrganizationAgentContextManifest,
  hydrateOrganizationAgentContext,
  organizationAgentContextDirectory,
  prepareOrganizationAgentWorkspace,
} from "./organization-agent-context";

const organizationId = "11111111-1111-4111-8111-111111111111";
const workId = "22222222-2222-4222-8222-222222222222";
const workerId = "33333333-3333-4333-8333-333333333333";
const projectA = "44444444-4444-4444-8444-444444444444";
const projectB = "55555555-5555-4555-8555-555555555555";
const snapshotAt = "2026-08-10T01:00:00.000Z";
const claimToken = `briar_channel_claim_${"a".repeat(64)}`;

const projectItem = (id: string, name: string) => ({
  id,
  name,
  issueKeyPrefix: "AH",
  createdAt: snapshotAt,
  settings: {
    velenOrg: null,
    dataSource: null,
    linear: { enabled: false, source: null, teamKey: null },
    githubRepository: null,
    workflow: {},
  },
});

const agentItem = (id: string) => ({
  id,
  name: "Builder",
  description: "Builds and maintains this project.",
  provider: "codex",
  model: null,
  effort: null,
  responsibility: "Own this project.",
  skills: [],
  createdAt: snapshotAt,
  updatedAt: snapshotAt,
});

const issueItem = (id: string, projectId: string) => ({
  id,
  projectId,
  runNumber: 1,
  source: "issue",
  sourceKey: "AH-1",
  title: "Issue",
  status: "backlog",
  workflowStage: null,
  detail: null,
  priority: null,
  assigneeUserId: null,
  agentId: null,
  issueDescription: null,
  resultSummary: null,
  structuredResult: null,
  repository: "wordbricks/briar",
  branch: null,
  commitSha: null,
  targetSha: null,
  tracker: null,
  preferredProvider: null,
  preferredModel: null,
  preferredEffort: null,
  requestedProvider: null,
  requestedModel: null,
  requestedEffort: null,
  stagingQaStatus: null,
  productionQaStatus: null,
  stagingQaDetail: null,
  productionQaDetail: null,
  sourceCreatedAt: null,
  startedAt: snapshotAt,
  createdAt: snapshotAt,
  updatedAt: snapshotAt,
  completedAt: null,
  lastEventAt: snapshotAt,
  eventCount: 0,
  eventCountStable: true,
});

const issuePullRequestItem = (projectId: string) => ({
  issueId: "issue-a",
  projectId,
  runNumber: 1,
  position: 0,
  url: "https://github.com/wordbricks/briar/pull/1",
});

const sessionItem = (id: string, projectId: string) => ({
  id,
  projectId,
  agentId: null,
  status: "completed",
  sessionType: "task",
  payload: { request: "Review status" },
  startedAt: snapshotAt,
  completedAt: snapshotAt,
  updatedAt: snapshotAt,
});

const page = (input: {
  resource:
    | "projects"
    | "agents"
    | "issues"
    | "issue-pull-requests"
    | "agent-sessions";
  projectId: string | null;
  total: number;
  items: unknown[];
  nextCursor?: string | null;
}) => ({
  schemaVersion: 1,
  organizationId,
  workId,
  resource: input.resource,
  projectId: input.projectId,
  snapshotAt,
  total: input.total,
  items: input.items,
  nextCursor: input.nextCursor ?? null,
  complete: (input.nextCursor ?? null) === null,
});

const indexManifest = () => ({
  schemaVersion: 2,
  organizationId,
  workId,
  snapshotAt,
  revision: "a".repeat(64),
  projects: [{
    id: projectA,
    name: "A",
    issueKeyPrefix: "AH",
    createdAt: snapshotAt,
    updatedAt: snapshotAt,
    resources: {
      settings: { revision: snapshotAt },
      agents: { count: 1, revision: snapshotAt },
      issues: {
        count: 1,
        openCount: 1,
        pullRequestCount: 0,
        revision: snapshotAt,
      },
      sessions: { count: 2, archivedCount: 1, revision: snapshotAt },
    },
  }],
  loadedQueries: [],
});

describe("Organization Agent context downloader", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) =>
        rm(path, { recursive: true, force: true })
      ),
    );
  });

  async function workspace() {
    const path = await mkdtemp(join(tmpdir(), "briar-org-context-test-"));
    temporaryDirectories.push(path);
    return path;
  }

  it("removes crashed-process workspaces while preserving live owners", async () => {
    const workspacePath = await workspace();
    const workerSessionsDirectory = join(workspacePath, "worker-sessions");
    const deadWorkspace = join(
      workerSessionsDirectory,
      "channel-11111111-1111-4111-8111-111111111111",
    );
    const liveWorkspace = join(
      workerSessionsDirectory,
      "channel-22222222-2222-4222-8222-222222222222",
    );
    const retainedWorkspace = join(
      workerSessionsDirectory,
      "channel-33333333-3333-4333-8333-333333333333",
    );
    await prepareOrganizationAgentWorkspace(deadWorkspace, 101);
    await prepareOrganizationAgentWorkspace(liveWorkspace, 202);
    await prepareOrganizationAgentWorkspace(retainedWorkspace, 303, {
      reuse: true,
      retainedUntil: new Date(Date.now() + 6 * 60 * 60 * 1_000).toISOString(),
    });

    await cleanupOrphanedOrganizationAgentWorkspaces({
      workerSessionsDirectory,
      isProcessAlive: (pid) => pid === 202,
    });

    await expect(access(deadWorkspace)).rejects.toThrow();
    await expect(access(liveWorkspace)).resolves.toBeUndefined();
    await expect(access(retainedWorkspace)).resolves.toBeUndefined();
    expect((await stat(liveWorkspace)).mode & 0o777).toBe(0o700);
    expect(
      (await stat(join(liveWorkspace, ".briar-workspace-owner.json"))).mode &
        0o777,
    ).toBe(0o600);
  });

  it("downloads only the revision manifest and reuses an unchanged cached index", async () => {
    const firstWorkspace = await workspace();
    const firstFetcher = vi.fn(async (_rawUrl: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("If-None-Match")).toBeNull();
      return new Response(JSON.stringify(indexManifest()), {
        headers: {
          "Content-Type": "application/json",
          ETag: `"${"a".repeat(64)}"`,
        },
      });
    });
    const first = await downloadOrganizationAgentContextManifest({
      apiUrl: "https://briar.example",
      workerToken: "worker-token",
      organizationId,
      workId,
      workerId,
      claimToken,
      snapshotAt,
      workspacePath: firstWorkspace,
      fetcher: firstFetcher,
    });
    expect(first.manifest.projects).toHaveLength(1);
    expect(await readFile(first.manifestPath, "utf8")).not.toContain(
      "Inspect project state",
    );

    const secondWorkspace = await workspace();
    const secondFetcher = vi.fn(async (_rawUrl: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("If-None-Match")).toBe(
        `"${"a".repeat(64)}"`,
      );
      return new Response(null, { status: 304 });
    });
    const second = await downloadOrganizationAgentContextManifest({
      apiUrl: "https://briar.example",
      workerToken: "worker-token",
      organizationId,
      workId,
      workerId,
      claimToken,
      snapshotAt,
      workspacePath: secondWorkspace,
      fetcher: secondFetcher,
    });
    expect(second.manifest.projects).toEqual(first.manifest.projects);
  });

  it("hydrates selected detail files and atomically updates the manifest", async () => {
    const workspacePath = await workspace();
    const fetcher = vi.fn(async (rawUrl: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(rawUrl));
      if (url.pathname.endsWith("/manifest")) {
        return new Response(JSON.stringify(indexManifest()), {
          headers: { "Content-Type": "application/json" },
        });
      }
      expect(url.pathname).toMatch(/\/organization-context\/lookup$/u);
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        workerId,
        requests: [{
          resource: "issues",
          projectId: projectA,
          detail: "summary",
        }],
      });
      return new Response(JSON.stringify({
        schemaVersion: 2,
        organizationId,
        workId,
        snapshotAt,
        results: [{
          request: body.requests[0],
          data: {
            schemaVersion: 2,
            resource: "issues",
            projectId: projectA,
            detail: "summary",
            total: 1,
            items: [{ id: "issue-a", title: "Only requested summary" }],
            nextCursor: null,
            complete: true,
          },
        }],
      }), { headers: { "Content-Type": "application/json" } });
    });
    const prepared = await downloadOrganizationAgentContextManifest({
      apiUrl: "https://briar.example",
      workerToken: "worker-token",
      organizationId,
      workId,
      workerId,
      claimToken,
      snapshotAt,
      workspacePath,
      fetcher,
    });
    const request = {
      resource: "issues" as const,
      projectId: projectA,
      detail: "summary" as const,
      limit: 25,
      cursor: null,
    };
    const hydrated = await hydrateOrganizationAgentContext({
      apiUrl: "https://briar.example",
      workerToken: "worker-token",
      organizationId,
      workId,
      workerId,
      claimToken,
      snapshotAt,
      workspacePath,
      requests: [request],
      fetcher,
    });
    expect(hydrated.loaded).toBe(1);
    expect(hydrated.manifest.loadedQueries).toEqual([
      expect.objectContaining({ request }),
    ]);
    const detailPath = join(
      organizationAgentContextDirectory(workspacePath),
      hydrated.manifest.loadedQueries[0].file,
    );
    expect(await readFile(detailPath, "utf8")).toContain(
      "Only requested summary",
    );
    expect(JSON.parse(await readFile(prepared.manifestPath, "utf8")))
      .toMatchObject({ loadedQueries: [{ request }] });

    const repeated = await hydrateOrganizationAgentContext({
      apiUrl: "https://briar.example",
      workerToken: "worker-token",
      organizationId,
      workId,
      workerId,
      claimToken,
      snapshotAt,
      workspacePath,
      requests: [request],
      fetcher,
    });
    expect(repeated.loaded).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("downloads every page, authenticates each request, and writes manifest last", async () => {
    const workspacePath = await workspace();
    const requests: string[] = [];
    const fetcher = vi.fn(async (rawUrl: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(rawUrl));
      requests.push(`${url.pathname}?${url.searchParams}`);
      const headers = new Headers(init?.headers);
      expect(init?.redirect).toBe("error");
      expect(headers.get("Authorization")).toBe("Bearer worker-token");
      expect(headers.get(channelReplyClaimTokenHeader)).toBe(claimToken);
      expect(url.searchParams.get("workerId")).toBe(workerId);
      expect(url.searchParams.get("limit")).toBe("1");

      let body: unknown;
      if (url.pathname.endsWith("/organization-context/projects")) {
        body = url.searchParams.get("cursor") === null
          ? page({
              resource: "projects",
              projectId: null,
              total: 2,
              items: [projectItem(projectA, "A")],
              nextCursor: "projects-next",
            })
          : page({
              resource: "projects",
              projectId: null,
              total: 2,
              items: [projectItem(projectB, "B")],
            });
      } else if (url.pathname.endsWith(`/${projectA}/issues`)) {
        body = page({
          resource: "issues",
          projectId: projectA,
          total: 1,
          items: [issueItem("issue-a", projectA)],
        });
      } else if (url.pathname.endsWith(`/${projectA}/agents`)) {
        body = page({
          resource: "agents",
          projectId: projectA,
          total: 1,
          items: [agentItem("66666666-6666-4666-8666-666666666666")],
        });
      } else if (
        url.pathname.endsWith(`/${projectA}/issue-pull-requests`)
      ) {
        body = page({
          resource: "issue-pull-requests",
          projectId: projectA,
          total: 1,
          items: [issuePullRequestItem(projectA)],
        });
      } else if (url.pathname.endsWith(`/${projectA}/agent-sessions`)) {
        body = page({
          resource: "agent-sessions",
          projectId: projectA,
          total: 1,
          items: [sessionItem("session-a", projectA)],
        });
      } else if (url.pathname.endsWith(`/${projectB}/issues`)) {
        body = page({
          resource: "issues",
          projectId: projectB,
          total: 0,
          items: [],
        });
      } else if (url.pathname.endsWith(`/${projectB}/agents`)) {
        body = page({
          resource: "agents",
          projectId: projectB,
          total: 0,
          items: [],
        });
      } else if (
        url.pathname.endsWith(`/${projectB}/issue-pull-requests`)
      ) {
        body = page({
          resource: "issue-pull-requests",
          projectId: projectB,
          total: 0,
          items: [],
        });
      } else {
        body = page({
          resource: "agent-sessions",
          projectId: projectB,
          total: 0,
          items: [],
        });
      }
      return Response.json(body);
    });

    const result = await downloadOrganizationAgentContext({
      apiUrl: "https://api.example.test/",
      workerToken: "worker-token",
      organizationId,
      workId,
      workerId,
      claimToken,
      snapshotAt,
      workspacePath,
      fetcher,
      pageLimit: 1,
    });

    expect(requests).toHaveLength(10);
    expect(requests[1]).toContain("cursor=projects-next");
    expect(result.manifest).toMatchObject({
      complete: true,
      collections: {
        projects: { total: 2 },
        agents: { total: 1 },
        issues: { total: 1 },
        issuePullRequests: { total: 1 },
        agentSessions: { total: 1 },
      },
    });
    expect(JSON.parse(await readFile(result.manifestPath, "utf8"))).toEqual(
      result.manifest,
    );
    expect((await stat(result.directory)).mode & 0o777).toBe(0o700);
    expect((await stat(result.manifestPath)).mode & 0o777).toBe(0o600);
    expect(
      JSON.parse(
        await readFile(
          join(result.directory, "projects", "page-000001.json"),
          "utf8",
        ),
      ).items,
    ).toEqual([projectItem(projectA, "A")]);
  });

  it("fails closed and removes partial pages when a cursor repeats", async () => {
    const workspacePath = await workspace();
    let requestCount = 0;
    const fetcher = vi.fn(async () => {
      requestCount += 1;
      return Response.json(
        page({
          resource: "projects",
          projectId: null,
          total: 3,
          items: [
            projectItem(requestCount === 1 ? projectA : projectB, "Project"),
          ],
          nextCursor: "same-cursor",
        }),
      );
    });

    await expect(
      downloadOrganizationAgentContext({
        apiUrl: "https://api.example.test",
        workerToken: "worker-token",
        organizationId,
        workId,
        workerId,
        claimToken,
        snapshotAt,
        workspacePath,
        fetcher,
        pageLimit: 1,
      }),
    ).rejects.toThrow("cursor repeated");
    await expect(
      access(organizationAgentContextDirectory(workspacePath)),
    ).rejects.toThrow();
  });

  it("stops an oversized chunked response and removes its partial context", async () => {
    const workspacePath = await workspace();
    const fetcher = vi.fn(async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("12345678"));
            controller.enqueue(new TextEncoder().encode("abcdefgh"));
            controller.close();
          },
        }),
      )
    );

    await expect(
      downloadOrganizationAgentContext({
        apiUrl: "https://api.example.test",
        workerToken: "worker-token",
        organizationId,
        workId,
        workerId,
        claimToken,
        snapshotAt,
        workspacePath,
        fetcher,
        maxPageBytes: 10,
      }),
    ).rejects.toThrow("page is too large");
    await expect(
      access(organizationAgentContextDirectory(workspacePath)),
    ).rejects.toThrow();
  });

  it("rejects a non-UUID project before it can become a local path", async () => {
    const workspacePath = await workspace();
    const escapedPath = join(workspacePath, "escaped-context");
    const fetcher = vi.fn(async () =>
      Response.json(
        page({
          resource: "projects",
          projectId: null,
          total: 1,
          items: [projectItem("../../escaped-context", "Invalid")],
        }),
      )
    );

    await expect(
      downloadOrganizationAgentContext({
        apiUrl: "https://api.example.test",
        workerToken: "worker-token",
        organizationId,
        workId,
        workerId,
        claimToken,
        snapshotAt,
        workspacePath,
        fetcher,
      }),
    ).rejects.toThrow();
    await expect(access(escapedPath)).rejects.toThrow();
    await expect(
      access(organizationAgentContextDirectory(workspacePath)),
    ).rejects.toThrow();
  });

  it.each([
    {
      resource: "issues" as const,
      items: [
        issueItem("duplicate-issue", projectA),
        issueItem("duplicate-issue", projectA),
      ],
    },
    {
      resource: "issue-pull-requests" as const,
      items: [
        issuePullRequestItem(projectA),
        issuePullRequestItem(projectA),
      ],
    },
  ])("rejects duplicate $resource identities", async ({ resource, items }) => {
    const workspacePath = await workspace();
    const projectResources = [
      "agents",
      "issues",
      "issue-pull-requests",
      "agent-sessions",
    ] as const;
    const fetcher = vi.fn(async (rawUrl: string | URL | Request) => {
      const pathname = new URL(String(rawUrl)).pathname;
      if (pathname.endsWith("/organization-context/projects")) {
        return Response.json(
          page({
            resource: "projects",
            projectId: null,
            total: 1,
            items: [projectItem(projectA, "Project")],
          }),
        );
      }
      const requestedResource = projectResources.find((candidate) =>
        pathname.endsWith(`/${projectA}/${candidate}`)
      );
      if (!requestedResource) throw new Error(`Unexpected URL: ${pathname}`);
      const isDuplicateResource = requestedResource === resource;
      return Response.json(
        page({
          resource: requestedResource,
          projectId: projectA,
          total: isDuplicateResource ? 2 : 0,
          items: isDuplicateResource ? items : [],
        }),
      );
    });

    await expect(
      downloadOrganizationAgentContext({
        apiUrl: "https://api.example.test",
        workerToken: "worker-token",
        organizationId,
        workId,
        workerId,
        claimToken,
        snapshotAt,
        workspacePath,
        fetcher,
      }),
    ).rejects.toThrow(
      `Organization Agent ${resource} context contains duplicates`,
    );
    await expect(
      access(organizationAgentContextDirectory(workspacePath)),
    ).rejects.toThrow();
  });

  it("fails closed when collection totals change between pages", async () => {
    const workspacePath = await workspace();
    let requestCount = 0;
    const fetcher = vi.fn(async () => {
      requestCount += 1;
      return Response.json(
        page({
          resource: "projects",
          projectId: null,
          total: requestCount === 1 ? 2 : 3,
          items: [
            projectItem(requestCount === 1 ? projectA : projectB, "Project"),
          ],
          nextCursor: requestCount === 1 ? "next" : null,
        }),
      );
    });

    await expect(
      downloadOrganizationAgentContext({
        apiUrl: "https://api.example.test",
        workerToken: "worker-token",
        organizationId,
        workId,
        workerId,
        claimToken,
        snapshotAt,
        workspacePath,
        fetcher,
        pageLimit: 1,
      }),
    ).rejects.toThrow("total changed");
    await expect(
      access(organizationAgentContextDirectory(workspacePath)),
    ).rejects.toThrow();
  });
});
