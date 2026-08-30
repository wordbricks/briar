import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createManagedComputerSetupSession,
  fetchMergeQueueProfile,
  fetchManagedComputer,
  fetchManagedComputerSetupStatus,
  updateRemoteMergeQueueProfile,
} from "./app-connect-client";

afterEach(() => vi.unstubAllGlobals());

describe("Fleet Connect CLI client", () => {
  it("uses all three generated Fleet methods with bearer authentication", async () => {
    const responses = new Map<string, unknown>([
      ["GetManagedComputer", {
        computer: {
          id: "computer-1",
          organizationId: "organization-1",
          requesterUserId: "user-1",
          state: "MANAGED_COMPUTER_STATE_NEEDS_SETUP",
          region: "ap-northeast-2",
          retryCount: 0,
          retryAvailable: true,
          createdAt: "2026-08-30T01:00:00.000Z",
          expiresAt: "2026-09-30T01:00:00.000Z",
          updatedAt: "2026-08-30T02:00:00.000Z",
        },
      }],
      ["CreateManagedComputerSetupSession", {
        session: {
          id: "setup-1",
          managedComputerId: "computer-1",
          organizationId: "organization-1",
          projectId: "project-1",
          status: "MANAGED_COMPUTER_SETUP_SESSION_STATUS_PENDING",
          expiresAt: "2026-08-30T03:00:00.000Z",
        },
        setupToken: "setup-token",
        socket: {
          url: "wss://briar.example/setup?ticket=signed",
          protocol: "briar-setup-v1",
        },
        agentConnected: true,
        duplicate: false,
      }],
      ["GetManagedComputerSetupStatus", {}],
    ]);
    const requests: Array<{ method: string; body: unknown }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const method = new URL(request.url).pathname.split("/").at(-1)!;
      expect(request.method).toBe("POST");
      expect(request.headers.get("authorization")).toBe("Bearer user-token");
      requests.push({ method, body: await request.json() });
      return new Response(JSON.stringify(responses.get(method)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(fetchManagedComputer(
      "https://briar.example/",
      "user-token",
      "organization-1",
      "computer-1",
    )).resolves.toMatchObject({ id: "computer-1", state: "needs_setup" });
    await expect(createManagedComputerSetupSession(
      "https://briar.example/",
      "user-token",
      "organization-1",
      "computer-1",
      "project-1",
      "request-1",
    )).resolves.toMatchObject({
      session: { id: "setup-1", status: "pending" },
      setupToken: "setup-token",
    });
    await expect(fetchManagedComputerSetupStatus(
      "https://briar.example/",
      "user-token",
      "organization-1",
      "computer-1",
    )).resolves.toEqual({ session: null, worker: null });

    expect(requests).toEqual([
      {
        method: "GetManagedComputer",
        body: {
          organizationId: "organization-1",
          managedComputerId: "computer-1",
        },
      },
      {
        method: "CreateManagedComputerSetupSession",
        body: {
          organizationId: "organization-1",
          managedComputerId: "computer-1",
          projectId: "project-1",
          requestId: "request-1",
        },
      },
      {
        method: "GetManagedComputerSetupStatus",
        body: {
          organizationId: "organization-1",
          managedComputerId: "computer-1",
        },
      },
    ]);
  });
});

describe("Merge queue Connect CLI client", () => {
  it("uses the generated service and preserves duration and uint64 values", async () => {
    const requests: Array<{ method: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const method = new URL(request.url).pathname.split("/").at(-1)!;
      expect(request.headers.get("authorization")).toBe("Bearer user-token");
      requests.push({ method, body: await request.json() });
      return new Response(JSON.stringify({
        profile: {
          projectId: "project-1",
          repositoryId: "42",
          repository: "briar-dev/briar",
          baseBranch: "main",
          enabled: method === "UpdateMergeQueueProfile",
          readinessStageId: "validate",
          validationCommands: ["bun test"],
          quietWindow: "1.250s",
          maxBatchSize: 5,
          updatedAt: "2026-08-31T03:04:05Z",
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    await expect(fetchMergeQueueProfile(
      "https://briar.example/",
      "user-token",
      "project-1",
    )).resolves.toMatchObject({ repositoryId: 42, quietWindowMs: 1_250 });
    await expect(updateRemoteMergeQueueProfile(
      "https://briar.example/",
      "user-token",
      {
        projectId: "project-1",
        enabled: true,
        readinessStageId: "validate",
        quietWindowMs: 1_250,
        maxBatchSize: 5,
      },
    )).resolves.toMatchObject({ enabled: true, quietWindowMs: 1_250 });

    expect(requests).toEqual([
      {
        method: "GetMergeQueueProfile",
        body: { projectId: "project-1" },
      },
      {
        method: "UpdateMergeQueueProfile",
        body: {
          projectId: "project-1",
          enabled: true,
          readinessStageId: "validate",
          quietWindow: "1.250s",
          maxBatchSize: 5,
        },
      },
    ]);
  });
});
