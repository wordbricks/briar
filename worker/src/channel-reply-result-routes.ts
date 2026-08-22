import type { AgentProvider } from "../../src/lib/agent-provider";
import { channelReplyClaimTokenHeader } from "../../src/lib/channels-contract";
import { agentSkillForMessage, hydrateAgentSkills } from "./agent-skills";
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
} from "./channel-route-decoders";
import {
  channelExecutionProposalTablesAvailable,
  channelReplyJson,
  channelSkillExecutionProposalTablesAvailable,
  completeChannelReply,
  failChannelReply,
  getClaimedChannelReply,
  getClaimedChannelReplyAttachment,
  getChannelMessage,
  getOrganizationProject,
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
import { leaseExpiryFrom } from "./workers";
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
    /^\/channel-reply-claims\/([0-9a-f-]+)\/(lease|complete)$/u,
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
      return json({ leaseExpiresAt: renewed.lease_expires_at, activity });
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
      result.delegation &&
      (agent.project_id !== null || job.delegated_by_reply_job_id !== null)
    ) {
      throw new HttpError(400, "Only an Organization Agent can delegate");
    }
    for (const projectId of [
      result.document?.projectId,
      result.issueProposal?.projectId,
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
      const selectedSkill = agentSkillForMessage(
        target.skills,
        result.delegation.request,
      );
      delegation = {
        projectId: target.project_id,
        agentId: target.id,
        skillId: selectedSkill?.id ?? null,
        provider: selectedSkill?.provider ?? target.provider,
        request: result.delegation.request,
      };
    }
    // A document or issue may only target a project inside this organization.
    for (const projectId of [
      document?.projectId,
      issueProposal?.projectId,
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
    const discardUploadedReplyImages = async () => {
      if (uploadedKeys.length === 0) return;
      try {
        await attachmentsBucket.delete(uploadedKeys);
      } catch (cleanupError) {
        console.error(JSON.stringify({
          message: "Failed channel reply image cleanup",
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
        document,
        issueProposal,
        executionProposal,
        skillExecutionProposal: Boolean(result.skillExecutionProposal),
        delegation,
        agentName: agent.name,
        agentProvider: job.agent_provider ?? agent.provider,
        completedAt: observedAt,
        attachments: storedAttachments.map(({ file: _file, ...attachment }) =>
          attachment
        ),
      });
    } catch (error) {
      await discardUploadedReplyImages();
      throw error;
    }
    if (!completed) {
      await discardUploadedReplyImages();
      throw new HttpError(409, "Reply claim is no longer active");
    }
    scheduleChannelRealtimePublish(env, db, input.organizationId, context);
    scheduleChannelActivityClear(env, completed, context);
    return json({
      agentReply: channelReplyJson(completed),
      message: await getChannelMessage(
        db,
        job.channel_id,
        job.reply_message_id,
      ),
    });
  }

  return undefined;
}
