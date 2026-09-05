import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ProjectGitHubCredentialSchema,
} from "@briar/contracts/gen/briar/app/v1/github_pb";
import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "./config-contract";
import {
  assignedDisplays,
  decodeSandboxBootstrapPayload,
  novncCommand,
  novncTokenFileContents,
  readSandboxState,
  runSandboxBootstrap,
  runSandboxUnregister,
  type SandboxBootstrapPayload,
  sandboxReport,
  type SandboxState,
  sandboxWorkerTeamIds,
} from "./sandbox-bootstrap";
import { SANDBOX_SCHEMA_VERSION } from "./sandbox-image";

const projectId = "11111111-1111-4111-8111-111111111111";
const otherProjectId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";
const agentToken = `briar_agent_${"a".repeat(40)}`;
const userToken = `briar_user_${"b".repeat(40)}`;
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

const baseConfig = (): Config => ({
  apiUrl: "https://old.example",
  agentProviders: {
    codex: true,
    claude: true,
    cursor: false,
    grok: false,
    agy: false,
    opencode: false,
    openrouter: false,
    vertex: false,
    pi: false,
  },
  appSettings: {
    preventSleepWhileRunning: false,
    browserAutomationProvider: "agent-browser",
  },
  teams: [],
});

const payload = (): SandboxBootstrapPayload => ({
  schemaVersion: SANDBOX_SCHEMA_VERSION,
  apiUrl: "https://briar.example",
  userToken,
  label: "sandbox-gx10",
  teams: [{ id: projectId, agentToken }],
});

const credential = (id: string) =>
  create(ProjectGitHubCredentialSchema, {
    projectId: id,
    organizationId,
    repositoryId: 42n,
    repository: "wordbricks/briar",
    cloneUrl: "https://github.com/wordbricks/briar.git",
    username: "x-access-token",
    password: "ghs_secret",
    expiresAt: timestampFromDate(new Date(Date.now() + 3_600_000)),
  });

describe("decodeSandboxBootstrapPayload", () => {
  it("accepts the documented shape", () => {
    const decoded = decodeSandboxBootstrapPayload(JSON.stringify({
      ...payload(),
      codexAuth: "{\"tokens\":{}}",
    }));
    expect(decoded.teams).toEqual([{ id: projectId, agentToken }]);
    expect(decoded.codexAuth).toBe("{\"tokens\":{}}");
  });

  it("rejects unknown fields, plain HTTP, and empty project lists", () => {
    expect(() => decodeSandboxBootstrapPayload(JSON.stringify({ ...payload(), extra: 1 })))
      .toThrow();
    expect(() => decodeSandboxBootstrapPayload(JSON.stringify({ ...payload(), apiUrl: "http://briar.example" })))
      .toThrow();
    expect(() => decodeSandboxBootstrapPayload(JSON.stringify({ ...payload(), teams: [] })))
      .toThrow();
    expect(() => decodeSandboxBootstrapPayload(JSON.stringify({
      ...payload(),
      teams: [{ id: projectId, agentToken: "nope" }],
    }))).toThrow();
  });
});

describe("runSandboxBootstrap", () => {
  it("clones, connects, and registers every project, then records the desired set", async () => {
    const config = baseConfig();
    const saved: Config[] = [];
    const registered: string[] = [];
    const states: SandboxState[] = [];
    const codexWrites: string[] = [];
    const identities: { name: string; email: string }[] = [];
    await runSandboxBootstrap({
      ...payload(),
      codexAuth: "{\"tokens\":{}}",
      gitIdentity: { name: "Jay", email: "jay@example.com" },
    }, {
      loadConfig: async () => config,
      saveConfig: async (value) => {
        saved.push(structuredClone(value));
      },
      fetchRepositoryCredential: async (apiUrl, project) => {
        expect(apiUrl).toBe("https://briar.example");
        return credential(project.id);
      },
      ensureRepository: async (value) => `/home/briar/Briar/teams/${value.projectId}/briar`,
      registerWorker: async (input) => {
        registered.push(input.project.id);
        expect(input.userToken).toBe(userToken);
        expect(input.label).toBe("sandbox-gx10");
        expect(input.project.repositoryPath).toContain(projectId);
        return {
          projectId: input.project.id,
          organizationId,
          deviceId: "device",
          workerId: "worker-1",
          label: input.label,
          maxConcurrentSessions: 1,
          state: "online",
        };
      },
      writeCodexAuth: async (contents) => {
        codexWrites.push(contents);
      },
      writeGitIdentity: async (identity) => {
        identities.push(identity);
      },
      writeState: async (state) => {
        states.push(state);
      },
      computerUseHealthy: async () => true,
      sleep: async () => undefined,
      now: () => new Date("2026-09-05T00:00:00.000Z"),
      log: () => undefined,
    });
    expect(config.apiUrl).toBe("https://briar.example");
    expect(config.userToken).toBe(userToken);
    expect(config.teams).toEqual([{
      id: projectId,
      repositoryPath: `/home/briar/Briar/teams/${projectId}/briar`,
      repositoryRemote: "https://github.com/wordbricks/briar.git",
      agentToken,
      apiUrl: "https://briar.example",
    }]);
    expect(saved).toHaveLength(1);
    expect(registered).toEqual([projectId]);
    expect(codexWrites).toEqual(["{\"tokens\":{}}"]);
    expect(identities).toEqual([{ name: "Jay", email: "jay@example.com" }]);
    expect(states).toEqual([{
      schemaVersion: SANDBOX_SCHEMA_VERSION,
      label: "sandbox-gx10",
      teamIds: [projectId],
      bootstrappedAt: "2026-09-05T00:00:00.000Z",
    }]);
  });

  it("keeps existing project settings when rerun", async () => {
    const config = baseConfig();
    config.teams = [{
      id: projectId,
      repositoryPath: "/stale",
      apiUrl: "https://old.example",
      agentToken,
      llm: { provider: "claude", approvalPolicy: "never" },
    }];
    await runSandboxBootstrap(payload(), {
      loadConfig: async () => config,
      saveConfig: async () => undefined,
      fetchRepositoryCredential: async (_apiUrl, project) => credential(project.id),
      ensureRepository: async () => "/fresh",
      registerWorker: async (input) => ({
        projectId: input.project.id,
        organizationId,
        deviceId: "device",
        workerId: "worker-1",
        label: input.label,
        maxConcurrentSessions: 1,
        state: "online",
      }),
      writeCodexAuth: async () => undefined,
      writeGitIdentity: async () => undefined,
      writeState: async () => undefined,
      computerUseHealthy: async () => true,
      sleep: async () => undefined,
      log: () => undefined,
    });
    expect(config.teams[0]).toMatchObject({
      repositoryPath: "/fresh",
      llm: { provider: "claude", approvalPolicy: "never" },
    });
  });
});

describe("sandboxReport", () => {
  const registeredConfig = (): Config => {
    const config = baseConfig();
    config.teams = [{
      id: projectId,
      repositoryPath: "/repo",
      apiUrl: "https://briar.example",
      agentToken,
      executionWorker: {
        deviceId: "device",
        workerId: "worker-1",
        organizationId,
        label: "sandbox-gx10",
        maxConcurrentSessions: 1,
      },
    }];
    return config;
  };
  const state: SandboxState = {
    schemaVersion: SANDBOX_SCHEMA_VERSION,
    label: "sandbox-gx10",
    teamIds: [projectId],
    bootstrappedAt: "2026-09-05T00:00:00.000Z",
  };

  it("waits for bootstrap when no state exists", async () => {
    const report = await sandboxReport({
      config: baseConfig(),
      state: null,
      supervisorPid: null,
      providerSignedIn: async () => false,
      computerUseHealthy: async () => false,
      displays: async () => [],
    });
    expect(report).toMatchObject({ ready: false, detail: "Waiting for bootstrap.", teams: [] });
  });

  it("is ready once teams are registered, cloned, and supervised", async () => {
    const report = await sandboxReport({
      config: registeredConfig(),
      state,
      supervisorPid: process.pid,
      repositoryPresent: () => true,
      providerSignedIn: async (provider) => provider === "codex",
      computerUseHealthy: async () => true,
      displays: async () => [{ agentId: "agent-a", displayIndex: 2 }],
    });
    expect(report.ready).toBe(true);
    expect(report.computerUse).toEqual({
      serviceHealthy: true,
      displays: [{ agentId: "agent-a", displayIndex: 2 }],
    });
    expect(report.teams).toEqual([{
      id: projectId,
      registered: true,
      workerId: "worker-1",
      repositoryPath: "/repo",
      repositoryPresent: true,
    }]);
    expect(report.providers).toEqual({ codex: true, claude: false });
  });

  it("names the incomplete project and a missing supervisor", async () => {
    const incomplete = await sandboxReport({
      config: registeredConfig(),
      state: { ...state, teamIds: [projectId, otherProjectId] },
      supervisorPid: process.pid,
      repositoryPresent: () => true,
      providerSignedIn: async () => true,
    });
    expect(incomplete.ready).toBe(false);
    expect(incomplete.detail).toContain(otherProjectId);
    const unsupervised = await sandboxReport({
      config: registeredConfig(),
      state,
      supervisorPid: null,
      repositoryPresent: () => true,
      providerSignedIn: async () => true,
    });
    expect(unsupervised).toMatchObject({
      ready: false,
      supervisorRunning: false,
      detail: "Worker supervisor is not running.",
    });
  });
});

describe("sandboxWorkerTeamIds", () => {
  it("runs only desired teams that hold a worker registration", () => {
    const config = baseConfig();
    config.teams = [
      {
        id: projectId,
        repositoryPath: "/a",
        apiUrl: "https://briar.example",
        agentToken,
        executionWorker: {
          deviceId: "device",
          workerId: "worker-1",
          organizationId,
          label: "sandbox",
          maxConcurrentSessions: 1,
        },
      },
      { id: otherProjectId, repositoryPath: "/b", apiUrl: "https://briar.example", agentToken },
    ];
    const state: SandboxState = {
      schemaVersion: SANDBOX_SCHEMA_VERSION,
      label: "sandbox",
      teamIds: [projectId, otherProjectId],
      bootstrappedAt: "2026-09-05T00:00:00.000Z",
    };
    expect(sandboxWorkerTeamIds(config, state)).toEqual([projectId]);
    expect(sandboxWorkerTeamIds(config, null)).toEqual([]);
  });
});

describe("runSandboxUnregister", () => {
  const state: SandboxState = {
    schemaVersion: SANDBOX_SCHEMA_VERSION,
    label: "sandbox-gx10",
    teamIds: [projectId, otherProjectId],
    bootstrappedAt: "2026-09-05T00:00:00.000Z",
  };
  const configWithWorker = (): Config => {
    const config = baseConfig();
    config.userToken = userToken;
    config.teams = [
      {
        id: projectId,
        repositoryPath: "/a",
        apiUrl: "https://briar.example",
        agentToken,
        executionWorker: {
          deviceId: "device",
          workerId: "worker-1",
          organizationId,
          label: "sandbox-gx10",
          maxConcurrentSessions: 1,
        },
      },
      { id: otherProjectId, repositoryPath: "/b", apiUrl: "https://briar.example", agentToken },
    ];
    return config;
  };

  it("unbinds every registered team and reports the rest", async () => {
    const calls: string[] = [];
    const result = await runSandboxUnregister({
      loadConfig: async () => configWithWorker(),
      readState: async () => state,
      unregister: async (input) => {
        calls.push(`${input.team.id}:${input.reason}`);
        return {
          deviceId: "device",
          projectId: input.team.id,
          workerId: input.team.executionWorker!.workerId,
          state: "unbound",
        };
      },
    });
    expect(calls).toEqual([`${projectId}:explicit_user_unlink`]);
    expect(result.teams).toEqual([
      { id: projectId, workerId: "worker-1", state: "unbound" },
      { id: otherProjectId, workerId: null, state: "not_registered" },
    ]);
  });

  it("records failures per team instead of aborting", async () => {
    const result = await runSandboxUnregister({
      loadConfig: async () => configWithWorker(),
      readState: async () => state,
      unregister: async () => {
        throw new Error("server unreachable");
      },
    });
    expect(result.teams[0]).toMatchObject({ state: "failed", detail: "server unreachable" });
  });

  it("does nothing without state", async () => {
    const result = await runSandboxUnregister({
      loadConfig: async () => configWithWorker(),
      readState: async () => null,
      unregister: async () => {
        throw new Error("must not be called");
      },
    });
    expect(result.teams).toEqual([]);
  });
});

describe("readSandboxState", () => {
  it("returns null before the first bootstrap", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-sandbox-state-"));
    directories.push(directory);
    expect(await readSandboxState(directory)).toBeNull();
  });

  it("reads a state file written before the project-to-team rename", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-sandbox-state-"));
    directories.push(directory);
    await writeFile(join(directory, "sandbox.json"), JSON.stringify({
      schemaVersion: SANDBOX_SCHEMA_VERSION,
      label: "sandbox-gx10",
      projectIds: [projectId],
      bootstrappedAt: "2026-09-05T00:00:00.000Z",
    }));
    expect((await readSandboxState(directory))?.teamIds).toEqual([projectId]);
  });
});

describe("noVNC bridge", () => {
  it("routes every assignable display through one websockify token file", () => {
    const tokens = novncTokenFileContents(3);
    expect(tokens).toBe("display1: 127.0.0.1:5901\ndisplay2: 127.0.0.1:5902\ndisplay3: 127.0.0.1:5903\n");
    expect(novncTokenFileContents().split("\n").filter(Boolean)).toHaveLength(100);
    const command = novncCommand("/tmp/tokens");
    expect(command[0]).toBe("/usr/bin/websockify");
    expect(command).toContain("TokenFile");
    expect(command.at(-1)).toBe("0.0.0.0:6080");
  });

  it("lists assigned displays without exposing owner tokens", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-sandbox-displays-"));
    directories.push(directory);
    const path = join(directory, "window-assignments.json");
    await writeFile(path, JSON.stringify({
      version: 1,
      assignments: [{ agentId: "agent-a", displayIndex: 2, ownerToken: "secret", assignedAt: "x" }],
    }));
    expect(await assignedDisplays(path)).toEqual([{ agentId: "agent-a", displayIndex: 2 }]);
    expect(await assignedDisplays(join(directory, "missing.json"))).toEqual([]);
  });
});
