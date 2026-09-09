import { create } from "@bufbuild/protobuf";
import { DmScheduleToolOperationSchema } from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { captureDmPublicMessageClaim, getDmPublicMessageClaim } from "./dm-public-message-repository";
import { dmScheduleTime, executeDmScheduleTool, getDmScheduleContext, runDueDmSchedules } from "./dm-schedules";
import { getChannelAgentReplyJob, liveChannelReplyRuntime } from "./channels";
import { dmReplyRoutingContext, resolveDmReplyRouting } from "./dm-reply-routing";
import { agentProviders } from "../../src/lib/agent-provider";
import { dmScheduleFixture } from "./test-helpers/dm-schedule-fixture";
const plus = (at: string, seconds: number) => new Date(Date.parse(at) + seconds * 1000).toISOString();
const op = (action: string, scheduleId = "") => create(DmScheduleToolOperationSchema, { action, scheduleId });
const db = env.DB;
const jobs = async (id: string) => (await db.prepare(`select * from briar_channel_agent_reply_jobs where dm_schedule_id = ? order by created_at`)
  .bind(id).all<{ id: string; session_id: string; trigger_message_id: string; status: string; stop_requested_at: string | null; stop_confirmed_at: string | null }>()).results;
const markRunning = async (f: Awaited<ReturnType<typeof dmScheduleFixture>>, jobId: string) => {
  await db.prepare(`update briar_channel_agent_reply_jobs set status = 'running', claimed_worker_id = ?, claimed_device_id = ?,
    claim_token_hash = ?, lease_expires_at = ? where id = ?`).bind(f.workerId, f.deviceId, f.claimTokenHash, plus(f.observedAt, 86400), jobId).run();
  const identity = { ...f, jobId };
  expect(await captureDmPublicMessageClaim(db, identity)).not.toBeNull();
  return identity;
};

describe("DM schedules", () => {
  it.each(agentProviders)("supports the same schedule lifecycle for %s", async (provider) => {
    const f = await dmScheduleFixture(db, undefined, provider);
    const schedule = (await executeDmScheduleTool(db, f)).schedules[0]!;
    expect((await executeDmScheduleTool(db, { ...f, operation: op("list") })).schedules.map((row) => row.id)).toContain(schedule.id);
    await runDueDmSchedules(db, schedule.nextRunAt);
    const occurrence = (await jobs(schedule.id))[0]!;
    const job = await getChannelAgentReplyJob(db, f.organizationId, occurrence.id);
    expect(job?.agent_provider).toBe(provider);
    expect((await getDmScheduleContext(db, occurrence.id))?.instruction).toBe(f.operation.instruction);
    const identity = await markRunning(f, occurrence.id);
    expect(await getDmPublicMessageClaim(db, identity)).not.toBeNull();
    const cancelled = await executeDmScheduleTool(db, { ...f, operation: op("cancel", schedule.id) });
    expect(cancelled.schedules[0]?.stopState).toBe("requested");
    expect(await getDmPublicMessageClaim(db, identity)).toBeNull();
  });
  it.each(["missing", "different-provider"])("rejects %s routing capability even with a valid public claim", async (capability) => {
    const f = await dmScheduleFixture(db, undefined, "claude");
    const schedule = (await executeDmScheduleTool(db, f)).schedules[0]!;
    if (capability === "missing") delete f.runtime.capabilities.dmReplyRouting;
    else f.runtime.capabilities.dmReplyRouting.providers = ["AGENT_PROVIDER_CODEX"];
    await db.prepare(`update briar_execution_workers set runtime_proto_json = ? where id = ?`)
      .bind(JSON.stringify(f.runtime), f.workerId).run();
    expect(await getDmPublicMessageClaim(db, f)).not.toBeNull();
    for (const operation of [f.operation, op("list"), op("cancel", schedule.id)]) {
      await expect(executeDmScheduleTool(db, { ...f, operation })).rejects.toThrow("active supported execution");
    }
    await db.prepare(`update briar_dm_schedules set enabled = 0 where id = ?`).bind(schedule.id).run();
  });
  it("uses receipt time, confirmed absolute zones, and fixed intervals", () => {
    const received = "2026-09-09T00:00:00.000Z", now = "2026-09-09T00:02:00.000Z";
    const relative = { delaySeconds: 300, timeZone: "", timeZoneConfirmed: false };
    expect(dmScheduleTime(relative, received, now)).toEqual({ nextRunAt: "2026-09-09T00:05:00.000Z", timeZone: "UTC" });
    const absolute = { runAt: "2026-09-09T10:00:00+09:00", timeZone: "Asia/Seoul", timeZoneConfirmed: true };
    expect(dmScheduleTime(absolute, received, now).nextRunAt).toBe("2026-09-09T01:00:00.000Z");
    expect(() => dmScheduleTime({ ...absolute, timeZoneConfirmed: false }, received, now)).toThrow("Confirm");
    expect(() => dmScheduleTime({ ...relative, intervalSeconds: 299 }, received, now)).toThrow("five minutes");
    expect(() => dmScheduleTime({ ...relative, intervalSeconds: 301 }, received, now)).toThrow("whole minutes");
    expect(() => dmScheduleTime({ ...relative, runAt: absolute.runAt }, received, now)).toThrow("Specify one");
  });
  it("saves once and enqueues one one-time occurrence in an independent session", async () => {
    const f = await dmScheduleFixture(db);
    const schedule = (await executeDmScheduleTool(db, f)).schedules[0]!;
    expect(schedule.nextRunAt).toBe(plus(f.sourceAt, 300));
    expect(schedule.nextRunDisplay.length).toBeGreaterThan(10);
    expect((await executeDmScheduleTool(db, f)).replayed).toBe(true);
    await expect(executeDmScheduleTool(db, { ...f, operation: { ...f.operation, instruction: "Different" } })).rejects.toThrow("different content");
    await runDueDmSchedules(db, plus(schedule.nextRunAt, -1));
    expect(await jobs(schedule.id)).toHaveLength(0);
    const ticks = await Promise.all([runDueDmSchedules(db, schedule.nextRunAt), runDueDmSchedules(db, schedule.nextRunAt)]);
    expect(ticks.reduce((total, tick) => total + tick.enqueued, 0)).toBe(1);
    const occurrence = (await jobs(schedule.id))[0]!;
    expect(await jobs(schedule.id)).toHaveLength(1);
    expect(occurrence.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(occurrence.session_id).not.toBe(f.sessionId);
    const trigger = await db.prepare(`select author_user_id, author_agent_name, body from briar_channel_messages where id = ?`)
      .bind(occurrence.trigger_message_id).first<{ author_user_id: string | null; author_agent_name: string; body: string }>();
    expect(trigger?.author_user_id).toBeNull(); expect(trigger?.author_agent_name).toBe("Briar");
    expect(trigger?.body).not.toContain(schedule.id);
    expect((await executeDmScheduleTool(db, { ...f, operation: op("list") })).schedules[0]?.enabled).toBe(false);
    expect((await getDmScheduleContext(db, occurrence.id))?.instruction).toBe(f.operation.instruction);
    await runDueDmSchedules(db, plus(schedule.nextRunAt, 86400));
    expect(await jobs(schedule.id)).toHaveLength(1);
  });
  it("coalesces duplicate/delayed repeat ticks without accumulating offline or running occurrences", async () => {
    const f = await dmScheduleFixture(db); f.operation.intervalSeconds = 300;
    const schedule = (await executeDmScheduleTool(db, f)).schedules[0]!;
    await runDueDmSchedules(db, schedule.nextRunAt);
    await db.prepare(`update briar_channel_agent_reply_jobs set status = 'completed' where dm_schedule_id = ?`).bind(schedule.id).run();
    await runDueDmSchedules(db, plus(schedule.nextRunAt, 300));
    expect(await jobs(schedule.id)).toHaveLength(2);
    await Promise.all([runDueDmSchedules(db, plus(schedule.nextRunAt, 86400)), runDueDmSchedules(db, plus(schedule.nextRunAt, 86400))]);
    expect(await jobs(schedule.id)).toHaveLength(2);
    const after = await db.prepare(`select next_run_at from briar_dm_schedules where id = ?`).bind(schedule.id).first<{ next_run_at: string }>();
    expect(after?.next_run_at).toBe(plus(schedule.nextRunAt, 86700));
    await db.prepare(`update briar_channel_agent_reply_jobs set status = 'completed' where dm_schedule_id = ?`).bind(schedule.id).run();
    await runDueDmSchedules(db, plus(schedule.nextRunAt, 87601));
    expect(await jobs(schedule.id)).toHaveLength(3);
    expect((await db.prepare(`select next_run_at from briar_dm_schedules where id = ?`).bind(schedule.id).first<{ next_run_at: string }>())?.next_run_at)
      .toBe(plus(schedule.nextRunAt, 87900));
    await db.prepare(`update briar_dm_schedules set enabled = 0 where id = ?`).bind(schedule.id).run();
  });
  it("cancellation races with ticks and distinguishes a requested running stop from confirmation", async () => {
    const f = await dmScheduleFixture(db); f.operation.intervalSeconds = 300;
    const schedule = (await executeDmScheduleTool(db, f)).schedules[0]!;
    await Promise.all([runDueDmSchedules(db, schedule.nextRunAt), executeDmScheduleTool(db, { ...f, operation: op("cancel", schedule.id) })]);
    expect((await jobs(schedule.id)).every((job) => job.status === "completed")).toBe(true);
    expect((await executeDmScheduleTool(db, { ...f, operation: op("cancel", schedule.id) })).replayed).toBe(true);
    await runDueDmSchedules(db, plus(schedule.nextRunAt, 10000));
    expect((await jobs(schedule.id)).length).toBeLessThanOrEqual(1);
    const id = (await executeDmScheduleTool(db, { ...f, operation: { ...f.operation, requestKey: "running" } })).schedules[0]!.id;
    await runDueDmSchedules(db, schedule.nextRunAt);
    const identity = await markRunning(f, (await jobs(id))[0]!.id);
    const stopped = await executeDmScheduleTool(db, { ...f, operation: op("cancel", id) });
    expect(stopped.schedules[0]?.stopState).toBe("requested");
    expect(await getDmPublicMessageClaim(db, identity)).toBeNull();
    expect(await getDmPublicMessageClaim(db, { ...identity, control: "stop-unconfirmed" })).not.toBeNull();
  });
  it("lets a later user input steer the scheduled occurrence through SPEC 2", async () => {
    const f = await dmScheduleFixture(db);
    const schedule = (await executeDmScheduleTool(db, f)).schedules[0]!;
    await runDueDmSchedules(db, schedule.nextRunAt);
    const target = (await jobs(schedule.id))[0]!;
    const jobId = crypto.randomUUID(), triggerId = crypto.randomUUID(), sessionId = crypto.randomUUID();
    const observedAt = plus(schedule.nextRunAt, 30);
    await db.batch([
      db.prepare(`insert into briar_channel_messages (id, channel_id, parent_message_id, author_user_id, body, created_at, updated_at)
        values (?, ?, ?, ?, 'Compare the new report too', ?, ?)`)
        .bind(triggerId, f.channelId, target.trigger_message_id, f.ownerId, observedAt, observedAt),
      db.prepare(`insert into briar_channel_reply_sessions (id, organization_id, channel_id, thread_root_message_id, agent_id,
        provider, last_activity_at, retained_until, created_at, updated_at) values (?, ?, ?, ?, ?, 'codex', ?, ?, ?, ?)`)
        .bind(sessionId, f.organizationId, f.channelId, triggerId, f.agentId, observedAt, plus(observedAt, 86400), observedAt, observedAt),
      db.prepare(`insert into briar_channel_agent_reply_jobs (id, organization_id, channel_id, agent_id, session_id, trigger_message_id,
        parent_message_id, reply_message_id, agent_provider, status, routing_action, claimed_device_id, claimed_worker_id,
        claim_token_hash, claimed_at, lease_expires_at, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, 'codex', 'running', 'pending', ?, ?, ?, ?, ?, ?, ?)`)
        .bind(jobId, f.organizationId, f.channelId, f.agentId, sessionId, triggerId, target.trigger_message_id, crypto.randomUUID(),
          f.deviceId, f.workerId, f.claimTokenHash, observedAt, plus(observedAt, 86400), observedAt, observedAt),
    ]);
    const identity = { ...f, jobId, observedAt };
    expect(await captureDmPublicMessageClaim(db, identity)).not.toBeNull();
    const incoming = (await getChannelAgentReplyJob(db, f.organizationId, jobId))!;
    expect((await dmReplyRoutingContext(db, incoming)).candidates.some((candidate) => candidate.id === target.id)).toBe(true);
    const decision = await resolveDmReplyRouting(db, { ...identity, decision: { action: "steer", targetJobId: target.id } });
    expect(decision.action).toBe("steer");
    expect((await getChannelAgentReplyJob(db, f.organizationId, target.id))?.steer_revision).toBe(1);
    expect((await getChannelAgentReplyJob(db, f.organizationId, jobId))?.superseded_by_reply_job_id).toBe(target.id);
  });
  it("rechecks owner rights and original source at tool access, claim and publication", async () => {
    const f = await dmScheduleFixture(db); f.operation.intervalSeconds = 300;
    const schedule = (await executeDmScheduleTool(db, f)).schedules[0]!;
    await runDueDmSchedules(db, schedule.nextRunAt);
    const identity = await markRunning(f, (await jobs(schedule.id))[0]!.id);
    await db.prepare(`delete from briar_organization_members where organization_id = ? and user_id = ?`).bind(f.organizationId, f.ownerId).run();
    await expect(executeDmScheduleTool(db, { ...f, operation: op("list") })).rejects.toThrow();
    expect(await getDmPublicMessageClaim(db, identity)).toBeNull();
    expect(await db.prepare(`select id from briar_channel_agent_reply_jobs job where id = ? and ${liveChannelReplyRuntime("job")}`).bind(identity.jobId).first()).toBeNull();
    await runDueDmSchedules(db, plus(schedule.nextRunAt, 300));
    expect((await db.prepare(`select enabled from briar_dm_schedules where id = ?`).bind(schedule.id).first<{enabled: number}>())?.enabled).toBe(0);
    const source = await dmScheduleFixture(db);
    const next = (await executeDmScheduleTool(db, source)).schedules[0]!;
    await db.prepare(`update briar_channel_messages set deleted_at = ? where id = ?`).bind(source.observedAt, source.sourceId).run();
    await runDueDmSchedules(db, next.nextRunAt);
    expect(await jobs(next.id)).toHaveLength(0);
  });
});
