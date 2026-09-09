import { execFileSync, spawnSync } from "node:child_process";
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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Config, TeamConfig } from "./config-contract";
import type {
  DetachedProviderTurnInput,
  DetachedProviderTurnResult,
} from "./detached-provider-turn";
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

const dmSnapshot = (triggerMessageId: string) => ({
  channel: { kind: "dm", id: crypto.randomUUID() },
  messages: [{
    id: triggerMessageId,
    author: { type: "user", id: crypto.randomUUID(), name: "Person" },
    body: "hi",
    mentionedUserIds: [],
    attachments: [],
  }],
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

type Exercise = {
  /** Claim the same retained session again, the way a follow-up message does. */
  sessionId?: string;
  agentMessageHop?: number;
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
    const activities: string[] = [];
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
          completeChannelReply: (request) => {
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
            return create(PublishReplyActivityResponseSchema, {});
          },
        });
      },
    });
    const server = createServer((request, reply) => void adapter(request, reply));
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

    const claim = claimedWorkFromProto(create(ClaimedWorkSchema, {
      work: {
        case: "channelReply",
        value: {
          workId,
          channelId: crypto.randomUUID(),
          scope: create(ChannelReplyScopeSchema, {
            scope: {
              case: "project",
              value: create(ChannelReplyScope_ProjectSchema, {
                workspaceId: organizationId,
                projectId,
              }),
            },
          }),
          runId: crypto.randomUUID(),
          sourceKey: "synthetic",
          title: "Reply",
          triggerMessageId,
          parentMessageId: crypto.randomUUID(),
          provider: AgentProvider.CLAUDE,
          agent: create(DetachedAgentClaimSchema, {
            id: crypto.randomUUID(),
            name: "Synthetic Agent",
            provider: AgentProvider.CLAUDE,
            responsibility: "Answer the person directly.",
            skills: [],
          }),
          agentMessageHop: input.agentMessageHop ?? 0,
          session: create(ChannelReplySessionSchema, {
            id: sessionId,
            threadId: crypto.randomUUID(),
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
          snapshot: dmSnapshot(triggerMessageId),
        },
      },
    })) as ClaimedChannelReply;

    let failure: unknown;
    const workspacePaths: string[] = [];
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
          runProviderTurn: ((turn: DetachedProviderTurnInput) => {
            // Briar picks the acknowledgement emoji on its own track; it is
            // not one of this reply's rounds.
            if (turn.agent.name === "DM acknowledgement") {
              return Promise.resolve(turnResult({ emoji: "👀" }));
            }
            workspacePaths.push(turn.workspacePath);
            prompts.push(turn.prompt);
            return input.provider(turn, ++turns);
          }) as never,
        },
      );
    } catch (error) {
      failure = error;
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      );
    }
    return {
      failure,
      turns,
      completed,
      activities,
      workspacePaths,
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

});
