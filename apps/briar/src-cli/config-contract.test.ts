import { describe, expect, it } from "vitest";
import {
  type Config,
  decodeConfig,
  decodeConfigJson,
  enabledAgentProviders,
  encodeConfigJson,
} from "./config-contract";

const managedComputerId = "44444444-4444-4444-8444-444444444444";
const managedDeviceId = `managed-${managedComputerId}`;
const organizationId = "55555555-5555-4555-8555-555555555555";

const config = {
  apiUrl: "https://briar.example.com",
  userToken: "user-session",
  agentProviders: {
    codex: false,
    claude: false,
    cursor: false,
    grok: false,
    agy: false,
    opencode: false,
    openrouter: false,
    vertex: false,
  },
  addedProviders: [],
  appSettings: {
    preventSleepWhileRunning: true,
    browserAutomationProvider: "ego-browser",
  },
  managedComputer: {
    managedComputerId,
    deviceId: managedDeviceId,
    organizationId,
    credentialFile: "/var/lib/briar/worker-credential.json",
  },
  projects: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      repositoryPath: "/projects/interactive",
      agentToken: "briar_agent_test",
      apiUrl: "https://briar.example.com",
      llm: {
        provider: "codex",
        model: "gpt-5",
        effort: "high",
        approvalPolicy: "never",
      },
      activeClaim: {
        runId: "22222222-2222-4222-8222-222222222222",
        sourceKey: "issue:BRI-123",
        token: "briar_claim_test",
        leaseExpiresAt: "2026-08-31T12:00:00.000Z",
        finished: true,
        terminalStatus: "completed",
        finishedAt: "2026-08-31T11:59:00.000Z",
      },
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      repositoryPath: "/projects/managed",
      apiUrl: "https://briar.example.com",
      executionWorker: {
        deviceId: managedDeviceId,
        workerId: "managed-worker",
        organizationId,
        label: "Managed computer",
        maxConcurrentSessions: 1,
      },
    },
  ],
} satisfies Config;

describe("CLI config contract", () => {
  it("round-trips the two supported credential modes as canonical ProtoJSON", () => {
    const json = encodeConfigJson(config);
    const persisted = JSON.parse(json);

    expect(persisted.appSettings.browserAutomationProvider).toBe(
      "LOCAL_BROWSER_AUTOMATION_PROVIDER_EGO_BROWSER",
    );
    expect(persisted.projects[0].llm).toMatchObject({
      provider: "AGENT_PROVIDER_CODEX",
      approvalPolicy: "LOCAL_APPROVAL_POLICY_NEVER",
    });
    expect(decodeConfigJson(json)).toEqual(config);
  });

  it("rejects unknown fields, absent credentials, and absent or zero concurrency", () => {
    const persisted = JSON.parse(encodeConfigJson(config));

    expect(() => decodeConfig({ ...persisted, futureRoot: true })).toThrow(
      /is unknown/i,
    );

    const withoutCredential = structuredClone(persisted);
    delete withoutCredential.projects[0].agentToken;
    expect(() => decodeConfig(withoutCredential)).toThrow(/credential/i);

    for (const concurrency of [undefined, 0]) {
      const invalid = structuredClone(persisted);
      if (concurrency === undefined) {
        delete invalid.projects[1].executionWorker.maxConcurrentSessions;
      } else {
        invalid.projects[1].executionWorker.maxConcurrentSessions = concurrency;
      }
      expect(() => decodeConfig(invalid)).toThrow();
    }
  });
});

describe("added providers", () => {
  const withProviders = (
    settings: Partial<Config["agentProviders"]>,
    rest: Partial<Config> = {},
  ) => ({
    ...config,
    agentProviders: { ...config.agentProviders, ...settings },
    addedProviders: undefined,
    ...rest,
  }) as Config;

  it("backfills a config written before the added list existed", () => {
    const persisted = JSON.parse(
      encodeConfigJson(withProviders({ codex: true, grok: true })),
    );
    // Absence, not an empty list, is what marks a config as never initialised.
    delete persisted.addedProviders;

    const decoded = decodeConfig(persisted);
    expect(decoded.addedProviders).toEqual(["grok"]);
    // Built-in providers are never listed: they need no add step.
    expect(enabledAgentProviders(decoded)).toMatchObject({
      codex: true,
      grok: true,
      cursor: false,
    });
  });

  it("backfills an upstream whose credential is saved but switch is off", () => {
    const persisted = JSON.parse(
      encodeConfigJson(
        withProviders({}, {
          openrouterApiKey: "sk-or-v1-saved-key",
          vertexAi: { projectId: "briar-dummy", location: "us-central1" },
        }),
      ),
    );
    delete persisted.addedProviders;

    expect(decodeConfig(persisted).addedProviders).toEqual([
      "openrouter",
      "vertex",
    ]);
  });

  it("keeps an empty stored list empty instead of backfilling it", () => {
    const persisted = JSON.parse(
      encodeConfigJson({
        ...withProviders({ grok: true }),
        addedProviders: [],
      }),
    );
    expect(persisted.addedProviders).toEqual({});

    const decoded = decodeConfig(persisted);
    expect(decoded.addedProviders).toEqual([]);
    // A provider that was never added reads as disabled, switch or not.
    expect(enabledAgentProviders(decoded).grok).toBe(false);
  });

  it("ignores built-in and duplicate entries in a stored list", () => {
    const persisted = JSON.parse(
      encodeConfigJson({ ...config, addedProviders: ["vertex", "grok"] }),
    );
    persisted.addedProviders.providers = [
      "AGENT_PROVIDER_VERTEX",
      "AGENT_PROVIDER_CODEX",
      "AGENT_PROVIDER_VERTEX",
      "AGENT_PROVIDER_GROK",
    ];
    expect(decodeConfig(persisted).addedProviders).toEqual([
      "grok",
      "vertex",
    ]);
  });
});
