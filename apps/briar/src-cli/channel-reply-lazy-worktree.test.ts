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
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  ChannelReplyScopeSchema,
  ChannelReplyScope_ProjectSchema,
  ClaimedChannelReplySchema,
  RefreshChannelReplyClaimResponseSchema,
  ChannelReplySessionSchema,
  ChannelReplySessionClaimReason,
  ClaimedWorkSchema,
  CheckpointChannelReplySessionResponseSchema,
  CompleteChannelReplyResponseSchema,
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
  deferChannelReplyTimelineOutcome,
  settleChannelReplyTimelineOutcome,
} from "./channel-reply-timeline";
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
  memoryCitations: null,
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

/*
  A quarter second before the claim: the reply reads this to say how long the
  person waited before the Worker even had the job.
*/
const triggerCreatedAt = () => new Date(Date.now() - 250).toISOString();

const dmMessage = (id: string, body: string) => ({
  id,
  author: { type: "user", id: crypto.randomUUID(), name: "Person" },
  body,
  createdAt: triggerCreatedAt(),
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
type HeldSetupStep = "attachment" | "prewarm";

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
  /**
   * The reaction the claim says this Agent already holds on the trigger. The
   * server picks its emoji at receipt, so a claim usually carries one.
   */
  acknowledgementReaction?: string;
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
  /** The attachment download answers 500, so the setup fails before any turn. */
  attachmentFails?: boolean;
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
  /**
   * What the Worker command does for a reply it may have to reclaim: register
   * for the steer verdict before the reply runs, then answer it afterwards.
   */
  steerVerdict?: "steered";
  /**
   * Pre-warm the provider process at claim time. The fake stands in for a real
   * prepared runner: it records what the reply asked for and what it did with
   * the handle, without spawning anything.
   */
  prewarm?: boolean;
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

    const adapter = connectNodeAdapter({
      routes: (router) => {
        router.service(WorkerQueueService, {
          checkpointChannelReplySession: () =>
            create(CheckpointChannelReplySessionResponseSchema, {
              retainedUntil: timestampFromDate(
                new Date("2099-01-01T00:00:00Z"),
              ),
            }),
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
          if (input.attachmentFails) {
            reply.writeHead(500);
            reply.end();
            return;
          }
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
    // Every line the reply printed, so a test can read its own account of it.
    const logs: string[] = [];
    const logged = vi.spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => { logs.push(args.join(" ")); });
    if (input.steerVerdict) deferChannelReplyTimelineOutcome(workId);
    const workspacePaths: string[] = [];
    const prompts: string[] = [];
    const toolInheritances: (string | undefined)[] = [];
    // What the reply asked the pre-warm for, and what it did with the handle.
    const prewarmRequests: {
      workspacePath: string;
      conversationId: string | null;
    }[] = [];
    const prewarmDiscards: string[] = [];
    /** Whether each reply round was handed the pre-warmed process. */
    const preparedRounds: boolean[] = [];
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
          prepareProviderTurn: (async (turn: DetachedProviderTurnInput) => {
            if (!input.prewarm) return null;
            prewarmRequests.push({
              workspacePath: turn.workspacePath,
              conversationId: turn.conversationId ?? null,
            });
            await holdStep("prewarm");
            events.push("prewarm:end");
            return {
              provider: turn.agent.provider,
              run: () => { throw new Error("unused by this harness"); },
              discard: async (reason: string) => {
                prewarmDiscards.push(reason);
              },
            };
          }) as never,
          runProviderTurn: ((
            turn: DetachedProviderTurnInput,
            prepared?: unknown,
          ) => {
            calls.push(`turn:${turns + 1}`);
            events.push(`turn:${turns + 1}`);
            workspacePaths.push(turn.workspacePath);
            prompts.push(turn.prompt);
            toolInheritances.push(turn.toolInheritance);
            preparedRounds.push(
              prepared !== null && prepared !== undefined,
            );
            return input.provider(turn, ++turns);
          }) as never,
        },
      );
    } catch (error) {
      failure = error;
    } finally {
      if (input.steerVerdict) {
        settleChannelReplyTimelineOutcome(workId, input.steerVerdict);
      }
      const deadline = Date.now() + 5_000;
      while (reactions.length < (input.expectReactions ?? 0) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await input.afterRun?.();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      );
      logged.mockRestore();
    }
    return {
      failure,
      logs,
      turns,
      steerMessageId,
      triggerMessageId,
      completed,
      activities,
      calls,
      events,
      reactions,
      workspacePaths,
      prompts,
      toolInheritances,
      prewarmRequests,
      prewarmDiscards,
      preparedRounds,
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

  /*
    The host user's `~/.codex/config.toml` MCP servers, apps and plugins were
    started before the prompt reached the model on every reply round — 4.5 s of
    the measured boot — and a channel reply never uses them.
  */
  it("asks for Briar-owned tools on every round of a channel reply", async () => {
    const conversationId = crypto.randomUUID();
    const observed = await exercise({
      provider: async (_turn, number) =>
        number === 1
          ? turnResult(repositoryRequest, conversationId)
          : turnResult(answer, conversationId),
    });

    expect(observed.failure).toBeUndefined();
    expect(observed.turns).toBe(2);
    expect(observed.toolInheritances).toEqual(["briar", "briar"]);
  });

  /*
    The provider process is what a "hi" waits on after the setup, and starting
    it needs nothing the setup produces. These hold the shape of that: it runs
    beside the attachment download, only the first round may use it, and it
    never outlives the reply.
  */
  it("pre-warms the provider process against the rest of the setup", async () => {
    const observed = await exercise({
      prewarm: true,
      attachment: true,
      hold: ["attachment", "prewarm"],
      provider: async () => turnResult(answer),
    });

    expect(observed.failure).toBeUndefined();
    // Each one started before the other could finish: serialized, the second
    // start could only follow the first end.
    expect(observed.events.indexOf("prewarm:start")).toBeLessThan(
      observed.events.indexOf("attachment:end"),
    );
    expect(observed.events.indexOf("attachment:start")).toBeLessThan(
      observed.events.indexOf("prewarm:end"),
    );
    // Both results are still owed before the model runs.
    expect(observed.events.indexOf("attachment:end")).toBeLessThan(
      observed.events.indexOf("turn:1"),
    );
    expect(observed.events.indexOf("prewarm:end")).toBeLessThan(
      observed.events.indexOf("turn:1"),
    );
    // The downloaded file reached the prompt, so the parallel step really ran.
    expect(observed.prompts[0]).toContain(".briar-channel-attachments");
    expect(observed.prewarmRequests).toEqual([
      {
        workspacePath: join(root, "worker-sessions", `channel-${observed.sessionId}`),
        conversationId: null,
      },
    ]);
    expect(observed.preparedRounds).toEqual([true]);
    // The reply owns the process end to end, however it finishes.
    expect(observed.prewarmDiscards).toEqual(["reply_finished"]);
  });

  it("keeps the pre-warmed process off every round after the first", async () => {
    const conversationId = crypto.randomUUID();
    const observed = await exercise({
      prewarm: true,
      provider: async (_turn, number) =>
        number === 1
          ? turnResult(repositoryRequest, conversationId)
          : turnResult(answer, conversationId),
    });

    expect(observed.failure).toBeUndefined();
    expect(observed.turns).toBe(2);
    // The repository round runs in a different workspace and continues the
    // conversation the first round started; the warm process fits neither.
    expect(observed.preparedRounds).toEqual([true, false]);
  });

  it("kills the pre-warmed process when the reply fails before its turn", async () => {
    const observed = await exercise({
      prewarm: true,
      attachment: true,
      attachmentFails: true,
      provider: async () => turnResult(answer),
    });

    expect(observed.failure).toBeDefined();
    expect(observed.turns).toBe(0);
    expect(observed.prewarmDiscards).toEqual(["reply_finished"]);
  });

  it("asks for no pre-warm when the runtime cannot prepare one", async () => {
    const observed = await exercise({
      provider: async () => turnResult(answer),
    });

    expect(observed.failure).toBeUndefined();
    expect(observed.prewarmRequests).toEqual([]);
    expect(observed.preparedRounds).toEqual([false]);
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

  it("answers after refusing a workspace context request on a project reply", async () => {
    const conversationId = crypto.randomUUID();
    const contextRequest = providerOutput({
      contextRequests: [
        { resource: "issues", projectId: "project-1", detail: "summary", limit: 25, cursor: null },
      ],
    });
    const observed = await exercise({
      provider: async (_turn, number) =>
        number === 1 ? turnResult(contextRequest, conversationId) : turnResult(answer),
    });
    expect(observed.failure).toBeUndefined();
    expect(observed.turns).toBe(2);
    expect(observed.prompts[1]).toContain("contextRequests must be null");
    expect(observed.prompts[1]).toContain("repositoryRequest");
  });

  it("fails a project reply that requests workspace context twice", async () => {
    const conversationId = crypto.randomUUID();
    const contextRequest = providerOutput({
      contextRequests: [
        { resource: "issues", projectId: "project-1", detail: "summary", limit: 25, cursor: null },
      ],
    });
    const observed = await exercise({
      provider: async () => turnResult(contextRequest, conversationId),
    });
    expect(observed.failure).toMatchObject({
      message: expect.stringContaining("cannot request workspace context"),
    });
    expect(observed.turns).toBe(2);
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
    The reaction used to wait for routing, the worktree, the setup and a
    whole provider turn of its own, so it reached the person about 48 seconds
    after they sent the message. The server now picks the emoji at receipt, and
    this placeholder — the fallback for a selection that failed — is published
    from the claim itself.
  */
  it("publishes the placeholder before the reply asks the server for anything else", async () => {
    const observed = await exercise({
      attachment: true,
      expectReactions: 1,
      provider: async () => turnResult(answer),
    });

    expect(observed.failure).toBeUndefined();
    expect(observed.reactions).toEqual(["👀"]);
    expect(observed.calls.indexOf("reaction:👀")).toBeLessThan(
      observed.calls.indexOf("attachment"),
    );
    // Nothing else is published: the contextual emoji is the server's, and no
    // round of this reply is spent choosing one.
    expect(observed.reactions).toHaveLength(1);
    expect(observed.turns).toBe(1);
  });

  it("cleans a created message invocation up when the setup fails", async () => {
    const observed = await exercise({
      attachment: true,
      attachmentFails: true,
      publicMessages: true,
      provider: async () => turnResult(answer),
    });

    // The reply stops before the model is asked anything.
    expect(observed.failure).toMatchObject({
      message: "Channel reply attachment download failed (500)",
    });
    expect(observed.turns).toBe(0);
    // The message invocation was created beside the failing download. Its
    // journal owner is released only by `cleanup()`, so its absence is the
    // proof that the relay socket and its private directory went with it.
    expect(observed.calls).toContain("attachment");
    await expect(
      stat(join(publicationJournalDirectory(observed.workId), "owner.json")),
    ).rejects.toThrow();
    await expect(
      stat(publicationJournalDirectory(observed.workId)),
    ).resolves.toBeDefined();
  });

  /*
    Reconstructing the 2026-09-09 two-minute reply meant cross-referencing the
    Worker log against D1 rows, file mtimes and provider session files. These
    hold the one line that answers it: where a reply's time went, whichever way
    it ended, with the same numbers the setup line already prints.
  */
  describe("reply timeline", () => {
    const decode = (logs: readonly string[], prefix: string) =>
      logs.flatMap((line) =>
        line.startsWith(prefix) ? [JSON.parse(line.slice(prefix.length))] : []
      );
    const timelines = (logs: readonly string[]) =>
      decode(logs, "channel reply timeline: ");
    const setups = (logs: readonly string[]) =>
      decode(logs, "channel reply setup: ");

    it("accounts for a completed reply from the person's message to the completion", async () => {
      const observed = await exercise({
        attachment: true,
        provider: async () => turnResult(answer),
      });

      expect(observed.failure).toBeUndefined();
      const [timeline, ...extra] = timelines(observed.logs);
      // Exactly one line per reply, however it ends.
      expect(extra).toEqual([]);
      expect(timeline).toMatchObject({
        workId: observed.workId,
        outcome: "completed",
        acknowledgement: "placeholder",
        workspace: "none",
        steerFolded: false,
        prewarm: "none",
        turns: [{ round: 1, result: "reply" }],
      });
      // The person waited a quarter second before the Worker had the job.
      expect(timeline.triggerToClaim).toBeGreaterThanOrEqual(250);
      expect(timeline.claimToAck).toBeGreaterThanOrEqual(0);
      expect(timeline.turns[0].ms).toBeGreaterThanOrEqual(0);
      expect(timeline.post).toBeGreaterThanOrEqual(0);
      expect(timeline.total).toBeGreaterThanOrEqual(timeline.setup);
      expect(timeline.triggerToReply)
        .toBeGreaterThanOrEqual(timeline.triggerToClaim);
      // The two lines are one measurement, not two.
      const [setup, ...extraSetups] = setups(observed.logs);
      expect(extraSetups).toEqual([]);
      expect(timeline.setup).toBe(setup.total);
      expect(timeline.steerFolded).toBe(setup.steerFolded);
      expect(timeline.prewarm).toBe(setup.prewarm);
      // A stretch this reply never had is absent rather than zero: nothing
      // reported a provider boot, so neither line claims one.
      expect(setup).not.toHaveProperty("boot");
      expect(timeline).not.toHaveProperty("firstTurnBoot");
    });

    it("still accounts for a reply that failed before its first turn", async () => {
      const observed = await exercise({
        attachment: true,
        attachmentFails: true,
        provider: async () => turnResult(answer),
      });

      expect(observed.failure).toMatchObject({
        message: "Channel reply attachment download failed (500)",
      });
      const [timeline, ...extra] = timelines(observed.logs);
      expect(extra).toEqual([]);
      expect(timeline).toMatchObject({
        workId: observed.workId,
        outcome: "failed",
        turns: [],
      });
      // No round ran and nothing was published, so neither stretch is claimed.
      expect(timeline).not.toHaveProperty("post");
      expect(timeline).not.toHaveProperty("triggerToReply");
      expect(timeline.setup).toBe(setups(observed.logs)[0]!.total);
    });

    /*
      A steer is the one ending the reply cannot name itself: the server is
      asked only after the provider has stopped and the cleanup has finished.
      The Worker command answers it, exactly as this does.
    */
    it("names a steered reply once the Worker command has the verdict", async () => {
      const observed = await exercise({
        attachment: true,
        attachmentFails: true,
        steerVerdict: "steered",
        provider: async () => turnResult(answer),
      });

      expect(observed.failure).toBeDefined();
      const [timeline, ...extra] = timelines(observed.logs);
      expect(extra).toEqual([]);
      expect(timeline).toMatchObject({
        workId: observed.workId,
        outcome: "steered",
        turns: [],
      });
    });

    it("counts every round of a reply that asked for the repository", async () => {
      const conversationId = crypto.randomUUID();
      const observed = await exercise({
        provider: async (_turn, number) =>
          number === 1
            ? turnResult(repositoryRequest, conversationId)
            : turnResult(answer, conversationId),
      });

      expect(observed.failure).toBeUndefined();
      const [timeline] = timelines(observed.logs);
      expect(timeline.turns).toMatchObject([
        { round: 1, result: "repository" },
        { round: 2, result: "reply" },
      ]);
      expect(timeline.workspace).toBe("on_demand");
      expect(timeline.outcome).toBe("completed");
    });
  });

  it("publishes nothing when the claim already carries the server's emoji", async () => {
    const observed = await exercise({
      acknowledgementReaction: "🎉",
      provider: async () => turnResult(answer),
    });

    expect(observed.failure).toBeUndefined();
    expect(observed.reactions).toEqual([]);
    expect(observed.turns).toBe(1);
    expect(observed.completed).toContain("A synthetic answer");
  });

});
