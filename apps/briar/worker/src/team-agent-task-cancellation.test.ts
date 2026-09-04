import { createHash } from "node:crypto";
import { env as cloudflareEnv } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  cancelTeamAgentTaskJob,
  claimNextTeamAgentTask,
  completeTeamAgentTask,
  createTeamAgent,
  createTeamAgentTaskJob,
  getTeamAgentSession,
  getTeamAgentTaskJob,
  reapTeamAgentTaskJobs,
  renewTeamAgentTaskLease,
  upsertTeamAgentSession,
} from "./db";
import { HttpError } from "./http-response";
import {
  STALE_TASK_LEASE_GRACE_MS,
} from "./team-agent-task-repository";
import {
  cancelTeamAgentTaskWork,
  teamAgentTaskCancelledError,
} from "./team-agent-task-worker";
import { teamAgentTaskSessionEvent } from "./team-agent-task-session";
import {
  decodeStoredTeamAgentSessionPayload,
  decodeTeamAgentSessionInput,
} from "./team-request-contract";
import { workerRuntimeMetadataFixture } from "./test-helpers/worker-runtime";
import { registerExecutionWorker } from "./workers";
import type { AgentSkillRow } from "./agent-skills";
import type { TeamAgentRow } from "./team-agent-model";

const organizationId = "a1000000-0000-4000-8000-000000000001";
const projectId = "a2000000-0000-4000-8000-000000000001";
const ownerId = "task-cancel-owner";
const workerId = "a3000000-0000-4000-8000-000000000001";
const deviceId = "a4000000-0000-4000-8000-000000000001";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const minute = (index: number) =>
  new Date(Date.UTC(2026, 8, 4, 0, index)).toISOString();

describe("Project Agent task cancellation", () => {
  const db = cloudflareEnv.DB;
  const env = { DB: db, ARCHIVES: cloudflareEnv.ARCHIVES } as unknown as Env;
  let agent: TeamAgentRow;
  let skill: AgentSkillRow;
  let sequence = 0;

  beforeAll(async () => {
    const observedAt = minute(0);
    await db.batch([
      db.prepare(
        `insert into "user" (
           id, name, email, emailVerified, createdAt, updatedAt
         ) values (?, 'Cancel Owner', ?, 1, ?, ?)`,
      ).bind(ownerId, `${ownerId}@example.com`, observedAt, observedAt),
      db.prepare(
        `insert into briar_organizations (
           id, name, handle, created_at, updated_at
         ) values (?, 'Cancel org', 'task-cancel-org', ?, ?)`,
      ).bind(organizationId, observedAt, observedAt),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(organizationId, ownerId, observedAt, observedAt),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Cancel project', ?, ?, ?)`,
      ).bind(
        projectId,
        ownerId,
        organizationId,
        "a".repeat(64),
        observedAt,
        observedAt,
      ),
    ]);
    await registerExecutionWorker(db, projectId, {
      id: workerId,
      deviceId,
      organizationId,
      ownerUserId: ownerId,
      label: "Cancel Worker",
      deviceIdentityHash: sha256("task-cancel-device"),
      credentialTokenHash: sha256("task-cancel-credential"),
      runtime: workerRuntimeMetadataFixture(),
      maxConcurrentSessions: 4,
      observedAt: new Date().toISOString(),
    });
    agent = await createTeamAgent(db, projectId, {
      name: "Cancel agent",
      provider: "codex",
      model: null,
      effort: null,
      responsibility: "Validate task cancellation.",
      calendarColor: "#3275d5",
      skills: [{
        name: "Cancellable work",
        description: "Use for long running direct tasks.",
        body: "Do the long running work.",
        provider: "codex",
        model: null,
        effort: null,
        kind: "custom",
        executionMode: "task",
        approvalPolicy: "invoke_is_consent",
        position: 0,
      }],
    });
    skill = agent.skills![0];
  }, 60_000);

  /** Queue a task with its session, exactly as `RunProjectAgentTask` does. */
  const seedTask = async (createdAt: string) => {
    sequence += 1;
    const taskId = `a5000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
    const job = await createTeamAgentTaskJob(db, {
      id: taskId,
      projectId,
      agentId: agent.id,
      skill,
      request: `Long running request ${sequence}`,
      requestId: `a6000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      workerId,
      createdAt,
    });
    if (!job) throw new Error("Could not seed the Agent task");
    await upsertTeamAgentSession(db, {
      projectId,
      id: taskId,
      requestedByUserId: ownerId,
      payload: decodeTeamAgentSessionInput({
        dispatchGroupId: taskId,
        agentId: agent.id,
        agentName: agent.name,
        skillId: skill.id,
        sessionType: "task",
        trigger: "manual",
        scheduleId: null,
        scheduleRunId: null,
        parentSessionId: null,
        request: job.request,
        followUps: [],
        status: "running",
        issues: [],
        startedAt: createdAt,
        completedAt: null,
        conversationId: null,
        requestedWorkerId: workerId,
        workerId,
        summary: null,
        error: null,
        events: [teamAgentTaskSessionEvent("started", createdAt)],
        updatedAt: createdAt,
      }),
    }, createdAt);
    return taskId;
  };

  const sessionPayload = async (taskId: string) => {
    const row = await getTeamAgentSession(db, projectId, taskId);
    if (!row) throw new Error("Agent session disappeared");
    return decodeStoredTeamAgentSessionPayload(row.payload_json);
  };

  const cancel = (taskId: string) =>
    cancelTeamAgentTaskWork({
      db,
      env,
      projectId,
      sessionId: taskId,
      userId: ownerId,
    });

  it("cancels a queued task and interrupts its session", async () => {
    const taskId = await seedTask(minute(1));

    const session = await cancel(taskId);
    expect(session).toMatchObject({ id: taskId, status: "interrupted" });
    expect(await getTeamAgentTaskJob(db, projectId, taskId)).toMatchObject({
      status: "failed",
      error: teamAgentTaskCancelledError,
      cancelled_by_user_id: ownerId,
      claim_token_hash: null,
      claimed_worker_id: null,
      lease_expires_at: null,
    });
    const payload = await sessionPayload(taskId);
    expect(payload).toMatchObject({ status: "interrupted", error: null });
    expect(payload.completedAt).not.toBeNull();
    expect(payload.events.at(-1)).toMatchObject({ type: "stopped" });
  });

  it("cancels a running task and releases its claim", async () => {
    const taskId = await seedTask(minute(2));
    const claimTokenHash = sha256("cancel-running-claim");
    const claimed = await claimNextTeamAgentTask(db, projectId, {
      workerId,
      claimTokenHash,
      claimedAt: minute(3),
      leaseExpiresAt: minute(18),
    });
    expect(claimed).toMatchObject({ id: taskId, status: "running" });

    await expect(cancel(taskId)).resolves.toMatchObject({
      status: "interrupted",
    });
    expect(await getTeamAgentTaskJob(db, projectId, taskId)).toMatchObject({
      status: "failed",
      claim_token_hash: null,
      claimed_worker_id: null,
      claimed_at: null,
      lease_expires_at: null,
    });
    expect((await sessionPayload(taskId)).events.at(-1))
      .toMatchObject({ type: "stopped" });

    // The Worker keeps renewing until it notices; the lease is gone.
    await expect(
      renewTeamAgentTaskLease(db, projectId, taskId, {
        workerId,
        claimTokenHash,
        leaseExpiresAt: minute(25),
        updatedAt: minute(19),
      }),
    ).resolves.toBeNull();

    // A completion that lost the race is rejected, not silently applied.
    await expect(
      completeTeamAgentTask(db, projectId, taskId, {
        workerId,
        claimTokenHash,
        updatedAt: minute(20),
        summary: "Finished after the stop",
      }),
    ).resolves.toBeNull();
    expect(await getTeamAgentTaskJob(db, projectId, taskId)).toMatchObject({
      status: "failed",
      result_summary: null,
    });
  });

  it("returns the session unchanged when the task is already terminal", async () => {
    const taskId = await seedTask(minute(4));
    const first = await cancel(taskId);
    const firstUpdatedAt = first.updated_at;

    const second = await cancel(taskId);
    expect(second).toMatchObject({
      id: taskId,
      status: "interrupted",
      updated_at: firstUpdatedAt,
    });
    const payload = await sessionPayload(taskId);
    expect(
      payload.events.filter((event) => event.type === "stopped"),
    ).toHaveLength(1);
  });

  it("rejects a cancel for a session without a task", async () => {
    await expect(
      cancelTeamAgentTaskWork({
        db,
        env,
        projectId,
        sessionId: "a7000000-0000-4000-8000-000000000009",
        userId: ownerId,
      }),
    ).rejects.toMatchObject({
      status: 404,
      message: "Agent task not found for this session",
    } satisfies Partial<HttpError>);
  });

  it("leaves an approval-owned task to its assigned Worker", async () => {
    const taskId = await seedTask(minute(5));
    await db
      .prepare(
        `update briar_project_agent_task_jobs
         set skill_execution_proposal_id = ? where id = ? and project_id = ?`,
      )
      .bind(`${taskId}-proposal`, taskId, projectId)
      .run();

    await expect(
      cancelTeamAgentTaskJob(db, projectId, taskId, {
        userId: ownerId,
        observedAt: minute(6),
        error: teamAgentTaskCancelledError,
      }),
    ).resolves.toBeNull();
    expect(await getTeamAgentTaskJob(db, projectId, taskId)).toMatchObject({
      status: "queued",
      cancel_requested_at: null,
    });
  });

  it("counts only planned-update resumes in resume_count", async () => {
    const taskId = await seedTask(minute(7));
    const claimed = await claimNextTeamAgentTask(db, projectId, {
      workerId,
      claimTokenHash: sha256("resume-claim-one"),
      claimedAt: minute(8),
      leaseExpiresAt: minute(9),
    });
    expect(claimed).toMatchObject({ id: taskId, attempts: 1, resume_count: 0 });

    // A plain re-claim after the lease expired spends an attempt instead.
    const reclaimed = await claimNextTeamAgentTask(db, projectId, {
      workerId,
      claimTokenHash: sha256("resume-claim-two"),
      claimedAt: minute(10),
      leaseExpiresAt: minute(11),
    });
    expect(reclaimed).toMatchObject({ id: taskId, attempts: 2, resume_count: 0 });

    await db
      .prepare(
        `update briar_project_agent_task_jobs
         set planned_update_resume = 1 where id = ? and project_id = ?`,
      )
      .bind(taskId, projectId)
      .run();
    const resumed = await claimNextTeamAgentTask(db, projectId, {
      workerId,
      claimTokenHash: sha256("resume-claim-three"),
      claimedAt: minute(12),
      leaseExpiresAt: minute(30),
    });
    expect(resumed).toMatchObject({
      id: taskId,
      attempts: 2,
      resume_count: 1,
      planned_update_resume: 0,
    });
  });

  it("fails a lease that expired a day ago even with attempts left", async () => {
    const fresh = await seedTask(minute(13));
    const stale = await seedTask(minute(14));
    const observedAt = new Date(Date.UTC(2026, 8, 6)).toISOString();
    const staleLeaseExpiresAt = new Date(
      Date.parse(observedAt) - STALE_TASK_LEASE_GRACE_MS - 60_000,
    ).toISOString();
    const freshLeaseExpiresAt = new Date(
      Date.parse(observedAt) - 10 * 60_000,
    ).toISOString();
    await db.batch([
      db.prepare(
        `update briar_project_agent_task_jobs
         set status = 'running', attempts = 1, claimed_worker_id = ?,
             claim_token_hash = ?, claimed_at = ?, lease_expires_at = ?
         where id = ? and project_id = ?`,
      ).bind(
        workerId,
        sha256("stale-lease"),
        minute(14),
        staleLeaseExpiresAt,
        stale,
        projectId,
      ),
      db.prepare(
        `update briar_project_agent_task_jobs
         set status = 'running', attempts = 1, claimed_worker_id = ?,
             claim_token_hash = ?, claimed_at = ?, lease_expires_at = ?
         where id = ? and project_id = ?`,
      ).bind(
        workerId,
        sha256("fresh-lease"),
        minute(13),
        freshLeaseExpiresAt,
        fresh,
        projectId,
      ),
    ]);

    const reaped = await reapTeamAgentTaskJobs(db, projectId, {
      observedAt,
      error: "Worker lease expired after repeated attempts.",
    });
    const seeded = reaped.filter((job) => job.id === fresh || job.id === stale);
    expect(seeded.map((job) => job.id)).toEqual([stale]);
    expect(seeded[0]).toMatchObject({
      status: "failed",
      error: "Worker lease expired and the task was not resumed within 24 hours.",
    });
    expect(await getTeamAgentTaskJob(db, projectId, fresh)).toMatchObject({
      status: "running",
      attempts: 1,
    });
  });

  it("keeps the repeated-attempt error for an exhausted task", async () => {
    const taskId = await seedTask(minute(15));
    const observedAt = new Date(Date.UTC(2026, 8, 6)).toISOString();
    await db
      .prepare(
        `update briar_project_agent_task_jobs
         set status = 'running', attempts = 3, claimed_worker_id = ?,
             claim_token_hash = ?, claimed_at = ?, lease_expires_at = ?
         where id = ? and project_id = ?`,
      )
      .bind(
        workerId,
        sha256("exhausted-lease"),
        minute(15),
        new Date(Date.parse(observedAt) - 60_000).toISOString(),
        taskId,
        projectId,
      )
      .run();

    const reaped = await reapTeamAgentTaskJobs(db, projectId, {
      observedAt,
      error: "Worker lease expired after repeated attempts.",
    });
    expect(reaped.filter((job) => job.id === taskId)).toMatchObject([{
      id: taskId,
      status: "failed",
      error: "Worker lease expired after repeated attempts.",
    }]);
  });
});
