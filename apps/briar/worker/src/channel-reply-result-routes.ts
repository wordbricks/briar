import { requireDmMemoryReplyFence } from "./dm-memory-reply-fence";
import { dmLearningPolicy, supportsDmMemoryLearningRequests } from "./dm-memory-learning-policy";
import type { AgentProvider } from "../../src/lib/agent-provider";
import { channelReplyClaimTokenHeader } from "../../src/lib/channels-contract";
import { hydrateAgentSkills } from "./agent-skills";
import {
  prepareStoredAttachments,
  uploadStoredAttachments,
} from "./attachment-storage";
import { channelAttachmentResponse } from "./channel-attachment-response";
import { publishChannelActivity } from "./channel-activity-realtime";
import { verifyChannelActivityPublishToken } from "./channel-activity-ticket";
import {
  decodeChannelAgentActivityPublishInput,
  decodeChannelReplyLeaseInput,
  decodeChannelReplySessionCheckpointInput,
} from "./channel-route-decoders";
import {
  channelExecutionProposalTablesAvailable,
  channelIssueBatchProposalTablesAvailable,
  channelReplyJson,
  channelSkillExecutionProposalTablesAvailable,
  completeChannelReply,
  checkpointChannelReplySession,
  failChannelReply,
  getClaimedChannelReply,
  getClaimedChannelReplyAttachment,
  getChannelMessage,
  getOrganizationProject,
  getChannelReplySession,
  listChannelAgents,
  renewChannelReplyLease,
} from "./channels";
import { sha256 } from "./crypto-digest";
import { HttpError, json } from "./http-response";
import { getOrganizationAgent } from "./organization-agents";
import {
  readChannelReplyCompleteRequest,
  readJson,
} from "./request-readers";
import {
  channelActivityCredential,
  channelActivityFrame,
  scheduleChannelActivityClear,
  scheduleChannelRealtimePublish,
} from "./realtime-scheduling";
import { executionWorkerBindingById, leaseExpiryFrom } from "./workers";
import { requireWorkerOrganization } from "./worker-route-auth";

export type ChannelReplyResultRouteInput = {
  request: Request;
  url: URL;
  db: D1Database;
  attachmentsBucket: R2Bucket;
  env: Env;
  context?: ExecutionContext;
};

export async function handleChannelReplyResultRoute(
  routeInput: ChannelReplyResultRouteInput,
): Promise<Response | undefined> {
  const { request, url, db, attachmentsBucket, env, context } = routeInput;
  const { pathname } = url;

  const channelReplyAttachmentMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channel-reply-claims\/([0-9a-f-]+)\/attachments\/([0-9a-f-]+)$/u,
  );
  if (
    channelReplyAttachmentMatch &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    const principal = await requireWorkerOrganization(
      db,
      request,
      channelReplyAttachmentMatch[1],
    );
    const claimToken = request.headers
      .get(channelReplyClaimTokenHeader)
      ?.trim();
    if (
      !claimToken?.startsWith("briar_channel_claim_") ||
      claimToken.length > 200
    ) {
      throw new HttpError(401, "Channel reply claim token required");
    }
    const attachment = await getClaimedChannelReplyAttachment(db, {
      organizationId: channelReplyAttachmentMatch[1],
      jobId: channelReplyAttachmentMatch[2],
      deviceId: principal.deviceId,
      claimTokenHash: await sha256(claimToken),
      attachmentId: channelReplyAttachmentMatch[3],
      observedAt: new Date().toISOString(),
    });
    if (!attachment) throw new HttpError(404, "Attachment not found");
    if (request.method === "HEAD") {
      const object = await attachmentsBucket.head(attachment.object_key);
      if (!object) throw new HttpError(404, "Attachment not found");
      return channelAttachmentResponse(attachment, object, null);
    }
    const object = await attachmentsBucket.get(attachment.object_key);
    if (!object) throw new HttpError(404, "Attachment not found");
    return channelAttachmentResponse(attachment, object, object.body);
  }

  const channelReplyActivityMatch = pathname.match(
    /^\/channel-reply-claims\/([0-9a-f-]+)\/activity$/u,
  );
  if (channelReplyActivityMatch && request.method === "POST") {
    const token = request.headers.get("X-Briar-Channel-Activity-Token") ?? "";
    const verified = await verifyChannelActivityPublishToken(
      env.BETTER_AUTH_SECRET,
      token,
      channelReplyActivityMatch[1],
    );
    if (!verified) {
      throw new HttpError(401, "Invalid or expired activity token");
    }
    await requireDmMemoryReplyFence(db, verified.replyJobId);
    const active = await db.prepare(`select 1 from briar_channel_agent_reply_jobs job
      where job.id = ? and job.organization_id = ? and job.channel_id = ? and job.agent_id = ?
        and job.attempts = ? and job.claimed_worker_id = ? and job.claimed_device_id = ?
        and job.status = 'running' and job.lease_expires_at > ?
        and (job.claim_token_hash = ? or (? is null and not exists (
          select 1 from briar_dm_memory_reply_fences fence where fence.job_id = job.id)))`)
      .bind(verified.replyJobId, verified.organizationId, verified.channelId, verified.agentId,
        verified.attempt, verified.workerId, verified.deviceId, new Date().toISOString(),
        verified.claimTokenHash ?? null, verified.claimTokenHash ?? null).first();
    if (!active) throw new HttpError(409, "Reply activity claim is no longer active");
    if (verified.claimTokenHash && !await getClaimedChannelReply(db, {
      jobId: verified.replyJobId, workerId: verified.workerId, deviceId: verified.deviceId,
      claimTokenHash: verified.claimTokenHash, observedAt: new Date().toISOString(),
    })) throw new HttpError(409, "Reply runtime changed", "memory_scope_revoked");
    const input = decodeChannelAgentActivityPublishInput(
      await readJson(request),
    );
    const frame = channelActivityFrame(
      {
        id: verified.replyJobId,
        organization_id: verified.organizationId,
        channel_id: verified.channelId,
        agent_id: verified.agentId,
        trigger_message_id: verified.triggerMessageId,
        parent_message_id: verified.parentMessageId,
        attempts: verified.attempt,
      },
      input,
    );
    await publishChannelActivity(env, verified.organizationId, frame);
    return new Response(null, { status: 204 });
  }

  const channelReplyClaimMatch = pathname.match(
    /^\/channel-reply-claims\/([0-9a-f-]+)\/(lease|session|complete)$/u,
  );
  if (channelReplyClaimMatch && request.method === "POST") {
    if (channelReplyClaimMatch[2] === "lease") {
      const input = decodeChannelReplyLeaseInput(await readJson(request));
      const principal = await requireWorkerOrganization(
        db,
        request,
        input.organizationId,
      );
      const observedAt = new Date().toISOString();
      const renewed = await renewChannelReplyLease(db, {
        jobId: channelReplyClaimMatch[1],
        deviceId: principal.deviceId,
        workerId: input.workerId,
        claimTokenHash: await sha256(input.claimToken),
        observedAt,
        leaseExpiresAt: leaseExpiryFrom(observedAt),
      });
      if (!renewed) {
        throw new HttpError(409, "Reply claim is no longer active");
      }
      const activity = env.CHANNEL_ACTIVITY_REALTIME
        ? await channelActivityCredential(env, renewed, {
            workerId: input.workerId,
            deviceId: principal.deviceId,
          })
        : null;
      const session = renewed.session_id
        ? await getChannelReplySession(db, renewed.session_id)
        : null;
      return json({
        leaseExpiresAt: renewed.lease_expires_at,
        retainedUntil: session?.retained_until ?? null,
        activity,
      });
    }

    if (channelReplyClaimMatch[2] === "session") {
      const input = decodeChannelReplySessionCheckpointInput(
        await readJson(request),
      );
      const principal = await requireWorkerOrganization(
        db,
        request,
        input.organizationId,
      );
      const session = await checkpointChannelReplySession(db, {
        jobId: channelReplyClaimMatch[1],
        deviceId: principal.deviceId,
        workerId: input.workerId,
        claimTokenHash: await sha256(input.claimToken),
        conversationId: input.conversationId,
        observedAt: new Date().toISOString(),
      });
      if (!session) {
        throw new HttpError(409, "Reply claim is no longer active");
      }
      return json({ retainedUntil: session.retained_until });
    }

    const { input, attachments } = await readChannelReplyCompleteRequest(
      request,
    );
    const principal = await requireWorkerOrganization(
      db,
      request,
      input.organizationId,
    );
    const claimTokenHash = await sha256(input.claimToken);
    const observedAt = new Date().toISOString();
    const job = await getClaimedChannelReply(db, {
      jobId: channelReplyClaimMatch[1],
      deviceId: principal.deviceId,
      workerId: input.workerId,
      claimTokenHash,
      observedAt,
    });
    if (!job || job.organization_id !== input.organizationId) {
      throw new HttpError(409, "Reply claim is no longer active");
    }
    if (input.error) {
      const failed = await failChannelReply(db, {
        jobId: job.id,
        deviceId: principal.deviceId,
        workerId: input.workerId,
        claimTokenHash,
        error: input.error,
        updatedAt: observedAt,
      });
      if (!failed) {
        throw new HttpError(409, "Reply claim is no longer active");
      }
      scheduleChannelRealtimePublish(env, db, input.organizationId, context);
      scheduleChannelActivityClear(env, failed, context);
      return json({ agentReply: channelReplyJson(failed) });
    }
    const agent = await getOrganizationAgent(
      db,
      job.organization_id,
      job.agent_id,
    );
    if (!agent) throw new HttpError(409, "Reply job lost its Agent");
    const result = input.result!;
    if (result.memorySaveRequest) {
      const binding = await executionWorkerBindingById(db, principal.deviceId, input.workerId);
      if (!binding || !supportsDmMemoryLearningRequests(binding.capabilities_json) ||
        !dmLearningPolicy(env, job.organization_id) || !await db.prepare(`select 1 from briar_dm_memory_reply_fences
          where job_id = ? and claim_token_hash = ? and protocol = 1`).bind(job.id, claimTokenHash).first()) {
        throw new HttpError(409, "Memory learning is unavailable", "memory_learning_unavailable");
      }
    }
    if (
      (result.executionProposal || result.issueProposal?.executeAfterCreate) &&
      !(await channelExecutionProposalTablesAvailable(db))
    ) {
      throw new HttpError(
        503,
        "Issue execution approval is not available during this upgrade",
        "ISSUE_EXECUTION_APPROVAL_UNAVAILABLE",
      );
    }
    if (
      result.skillExecutionProposal &&
      !(await channelSkillExecutionProposalTablesAvailable(db))
    ) {
      throw new HttpError(
        503,
        "Agent Skill execution approval is not available during this upgrade",
        "AGENT_SKILL_EXECUTION_APPROVAL_UNAVAILABLE",
      );
    }
    if (
      result.issueBatchProposal &&
      !(await channelIssueBatchProposalTablesAvailable(db))
    ) {
      throw new HttpError(
        503,
        "Issue batch approval is not available during this upgrade",
        "ISSUE_BATCH_APPROVAL_UNAVAILABLE",
      );
    }
    if (
      result.delegation &&
      (agent.project_id !== null || job.delegated_by_reply_job_id !== null)
    ) {
      throw new HttpError(400, "Only an Organization Agent can delegate");
    }
    for (const projectId of [
      result.document?.projectId,
      result.issueProposal?.projectId,
      result.issueBatchProposal?.projectId,
      result.executionProposal?.projectId,
    ]) {
      if (
        projectId !== null &&
        projectId !== undefined &&
        agent.project_id !== null &&
        projectId !== agent.project_id
      ) {
        throw new HttpError(400, "Project Agent output is outside its project");
      }
    }
    const document = result.document
      ? {
          ...result.document,
          projectId: result.document.projectId ?? agent.project_id,
        }
      : null;
    const issueProposal = result.issueProposal
      ? {
          ...result.issueProposal,
          projectId: result.issueProposal.projectId ?? agent.project_id,
        }
      : null;
    const issueBatchProposal = result.issueBatchProposal
      ? {
          ...result.issueBatchProposal,
          projectId: result.issueBatchProposal.projectId ?? agent.project_id,
        }
      : null;
    const executionProposal = result.executionProposal;
    if (
      agent.project_id === null &&
      (executionProposal ||
        issueProposal?.executeAfterCreate ||
        result.skillExecutionProposal)
    ) {
      throw new HttpError(
        400,
        "Organization Agents must delegate execution requests to a Project Agent",
      );
    }
    if (
      result.skillExecutionProposal &&
      (!job.skill_id ||
        job.selected_skill_id_snapshot !== job.skill_id ||
        !agent.skills.some((skill) =>
          skill.id === job.skill_id && skill.provider === job.agent_provider
        ))
    ) {
      throw new HttpError(
        409,
        "Agent Skill execution requires the server-selected Skill",
        "CHANNEL_SKILL_EXECUTION_PROPOSAL_STALE",
      );
    }
    let delegation: {
      projectId: string;
      agentId: string;
      skillId: string | null;
      provider: AgentProvider;
      request: string;
    } | null = null;
    if (result.delegation) {
      const roster = await hydrateAgentSkills(
        db,
        await listChannelAgents(db, job.channel_id),
      );
      const target = roster.find(
        (candidate) => candidate.id === result.delegation?.agentId,
      );
      if (
        !target ||
        !target.project_id ||
        target.organization_id !== job.organization_id ||
        target.project_id !== result.delegation.projectId
      ) {
        throw new HttpError(
          400,
          "Delegation target is not an eligible Project Agent in this channel",
        );
      }
      delegation = {
        projectId: target.project_id,
        agentId: target.id,
        skillId: null,
        provider: target.provider,
        request: result.delegation.request,
      };
    }
    // A document or issue may only target a project inside this organization.
    for (const projectId of [
      document?.projectId,
      issueProposal?.projectId,
      issueBatchProposal?.projectId,
      executionProposal?.projectId,
    ]) {
      if (!projectId) continue;
      const project = await getOrganizationProject(
        db,
        job.organization_id,
        projectId,
      );
      if (!project) {
        throw new HttpError(400, "Target project is outside this organization");
      }
    }
    const storedAttachments = prepareStoredAttachments(attachments, () => {
      const id = crypto.randomUUID();
      return {
        id,
        organization_id: job.organization_id,
        object_key:
          `channel-attachments/${job.organization_id}/${job.channel_id}/${job.reply_message_id}/${id}`,
      };
    });
    const uploadedKeys: string[] = [];
    const discardUploadedReplyAttachments = async () => {
      if (uploadedKeys.length === 0) return;
      try {
        await attachmentsBucket.delete(uploadedKeys);
      } catch (cleanupError) {
        console.error(JSON.stringify({
          message: "Failed channel reply attachment cleanup",
          organizationId: job.organization_id,
          channelId: job.channel_id,
          messageId: job.reply_message_id,
          attachmentCount: uploadedKeys.length,
          error: cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
        }));
      }
    };
    let completed: Awaited<ReturnType<typeof completeChannelReply>> = null;
    try {
      await uploadStoredAttachments(
        attachmentsBucket,
        storedAttachments,
        uploadedKeys,
        (attachment) => ({
          attachmentId: attachment.id,
          channelId: job.channel_id,
          messageId: job.reply_message_id,
          organizationId: job.organization_id,
        }),
      );
      completed = await completeChannelReply(db, job, {
        jobId: job.id,
        deviceId: principal.deviceId,
        workerId: input.workerId,
        claimTokenHash,
        body: result.body,
        memoryCitations: result.memoryCitations,
        memorySaveRequest: result.memorySaveRequest,
        document,
        issueProposal,
        issueBatchProposal,
        executionProposal,
        skillExecutionProposal: Boolean(result.skillExecutionProposal),
        delegation,
        agentName: agent.name,
        agentProvider: job.agent_provider ?? agent.provider,
        completedAt: observedAt,
        conversationId: input.conversationId,
        attachments: storedAttachments.map(({ file: _file, ...attachment }) =>
          attachment
        ),
      });
    } catch (error) {
      await discardUploadedReplyAttachments();
      throw error;
    }
    if (!completed) {
      await discardUploadedReplyAttachments();
      throw new HttpError(409, "Reply claim is no longer active");
    }
    scheduleChannelRealtimePublish(env, db, input.organizationId, context);
    scheduleChannelActivityClear(env, completed, context);
    return json({
      agentReply: channelReplyJson(completed),
      session: completed.session_id
        ? await getChannelReplySession(db, completed.session_id)
        : null,
      message: await getChannelMessage(
        db,
        job.channel_id,
        job.reply_message_id,
      ),
    });
  }

  return undefined;
}
