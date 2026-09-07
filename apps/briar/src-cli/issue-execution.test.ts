import { describe, expect, it } from "vitest";
import type { Config, TeamConfig } from "./config-contract";
import { issueRuntimeConfig } from "./issue-execution";

describe("issue execution runtime scope", () => {
  it("writes only the authenticated project and claimed run to the runtime config", () => {
    const project = {
      id: "project-1",
      repositoryPath: "/projects/one",
      apiUrl: "https://briar.example",
      executionWorker: {
        deviceId: "device-1",
        workerId: "worker-1",
        organizationId: "organization-1",
        label: "Worker",
        maxConcurrentSessions: 1,
      },
    } as unknown as TeamConfig;
    const otherProject = {
      ...project,
      id: "project-2",
      repositoryPath: "/projects/two",
      agentToken: "briar_agent_other-project-secret",
    };
    const config = {
      apiUrl: "https://briar.example",
      userToken: "user-token-with-organization-access",
      workerDeviceIdentity: "briar_device_machine-identity",
      managedComputer: {
        managedComputerId: "computer-1",
        credentialFile: "/credentials/organization-wide.json",
      },
      teams: [project, otherProject],
    } as unknown as Config;

    const runtime = issueRuntimeConfig(config, project, {
      runId: "run-1",
      sourceKey: "BRIAR-1",
      claimToken: "briar_claim_run-token",
      leaseExpiresAt: "2026-09-07T10:00:00.000Z",
    }, "briar_worker_project-token");

    expect(runtime.teams).toHaveLength(1);
    expect(runtime.teams[0]).toMatchObject({
      id: "project-1",
      agentToken: undefined,
      executionWorker: { token: "briar_worker_project-token" },
      activeClaim: {
        runId: "run-1",
        sourceKey: "BRIAR-1",
        token: "briar_claim_run-token",
      },
    });
    expect(JSON.stringify(runtime)).not.toContain("project-2");
    expect(JSON.stringify(runtime)).not.toContain("other-project-secret");
    expect(JSON.stringify(runtime)).not.toContain("organization-access");
    expect(JSON.stringify(runtime)).not.toContain("organization-wide");
    expect(runtime.userToken).toBeUndefined();
    expect(runtime.managedComputer).toBeUndefined();
  });
});
