import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { Code, ConnectError } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { DmMemoryBriefState, DmMemoryDescriptorSchema } from "@briar/contracts/gen/briar/app/v1/dm_memory_pb";
import {
  ChannelReplyScopeSchema,
  ChannelReplyScope_ProjectSchema,
  ClaimedChannelReplySchema,
  RefreshChannelReplyClaimResponseSchema,
  ChannelReplySessionSchema,
  ChannelReplySessionClaimReason,
  ClaimedWorkSchema,
  CheckDmMemoryClaimResponseSchema,
  CheckpointChannelReplySessionResponseSchema,
  CompleteChannelReplyResponseSchema,
  GetDmMemoryBriefResponseSchema,
  DetachedAgentClaimSchema,
  PublishReplyActivityResponseSchema,
  ReplyActivityService,
  ReplyCompletionDisposition,
  WorkerQueueService,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Config, TeamConfig } from "./config-contract";
import type {
  DetachedProviderTurnInput,
  DetachedProviderTurnResult,
} from "./detached-provider-turn";
import { channelReplyAttachmentPath } from "../src/lib/channel-reply-attachment-path";
import { runClaimedChannelReply } from "./reply-execution";
import {
  claimedWorkFromProto,
  type ClaimedChannelReply,
} from "./worker-queue-contract";
import {
  listCachedAnalysisWorktrees,
  projectWorktreeRoot,
  type GitRunner,
} from "./worktree";

/*
  A DM reply used to fetch and add an analysis worktree before any model ran,
  even for "hi". These tests hold the new shape: a plain conversation turn
  starts with no checkout, asks for one only when it says it needs the
  repository, and everything outside that gate keeps allocating up front.

  The claim is built on the wire and decoded with the real contract, and the
  repository is a real git checkout, so neither the claim shape nor the
  worktree mechanics can drift away from this test.
*/

const organizationId = crypto.randomUUID();
const projectId = crypto.randomUUID();

/* Every member is present on every turn: the provider contract is exact. */
const providerOutput = (overrides: Record<string, unknown>) => ({
  body: null,
  attachments: [],
  document: null,
  issueProposal: null,
  issueBatchProposal: null,
  executionProposal: null,
  skillExecutionProposal: null,
  delegation: null,
  agentMessage: null,
  contextRequests: null,
  memoryRequests: null,
  memoryCitations: null,
  memorySaveRequest: null,
  repositoryRequest: null,
  ...overrides,
});

const answer = providerOutput({ body: "A synthetic answer" });
const repositoryRequest = providerOutput({
  repositoryRequest: { reason: "Read the router before answering" },
});

const turnResult = (
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

const dmMessage = (id: string, body: string) => ({
  id,
  author: { type: "user", id: crypto.randomUUID(), name: "Person" },
  body,
  mentionedUserIds: [],
  attachments: [],
});

const dmSnapshot = (...messages: readonly (readonly [string, string])[]) => ({
  channel: { kind: "dm", id: crypto.randomUUID() },
  messages: messages.map(([id, body]) => dmMessage(id, body)),
});

/**
 * `runGit` uses `Bun.spawnSync`, which vitest's node runtime does not have, so
 * the reply runs against the same git binary through the injected runner.
 */
const git: GitRunner = (args, options = {}) => {
  const result = spawnSync("git", [...args], {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

/** The setup steps this harness can observe from the server side. */
type HeldSetupStep = "memory-brief" | "memory-check" | "attachment";

/** Where `DmMessageInvocation` keeps the journal it owns for a work item. */
const publicationJournalDirectory = (workId: string) => join(
  "/tmp",
  "briar-dm-publication-journals",
  createHash("sha256").update(workId).digest("hex").slice(0, 32),
);

const attachmentBody = "synthetic channel attachment\n";

type Exercise = {
  /** Claim the same retained session again, the way a follow-up message does. */
  sessionId?: string;
  agentMessageHop?: number;
  /** The reaction the claim says this Agent already holds on the trigger. */
  acknowledgementReaction?: string;
  /** Bind a private DM memory space, so the claim owes a memory brief RPC. */
  memory?: boolean;
  /** Attach one text file to the trigger, so the claim owes a download. */
  attachment?: boolean;
  /**
   * Durable public messages, so the claim owes a message invocation: a journal
   * owner under /tmp and a relay socket in a private directory beside it.
   */
  publicMessages?: boolean;
  /**
   * Setup steps to hold: each one reports that it started and then waits until
   * every held step has started too. A setup that runs them one after the next
   * can never open that barrier, so it fails on the order it produced instead.
   */
  hold?: readonly HeldSetupStep[];
  /**
   * How the memory brief refuses: `transport` is an unreachable server, which
   * the reply is expected to survive, and `revoked` is the server's verdict on
   * the claim, which it is not.
   */
  memoryBriefFails?: "transport" | "revoked";
  /** What the acknowledgement selection turn answers, and when. */
  selectAcknowledgement?: () => Promise<DetachedProviderTurnResult>;
  /**
   * Reactions to wait for before the server closes: the acknowledgement is
   * deliberately off the reply's critical path, so nothing else waits for it.
   */
  expectReactions?: number;
  /**
   * What the pre-turn steer fold answers. Absent registers no handler at all,
   * which is exactly what an older server does: the RPC is unimplemented.
   */
  steerFold?: "none" | "folded";
  /** Runs once the reply has returned, while the server is still listening. */
  afterRun?: () => Promise<void>;
  provider: (
    turn: DetachedProviderTurnInput,
    number: number,
  ) => Promise<DetachedProviderTurnResult>;
};

describe("DM reply worktree allocation", () => {
  let root = "";
  let repositoryPath = "";
  let worktreeRoot = "";
  const savedWorktreeRootEnv = process.env.BRIAR_WORKTREE_ROOT;

  beforeAll(async () => {
    delete process.env.BRIAR_WORKTREE_ROOT;
    // Canonical, not the /var symlink: git reports resolved paths and the
    // worktree root guard compares them literally.
    root = await mkdtemp(join(realpathSync(tmpdir()), "briar-lazy-worktree-test-"));
    repositoryPath = join(root, "repository");
    worktreeRoot = join(root, "worktrees");
    await mkdir(repositoryPath, { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repositoryPath, stdio: "pipe" });
    git("init", "--initial-branch", "main");
    git("config", "user.email", "synthetic@example.com");
    git("config", "user.name", "Synthetic");
    git("commit", "--allow-empty", "-m", "root");
    // No remote is configured, so nothing is fetched; the base ref still has
    // to exist for `worktree add` to have something to cut from.
    git("update-ref", "refs/remotes/origin/main", "HEAD");
  });

  afterAll(async () => {
    if (savedWorktreeRootEnv === undefined) {
      delete process.env.BRIAR_WORKTREE_ROOT;
    } else {
      process.env.BRIAR_WORKTREE_ROOT = savedWorktreeRootEnv;
    }
    await rm(root, { recursive: true, force: true });
  });

  async function exercise(input: Exercise) {
    const workId = crypto.randomUUID();
    const sessionId = input.sessionId ?? crypto.randomUUID();
    const triggerMessageId = crypto.randomUUID();
    // The message the person sends while this reply is still being set up.
    const steerMessageId = crypto.randomUUID();
    const activities: string[] = [];
    // Every server call this reply makes, in the order the server saw it.
    const calls: string[] = [];
    // Where each observable setup step started and ended, so a test can tell
    // steps that overlap from steps that merely both happened.
    const events: string[] = [];
    const reactions: string[] = [];
    const attachmentId = crypto.randomUUID();
    const attachmentUrl = channelReplyAttachmentPath({
      workspaceId: organizationId,
      workId,
      attachmentId,
    });
    const startedHeldSteps = new Set<HeldSetupStep>();
    let openBarrier = () => {};
    const barrier = new Promise<void>((resolve) => { openBarrier = resolve; });
    const holdStep = async (step: HeldSetupStep) => {
      events.push(`${step}:start`);
      if (!input.hold?.includes(step)) return;
      startedHeldSteps.add(step);
      if (input.hold.every((held) => startedHeldSteps.has(held))) openBarrier();
      // A serial setup never opens the barrier. Give up rather than hang, so
      // the failure is the recorded order and not a timeout.
      await Promise.race([
        barrier,
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
    };
    let completed = "";
    let turns = 0;
    const memory = {
      protocol: 1,
      memorySpaceId: crypto.randomUUID(),
      memoryRevision: 1n,
      revocationEpoch: 1n,
      searchEnabled: false,
      briefState: DmMemoryBriefState.DISABLED,
    };

    const adapter = connectNodeAdapter({
      routes: (router) => {
        router.service(WorkerQueueService, {
          checkpointChannelReplySession: () =>
            create(CheckpointChannelReplySessionResponseSchema, {
              retainedUntil: timestampFromDate(
                new Date("2099-01-01T00:00:00Z"),
              ),
            }),
          getDmMemoryBrief: async () => {
            calls.push("memory-brief");
            await holdStep("memory-brief");
            events.push("memory-brief:end");
            if (input.memoryBriefFails === "transport") {
              throw new ConnectError(
                "synthetic memory brief outage",
                Code.Unavailable,
              );
            }
            return create(GetDmMemoryBriefResponseSchema, {
              // A revoked scope answers with an epoch the claim cannot accept.
              memory: input.memoryBriefFails === "revoked"
                ? { ...memory, revocationEpoch: memory.revocationEpoch + 1n }
                : memory,
            });
          },
          checkDmMemoryClaim: async () => {
            calls.push("memory-check");
            await holdStep("memory-check");
            events.push("memory-check:end");
            return create(CheckDmMemoryClaimResponseSchema, { memory });
          },
          ...(input.steerFold === undefined ? {} : {
            /*
              The reply asks once, right before its first provider turn. An
              older server has no such method at all, which is why the default
              here is to register none.
            */
            refreshChannelReplyClaim: () => {
              calls.push("steer-fold");
              if (input.steerFold !== "folded") {
                return create(RefreshChannelReplyClaimResponseSchema, {
                  steered: false,
                });
              }
              return create(RefreshChannelReplyClaimResponseSchema, {
                steered: true,
                reply: create(ClaimedChannelReplySchema, replyValue({
                  pendingTriggerMessageIds: [triggerMessageId, steerMessageId],
                  inputRevision: 1n,
                  snapshot: dmSnapshot(
                    [triggerMessageId, "hi"],
                    [steerMessageId, "and one more thing"],
                  ),
                })),
              });
            },
          }),
          completeChannelReply: (request) => {
            calls.push("complete");
            completed = JSON.stringify(request);
            return create(CompleteChannelReplyResponseSchema, {
              replayed: false,
              disposition: ReplyCompletionDisposition.COMPLETED,
              retainedUntil: timestampFromDate(
                new Date("2099-01-01T00:00:00Z"),
              ),
            });
          },
        });
        router.service(ReplyActivityService, {
          publishReplyActivity: (request) => {
            if (request.activity) activities.push(request.activity.headline);
            if (request.acknowledgementReaction !== undefined) {
              calls.push(`reaction:${request.acknowledgementReaction}`);
              reactions.push(request.acknowledgementReaction);
            }
            return create(PublishReplyActivityResponseSchema, {});
          },
        });
      },
    });
    const server = createServer((request, reply) => {
      // The attachment download is plain HTTP against the same origin, so it
      // is held and observed here rather than through the Connect router.
      if (request.url === attachmentUrl) {
        void (async () => {
          calls.push("attachment");
          await holdStep("attachment");
          events.push("attachment:end");
          const body = Buffer.from(attachmentBody, "utf8");
          reply.writeHead(200, {
            "Content-Type": "text/plain",
            "Content-Length": String(body.byteLength),
          });
          reply.end(body);
        })();
        return;
      }
      void adapter(request, reply);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server unavailable");
    }

    const config = {
      apiUrl: `http://127.0.0.1:${address.port}`,
      teams: [],
      agentProviders: { claude: true },
      appSettings: {
        preventSleepWhileRunning: false,
        browserAutomationProvider: "ego-browser",
      },
    } as unknown as Config;
    const project = {
      id: projectId,
      repositoryPath,
      agentToken: "synthetic",
      autoHunt: {
        worktrees: { enabled: true, root: worktreeRoot, branchPrefix: "briar" },
        sandbox: { fullAccess: false },
      },
      executionWorker: {
        workerId: "synthetic-worker",
        deviceId: crypto.randomUUID(),
        organizationId,
        token: "briar_worker_synthetic",
        label: "Synthetic",
        maxConcurrentSessions: 1,
      },
    } as unknown as TeamConfig;

    const channelId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const parentMessageId = crypto.randomUUID();
    const agentId = crypto.randomUUID();
    const threadId = crypto.randomUUID();
    /* One claim shape, so the steer fold answers with the same claim the loop
       started from and cannot drift away from it. */
    const replyValue = (overrides: Record<string, unknown> = {}) => ({
      workId,
      channelId,
      scope: create(ChannelReplyScopeSchema, {
        scope: {
          case: "project" as const,
          value: create(ChannelReplyScope_ProjectSchema, {
            workspaceId: organizationId,
            projectId,
          }),
        },
      }),
      runId,
      sourceKey: "synthetic",
      title: "Reply",
      triggerMessageId,
      parentMessageId,
      provider: AgentProvider.CLAUDE,
      agent: create(DetachedAgentClaimSchema, {
        id: agentId,
        name: "Synthetic Agent",
        provider: AgentProvider.CLAUDE,
        responsibility: "Answer the person directly.",
        skills: [],
      }),
      agentMessageHop: input.agentMessageHop ?? 0,
      session: create(ChannelReplySessionSchema, {
        id: sessionId,
        threadId,
        retainedUntil: timestampFromDate(new Date("2099-01-01T00:00:00Z")),
        claimReason: ChannelReplySessionClaimReason.SESSION_CREATED,
      }),
      activity: {
        token: "synthetic-activity",
        expiresAt: timestampFromDate(new Date("2099-01-01T00:00:00Z")),
      },
      claimToken: `briar_channel_claim_${"a".repeat(64)}`,
      claimedAt: timestampFromDate(new Date("2026-09-09T00:00:00Z")),
      leaseExpiresAt: timestampFromDate(new Date("2099-01-01T00:00:00Z")),
      acknowledgementReaction: input.acknowledgementReaction,
      memory: input.memory ? create(DmMemoryDescriptorSchema, memory) : undefined,
      dmPublicMessageProtocol: input.publicMessages ? 1 : 0,
      triggerAttachments: input.attachment
        ? [{
            id: attachmentId,
            filename: "note.txt",
            contentType: "text/plain",
            byteSize: Buffer.byteLength(attachmentBody, "utf8"),
            url: attachmentUrl,
          }]
        : [],
      pendingTriggerMessageIds: [triggerMessageId],
      snapshot: dmSnapshot([triggerMessageId, "hi"]),
      ...overrides,
    });

    const claim = claimedWorkFromProto(create(ClaimedWorkSchema, {
      work: { case: "channelReply", value: replyValue() },
    })) as ClaimedChannelReply;

    let failure: unknown;
    const workspacePaths: string[] = [];
    const acknowledgementWorkspaces: string[] = [];
    const prompts: string[] = [];
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
          git,
          // `findAgentBundle` reads `import.meta.dir`, which only Bun defines.
          dmMessageMcpServerPath: join(root, "dm-message-mcp-server.js"),
          runProviderTurn: ((turn: DetachedProviderTurnInput) => {
            // Briar picks the acknowledgement emoji on its own track; it is
            // not one of this reply's rounds.
            if (turn.agent.name === "DM acknowledgement") {
              acknowledgementWorkspaces.push(turn.workspacePath);
              return input.selectAcknowledgement
                ? input.selectAcknowledgement()
                : Promise.resolve(turnResult({ emoji: "👀" }));
            }
            calls.push(`turn:${turns + 1}`);
            events.push(`turn:${turns + 1}`);
            workspacePaths.push(turn.workspacePath);
            prompts.push(turn.prompt);
            return input.provider(turn, ++turns);
          }) as never,
        },
      );
    } catch (error) {
      failure = error;
    } finally {
      const deadline = Date.now() + 5_000;
      while (reactions.length < (input.expectReactions ?? 0) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await input.afterRun?.();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      );
    }
    return {
      failure,
      turns,
      steerMessageId,
      triggerMessageId,
      completed,
      activities,
      calls,
      events,
      reactions,
      workspacePaths,
      acknowledgementWorkspaces,
      prompts,
      sessionId,
      workId,
    };
  }

  const analysisRoot = () => join(projectWorktreeRoot(worktreeRoot, projectId), "analysis");
  const analysisEntries = async () => {
    try {
      return await readdir(analysisRoot());
    } catch {
      return [] as string[];
    }
  };

  it("answers a plain DM without checking the repository out", async () => {
    const observed = await exercise({
      provider: async () => turnResult(answer),
    });

    expect(observed.failure).toBeUndefined();
    expect(observed.turns).toBe(1);
    // The whole point: no analysis checkout was fetched or added.
    expect(await analysisEntries()).toEqual([]);
    expect(observed.workspacePaths[0]).toBe(
      join(root, "worker-sessions", `channel-${observed.sessionId}`),
    );
    await expect(stat(observed.workspacePaths[0]!)).resolves.toBeDefined();
    expect(observed.prompts[0]).toContain("it is not checked out for this turn");
    expect(observed.completed).toContain("A synthetic answer");
  });

  /*
    A second message sent while the reply was still being set up used to be
    noticed only when the finished answer was refused: the whole provider turn
    was thrown away and a second claim ran the whole setup again. Folded before
    the turn it costs one RPC, and the single turn answers both messages.
  */
  it("folds a steer into the turn it is about to run, without a second claim", async () => {
    const observed = await exercise({
      steerFold: "folded",
      provider: async () => turnResult(answer),
    });

    expect(observed.failure).toBeUndefined();
    expect(observed.turns).toBe(1);
    expect(observed.calls.filter((call) => call === "steer-fold")).toHaveLength(1);
    // The fold happens before the provider runs, never after it.
    expect(observed.calls.indexOf("steer-fold"))
      .toBeLessThan(observed.calls.indexOf("turn:1"));
    const prompt = observed.prompts[0]!;
    expect(prompt).toContain("none of them has been answered yet");
    expect(prompt).toContain(observed.triggerMessageId);
    expect(prompt).toContain(observed.steerMessageId);
    expect(prompt).toContain("and one more thing");
    expect(prompt).toContain('"unanswered": true');
    // The turn never started, so there is no interrupted response to continue.
    expect(prompt).not.toContain("Continue the interrupted response");
    expect(observed.completed).toContain("A synthetic answer");
  });

  it("asks once and changes nothing when no steer is pending", async () => {
    const observed = await exercise({
      steerFold: "none",
      provider: async () => turnResult(answer),
    });

    expect(observed.failure).toBeUndefined();
    expect(observed.turns).toBe(1);
    expect(observed.calls.filter((call) => call === "steer-fold")).toHaveLength(1);
    const prompt = observed.prompts[0]!;
    expect(prompt).not.toContain("none of them has been answered yet");
    expect(prompt).not.toContain(observed.steerMessageId);
    expect(observed.completed).toContain("A synthetic answer");
  });

  it("answers normally against a server that does not implement the fold", async () => {
    const observed = await exercise({
      provider: async () => turnResult(answer),
    });

    expect(observed.failure).toBeUndefined();
    expect(observed.turns).toBe(1);
    expect(observed.calls).not.toContain("steer-fold");
    expect(observed.completed).toContain("A synthetic answer");
  });

  it("checks the repository out only when the Agent asks, then continues the same conversation", async () => {
    const conversationId = crypto.randomUUID();
    const observed = await exercise({
      provider: async (_turn, number) =>
        number === 1
          ? turnResult(repositoryRequest, conversationId)
          : turnResult(answer, conversationId),
    });

    expect(observed.failure).toBeUndefined();
    expect(observed.turns).toBe(2);
    const worktreePath = join(
      analysisRoot(),
      `analysis-${observed.sessionId}`,
    );
    // Round one ran repository-less; round two ran inside the new checkout.
    expect(observed.workspacePaths[0]).not.toBe(worktreePath);
    expect(observed.workspacePaths[1]).toBe(worktreePath);
    await expect(stat(join(worktreePath, ".git"))).resolves.toBeDefined();
    // The continuation names the checkout and repeats that it is throwaway.
    expect(observed.prompts[1]).toContain(worktreePath);
    expect(observed.prompts[1]).toContain("discarded after this reply");
    expect(observed.prompts[1]).toContain("do not request it again");
    // The request itself never reaches the server as a completion.
    expect(observed.completed).toContain("A synthetic answer");
    expect(observed.completed).not.toContain("Read the router before answering");
    expect(observed.activities).toContain("저장소 확인 중");
    // A retained session keeps the checkout so a retry or steer reuses it.
    const cached = await listCachedAnalysisWorktrees(
      projectWorktreeRoot(worktreeRoot, projectId),
    );
    expect(cached.map((record) => record.runId)).toContain(observed.sessionId);
  });

  it("reuses a session checkout that already exists without asking again", async () => {
    const sessionId = crypto.randomUUID();
    const first = await exercise({
      sessionId,
      provider: async (_turn, number) =>
        number === 1
          ? turnResult(repositoryRequest, crypto.randomUUID())
          : turnResult(answer),
    });
    expect(first.failure).toBeUndefined();
    const record = (await listCachedAnalysisWorktrees(
      projectWorktreeRoot(worktreeRoot, projectId),
    )).find((candidate) => candidate.runId === sessionId);
    expect(record).toBeDefined();

    // The next message in that DM claims the same session; the checkout it
    // already has is used from round one, with no second request.
    const observed = await exercise({
      sessionId,
      provider: async () => turnResult(answer),
    });
    expect(observed.failure).toBeUndefined();
    expect(observed.turns).toBe(1);
    expect(observed.workspacePaths[0]).toBe(record!.path);
    expect(observed.prompts[0]).toContain(
      "A disposable project worktree is available",
    );
  });

  it("rejects a second repository request in the same reply", async () => {
    const conversationId = crypto.randomUUID();
    const observed = await exercise({
      provider: async () => turnResult(repositoryRequest, conversationId),
    });
    expect(observed.failure).toMatchObject({
      message: "repository_budget_exhausted",
    });
    expect(observed.turns).toBe(2);
  });

  it("keeps the up-front checkout outside the gate and refuses a request there", async () => {
    const observed = await exercise({
      // An Agent-to-Agent hop is not a plain conversation turn.
      agentMessageHop: 1,
      provider: async () => turnResult(repositoryRequest),
    });
    // Outside the gate nothing changed: the checkout exists before turn one.
    expect(observed.workspacePaths[0]).toContain("analysis-");
    expect(observed.prompts[0]).toContain(
      "A disposable project worktree is available",
    );
    expect(observed.failure).toMatchObject({ message: "repository_unavailable" });
  });

  /*
    The reaction used to wait for routing, the worktree, the memory brief and a
    whole provider turn of its own, so it reached the person about 48 seconds
    after they sent the message. It is now published from the claim itself.
  */
  it("publishes the placeholder before the reply asks the server for anything else", async () => {
    const observed = await exercise({
      memory: true,
      expectReactions: 1,
      provider: async () => turnResult(answer),
    });

    expect(observed.failure).toBeUndefined();
    expect(observed.reactions).toEqual(["👀"]);
    expect(observed.calls.indexOf("reaction:👀")).toBeLessThan(
      observed.calls.indexOf("memory-brief"),
    );
    // The selection has no workspace of its own to run in yet, so it never
    // borrows the reply's.
    expect(observed.acknowledgementWorkspaces[0]).not.toContain("worker-sessions");
    expect(observed.workspacePaths).not.toContain(observed.acknowledgementWorkspaces[0]);
    await expect(stat(observed.acknowledgementWorkspaces[0]!)).rejects.toThrow();
  });

  it("replaces the placeholder with the emoji the model chose", async () => {
    const observed = await exercise({
      selectAcknowledgement: async () => turnResult({ emoji: "🎉" }),
      expectReactions: 2,
      provider: async () => turnResult(answer),
    });

    expect(observed.failure).toBeUndefined();
    // Order, not just membership: the placeholder can never land on top.
    expect(observed.reactions).toEqual(["👀", "🎉"]);
    expect(observed.completed).toContain("A synthetic answer");
  });

  it("publishes nothing beyond the placeholder when selection fails", async () => {
    const observed = await exercise({
      selectAcknowledgement: () => Promise.reject(new Error("provider offline")),
      expectReactions: 1,
      provider: async () => turnResult(answer),
    });

    expect(observed.failure).toBeUndefined();
    expect(observed.reactions).toEqual(["👀"]);
  });

  it("ignores a selection that only lands after the reply finished", async () => {
    let selected!: (value: DetachedProviderTurnResult) => void;
    const observed = await exercise({
      selectAcknowledgement: () => new Promise((resolve) => { selected = resolve; }),
      expectReactions: 1,
      afterRun: async () => {
        selected(turnResult({ emoji: "🎉" }));
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
      provider: async () => turnResult(answer),
    });

    expect(observed.failure).toBeUndefined();
    expect(observed.reactions).toEqual(["👀"]);
  });

  /*
    Even with no checkout to make, a DM used to spend 15–30 seconds between its
    claim and `turn.started` because every setup step waited for the one before
    it. These tests hold the shape that fixed it: the steps that do not depend
    on each other are in flight together, and the turn still waits for all of
    them.
  */
  it("runs the memory brief and the attachment download against each other", async () => {
    const observed = await exercise({
      memory: true,
      attachment: true,
      hold: ["memory-brief", "attachment"],
      provider: async () => turnResult(answer),
    });

    expect(observed.failure).toBeUndefined();
    // Each one started before the other could finish: serialized, the second
    // start could only follow the first end.
    expect(observed.events.indexOf("memory-brief:start")).toBeLessThan(
      observed.events.indexOf("attachment:end"),
    );
    expect(observed.events.indexOf("attachment:start")).toBeLessThan(
      observed.events.indexOf("memory-brief:end"),
    );
    // Both results are still owed before the model runs.
    expect(observed.events.indexOf("memory-brief:end")).toBeLessThan(
      observed.events.indexOf("turn:1"),
    );
    expect(observed.events.indexOf("attachment:end")).toBeLessThan(
      observed.events.indexOf("turn:1"),
    );
    // The downloaded file reached the prompt, so the parallel step really ran.
    expect(observed.prompts[0]).toContain(".briar-channel-attachments");
  });

  /*
    The memory claim check that used to open round one is the same fence, moved:
    it now runs inside the setup, beside the steps that do not need it, instead
    of costing a serial round trip once they are all finished. M07 needs it
    before the first provider turn either way.
  */
  it("checks the memory claim before the first turn, beside the other setup", async () => {
    const observed = await exercise({
      memory: true,
      attachment: true,
      hold: ["memory-check", "attachment"],
      provider: async () => turnResult(answer),
    });

    expect(observed.failure).toBeUndefined();
    // The attachment download was already in flight when the check ran, which
    // it could not be if the check waited for the whole setup to finish.
    expect(observed.events.indexOf("attachment:start")).toBeLessThan(
      observed.events.indexOf("memory-check:end"),
    );
    expect(observed.calls.indexOf("memory-check")).toBeLessThan(
      observed.calls.indexOf("turn:1"),
    );
    // Round one asks nothing further; a later round still checks in the loop.
    const beforeFirstTurn = observed.calls.slice(
      0,
      observed.calls.indexOf("turn:1"),
    );
    expect(beforeFirstTurn.filter((call) => call === "memory-check")).toHaveLength(1);
  });

  it("checks the memory claim again on a continuation round", async () => {
    const observed = await exercise({
      memory: true,
      // Unparseable output, so round two is a repair continuation rather than
      // anything that would publish activity of its own.
      provider: async (_turn, number) =>
        number === 1 ? turnResult("not a channel reply") : turnResult(answer),
    });

    expect(observed.failure).toBeUndefined();
    expect(observed.turns).toBe(2);
    const between = observed.calls.slice(
      observed.calls.indexOf("turn:1") + 1,
      observed.calls.indexOf("turn:2"),
    );
    expect(between).toEqual(["memory-check"]);
  });

  it("cleans a created message invocation up when the memory brief is revoked", async () => {
    const observed = await exercise({
      memory: true,
      publicMessages: true,
      memoryBriefFails: "revoked",
      provider: async () => turnResult(answer),
    });

    // A revocation is the server's answer, not a stall: the reply still stops
    // before the model is asked anything.
    expect(observed.failure).toMatchObject({
      message: "memory_scope_revoked",
    });
    expect(observed.turns).toBe(0);
    // The message invocation was created beside the failing brief. Its journal
    // owner is released only by `cleanup()`, so its absence is the proof that
    // the relay socket and its private directory went with it.
    expect(observed.calls).toContain("memory-brief");
    await expect(
      stat(join(publicationJournalDirectory(observed.workId), "owner.json")),
    ).rejects.toThrow();
    await expect(
      stat(publicationJournalDirectory(observed.workId)),
    ).resolves.toBeDefined();
  });

  /*
    The other half of the same claim: a brief the server cannot answer at all
    used to fail the whole reply, so a DM whose memory space held nothing lost
    its answer to a 7 s stall (2026-09-09).
  */
  it("answers without the brief when it keeps failing at the transport", async () => {
    const logs: string[] = [];
    const log = vi.spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => { logs.push(args.join(" ")); });
    let observed;
    try {
      observed = await exercise({
        memory: true,
        memoryBriefFails: "transport",
        provider: async () => turnResult(answer),
      });
    } finally { log.mockRestore(); }

    expect(observed.failure).toBeUndefined();
    expect(observed.turns).toBe(1);
    // Three attempts inside the one setup step, not three claims.
    expect(observed.calls.filter((call) => call === "memory-brief")).toHaveLength(3);
    expect(observed.prompts[0]).toContain(
      "The memory brief could not be loaded for this reply.",
    );
    expect(observed.completed).toContain("A synthetic answer");
    expect(logs.some((line) =>
      line.startsWith("channel reply setup:") &&
      line.includes(`"memoryBrief":"unavailable"`)
    )).toBe(true);
  });

  it("neither reacts nor runs a selection when the claim already carries one", async () => {
    const observed = await exercise({
      acknowledgementReaction: "🎉",
      provider: async () => turnResult(answer),
    });

    expect(observed.failure).toBeUndefined();
    expect(observed.reactions).toEqual([]);
    expect(observed.acknowledgementWorkspaces).toEqual([]);
    expect(observed.completed).toContain("A synthetic answer");
  });

});
