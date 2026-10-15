import { env as cloudflareEnv } from "cloudflare:workers";
import { ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
import { ApplicationErrorDetailSchema } from "@briar/contracts/gen/briar/types/v1/error_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { WorkerQueueService } from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { beforeAll, describe, expect, it } from "vitest";
import { connectErrorInterceptor } from "../app-connect-errors";
import { createChannel } from "../channels";
import { listIssueExecutionProposals, reserveIssueExecutionProposalApproval } from "../db";
import { memoryVaultDeps, memoryVaultFixture, type MemoryVaultFixture } from "../test-helpers/memory-vault-fixture";
import { createWorkerQueueService } from "../worker-connect-queue";
import { postAgentChannelMessage } from "./channels";
import { resolveAgentWorkspaceScope } from "./claim";

const db = cloudflareEnv.DB;

type Claim = {
  projectId: string;
  workerId: string;
  agentProvider: AgentProvider;
  work: {
    workId: string;
    runId: string;
    claimToken: string;
    work:
      | { case: "issue"; value: Record<string, never> }
      | { case: "projectAgentTask"; value: Record<string, never> }
      | { case: "channelReply"; value: { workspaceId: string } };
  };
};

const code = (error: unknown) => ConnectError.from(error).findDetails(ApplicationErrorDetailSchema)[0]?.code;

const failure = (promise: Promise<unknown>) => promise.then(
  () => { throw new Error("Expected the call to fail"); },
  (error: unknown) => code(error),
);

describe("agent workspace tools", () => {
  let fixture: MemoryVaultFixture;
  let client: ReturnType<typeof createClient<typeof WorkerQueueService>>;
  let stranger: ReturnType<typeof createClient<typeof WorkerQueueService>>;

  const issueClaim = async (options: { agent?: boolean } = {}) => {
    const run = await fixture.claimIssueRun(options);
    return {
      run,
      claim: {
        projectId: fixture.projectId,
        workerId: fixture.workerId,
        agentProvider: AgentProvider.CODEX,
        work: { workId: run.runId, runId: run.runId, claimToken: run.claimToken, work: { case: "issue", value: {} } },
      } satisfies Claim,
    };
  };

  const channelClaim = async () => {
    const group = await fixture.claimChannel("channel", fixture.ownerId);
    return {
      group,
      claim: {
        projectId: fixture.projectId,
        workerId: fixture.workerId,
        agentProvider: AgentProvider.CLAUDE,
        work: {
          workId: group.jobId, runId: group.runId, claimToken: group.claimToken,
          work: { case: "channelReply", value: { workspaceId: fixture.workspaceId } },
        },
      } satisfies Claim,
    };
  };

  const channel = async (options: { kind?: "channel" | "dm"; withAgent?: boolean; name?: string } = {}) => {
    const id = crypto.randomUUID();
    const at = new Date().toISOString();
    await createChannel(db, options.kind === "dm"
      ? {
          id, workspaceId: fixture.workspaceId, kind: "dm", dmKey: `agent:${JSON.stringify([fixture.otherUserId, id])}`,
          slug: id, name: "Other DM", visibility: "private", topic: null, defaultProjectId: null,
          createdByUserId: fixture.otherUserId, agentIds: [fixture.agentId], createdAt: at,
        }
      : {
          id, workspaceId: fixture.workspaceId, kind: "channel", dmKey: null, slug: id, name: options.name ?? `room-${id.slice(0, 8)}`,
          visibility: "public", topic: "Shared progress", defaultProjectId: null, createdByUserId: fixture.ownerId,
          memberIds: [fixture.ownerId], agentIds: options.withAgent === false ? [] : [fixture.agentId], createdAt: at,
        });
    return id;
  };

  beforeAll(async () => {
    fixture = await memoryVaultFixture(db);
    const at = new Date().toISOString();
    await db.prepare(`insert into briar_project_settings (project_id, workflow_json, mandatory_checkpoints_json, created_at, updated_at)
      values (?, ?, '[]', ?, ?)`)
      .bind(fixture.projectId, JSON.stringify({
        version: 2, requirements: [], stages: [{ id: "implementing", label: "Implement", required: true }],
        execution: { checkpoints: [] }, completion: { requiredStages: ["implementing"] },
      }), at, at).run();
    const deps = memoryVaultDeps(db);
    const transport = (authorization: string) => createRouterTransport((router) => router.service(
      WorkerQueueService,
      createWorkerQueueService({
        request: new Request("https://briar.example", { headers: { authorization } }),
        db,
        env: { DB: db } as unknown as Env,
      }, { memoryVaultStore: () => deps.store }),
    ), { router: { interceptors: [connectErrorInterceptor] } });
    client = createClient(WorkerQueueService, transport(`Bearer ${fixture.workerToken}`));
    stranger = createClient(WorkerQueueService, transport("Bearer briar_worker_unenrolled"));
  }, 120_000);

  it("authorizes every call from a live claim only", async () => {
    const { claim } = await issueClaim();
    expect(await failure(client.agentIssueList({}))).toBe("claim_inactive");
    expect(await failure(client.agentIssueList({
      claim: { ...claim, work: { ...claim.work, claimToken: "briar_claim_forged" } },
    }))).toBe("claim_inactive");
    expect(await failure(client.agentIssueList({
      claim: { ...claim, work: { ...claim.work, work: { case: "mergeBatch", value: {} } } },
    }))).toBe("claim_inactive");
    expect(await failure(client.agentIssueList({ claim: { ...claim, agentProvider: AgentProvider.UNSPECIFIED } })))
      .toBe("invalid_request");
    await expect(stranger.agentIssueList({ claim })).rejects.toThrow();
    // A claim whose lease ran out is no longer a credential.
    await db.prepare(`update briar_hunt_runs set lease_expires_at = ? where id = ?`)
      .bind(new Date(Date.now() - 1_000).toISOString(), claim.work.runId).run();
    expect(await failure(client.agentIssueList({ claim }))).toBe("claim_inactive");
  });

  it("creates, lists, shows and notes issues as the claim's Agent without enqueueing replies", async () => {
    const { claim } = await issueClaim();
    const created = await client.agentIssueCreate({
      claim, requestKey: "follow-up-1", title: "Follow up on flaky test", description: "Seen in CI twice.", priority: 2,
    });
    expect(created.replayed).toBe(false);
    expect(created.issue).toMatchObject({ title: "Follow up on flaky test", status: "backlog", priority: 2 });
    expect(created.issue?.key).toMatch(/^AH-\d+$/u);
    const run = await db.prepare(`select created_by_user_id, requires_claim_token, context_json from briar_hunt_runs where id = ?`)
      .bind(created.issue!.id).first<{ created_by_user_id: string | null; requires_claim_token: number; context_json: string }>();
    expect(run).toMatchObject({ created_by_user_id: null, requires_claim_token: 1 });
    expect(JSON.parse(run!.context_json)).toMatchObject({
      origin: "briar-agent-tool", createdByAgent: { id: fixture.agentId, name: "Vault Agent" },
    });

    const replay = await client.agentIssueCreate({
      claim, requestKey: "follow-up-1", title: "Follow up on flaky test", description: "Seen in CI twice.", priority: 2,
    });
    expect(replay).toMatchObject({ replayed: true, issue: { id: created.issue!.id } });
    expect(await failure(client.agentIssueCreate({ claim, requestKey: "follow-up-1", title: "Something else" })))
      .toBe("idempotency_conflict");

    const child = await client.agentIssueCreate({ claim, requestKey: "child", title: "Child", parent: created.issue!.key });
    const listed = await client.agentIssueList({ claim, statuses: ["backlog"], text: "flaky" });
    expect(listed.issues.map((issue) => issue.id)).toEqual([created.issue!.id]);

    const note = await client.agentIssueNote({ claim, requestKey: "note-1", issue: created.issue!.key, body: "Root cause: a race." });
    const noteAgain = await client.agentIssueNote({ claim, requestKey: "note-1", issue: created.issue!.key, body: "Root cause: a race." });
    expect(noteAgain).toMatchObject({ replayed: true, messageId: note.messageId });
    const shown = await client.agentIssueShow({ claim, issue: child.issue!.id });
    expect(shown.parentKey).toBe(created.issue!.key);
    const parentShown = await client.agentIssueShow({ claim, issue: created.issue!.key });
    expect(parentShown.description).toBe("Seen in CI twice.");
    expect(parentShown.notes).toEqual([expect.objectContaining({
      id: note.messageId, authorName: "Vault Agent", authorIsAgent: true, body: "Root cause: a race.",
    })]);
    const message = await db.prepare(`select author_user_id, author_agent_id, author_agent_name, author_agent_provider
      from briar_issue_messages where id = ?`).bind(note.messageId).first();
    expect(message).toEqual({
      author_user_id: null, author_agent_id: fixture.agentId, author_agent_name: "Vault Agent", author_agent_provider: "codex",
    });
    const jobs = await db.prepare(`select count(*) as count from briar_issue_agent_reply_jobs where run_id = ?`)
      .bind(created.issue!.id).first<{ count: number }>();
    expect(jobs?.count).toBe(0);

    const updated = await client.agentIssueUpdate({ claim, requestKey: "rename", issue: created.issue!.id, title: "Fix flaky test" });
    expect(updated.issue).toMatchObject({ title: "Fix flaky test", priority: 2 });
    expect(await failure(client.agentIssueShow({ claim, issue: "AH-999999999" }))).toBe("not_found");
  });

  it("moves statuses an agent owns and leaves the lifecycle's to the lifecycle", async () => {
    const { claim, run } = await issueClaim();
    expect(await failure(client.agentIssueSetStatus({ claim, requestKey: "own", issue: run.runId, status: "completed" })))
      .toBe("own_run");
    const target = await client.agentIssueCreate({ claim, requestKey: "target", title: "Target" });
    expect(await failure(client.agentIssueSetStatus({ claim, requestKey: "run", issue: target.issue!.id, status: "running" })))
      .toBe("not_allowed");
    const moved = await client.agentIssueSetStatus({
      claim, requestKey: "done", issue: target.issue!.id, status: "completed", reason: "Fixed by the parent change",
    });
    expect(moved).toMatchObject({ outcome: "moved", issue: { status: "completed" } });
    expect(await client.agentIssueSetStatus({
      claim, requestKey: "done", issue: target.issue!.id, status: "completed", reason: "Fixed by the parent change",
    })).toMatchObject({ outcome: "moved", replayed: true });
    const reasonNote = await db.prepare(`select body from briar_issue_messages where run_id = ? and author_agent_id = ?`)
      .bind(target.issue!.id, fixture.agentId).first<{ body: string }>();
    expect(reasonNote?.body).toBe("Moved to completed: Fixed by the parent change");

    // Another issue running on some Worker belongs to that run.
    const other = await fixture.claimIssueRun();
    expect(await failure(client.agentIssueSetStatus({ claim, requestKey: "busy", issue: other.runId, status: "cancelled" })))
      .toBe("issue_in_execution");
  });

  it("turns queued into a pending execution approval on an agent note", async () => {
    const { claim } = await issueClaim();
    const created = await client.agentIssueCreate({ claim, requestKey: "ship", title: "Ship it", requestExecution: true });
    expect(created.issue?.status).toBe("backlog");
    expect(created.executionApprovalId).toBeTruthy();
    const again = await client.agentIssueSetStatus({ claim, requestKey: "ship-2", issue: created.issue!.id, status: "queued" });
    expect(again).toMatchObject({ outcome: "approval_requested", executionApprovalId: created.executionApprovalId });

    const proposals = await listIssueExecutionProposals(db, fixture.projectId, created.issue!.id);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      id: created.executionApprovalId, status: "pending", source_kind: "issue", target_run_id: created.issue!.id,
    });
    const reply = await db.prepare(`select author_agent_id, body from briar_issue_messages where id = ?`)
      .bind(proposals[0]!.reply_message_id).first<{ author_agent_id: string; body: string }>();
    expect(reply).toMatchObject({ author_agent_id: fixture.agentId });
    expect(reply?.body).toMatch(/^Requesting approval to run this issue/u);
    const status = await db.prepare(`select status, dispatch_request_id from briar_hunt_runs where id = ?`)
      .bind(created.issue!.id).first();
    expect(status).toEqual({ status: "backlog", dispatch_request_id: null });

    // A person approves it through the unchanged approval path.
    const reserved = await reserveIssueExecutionProposalApproval(db, {
      projectId: fixture.projectId,
      conversationRunId: created.issue!.id,
      proposalId: created.executionApprovalId!,
      userId: fixture.ownerId,
      provider: "codex",
      model: null,
      effort: null,
      workerId: null,
      dispatchRequestId: crypto.randomUUID(),
      reservedAt: new Date().toISOString(),
    });
    expect(reserved).not.toBeNull();

    const completed = await client.agentIssueCreate({ claim, requestKey: "closed", title: "Closed" });
    await client.agentIssueSetStatus({ claim, requestKey: "close", issue: completed.issue!.id, status: "cancelled" });
    expect(await failure(client.agentIssueSetStatus({ claim, requestKey: "reopen", issue: completed.issue!.id, status: "queued" })))
      .toBe("not_allowed");
  });

  it("lists, reads and posts only in member channels, never DMs, and enqueues no replies", async () => {
    const { claim, group } = await channelClaim();
    const shared = await channel({ name: "eng-progress" });
    const foreign = await channel({ withAgent: false });
    const dm = await channel({ kind: "dm" });
    const listed = await client.agentChannelList({ claim });
    const ids = listed.channels.map((entry) => entry.id);
    expect(ids).toEqual(expect.arrayContaining([group.channelId, shared]));
    expect(ids).not.toContain(foreign);
    expect(ids).not.toContain(dm);
    expect(listed.channels.find((entry) => entry.id === group.channelId)?.current).toBe(true);

    expect(await failure(client.agentChannelPost({ claim, requestKey: "dm", channel: dm, body: "hi" }))).toBe("not_allowed");
    expect(await failure(client.agentChannelPost({ claim, requestKey: "f", channel: foreign, body: "hi" }))).toBe("not_allowed");
    expect(await failure(client.agentChannelRead({ claim, channel: dm }))).toBe("not_allowed");
    expect(await failure(client.agentChannelPost({ claim, requestKey: "own", channel: group.channelId, body: "hi" })))
      .toBe("not_allowed");

    const posted = await client.agentChannelPost({ claim, requestKey: "p1", channel: "#eng-progress", body: "Deployed v2 to staging." });
    expect(posted).toMatchObject({ replayed: false, channel: { id: shared, name: "eng-progress" } });
    expect(await client.agentChannelPost({ claim, requestKey: "p1", channel: shared, body: "Deployed v2 to staging." }))
      .toMatchObject({ replayed: true, messageId: posted.messageId });
    const threaded = await client.agentChannelPost({
      claim, requestKey: "p2", channel: shared, thread: posted.messageId, body: "Smoke tests passed.",
    });
    expect(await failure(client.agentChannelPost({
      claim, requestKey: "p3", channel: shared, thread: threaded.messageId, body: "Not a root.",
    }))).toBe("not_found");

    const row = await db.prepare(`select author_user_id, author_agent_id, author_agent_name, author_agent_provider
      from briar_channel_messages where id = ?`).bind(posted.messageId).first();
    expect(row).toEqual({
      author_user_id: null, author_agent_id: fixture.agentId, author_agent_name: "Vault Agent", author_agent_provider: "claude",
    });
    const jobs = await db.prepare(`select count(*) as count from briar_channel_agent_reply_jobs where channel_id = ?`)
      .bind(shared).first<{ count: number }>();
    expect(jobs?.count).toBe(0);

    const read = await client.agentChannelRead({ claim, channel: shared });
    expect(read.messages.map((message) => message.body)).toEqual(["Deployed v2 to staging."]);
    const thread = await client.agentChannelRead({ claim, channel: shared, thread: posted.messageId });
    expect(thread.messages.map((message) => message.body)).toEqual(["Deployed v2 to staging.", "Smoke tests passed."]);
  });

  it("refuses channels to a run without an Agent", async () => {
    const { claim } = await issueClaim({ agent: false });
    expect(await failure(client.agentChannelList({ claim }))).toBe("no_agent");
  });

  it("caps agent channel posts per organization per hour", async () => {
    const { group } = await channelClaim();
    const target = await channel();
    const scope = await resolveAgentWorkspaceScope(db, {
      claim: { kind: "channelReply", workId: group.jobId, runId: group.runId, claimToken: group.claimToken,
        workspaceId: fixture.workspaceId },
      worker: fixture.worker,
      provider: "codex",
      observedAt: new Date().toISOString(),
    });
    const used = await db.prepare(`select count(*) as count from briar_agent_workspace_tool_requests
      where organization_id = ? and operation = 'channel.post'`).bind(fixture.workspaceId).first<{ count: number }>();
    const hourlyLimit = (used?.count ?? 0) + 1;
    await postAgentChannelMessage(db, scope, { requestKey: "r1", channel: target, thread: null, body: "one" }, { hourlyLimit });
    await expect(postAgentChannelMessage(db, scope, { requestKey: "r2", channel: target, thread: null, body: "two" }, { hourlyLimit }))
      .rejects.toMatchObject({ toolCode: "rate_limited" });
    // A replay of an accepted post is not a new post.
    await expect(postAgentChannelMessage(db, scope, { requestKey: "r1", channel: target, thread: null, body: "one" }, { hourlyLimit }))
      .resolves.toMatchObject({ replayed: true });
    const messages = await db.prepare(`select count(*) as count from briar_channel_messages where channel_id = ?`)
      .bind(target).first<{ count: number }>();
    expect(messages?.count).toBe(1);
    // Posts older than the window no longer count.
    const later = new Date(Date.now() + 61 * 60 * 1_000);
    await expect(postAgentChannelMessage(db, scope, { requestKey: "r3", channel: target, thread: null, body: "three" },
      { hourlyLimit, now: () => later })).resolves.toMatchObject({ replayed: false });
  });
});
