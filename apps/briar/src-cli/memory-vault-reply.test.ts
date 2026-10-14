import { createServer } from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import {
  WorkspaceAgentContextService,
  WorkspaceAgentContextServiceGetManifestResponseSchema,
} from "@briar/contracts/gen/briar/worker/v1/workspace_agent_context_pb";
import {
  ChannelReplyScopeSchema,
  ChannelReplyScope_WorkspaceSchema,
  ClaimedWorkSchema,
  CompleteChannelReplyResponseSchema,
  DetachedAgentClaimSchema,
  GetMemoryVaultContextResponseSchema,
  MemoryVaultReadResponseSchema,
  ReplyCompletionDisposition,
  WorkerQueueService,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { describe, expect, it } from "vitest";
import { runMemoryTools } from "../src-agent/memory-tools";
import type { Config, TeamConfig } from "./config-contract";
import type {
  DetachedProviderTurnInput,
  DetachedProviderTurnResult,
} from "./detached-provider-turn";
import { runClaimedChannelReply, runClaimedProjectAgentTask } from "./reply-execution";
import {
  claimedWorkFromProto,
  type ClaimedChannelReply,
  type ClaimedProjectAgentTask,
} from "./worker-queue-contract";

/*
  The memory vault in the actual reply and Agent-task runners: what a provider
  turn receives with a vault, and that a `none` answer runs the reply without
  memory.
*/
const readmePath = fileURLToPath(new URL("../worker/src/memory-vault/memory-vault-readme.md", import.meta.url));
const workspaceId = crypto.randomUUID();
const projectId = crypto.randomUUID();
const snapshotAt = "2026-09-01T00:00:00.000Z";
const claimToken = `briar_channel_claim_${"a".repeat(64)}`;

const reply = (overrides: Record<string, unknown>) => ({
  body: null,
  attachments: [],
  document: null,
  issueProposal: null,
  issueBatchProposal: null,
  executionProposal: null,
  skillExecutionProposal: null,
  delegation: null,
  agentMessage: null,
  memoryCitations: null,
  contextRequests: null,
  ...overrides,
});

const result = (value: unknown): DetachedProviderTurnResult => ({
  resultText: typeof value === "string" ? value : JSON.stringify(value),
  conversationId: null,
  completed: true,
  exitCode: 0,
  stderr: "",
  runnerError: null,
});

/** The claim the synthetic server is answering for; the manifest echoes it. */
let currentWorkId = crypto.randomUUID();

const config = (port: number): Config => ({
  apiUrl: `http://127.0.0.1:${port}`,
  projects: [],
  agentProviders: {
    codex: true, claude: true, cursor: true, grok: true, agy: true, opencode: true, openrouter: true,
  },
  appSettings: { preventSleepWhileRunning: false, browserAutomationProvider: "ego-browser" },
} as unknown as Config);

const project = (root: string): TeamConfig => ({
  id: projectId,
  repositoryPath: root,
  agentToken: "synthetic",
  executionWorker: {
    workerId: "synthetic-worker",
    deviceId: crypto.randomUUID(),
    workspaceId,
    token: "briar_worker_synthetic",
    label: "Synthetic",
    maxConcurrentSessions: 1,
  },
} as unknown as TeamConfig);

async function withServer<T>(
  vault: "context" | "none",
  run: (input: { port: number; calls: string[]; completed: () => string; readme: string }) => Promise<T>,
) {
  const readme = await readFile(readmePath, "utf8");
  const calls: string[] = [];
  let completed = "";
  const adapter = connectNodeAdapter({
    routes: (router) => {
      router.service(WorkerQueueService, {
        getMemoryVaultContext: () => {
          calls.push("vault-context");
          return create(GetMemoryVaultContextResponseSchema, vault === "none"
            ? { state: { case: "none", value: {} } }
            : {
                state: {
                  case: "context",
                  value: {
                    contextKey: "key-1",
                    scopeKind: "dm",
                    readme,
                    status: "Memory status: recall on; automatic writing off; user-requested writing on.",
                    voice: "- Prefers short answers (4회/times, 2026-10-12)",
                    voiceGuide: "- Answer in Korean (user, 2026-10-10)",
                    playbook: "",
                    readable: true,
                    writable: false,
                    userRequestedWritable: true,
                  },
                },
              });
        },
        memoryVaultRead: (request) => {
          calls.push(`vault-read:${request.target}:${request.claim?.work?.claimToken === claimToken}`);
          return create(MemoryVaultReadResponseSchema, {
            record: { id: "bay-area", type: "workstream", path: "workstreams/bay-area.md", aliases: [], revision: 4, protectedByUser: false },
            body: "Moving in March.",
            latest: true,
          });
        },
        completeChannelReply: (request) => {
          completed = JSON.stringify(request);
          return create(CompleteChannelReplyResponseSchema, {
            replayed: false,
            disposition: ReplyCompletionDisposition.COMPLETED,
            retainedUntil: timestampFromDate(new Date("2099-01-01T00:00:00Z")),
          });
        },
      });
      router.service(WorkspaceAgentContextService, {
        getManifest: () => create(WorkspaceAgentContextServiceGetManifestResponseSchema, {
          result: {
            case: "manifest",
            value: {
              workspaceId,
              workId: currentWorkId,
              snapshotAt: timestampFromDate(new Date(snapshotAt)),
              revision: "a".repeat(64),
              projects: [],
            },
          },
        }),
      });
    },
  });
  const server = createServer((request, response) => void adapter(request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server unavailable");
  try {
    return await run({ port: address.port, calls, completed: () => completed, readme });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const channelClaim = () => claimedWorkFromProto(create(ClaimedWorkSchema, {
  work: {
    case: "channelReply",
    value: {
      workId: (currentWorkId = crypto.randomUUID()),
      channelId: crypto.randomUUID(),
      scope: create(ChannelReplyScopeSchema, {
        scope: { case: "workspace", value: create(ChannelReplyScope_WorkspaceSchema, { workspaceId }) },
      }),
      runId: crypto.randomUUID(),
      sourceKey: "synthetic",
      title: "Reply",
      triggerMessageId: crypto.randomUUID(),
      parentMessageId: crypto.randomUUID(),
      provider: AgentProvider.CLAUDE,
      agent: create(DetachedAgentClaimSchema, {
        id: crypto.randomUUID(),
        name: "Synthetic Agent",
        provider: AgentProvider.CLAUDE,
        responsibility: "Answer the person directly.",
        skills: [],
      }),
      claimToken,
      claimedAt: timestampFromDate(new Date(snapshotAt)),
      leaseExpiresAt: timestampFromDate(new Date("2099-01-01T00:00:00Z")),
      snapshot: {},
      workspaceContextSnapshotAt: timestampFromDate(new Date(snapshotAt)),
    },
  },
})) as ClaimedChannelReply;

async function exerciseChannelReply(
  vault: "context" | "none",
  provider: (turn: DetachedProviderTurnInput, number: number) => Promise<DetachedProviderTurnResult>,
) {
  return withServer(vault, async ({ port, calls, completed, readme }) => {
    const root = await mkdtemp(join(tmpdir(), "briar-memory-vault-reply-"));
    let turns = 0;
    let failure: unknown;
    try {
      await runClaimedChannelReply(
        config(port), project(root), channelClaim(), "briar_worker_synthetic",
        new AbortController().signal, undefined,
        {
          workspaceRoot: root,
          runProviderTurn: ((turn: DetachedProviderTurnInput) => provider(turn, ++turns)) as never,
          prepareProviderTurn: (async () => null) as never,
          memoryToolsPath: "/opt/briar/agent/memory-tools.js",
        },
      );
    } catch (error) {
      failure = error;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    return { failure, turns, calls, completed: completed(), readme };
  });
}

/** The provider's own view: run `tools memory …` with the PATH and config of its turn. */
async function toolsFromTurn(turn: DetachedProviderTurnInput, argv: string[]) {
  const bin = turn.environment.PATH!.split(delimiter)[0]!;
  const output: string[] = [];
  const exitCode = await runMemoryTools(["--config", join(bin, "config.json"), ...argv], {
    readStdin: async () => null,
    readContentFile: async () => new Uint8Array(),
    write: (text) => { output.push(text); },
  });
  return { exitCode, json: JSON.parse(output.join("")) as Record<string, any>, bin };
}

describe("memory vault in the channel reply runner", () => {
  it("gives a vault reply the README, the tags and working tools", async () => {
    const seen: DetachedProviderTurnInput[] = [];
    let toolResult: Awaited<ReturnType<typeof toolsFromTurn>> | null = null;
    const observed = await exerciseChannelReply("context", async (turn) => {
      seen.push(turn);
      toolResult = await toolsFromTurn(turn, ["memory", "read", "bay-area"]);
      return result(reply({ body: "3월에 이사하시죠.", memoryCitations: [{ documentId: "bay-area", version: 4 }] }));
    });

    expect(observed.failure).toBeUndefined();
    expect(observed.turns).toBe(1);
    const [turn] = seen;
    expect(turn!.memoryVaultInstructions).toContain(`\n\n${observed.readme}\n\nMemory status: recall on;`);
    expect(turn!.prompt.startsWith("<voice-memory>\n- Prefers short answers")).toBe(true);
    expect(turn!.prompt).toContain("<voice-guide>\n- Answer in Korean (user, 2026-10-10)\n</voice-guide>");
    expect(turn!.prompt).toContain("<playbook-memory></playbook-memory>");
    expect(turn!.prompt).toContain("Memory is kept with the `tools memory` command");
    expect(turn!.prompt).not.toContain("memorySaveRequest");
    expect(turn!.prompt).not.toContain("memoryRequests");
    // The reply job id lets `briar channel messages` read this channel under
    // the claim; the claim token itself also authorizes submitting the reply.
    expect(turn!.environment.BRIAR_CHANNEL_REPLY_WORK_ID).toBe(currentWorkId);
    expect(JSON.stringify(turn!.environment)).not.toContain(claimToken);
    expect(toolResult).toMatchObject({ exitCode: 0, json: { id: "bay-area", revision: 4, body: "Moving in March." } });
    // The claim reached the server from the Worker side only.
    expect(observed.calls).toContain("vault-read:bay-area:true");
    expect(observed.completed).toContain("\"documentId\":\"bay-area\"");
    // The run's private directory is gone with the reply.
    await expect(readdir(toolResult!.bin)).rejects.toThrow();
  });

  it("repairs a reply that still carries the removed memoryRequests field", async () => {
    const prompts: string[] = [];
    const observed = await exerciseChannelReply("context", async (turn, number) => {
      prompts.push(turn.prompt);
      return result(number === 1
        ? reply({ memoryRequests: [{ operation: "search", queries: ["moving"], max_results: 3 }] })
        : reply({ body: "Done." }));
    });
    expect(observed.failure).toBeUndefined();
    expect(observed.turns).toBe(2);
    expect(observed.completed).toContain("Done.");
    // Every provider turn gets the tags again.
    expect(prompts[1]!.startsWith("<voice-memory>")).toBe(true);
  });

  it("runs the reply without memory when the server says none", async () => {
    const seen: DetachedProviderTurnInput[] = [];
    let bin = "";
    const observed = await exerciseChannelReply("none", async (turn) => {
      seen.push(turn);
      bin = turn.environment.PATH!.split(delimiter)[0]!;
      return result(reply({ body: "Hello." }));
    });
    expect(observed.failure).toBeUndefined();
    const [turn] = seen;
    expect(turn!.memoryVaultInstructions).toBeUndefined();
    expect(turn!.prompt).not.toContain("<voice-memory>");
    expect(turn!.prompt).toContain("Memory is unavailable for this reply.");
    expect(observed.calls.filter((call) => call === "vault-context")).toHaveLength(1);
    // The pre-warm PATH entry is an empty private directory: no `tools` is offered.
    expect(bin).toMatch(/briar-memory-tools-/u);
  });
});

describe("memory vault in the project Agent task runner", () => {
  it("injects the README and the work tags, without the voice guide", async () => {
    await withServer("context", async ({ port, readme }) => {
      const seen: DetachedProviderTurnInput[] = [];
      const task: ClaimedProjectAgentTask = {
        workType: "projectAgentTask",
        workId: crypto.randomUUID(),
        runId: crypto.randomUUID(),
        sourceKey: "agent-task:test",
        title: "Run release Skill",
        claimToken: "briar_agent_task_claim_test",
        claimAttempts: 1,
        resumeCount: 0,
        claimedAt: "2026-08-22T08:00:00+00:00",
        leaseExpiresAt: "2026-08-22T08:15:00+00:00",
        handoffContext: null,
        request: "Run the saved release Skill",
        agent: {
          id: "agent-1", name: "Release Agent", provider: "codex", model: null, effort: null,
          computerUsePolicy: "disabled", responsibility: "Release the project", skills: [],
        },
        activeSkill: null,
      } as unknown as ClaimedProjectAgentTask;
      const workspace = await mkdtemp(join(tmpdir(), "briar-memory-vault-task-"));
      try {
        await runClaimedProjectAgentTask(
          config(port), project(workspace), task, "worker-token", "worker-1",
          new AbortController().signal, undefined,
          {
            allocateWorktree: async () => ({ path: workspace, baseRef: "origin/main", baseSha: "a".repeat(40), includedPaths: [] }),
            removeWorktree: async () => undefined,
            runProviderTurn: async (turn) => {
              seen.push(turn);
              return result("Release Skill completed");
            },
            git: () => ({ exitCode: 0, stdout: "", stderr: "" }),
            memoryToolsPath: "/opt/briar/agent/memory-tools.js",
          },
        );
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
      expect(seen[0]!.memoryVaultInstructions).toContain(readme);
      expect(seen[0]!.prompt).toContain("<voice-memory>");
      expect(seen[0]!.prompt).toContain("<playbook-memory>");
      expect(seen[0]!.prompt).not.toContain("<voice-guide>");
      expect(seen[0]!.memoryVaultInstructions).not.toMatch(/memoryCitations/u);
    });
  });
});
