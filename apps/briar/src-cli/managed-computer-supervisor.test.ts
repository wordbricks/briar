import { describe, expect, it } from "vitest";
import { decodeConfig } from "./config-contract";
import {
  managedWorkerProcessCommand,
  managedWorkerProjectIds,
} from "./managed-computer-supervisor";

const managedComputerId = "44444444-4444-4444-8444-444444444444";
const organizationId = "55555555-5555-4555-8555-555555555555";
const deviceId = `managed-${managedComputerId}`;

describe("managed computer worker supervisor", () => {
  it("starts only project bindings that belong to the enrolled device", () => {
    const config = decodeConfig({
      apiUrl: "https://briar.example",
      agentProviders: {
        codex: true,
        claude: true,
        cursor: true,
        grok: true,
        agy: true,
        opencode: true,
        openrouter: true,
      },
      appSettings: {
        preventSleepWhileRunning: false,
        browserAutomationProvider:
          "LOCAL_BROWSER_AUTOMATION_PROVIDER_EGO_BROWSER",
      },
      managedComputer: {
        managedComputerId,
        organizationId,
        deviceId,
        credentialFile: "/var/lib/briar/worker-credential.json",
      },
      projects: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          repositoryPath: "/home/briar/one",
          apiUrl: "https://briar.example",
          executionWorker: {
            deviceId,
            workerId: "worker-one",
            organizationId,
            label: "Managed",
            maxConcurrentSessions: 1,
          },
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          repositoryPath: "/home/briar/two",
          apiUrl: "https://briar.example",
          executionWorker: {
            deviceId: "33333333-3333-4333-8333-333333333333",
            workerId: "other-worker",
            organizationId,
            token: "briar_worker_other",
            label: "Other",
            maxConcurrentSessions: 1,
          },
        },
      ],
    });
    expect(managedWorkerProjectIds(config)).toEqual([
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("uses an absolute configured CLI without a shell", () => {
    expect(managedWorkerProcessCommand(
      "11111111-1111-4111-8111-111111111111",
      { BRIAR_CLI: "/opt/briar/bin/briar" },
    )).toEqual([
      "/opt/briar/bin/briar",
      "worker",
      "--project",
      "11111111-1111-4111-8111-111111111111",
    ]);
    expect(() => managedWorkerProcessCommand(
      "11111111-1111-4111-8111-111111111111",
      { BRIAR_CLI: "briar" },
    )).toThrow("absolute");
  });
});
