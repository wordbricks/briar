import type { IssueExecutionRecommendation } from "../src/lib/issue-execution-recommendation";
import { createServer } from "node:http";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create, fromJson, type JsonValue } from "@bufbuild/protobuf";
import { ValueSchema, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { Code, ConnectError } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  WorkspaceAgentContextService,
  WorkspaceAgentContextServiceGetManifestResponseSchema,
} from "@briar/contracts/gen/briar/worker/v1/workspace_agent_context_pb";
import {
  DmMemoryBriefState,
  DmMemoryDescriptorSchema,
} from "@briar/contracts/gen/briar/app/v1/dm_memory_pb";
import {
  CheckDmMemoryClaimResponseSchema,
  ClaimedWorkSchema,
  ChannelReplyScopeSchema,
  ChannelReplyScope_WorkspaceSchema,
  DetachedAgentClaimSchema,
  CompleteChannelReplyResponseSchema,
  GetDmMemoryBriefResponseSchema,
  LookupDmMemoryResponseSchema,
  ReplyCompletionDisposition,
  WorkerQueueService,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import {
  NormalizedAgentEventSchema,
} from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import { describe, expect, it } from "vitest";
import { sidecarProviderEvent } from "../src-agent/sidecar-protocol";
import type { Config, TeamConfig } from "./config-contract";
import type {
  DetachedProviderTurnInput,
  DetachedProviderTurnResult,
} from "./detached-provider-turn";
import { runClaimedChannelReply } from "./reply-execution";
import { claimedWorkFromProto, type ClaimedChannelReply } from "./worker-queue-contract";

/*
  The runner half of the DM memory contract: what a real provider turn actually
  receives, what survives a provider that cannot resume its conversation, and
  what stops the moment the server revokes the claim. Written against the
  pre-Connect HTTP endpoints, deleted in #1427, and restored here on a synthetic
  Connect server so the generated Worker Queue client is exercised end to end.
*/
const workspaceId = crypto.randomUUID();
const projectId = crypto.randomUUID();
const workId = crypto.randomUUID();
const documentId = crypto.randomUUID();
const memorySpaceId = crypto.randomUUID();
const snapshotAt = "2026-09-01T00:00:00.000Z";

const brief = {
  memorySpaceId,
  memoryRevision: 1,
  revocationEpoch: 0,
  policyVersion: "test",
  validThrough: null,
  profile: [],
  progress: [],
  omitted: true,
  notice: "Search other memories when needed.",
};

const lookupBody = "Synthetic old preference: use metric units.";
const lookupResponse = {
  operation: "get",
  memoryRevision: 1,
  revocationEpoch: 0,
  truncated: false,
  documents: [{
    status: "ok",
    documentId,
    version: 1,
    title: "Synthetic older note",
    memoryClass: "note",
    body: lookupBody,
    evidenceType: "explicit_user",
    protectedByUser: true,
    sourceLanguage: "en",
    observedAt: null,
    validUntil: null,
    conflicted: false,
    sourceMessageIds: [],
    sourceEventIds: [],
    updatedAt: snapshotAt,
    offsetBytes: 0,
    nextOffsetBytes: null,
    endOffsetBytes: lookupBody.length,
  }],
};

/* The provider contract is exact: every field is present on every turn. */
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
  memoryRequests: null,
  memoryCitations: null,
  memorySaveRequest: null,
  contextRequests: null,
  ...overrides,
});

const final = reply({
  body: "A synthetic answer in metric units",
  memoryCitations: [{ documentId, version: 1 }],
});

const result = (
  value: unknown,
  conversationId: string | null = null,
): DetachedProviderTurnResult => ({
  resultText: JSON.stringify(value),
  conversationId,
  completed: true,
  exitCode: 0,
  stderr: "",
  runnerError: null,
});

const jsonValue = (value: unknown) =>
  fromJson(ValueSchema, JSON.parse(JSON.stringify(value)) as JsonValue);

const wireDescriptor = (revocationEpoch: number) =>
  create(DmMemoryDescriptorSchema, {
    protocol: 1,
    memorySpaceId,
    memoryRevision: 1n,
    revocationEpoch: BigInt(revocationEpoch),
    searchEnabled: true,
    briefState: DmMemoryBriefState.AVAILABLE,
  });

describe("DM memory in the actual channel reply runner", () => {
  async function exercise(input: {
    revokedAfter?: number;
    /** Every claim check after this many answers with an unreachable server. */
    checkTransportFailsAfter?: number;
    activity?: boolean;
    acknowledgement?: { execution: IssueExecutionRecommendation | null };
    provider: (
      turn: DetachedProviderTurnInput,
      number: number,
    ) => Promise<DetachedProviderTurnResult>;
  }) {
    const root = await mkdtemp(join(tmpdir(), "briar-memory-loop-test-"));
    const requests: string[] = [];
    let checks = 0;
    let turns = 0;
    let completed = "";

    const epoch = () => checks > (input.revokedAfter ?? Infinity) ? 1 : 0;
    const adapter = connectNodeAdapter({
      routes: (router) => {
        router.service(WorkerQueueService, {
          checkDmMemoryClaim: () => {
            checks++;
            if (checks > (input.checkTransportFailsAfter ?? Infinity)) {
              throw new ConnectError("synthetic claim check outage", Code.Unavailable);
            }
            return create(CheckDmMemoryClaimResponseSchema, {
              memory: wireDescriptor(epoch()),
            });
          },
          getDmMemoryBrief: () =>
            create(GetDmMemoryBriefResponseSchema, {
              memory: wireDescriptor(epoch()),
              brief: jsonValue(brief),
            }),
          lookupDmMemory: () =>
            create(LookupDmMemoryResponseSchema, {
              response: jsonValue(lookupResponse),
            }),
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
          getManifest: () =>
            create(WorkspaceAgentContextServiceGetManifestResponseSchema, {
              result: {
                case: "manifest",
                value: {
                  workspaceId: workspaceId,
                  workId,
                  snapshotAt: timestampFromDate(new Date(snapshotAt)),
                  revision: "a".repeat(64),
                  projects: [],
                },
              },
            }),
        });
      },
    });

    const server = createServer((request, reply) => {
      requests.push(new URL(request.url!, "http://localhost").pathname);
      void adapter(request, reply);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server unavailable");
    }

    const config: Config = {
      apiUrl: `http://127.0.0.1:${address.port}`,
      projects: [],
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
        browserAutomationProvider: "ego-browser",
      },
    } as unknown as Config;
    const project: TeamConfig = {
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
    } as unknown as TeamConfig;

    // Build the wire claim and decode it with the real contract, so this test
    // cannot drift from what a Worker actually receives.
    const claim = claimedWorkFromProto(create(ClaimedWorkSchema, {
      work: {
        case: "channelReply",
        value: {
          workId,
          channelId: crypto.randomUUID(),
          scope: create(ChannelReplyScopeSchema, {
            scope: {
              case: "workspace",
              value: create(ChannelReplyScope_WorkspaceSchema, {
                workspaceId: workspaceId,
              }),
            },
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
          claimToken: `briar_channel_claim_${"a".repeat(64)}`,
          claimedAt: timestampFromDate(new Date(snapshotAt)),
          leaseExpiresAt: timestampFromDate(new Date("2099-01-01T00:00:00Z")),
          snapshot: {},
          workspaceContextSnapshotAt: timestampFromDate(new Date(snapshotAt)),
          memory: wireDescriptor(0),
          ...(input.activity
            ? {
              activity: {
                token: "synthetic-activity",
                expiresAt: timestampFromDate(new Date("2099-01-01T00:00:00Z")),
              },
            }
            : {}),
        },
      },
    })) as ClaimedChannelReply;

    if (input.acknowledgement) {
      claim.model = "body-model";
      claim.effort = "high";
      claim.snapshot = {
        channel: { kind: "dm" },
        messages: [{ id: claim.triggerMessageId, author: { type: "user" }, body: "Thanks for helping!" }],
      };
    }
    let failure: unknown;
    try {
      await runClaimedChannelReply(
        config,
        project,
        claim,
        "briar_worker_synthetic",
        new AbortController().signal,
        undefined,
        {
          workspaceRoot: root,
          runProviderTurn: ((turn: DetachedProviderTurnInput) =>
            input.provider(turn, ++turns)) as never,
        },
        input.acknowledgement?.execution ?? null,
      );
    } catch (error) {
      failure = error;
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      );
      await rm(root, { recursive: true, force: true });
    }
    return { failure, turns, requests, completed, checks };
  }

  it.each([
    { provider: "codex", model: "easy-model", effort: "max" } as const,
    null,
  ])("keeps body settings and isolates acknowledgement execution %j", async (execution) => {
    const selected: DetachedProviderTurnInput[] = [];
    const body: DetachedProviderTurnInput[] = [];
    const observed = await exercise({
      activity: true,
      acknowledgement: { execution },
      provider: async (turn) => {
        if (turn.agent.name === "DM acknowledgement") {
          selected.push(turn);
          return result({ emoji: "🙏" });
        }
        body.push(turn);
        // Let the independent selector start before body completion cleans up.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return result(final);
      },
    });
    expect(observed.failure).toBeUndefined();
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      agent: {
        ...(execution ?? { provider: "claude", model: "body-model", effort: "high" }),
        skills: [], activeSkill: null, computerUsePolicy: "disabled",
      },
      fullAccess: false, readOnly: true, conversationId: null,
    });
    expect(selected[0]!.prompt).toContain("Thanks for helping!");
    expect(body.length).toBeGreaterThan(0);
    for (const turn of body) {
      expect(turn.agent).toMatchObject({ provider: "claude", model: "body-model", effort: "high" });
      expect(turn.workspacePath).not.toBe(selected[0]!.workspacePath);
    }
  });

  it("M02/M03/M17 reconstructs retrieved sources for a provider without conversation continuation", async () => {
    const prompts: string[] = [];
    let privateDirectory = "";
    const observed = await exercise({
      provider: async (turn, number) => {
        prompts.push(turn.prompt);
        privateDirectory =
          turn.prompt.match(/Private profile file: (.+)\/profile\.md/u)![1]!;
        expect(turn.conversationId).toBeNull();
        return result(
          number === 1
            ? reply({
              memoryRequests: [{
                operation: "get",
                documents: [{ documentId, version: 1 }],
              }],
            })
            : final,
        );
      },
    });
    expect(observed.failure).toBeUndefined();
    expect(observed.turns).toBe(2);
    expect(prompts[0]).not.toContain(lookupBody);
    expect(prompts[1]).toContain(lookupBody);
    expect(observed.completed).toContain(documentId);
    expect(observed.completed).not.toContain(lookupBody);
    await expect(stat(privateDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("hands the reply job id, but never the claim token, to the provider", async () => {
    const environments: Array<NodeJS.ProcessEnv | undefined> = [];
    const observed = await exercise({
      provider: async (turn) => {
        environments.push(turn.environment);
        return result(final);
      },
    });

    expect(observed.failure).toBeUndefined();
    // The identifier the Agent needs so `briar channel messages` can read the
    // channel it is replying in under this session's own claim.
    expect(environments[0]?.BRIAR_CHANNEL_REPLY_WORK_ID).toBe(workId);
    // The claim token also authorizes submitting the reply, so widening it to
    // the Agent process is out of scope.
    expect(JSON.stringify(environments[0])).not.toContain(
      "briar_channel_claim_",
    );
  });

  it("M13 keeps private provider errors out of the durable failure payload", async () => {
    const observed = await exercise({
      provider: async () => ({
        resultText: "",
        conversationId: null,
        completed: false,
        exitCode: 1,
        stderr: "Synthetic private memory echoed by a failing provider",
        runnerError: null,
      }),
    });
    expect(observed.failure).toBeDefined();
    expect(observed.completed).not.toContain(
      "Synthetic private memory echoed by a failing provider",
    );
  });

  it("M07 blocks a revoked claim before invoking a provider", async () => {
    const observed = await exercise({
      revokedAfter: 0,
      provider: async () => result(final),
    });
    expect(observed.failure).toMatchObject({ message: "memory_scope_revoked" });
    expect(observed.turns).toBe(0);
    expect(observed.completed).toBe("");
  });

  it("M07 aborts provider work before publishing activity after revocation", async () => {
    let aborted = false;
    const observed = await exercise({
      revokedAfter: 1,
      activity: true,
      provider: async (turn) => {
        const abort = new Promise<void>((resolve) =>
          turn.signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          }, { once: true })
        );
        await turn.onPayload?.(
          sidecarProviderEvent({
            raw: { synthetic: true },
            event: create(NormalizedAgentEventSchema, {
              event: {
                case: "messageStarted",
                value: {
                  id: "synthetic",
                  phase: "commentary",
                  text: "Synthetic progress",
                },
              },
            }),
          }) as never,
        );
        await abort;
        return result(final);
      },
    });
    expect(aborted).toBe(true);
    expect(observed.failure).toBeDefined();
    expect(observed.completed).toBe("");
    expect(observed.requests.some((path) => path.includes("ReplyActivity")))
      .toBe(false);
  });

  /*
    The same publisher path as the M07 abort above, with the one difference
    that decides whether a reply survives: an unreachable server is not a
    revocation. A transport failure here threw away a live Computer Use turn
    100 seconds in (2026-09-09).
  */
  it("keeps a live turn when a mid-turn claim check cannot reach the server", async () => {
    let aborted = false;
    const observed = await exercise({
      activity: true,
      // Everything after the setup check fails, which is the activity-time
      // check and then the one before publication.
      checkTransportFailsAfter: 1,
      provider: async (turn) => {
        turn.signal.addEventListener("abort", () => { aborted = true; }, { once: true });
        await turn.onPayload?.(
          sidecarProviderEvent({
            raw: { synthetic: true },
            event: create(NormalizedAgentEventSchema, {
              event: {
                case: "messageStarted",
                value: {
                  id: "synthetic",
                  phase: "commentary",
                  text: "Synthetic progress",
                },
              },
            }),
          }) as never,
        );
        // Outlive all three attempts and their backoff before answering.
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        return result(final);
      },
    });
    expect(aborted).toBe(false);
    expect(observed.failure).toBeUndefined();
    expect(observed.turns).toBe(1);
    expect(observed.completed).toContain("A synthetic answer in metric units");
    // The publish the failing check used to take down with the turn.
    expect(observed.requests.some((path) => path.includes("ReplyActivity")))
      .toBe(true);
  });

  it("M07 blocks a revocation between model generation and final publication", async () => {
    const observed = await exercise({
      revokedAfter: 1,
      provider: async () => result(final),
    });
    expect(observed.failure).toMatchObject({ message: "memory_scope_revoked" });
    expect(observed.turns).toBe(1);
    expect(observed.completed).toBe("");
  });
});
