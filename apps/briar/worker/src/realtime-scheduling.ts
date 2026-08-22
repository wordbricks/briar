import {
  CHANNEL_AGENT_ACTIVITY_STALE_MS,
  CHANNEL_AGENT_ACTIVITY_VERSION,
  type ChannelAgentActivityFrame,
  type IssueAgentActivityFrame,
} from "../../src/lib/channel-agent-activity";
import { getDashboardSyncCursor } from "./dashboard-change-repository";
import {
  acknowledgeOrganizationInboxRealtimeOutbox,
  getProjectAgentSessionSyncCursor,
  listOrganizationInboxRealtimeOutbox,
  type IssueAgentReplyJobRow,
} from "./db";
import { getChannelSyncCursor, type ChannelReplyJobRow } from "./channels";
import {
  publishChannelRealtime,
  publishInboxRealtime,
  publishProjectAgentSessionRealtime,
  publishProjectRealtime,
} from "./channel-realtime";
import {
  disconnectChannelActivitySubscribers,
  publishChannelActivity,
  publishIssueActivity,
} from "./channel-activity-realtime";
import {
  createChannelActivityPublishToken,
  createIssueActivityPublishToken,
} from "./channel-activity-ticket";
import { HttpError } from "./http-response";

export async function flushOrganizationInboxRealtimeOutbox(
  env: Env,
  db: D1Database,
) {
  if (!env.CHANNEL_REALTIME) return;
  const pending = await listOrganizationInboxRealtimeOutbox(db);
  for (const row of pending) {
    try {
      await publishInboxRealtime(env, row.organization_id, row.version);
      await acknowledgeOrganizationInboxRealtimeOutbox(
        db,
        row.organization_id,
        row.version,
      );
    } catch (error) {
      // Keep the transactional outbox row for the next mutation, scheduled
      // sweep, or client fallback refresh.
      console.error(JSON.stringify({
        message: "Inbox realtime publish failed",
        organizationId: row.organization_id,
        version: row.version,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}

export function scheduleInboxRealtimeFlush(
  env: Env,
  db: D1Database,
  context?: ExecutionContext,
) {
  if (!env.CHANNEL_REALTIME) return;
  const flush = flushOrganizationInboxRealtimeOutbox(env, db).catch((error) => {
    console.error(JSON.stringify({
      message: "Inbox realtime outbox flush failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  });
  if (context) context.waitUntil(flush);
  else void flush;
}

export function scheduleChannelRealtimePublish(
  env: Env,
  db: D1Database,
  organizationId: string,
  context?: ExecutionContext,
) {
  if (!env.CHANNEL_REALTIME) return;
  const publish = getChannelSyncCursor(db, organizationId)
    .then((cursor) => publishChannelRealtime(env, organizationId, cursor))
    .catch((error) => {
      console.error(JSON.stringify({
        message: "Channel realtime publish failed",
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  if (context) context.waitUntil(publish);
  else void publish;
  scheduleInboxRealtimeFlush(env, db, context);
}

type ChannelActivityReplyIdentity = Pick<
  ChannelReplyJobRow,
  | "id"
  | "organization_id"
  | "channel_id"
  | "agent_id"
  | "trigger_message_id"
  | "parent_message_id"
  | "attempts"
  | "lease_expires_at"
>;

export async function channelActivityCredential(
  env: Env,
  job: ChannelActivityReplyIdentity,
  input: { workerId: string; deviceId: string },
) {
  if (!job.lease_expires_at) {
    throw new HttpError(409, "Reply claim has no active lease");
  }
  const expiresAt = Date.parse(job.lease_expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new HttpError(409, "Reply claim lease has expired");
  }
  const credential = await createChannelActivityPublishToken(
    env.BETTER_AUTH_SECRET,
    {
      organizationId: job.organization_id,
      channelId: job.channel_id,
      replyJobId: job.id,
      agentId: job.agent_id,
      triggerMessageId: job.trigger_message_id,
      parentMessageId: job.parent_message_id,
      attempt: job.attempts,
      workerId: input.workerId,
      deviceId: input.deviceId,
      expiresAt,
    },
  );
  return {
    token: credential.token,
    expiresAt: new Date(credential.expiresAt).toISOString(),
  };
}

export function channelActivityFrame(
  job: Omit<ChannelActivityReplyIdentity, "lease_expires_at">,
  input: Pick<ChannelAgentActivityFrame, "sequence" | "activity">,
  now = Date.now(),
): ChannelAgentActivityFrame {
  return {
    version: CHANNEL_AGENT_ACTIVITY_VERSION,
    replyJobId: job.id,
    attempt: job.attempts,
    sequence: input.sequence,
    agentId: job.agent_id,
    channelId: job.channel_id,
    triggerMessageId: job.trigger_message_id,
    parentMessageId: job.parent_message_id,
    activity: input.activity,
    sentAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CHANNEL_AGENT_ACTIVITY_STALE_MS).toISOString(),
  };
}

export function scheduleChannelActivityClear(
  env: Env,
  job: ChannelActivityReplyIdentity,
  context?: ExecutionContext,
) {
  if (!env.CHANNEL_ACTIVITY_REALTIME) return;
  const frame = channelActivityFrame(job, {
    sequence: Number.MAX_SAFE_INTEGER,
    activity: null,
  });
  const publish = publishChannelActivity(env, job.organization_id, frame).catch(
    (error) => {
      console.error(JSON.stringify({
        message: "Channel activity clear failed",
        organizationId: job.organization_id,
        channelId: job.channel_id,
        replyJobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      }));
    },
  );
  if (context) context.waitUntil(publish);
  else void publish;
}

type IssueActivityReplyIdentity = Pick<
  IssueAgentReplyJobRow,
  | "id"
  | "project_id"
  | "run_id"
  | "trigger_message_id"
  | "parent_message_id"
  | "attempts"
  | "lease_expires_at"
>;

export async function issueActivityCredential(
  env: Env,
  organizationId: string,
  job: IssueActivityReplyIdentity,
  input: { workerId: string; deviceId: string },
) {
  if (!job.lease_expires_at) {
    throw new HttpError(409, "Reply claim has no active lease");
  }
  const expiresAt = Date.parse(job.lease_expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new HttpError(409, "Reply claim lease has expired");
  }
  const credential = await createIssueActivityPublishToken(
    env.BETTER_AUTH_SECRET,
    {
      organizationId,
      projectId: job.project_id,
      runId: job.run_id,
      replyJobId: job.id,
      triggerMessageId: job.trigger_message_id,
      parentMessageId: job.parent_message_id,
      attempt: job.attempts,
      workerId: input.workerId,
      deviceId: input.deviceId,
      expiresAt,
    },
  );
  return {
    token: credential.token,
    expiresAt: new Date(credential.expiresAt).toISOString(),
  };
}

export function issueActivityFrame(
  job: Omit<IssueActivityReplyIdentity, "lease_expires_at">,
  input: Pick<IssueAgentActivityFrame, "sequence" | "activity">,
  now = Date.now(),
): IssueAgentActivityFrame {
  return {
    version: CHANNEL_AGENT_ACTIVITY_VERSION,
    replyJobId: job.id,
    attempt: job.attempts,
    sequence: input.sequence,
    projectId: job.project_id,
    runId: job.run_id,
    triggerMessageId: job.trigger_message_id,
    parentMessageId: job.parent_message_id,
    activity: input.activity,
    sentAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CHANNEL_AGENT_ACTIVITY_STALE_MS).toISOString(),
  };
}

export function scheduleIssueActivityClear(
  env: Env,
  organizationId: string,
  job: IssueActivityReplyIdentity,
  context?: ExecutionContext,
) {
  if (!env.CHANNEL_ACTIVITY_REALTIME) return;
  const frame = issueActivityFrame(job, {
    sequence: Number.MAX_SAFE_INTEGER,
    activity: null,
  });
  const publish = publishIssueActivity(env, organizationId, frame).catch(
    (error) => {
      console.error(JSON.stringify({
        message: "Issue activity clear failed",
        organizationId,
        projectId: job.project_id,
        runId: job.run_id,
        replyJobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      }));
    },
  );
  if (context) context.waitUntil(publish);
  else void publish;
}

export function scheduleChannelActivityDisconnect(
  env: Env,
  organizationId: string,
  channelId: string,
  context?: ExecutionContext,
) {
  if (!env.CHANNEL_ACTIVITY_REALTIME) return;
  const disconnect = disconnectChannelActivitySubscribers(
    env,
    organizationId,
    channelId,
  ).catch((error) => {
    console.error(JSON.stringify({
      message: "Channel activity disconnect failed",
      organizationId,
      channelId,
      error: error instanceof Error ? error.message : String(error),
    }));
  });
  if (context) context.waitUntil(disconnect);
  else void disconnect;
}

export function scheduleProjectRealtimePublish(
  env: Env,
  db: D1Database,
  projectId: string,
  context?: ExecutionContext,
) {
  if (!env.CHANNEL_REALTIME) return;
  const publish = Promise.all([
    db.prepare(
      `select organization_id from briar_projects where id = ?`,
    ).bind(projectId).first<{ organization_id: string }>(),
    getDashboardSyncCursor(db, projectId),
  ]).then(([project, cursor]) => {
    if (!project) return;
    return publishProjectRealtime(
      env,
      project.organization_id,
      projectId,
      cursor,
    );
  }).catch((error) => {
    console.error(JSON.stringify({
      message: "Project realtime publish failed",
      projectId,
      error: error instanceof Error ? error.message : String(error),
    }));
  });
  if (context) context.waitUntil(publish);
  else void publish;
  scheduleInboxRealtimeFlush(env, db, context);
}

export function scheduleProjectAgentSessionRealtimePublish(
  env: Env,
  db: D1Database,
  projectId: string,
  context?: ExecutionContext,
) {
  if (!env.CHANNEL_REALTIME) return;
  const publish = Promise.all([
    db.prepare(
      `select organization_id from briar_projects where id = ?`,
    ).bind(projectId).first<{ organization_id: string }>(),
    getProjectAgentSessionSyncCursor(db, projectId),
  ]).then(([project, version]) => {
    if (!project) return;
    return publishProjectAgentSessionRealtime(
      env,
      project.organization_id,
      projectId,
      version,
    );
  }).catch((error) => {
    console.error(JSON.stringify({
      message: "Project Agent session realtime publish failed",
      projectId,
      error: error instanceof Error ? error.message : String(error),
    }));
  });
  if (context) context.waitUntil(publish);
  else void publish;
}

export function channelMutationOrganization(
  pathname: string,
  method: string,
  status: number,
) {
  if (status >= 400 || method === "GET" || method === "HEAD") return null;
  return pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels(?:\/|$)/u,
  )?.[1] ?? null;
}

export function projectScheduleClaimMutation(
  pathname: string,
  method: string,
  status: number,
) {
  if (status >= 400 || method !== "POST") return false;
  return pathname === "/agent-schedule-runs/claim" ||
    /^\/projects\/[0-9a-f-]+\/agent-schedule-runs\/claim$/u.test(pathname);
}

export function projectMutationProject(
  pathname: string,
  method: string,
  status: number,
) {
  if (status >= 400 || method === "GET" || method === "HEAD") return null;
  if (projectScheduleClaimMutation(pathname, method, status)) return null;
  if (
    /^\/projects\/[0-9a-f-]+\/agent-sessions\/[^/]+$/u.test(
      pathname,
    )
  ) return null;
  return pathname.match(/^\/projects\/([0-9a-f-]+)(?:\/|$)/u)?.[1] ?? null;
}

