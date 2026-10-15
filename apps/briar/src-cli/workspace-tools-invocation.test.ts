import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { ApplicationErrorDetailSchema } from "@briar/contracts/gen/briar/types/v1/error_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import {
  AgentChannelPostResponseSchema,
  AgentIssueCreateResponseSchema,
  AgentIssueListResponseSchema,
  AgentIssueSetStatusResponseSchema,
  GetMemoryVaultContextResponseSchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMemoryTools, type MemoryToolsIo } from "../src-agent/memory-tools";
import { detachedProviderRequest, type DetachedAgent } from "./agent-runner";
import type { DetachedProviderTurnInput } from "./detached-provider-turn";
import {
  MemoryVaultInvocation,
  runWithMemoryVault,
  type MemoryVaultInvocationInput,
  type MemoryVaultQueue,
} from "./memory-vault-invocation";
import { workspaceToolsInstructions } from "./workspace-tools-executor";
import type { ClaimedChannelReply } from "./worker-queue-contract";

const claimToken = `briar_channel_claim_${"t".repeat(64)}`;
const workId = "66666666-6666-4666-8666-666666666666";

const channelWork = {
  workType: "channelReply",
  workId,
  runId: "77777777-7777-4777-8777-777777777777",
  claimToken,
  workspaceId: "22222222-2222-4222-8222-222222222222",
} as unknown as ClaimedChannelReply;

const agent = {
  id: "agent-1",
  name: "Workspace Agent",
  provider: "claude",
  model: null,
  effort: null,
  responsibility: "Coordinate work.",
  skills: [],
} as unknown as DetachedAgent;

const issue = {
  id: "88888888-8888-4888-8888-888888888888",
  key: "AH-42",
  title: "Follow up",
  status: "backlog",
  paused: false,
  updatedAt: "2026-10-15T00:00:00.000Z",
};

const directories: string[] = [];
const invocations: MemoryVaultInvocation[] = [];

afterEach(async () => {
  await Promise.all(invocations.splice(0).map((invocation) => invocation.cleanup()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), "workspace-tools-"));
  directories.push(directory);
  return directory;
}

function fakeQueue(overrides: Partial<Record<keyof MemoryVaultQueue, unknown>> = {}) {
  const queue = {
    getMemoryVaultContext: vi.fn(async () => create(GetMemoryVaultContextResponseSchema, {
      state: { case: "none", value: {} },
    })),
    agentIssueList: vi.fn(async () => create(AgentIssueListResponseSchema, { issues: [issue], nextCursor: "next" })),
    agentIssueCreate: vi.fn(async () => create(AgentIssueCreateResponseSchema, {
      issue, executionApprovalId: "approval-1", replayed: false,
    })),
    agentIssueSetStatus: vi.fn(async () => create(AgentIssueSetStatusResponseSchema, {
      issue: { ...issue, status: "blocked" }, outcome: "moved", replayed: false,
    })),
    agentChannelPost: vi.fn(async () => create(AgentChannelPostResponseSchema, {
      messageId: "message-1", channel: { id: "channel-1", name: "eng", current: false }, replayed: false,
    })),
    ...overrides,
  };
  return queue as typeof queue & MemoryVaultQueue;
}

async function open(input: Partial<MemoryVaultInvocationInput> & { queue: MemoryVaultQueue }) {
  const invocation = await MemoryVaultInvocation.create({
    projectId: "11111111-1111-4111-8111-111111111111",
    workerId: "worker-1",
    work: channelWork,
    personFacing: true,
    workspaceTools: true,
    launcher: { runtimePath: "/usr/bin/env", scriptPath: "/opt/briar/agent/memory-tools.js" },
    retryDelaysMs: [1, 1],
    log: () => undefined,
    ...input,
  });
  invocations.push(invocation);
  return invocation;
}

async function tools(invocation: MemoryVaultInvocation, argv: string[], stdin: string | null = null) {
  const output: string[] = [];
  const io: MemoryToolsIo = {
    readStdin: async () => stdin === null ? null : Buffer.from(stdin, "utf8"),
    readContentFile: (path) => readFile(path),
    write: (text) => { output.push(text); },
  };
  const exitCode = await runMemoryTools(["--config", join(invocation.binDirectory, "config.json"), ...argv], io);
  expect(output).toHaveLength(1);
  return { exitCode, json: JSON.parse(output[0]!) as Record<string, any> };
}

const turnInput = (workspacePath: string): DetachedProviderTurnInput => ({
  agent,
  prompt: "Reply.",
  workspacePath,
  fullAccess: false,
  environment: { PATH: "/usr/bin:/bin" },
  signal: new AbortController().signal,
});

describe("workspace tools relay", () => {
  it("serves issue and channel commands with the claim and the turn's provider, even without a vault", async () => {
    const queue = fakeQueue();
    const invocation = await open({ queue });
    const turn = await invocation.prepareTurn(await workspace(), "claude");
    expect(turn).not.toBeNull();
    expect(turn!.instructions).toBeNull();
    expect(turn!.workspaceInstructions).toContain("# Briar issues and channels");

    const listed = await tools(invocation, ["issue", "list", "--status", "backlog,blocked", "--text", "flaky"]);
    expect(listed).toMatchObject({
      exitCode: 0,
      json: { issues: [{ key: "AH-42", status: "backlog", priority: null }], next_cursor: "next" },
    });
    const listRequest = vi.mocked(queue.agentIssueList).mock.calls[0]![0] as Record<string, any>;
    expect(listRequest.statuses).toEqual(["backlog", "blocked"]);
    expect(listRequest.claim).toMatchObject({
      projectId: "11111111-1111-4111-8111-111111111111",
      workerId: "worker-1",
      agentProvider: AgentProvider.CLAUDE,
      work: { workId, claimToken, work: { case: "channelReply" } },
    });

    const created = await tools(invocation, [
      "issue", "create", "--title", "Follow up", "--description-file", "-", "--priority", "high", "--queue",
      "--request-key", "follow-up",
    ], "Body with \"quotes\" — 한국어\n");
    expect(created).toMatchObject({
      exitCode: 0,
      json: { issue: { key: "AH-42" }, execution_approval: { id: "approval-1", status: "pending" }, replayed: false },
    });
    expect(vi.mocked(queue.agentIssueCreate).mock.calls[0]![0]).toMatchObject({
      requestKey: "follow-up", title: "Follow up", description: "Body with \"quotes\" — 한국어\n", priority: 2,
      requestExecution: true,
    });

    const posted = await tools(invocation, ["channel", "post", "#eng", "Shipped", "v2"]);
    expect(posted).toMatchObject({ exitCode: 0, json: { message_id: "message-1", channel: { name: "eng" } } });
    const postRequest = vi.mocked(queue.agentChannelPost).mock.calls[0]![0] as Record<string, any>;
    expect(postRequest).toMatchObject({ channel: "#eng", body: "Shipped v2" });
    // No --request-key: one is generated for this invocation.
    expect(postRequest.requestKey).toMatch(/^[0-9a-f-]{36}$/u);

    // Memory is not offered on a run without a vault.
    const memory = await tools(invocation, ["memory", "list"]);
    expect(memory).toMatchObject({ exitCode: 1, json: { error: { code: "memory_unavailable" } } });
    await turn!.cleanup();
  });

  it("reuses the request key on transport retries and passes domain errors through once", async () => {
    let attempts = 0;
    const queue = fakeQueue({
      agentChannelPost: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new ConnectError("socket hang up", Code.Unavailable);
        return create(AgentChannelPostResponseSchema, {
          messageId: "message-2", channel: { id: "channel-1", name: "eng", current: false }, replayed: true,
        });
      }),
      agentIssueSetStatus: vi.fn(async () => {
        throw new ConnectError("The issue is being executed", Code.FailedPrecondition, undefined, [
          { desc: ApplicationErrorDetailSchema, value: { code: "issue_in_execution" } },
        ]);
      }),
    });
    const invocation = await open({ queue });
    const turn = await invocation.prepareTurn(await workspace(), "codex");

    const posted = await tools(invocation, ["channel", "post", "eng", "--body-file", "-"], "Update\n");
    expect(posted).toMatchObject({ exitCode: 0, json: { replayed: true } });
    const [first, second] = vi.mocked(queue.agentChannelPost).mock.calls
      .map((call) => (call as unknown[])[0] as { requestKey: string });
    expect(second!.requestKey).toBe(first!.requestKey);

    const refused = await tools(invocation, ["issue", "status", "AH-42", "cancelled", "--request-key", "k1"]);
    expect(refused).toMatchObject({
      exitCode: 1,
      json: { error: { code: "issue_in_execution", message: "The issue is being executed", retryable: false } },
    });
    expect(queue.agentIssueSetStatus).toHaveBeenCalledTimes(1);
    await turn!.cleanup();
  });

  it("offers nothing when workspace tools are off and the run has no vault", async () => {
    const invocation = await open({ queue: fakeQueue(), workspaceTools: false });
    expect(await invocation.prepareTurn(await workspace(), "codex")).toBeNull();
  });

  it("places the workspace section in the trusted instructions before memory, on every turn", async () => {
    const invocation = await open({ queue: fakeQueue() });
    const directory = await workspace();
    let seen: DetachedProviderTurnInput | null = null;
    await runWithMemoryVault(invocation, turnInput(directory), async (input) => {
      seen = input;
      return null;
    });
    expect(seen!.environment.PATH!.split(":")[0]).toBe(invocation.binDirectory);
    const instructions = detachedProviderRequest({
      agent,
      prompt: seen!.prompt,
      workspacePath: directory,
      fullAccess: false,
      workspaceToolsInstructions: seen!.workspaceToolsInstructions,
      memoryVaultInstructions: "# Memory vault\n\nREADME",
      agentBinary: "/bin/claude",
    }).request.instructions ?? "";
    expect(instructions.indexOf("Workspace Agent")).toBeLessThan(instructions.indexOf("# Briar issues and channels"));
    expect(instructions.indexOf("# Briar issues and channels")).toBeLessThan(instructions.indexOf("# Memory vault"));
  });

  it("tells each run kind how its own conversation relates to the tools", () => {
    expect(workspaceToolsInstructions({ workType: "issue" })).toMatch(/never move this issue/u);
    expect(workspaceToolsInstructions({ workType: "issueReply" })).toMatch(/issue conversation/u);
    expect(workspaceToolsInstructions({ workType: "channelReply" })).toMatch(/channel or DM/u);
    expect(workspaceToolsInstructions({ workType: "projectAgentTask" })).toMatch(/Agent task/u);
    for (const workType of ["issue", "issueReply", "channelReply", "projectAgentTask"] as const) {
      const text = workspaceToolsInstructions({ workType });
      expect(text).toMatch(/queued only asks a person to approve execution/u);
      expect(text).toMatch(/--request-key/u);
    }
  });
});
