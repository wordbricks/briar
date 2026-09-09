import { channelReplyAttachmentPath } from "../../src/lib/channel-reply-attachment-path";
import { channelReplyContextMessageJson } from "../../src/lib/channels-contract";
import { agentReplyDisplayParentMessageId } from "../../src/lib/issue-reply-decision";
import {
  bindDmMemoryReplyClaim,
  excludeForgottenDmSources,
} from "./dm-memory-claim";
import { requireDmMemoryReplyFence } from "./dm-memory-reply-fence";
import {
  captureDmPublicMessageClaim,
  listDmPublicMessagesForReply,
} from "./dm-public-message-repository";
import {
  agentSkillJson,
  hydrateAgentSkills,
} from "./agent-skills";
import {
  agentMessageTargetJson,
  listAgentMessageTargetAgents,
} from "./agent-message-targets";
import {
  claimNextChannelAgentReply,
  dmReplySettleMs,
  failChannelReply,
  getChannelAgentReplyJob,
  getChannelById,
  getChannelMessage,
  getChannelReplySession,
  getOrganizationProject,
  isAgentDirectMessage,
  listChannelAgents,
  listChannelRootMessages,
  listChannelThreadMessages,
  snapshotChannelReplyExecutionTargets,
} from "./channels";
import { sha256 } from "./crypto-digest";
import { HttpError } from "./http-response";
import { getOrganizationAgent } from "./organization-agents";
import {
  channelActivityCredential,
  scheduleChannelRealtimePublish,
} from "./realtime-scheduling";
import {
  executionWorkerRuntime,
  leaseExpiryFrom,
  workerStateAt,
} from "./workers";
import { latestExecutionWorkerUpdateHandoff } from "./worker-update-repository";
import type { AuthenticatedWorkerTeam } from "./worker-route-auth";

const DM_REPLY_CONTEXT_MESSAGE_LIMIT = 20;
const DM_REPLY_CONTEXT_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1_000;

export type AuthenticatedChannelWorkerProject = AuthenticatedWorkerTeam;

export type ClaimNextChannelReplyWorkInput = {
  input: { organizationId: string; workerId: string };
  db: D1Database;
  env: Env;
  context?: ExecutionContext;
  authenticatedWorker: AuthenticatedChannelWorkerProject;
};

/**
 * Claim leaf used by both the direct endpoint and the aggregate Worker claim
 * loop. The aggregate caller passes its already authenticated Worker and the
 * original request instead of recursively routing a synthetic Request.
 */
export async function claimNextChannelReplyWork(
  claimInput: ClaimNextChannelReplyWorkInput,
){
  const { input, db, env, context, authenticatedWorker } = claimInput;
  const principal = authenticatedWorker.principal;
  if (principal.organizationId !== input.organizationId) {
    throw new HttpError(403, "Worker is not enabled for this organization");
  }
  // Readiness and provider health still come from a project binding, which
  // every registered device has. Eligibility per job is enforced in the claim.
  const binding = authenticatedWorker.binding;
  if (!binding || binding.id !== input.workerId || binding.state === "disabled") {
    throw new HttpError(403, "Worker is not enabled for this organization");
  }
  const observedAt = new Date().toISOString();
  if (
    workerStateAt(
      binding.last_heartbeat_at,
      observedAt,
      binding.state,
    ) !== "online" ||
    binding.accepting_work !== 1 ||
    // `busy` represents occupied regular execution slots. Reply work does
    // not consume those slots, so only an unhealthy readiness state blocks.
    binding.readiness_state === "needs_attention"
  ) {
    throw new HttpError(409, "Worker is not ready to claim replies");
  }
  const runtime = executionWorkerRuntime(binding);
  if (runtime.providers.length === 0) {
    throw new HttpError(409, "Worker has no available reply provider");
  }
  const claimToken = `briar_channel_claim_${
    crypto.randomUUID().replaceAll("-", "")
  }${crypto.randomUUID().replaceAll("-", "")}`;
  const claimTokenHash = await sha256(claimToken);
  const job = await claimNextChannelAgentReply(db, input.organizationId, {
    deviceId: principal.deviceId,
    workerId: binding.id,
    runtime,
    claimTokenHash,
    claimedAt: observedAt,
    leaseExpiresAt: leaseExpiryFrom(observedAt),
    settleMs: dmReplySettleMs(env.DM_REPLY_SETTLE_MS),
  });
  if (!job) return null;
  scheduleChannelRealtimePublish(env, db, input.organizationId, context);
  try {
    if (job.claimed_worker_id !== binding.id) {
      throw new HttpError(409, "Reply claim is bound to another Worker");
    }
    const [channel, liveAgent, sourceMessage] = await Promise.all([
      getChannelById(db, job.organization_id, job.channel_id),
      getOrganizationAgent(db, job.organization_id, job.agent_id),
      getChannelMessage(db, job.channel_id, job.trigger_message_id),
    ]);
    if (!channel || !liveAgent || !job.agent_provider) {
      throw new HttpError(409, "Reply job lost its channel context");
    }
    // The job anchor also exists for timeline messages; only the actual
    // message parent distinguishes an explicit DM thread reply.
    const contextParentMessageId = agentReplyDisplayParentMessageId(
      channel.kind,
      {
        id: job.trigger_message_id,
        parentMessageId: sourceMessage?.parentMessageId ?? null,
      },
    );
    /*
      Answers copied back by an older round trip stay in the Agent's own
      context: a relaying turn queued before the copying stopped is still
      triggered by one, and losing it would strand that turn.
    */
    const messages = contextParentMessageId
      ? await listChannelThreadMessages(
          db,
          job.channel_id,
          contextParentMessageId,
          { includeAgentAnswerCopies: true },
        )
      : await listChannelRootMessages(
          db,
          job.channel_id,
          channel.kind === "dm"
            ? {
                limit: DM_REPLY_CONTEXT_MESSAGE_LIMIT,
                createdBefore: job.last_input_at ?? sourceMessage?.createdAt,
                createdAfter: new Date(
                  Date.parse(job.claimed_at ?? observedAt) -
                    DM_REPLY_CONTEXT_MAX_AGE_MS,
                ).toISOString(),
                includeAgentAnswerCopies: true,
              }
            : { includeAgentAnswerCopies: true },
        );
    if (job.project_id !== liveAgent.project_id) {
      throw new HttpError(409, "Reply job no longer matches its Agent scope");
    }
    const triggerMessage = messages.find(
      (message) => message.id === job.trigger_message_id,
    ) ?? null;
    /*
      Every message this one reply owes an answer to: its own trigger plus the
      triggers of the queued turns it took over. Ordered by the messages'
      creation so the runner can read them as the person wrote them.
    */
    const pendingTriggers = await db.prepare(
      `select message.id
       from briar_channel_agent_reply_jobs pending
       join briar_channel_messages message
         on message.id = pending.trigger_message_id
        and message.channel_id = pending.channel_id
       where pending.channel_id = ? and pending.agent_id = ?
         and (pending.id = ? or pending.superseded_by_reply_job_id = ?)
       order by message.created_at, message.id`,
    ).bind(job.channel_id, job.agent_id, job.id, job.id)
      .all<{ id: string }>();
    const pendingTriggerMessageIds = pendingTriggers.results.length > 0
      ? pendingTriggers.results.map((row) => row.id)
      : [job.trigger_message_id];
    // Pending inputs are not subject to the recent-history limit. A long burst
    // must not lose its first messages or attachments when it resumes.
    const pendingMessages = (await Promise.all(pendingTriggerMessageIds.map(
      (id) => getChannelMessage(db, job.channel_id, id),
    ))).filter((message) => message !== null);
    const responseMessages = [...new Map([...messages, ...pendingMessages]
      .map((message) => [message.id, message])).values()]
      .filter((message) => channel.kind !== "dm" ||
        message.createdAt <= (job.last_input_at ?? sourceMessage?.createdAt ?? observedAt) ||
        pendingTriggerMessageIds.includes(message.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const liveActiveSkill = job.skill_id
      ? liveAgent.skills.find((skill) => skill.id === job.skill_id) ?? null
      : null;
    const approvedSkillExecution = job.approved_skill_execution_proposal_id
      ? await db.prepare(
        `select * from briar_agent_skill_execution_proposals
         where id = ? and organization_id = ? and channel_id = ?
           and source_kind = 'channel'`,
      ).bind(
        job.approved_skill_execution_proposal_id,
        job.organization_id,
        job.channel_id,
      ).first<import("./agent-skill-execution-proposal-repository").AgentSkillExecutionProposalRow>()
      : null;
    const approvedSkillExecutionMatches = approvedSkillExecution !== null &&
      approvedSkillExecution.status === "accepted" &&
      approvedSkillExecution.execution_mode === "conversation" &&
      approvedSkillExecution.result_reply_job_id === job.id &&
      approvedSkillExecution.result_message_id === job.reply_message_id &&
      approvedSkillExecution.result_session_id === job.session_id &&
      approvedSkillExecution.project_id === job.project_id &&
      approvedSkillExecution.agent_id === job.agent_id &&
      approvedSkillExecution.skill_id === job.skill_id &&
      approvedSkillExecution.channel_id === job.channel_id &&
      approvedSkillExecution.thread_root_message_id === job.parent_message_id &&
      approvedSkillExecution.reply_message_id === job.trigger_message_id &&
      approvedSkillExecution.request === job.skill_execution_request_snapshot;
    if (
      job.selected_skill_id_snapshot !== job.skill_id ||
      (job.skill_id && (
        !liveActiveSkill ||
        !triggerMessage ||
        !job.selected_agent_name_snapshot ||
        !job.selected_agent_responsibility_snapshot ||
        !job.selected_skill_name_snapshot ||
        job.selected_skill_instructions_snapshot == null ||
        !job.selected_skill_provider_snapshot ||
        !job.skill_execution_request_snapshot ||
        (job.approved_skill_execution_proposal_id
          ? !approvedSkillExecutionMatches
          : job.skill_execution_request_snapshot !==
            (job.delegated_by_reply_job_id
              ? job.delegation_request
              : triggerMessage.body))
      ))
    ) {
      throw new HttpError(409, "Reply job lost its selected Agent Skill");
    }
    const activeSkill = liveActiveSkill
      ? {
          ...liveActiveSkill,
          name: job.selected_skill_name_snapshot!,
          body: job.selected_skill_instructions_snapshot!,
          provider: liveActiveSkill.execution_mode === "conversation"
            ? job.channel_reply_session.provider
            : job.selected_skill_provider_snapshot!,
          model: liveActiveSkill.execution_mode === "conversation"
            ? job.channel_reply_session.model
            : job.selected_skill_model_snapshot ?? null,
          effort: liveActiveSkill.execution_mode === "conversation"
            ? job.channel_reply_session.effort
            : job.selected_skill_effort_snapshot ?? null,
        }
      : null;
    const agent = activeSkill
      ? {
          ...liveAgent,
          name: job.selected_agent_name_snapshot!,
          responsibility: job.selected_agent_responsibility_snapshot!,
          skills: liveAgent.skills.map((skill) =>
            skill.id === activeSkill.id ? activeSkill : skill
          ),
        }
      : liveAgent;
    const replyRuntime = activeSkill ?? agent;
    if (replyRuntime.provider !== job.agent_provider) {
      throw new HttpError(409, "Reply job provider was revoked");
    }
    const replyModel = replyRuntime.model;
    const replyEffort = replyRuntime.effort;
    const project = job.project_id
      ? await getOrganizationProject(db, job.organization_id, job.project_id)
      : null;
    if (job.project_id !== null && !project) {
      throw new HttpError(409, "Reply job lost its project context");
    }
    const executionTargets = job.project_id
      ? await snapshotChannelReplyExecutionTargets(db, {
          jobId: job.id,
          deviceId: principal.deviceId,
          workerId: binding.id,
          claimTokenHash,
          claimedAt: job.claimed_at ?? observedAt,
        })
      : [];
    if (executionTargets === null) {
      throw new HttpError(409, "Reply claim target snapshot was not stored");
    }
    const channelAgents = agent.project_id === null
      ? await hydrateAgentSkills(db, await listChannelAgents(db, job.channel_id))
      : [];
    let delegation: {
      delegatedByReplyId: string;
      delegatedByAgentId: string;
      delegatedByAgentName: string;
      request: string;
    } | null = null;
    if (job.delegated_by_reply_job_id) {
      const delegatedByJob = await getChannelAgentReplyJob(
        db,
        job.organization_id,
        job.delegated_by_reply_job_id,
      );
      if (
        !delegatedByJob ||
        delegatedByJob.project_id !== null ||
        delegatedByJob.status !== "completed" ||
        delegatedByJob.delegated_by_reply_job_id !== null ||
        delegatedByJob.channel_id !== job.channel_id ||
        delegatedByJob.trigger_message_id !== job.trigger_message_id ||
        delegatedByJob.parent_message_id !== job.parent_message_id ||
        !job.delegation_request
      ) {
        throw new HttpError(409, "Delegated reply lost its parent scope");
      }
      const delegatedByAgent = await getOrganizationAgent(
        db,
        job.organization_id,
        delegatedByJob.agent_id,
      );
      if (!delegatedByAgent || delegatedByAgent.project_id !== null) {
        throw new HttpError(
          409,
          "Delegated reply lost its Organization Agent",
        );
      }
      delegation = {
        delegatedByReplyId: delegatedByJob.id,
        delegatedByAgentId: delegatedByAgent.id,
        delegatedByAgentName: delegatedByAgent.name,
        request: job.delegation_request,
      };
    }
    const skillExecutionRequest = job.skill_execution_request_snapshot ?? null;
    if (activeSkill && agent.project_id !== null && !skillExecutionRequest) {
      throw new HttpError(409, "Reply job lost its Skill execution request");
    }
    /*
      The two paths split on the conversation the turn belongs to: a channel
      thread keeps the existing in-thread delegation, a direct message opens an
      Agent-to-Agent conversation instead. Plan §3.7 — never both at once.
    */
    const delegationTargets = agent.project_id === null &&
        channel.kind !== "dm"
      ? channelAgents.flatMap((target) =>
          target.project_id
            ? [{
                agentId: target.id,
                agentName: target.name,
                projectId: target.project_id,
                projectName: target.project_name ?? "Project",
                responsibility: target.responsibility,
                skills: target.skills.map((skill) => ({
                  id: skill.id,
                  name: skill.name,
                })),
              }]
            : []
        )
      : [];
    const agentDirectMessage = isAgentDirectMessage(channel);
    /*
      A hop above zero only makes sense as part of a whole round trip. Losing
      the origin job, its conversation or the Agent-to-Agent DM would leave the
      runner guessing who it is answering, so the claim is refused instead.
    */
    const originJob = job.agent_message_hop > 0
      ? job.origin_reply_job_id
        ? await getChannelAgentReplyJob(
          db,
          job.organization_id,
          job.origin_reply_job_id,
        )
        : null
      : null;
    if (job.agent_message_hop > 0 && originJob?.agent_message_hop !== 0) {
      throw new HttpError(409, "Agent message lost its origin reply");
    }
    let inboundAgentMessage: {
      senderAgentId: string;
      senderAgentName: string;
      body: string;
      originReplyJobId: string;
    } | null = null;
    if (originJob && job.agent_message_hop === 1) {
      const sender = await getOrganizationAgent(
        db,
        job.organization_id,
        originJob.agent_id,
      );
      if (
        !agentDirectMessage || originJob.channel_id === job.channel_id ||
        !sender || sender.id === job.agent_id || !triggerMessage ||
        triggerMessage.author.type !== "agent" ||
        triggerMessage.author.id !== sender.id
      ) {
        throw new HttpError(409, "Agent message lost its sender");
      }
      inboundAgentMessage = {
        senderAgentId: sender.id,
        senderAgentName: sender.name,
        body: triggerMessage.body,
        originReplyJobId: originJob.id,
      };
    }
    /*
      The answer is read where it was written, in the Agent-to-Agent
      conversation, rather than from a copy in the person's own: the person
      reads the summary this turn is about to write, not the raw answer, so
      nothing is copied across.
    */
    if (originJob && job.agent_message_hop === 2) {
      const answer = await db.prepare(
        `select answer.agent_id, answer.channel_id, answer.reply_message_id,
                agent.name as agent_name
         from briar_channel_agent_reply_jobs answer
         join briar_project_agents agent on agent.id = answer.agent_id
         where answer.origin_reply_job_id = ? and answer.agent_message_hop = 1
           and answer.status = 'completed'
         order by answer.created_at, answer.id limit 1`,
      ).bind(originJob.id).first<{
        agent_id: string;
        channel_id: string;
        reply_message_id: string;
        agent_name: string;
      }>();
      const [peerChannel, answerMessage] = await Promise.all([
        answer
          ? getChannelById(db, job.organization_id, answer.channel_id)
          : Promise.resolve(null),
        answer
          ? getChannelMessage(db, answer.channel_id, answer.reply_message_id)
          : Promise.resolve(null),
      ]);
      if (
        job.channel_id !== originJob.channel_id || !answer || !peerChannel ||
        !isAgentDirectMessage(peerChannel) || !triggerMessage || !answerMessage
      ) {
        throw new HttpError(409, "Agent message lost its answer");
      }
      inboundAgentMessage = {
        senderAgentId: answer.agent_id,
        senderAgentName: answer.agent_name,
        body: answerMessage.body,
        originReplyJobId: originJob.id,
      };
    }
    /*
      Only the turn a person started may open a conversation, and the reachable
      Agents are the ones that person could reach themselves (plan §3.5). The
      author is read from the row rather than the snapshot, which is windowed.
    */
    const triggerAuthor = job.agent_message_hop === 0 && channel.kind === "dm" &&
        !agentDirectMessage
      ? await db.prepare(
        `select author_user_id from briar_channel_messages
         where id = ? and channel_id = ?`,
      ).bind(job.trigger_message_id, job.channel_id)
        .first<{ author_user_id: string | null }>()
      : null;
    const agentMessageTargets = triggerAuthor?.author_user_id
      ? (await listAgentMessageTargetAgents(db, {
        organizationId: job.organization_id,
        viewerUserId: triggerAuthor.author_user_id,
        excludeAgentId: job.agent_id,
      })).map(agentMessageTargetJson)
      : [];
    // An Agent-to-Agent DM has no owner, so it can never carry DM memory.
    const memoryBinding = channel.kind === "dm" && !agentDirectMessage
      ? await bindDmMemoryReplyClaim(db, {
          jobId: job.id,
          claimTokenHash,
          supportsMemory: runtime.proto.capabilities?.dmMemoryProtocol === 1,
          enabled: String(env.DM_MEMORY_RETRIEVAL_ENABLED) === "true",
        })
      : null;
    const safeMessages = channel.kind === "dm" && !agentDirectMessage
      ? await excludeForgottenDmSources(db, channel.id, responseMessages)
      : responseMessages;
    const currentSession = memoryBinding
      ? await getChannelReplySession(db, job.channel_reply_session.id)
      : job.channel_reply_session;
    /*
      A direct message the person simply sent starts its own provider
      conversation. What accumulates in a resumed one is the Agent's working
      transcript — every command it ran, every screen it captured — and
      carrying that into the next message puts a whole day of tool output
      behind a "hi": one DM thread reached 105 MB and 81.8M input tokens on
      2026-09-07 and then could not be resumed at all. The next message already
      gets what it needs, the channel snapshot and DM memory. An explicit reply
      is the one place the person points at earlier work, so that is where the
      conversation continues; a channel or issue message always carries a
      display parent, which leaves this a DM-only rule.
    */
    const resumedConversationId = contextParentMessageId || job.steer_revision > 0
      ? currentSession?.conversation_id ?? null
      : null;
    await requireDmMemoryReplyFence(db, job.id);
    const publicMessageScope = runtime.dmPublicMessages?.providers.includes(
        job.agent_provider,
      )
      ? await captureDmPublicMessageClaim(db, {
          jobId: job.id,
          organizationId: job.organization_id,
          workerId: binding.id,
          deviceId: principal.deviceId,
          claimTokenHash,
          observedAt,
        })
      : null;
    const publishedMessageBatches = publicMessageScope
      ? await listDmPublicMessagesForReply(db, {
          jobId: job.id,
          organizationId: job.organization_id,
        })
      : [];
    const activity = env.CHANNEL_ACTIVITY_REALTIME
      ? await channelActivityCredential(env, job, {
          workerId: binding.id,
          deviceId: principal.deviceId,
        })
      : null;
    const handoffContext = await latestExecutionWorkerUpdateHandoff(db, {
      deviceId: principal.deviceId,
      workType: "channelReply",
      workId: job.id,
    });
    return {
        workType: "channelReply" as const,
        workId: job.id,
        organizationId: job.organization_id,
        channelId: job.channel_id,
        // Null means there is no repository: the runner skips worktree setup.
        projectId: job.project_id,
        scope: agent.project_id === null
          ? { kind: "organization", organizationId: job.organization_id }
          : {
              kind: "project",
              organizationId: job.organization_id,
              projectId: agent.project_id,
            },
        // The worker loop keys in-flight work by runId; a channel reply has no
        // run, so the channel stands in for it.
        runId: job.channel_id,
        sourceKey:
          `briar-channel:${job.channel_id}:reply:${job.trigger_message_id}`,
        title: channel.name,
        triggerMessageId: job.trigger_message_id,
        parentMessageId: job.parent_message_id,
        pendingTriggerMessageIds,
        dmPublicMessageProtocol: publicMessageScope ? 1 as const : null,
        inputRevision: publicMessageScope?.input_revision ?? 0,
        publishedMessageBatches,
        provider: job.agent_provider,
        model: replyModel,
        effort: replyEffort,
        activeSkill: activeSkill ? agentSkillJson(activeSkill) : null,
        skillExecutionTarget:
          activeSkill && agent.project_id !== null && skillExecutionRequest
            ? {
                projectId: agent.project_id,
                agentId: agent.id,
                skillId: activeSkill.id,
                skillName: activeSkill.name,
                request: skillExecutionRequest,
                executionMode: activeSkill.execution_mode,
                approvalPolicy: activeSkill.approval_policy,
                approved: Boolean(job.approved_skill_execution_proposal_id),
              }
            : null,
        agent: {
          id: agent.id,
          name: agent.name,
          provider: job.agent_provider,
          model: replyModel,
          effort: replyEffort,
          computerUsePolicy: agent.computer_use_policy,
          responsibility: agent.responsibility,
          skills: agent.skills.map(agentSkillJson),
        },
        claimToken,
        claimedAt: job.claimed_at,
        leaseExpiresAt: job.lease_expires_at,
        activity,
        handoffContext: memoryBinding ? null : handoffContext,
        memory: memoryBinding?.memory ?? null,
        memoryLearningEnabled:
          runtime.proto.capabilities?.dmMemoryLearningRequests === 1 &&
          memoryBinding !== null,
        session: {
          id: job.channel_reply_session.id,
          threadId: job.channel_reply_session.thread_root_message_id,
          conversationId: resumedConversationId,
          retainedUntil: job.channel_reply_session.retained_until,
          claimReason: job.session_claim_reason,
        },
        organizationContext: agent.project_id === null
          ? { snapshotAt: job.claimed_at }
          : null,
        delegation,
        delegationTargets,
        agentMessageTargets,
        inboundAgentMessage,
        agentMessageHop: job.agent_message_hop,
        triggerAttachments: safeMessages.filter((message) => pendingTriggerMessageIds.includes(message.id))
          .flatMap((message) => message.attachments ?? []).map(
          (attachment) => ({
            id: attachment.id,
            filename: attachment.filename,
            contentType: attachment.contentType,
            byteSize: attachment.byteSize,
            url: channelReplyAttachmentPath({
              organizationId: job.organization_id,
              workId: job.id,
              attachmentId: attachment.id,
            }),
          }),
        ),
        snapshot: {
          channel: {
            id: channel.id,
            kind: channel.kind,
            name: channel.name,
            slug: channel.slug,
            topic: channel.topic,
            defaultProjectId: channel.default_project_id,
          },
          agent: {
            id: agent.id,
            name: agent.name,
            responsibility: agent.responsibility,
            provider: job.agent_provider,
            model: replyModel,
            effort: replyEffort,
            projectId: agent.project_id,
          },
          project: project ? { id: project.id, name: project.name } : null,
          projectTargets: project ? [{ id: project.id, name: project.name }] : [],
          executionTargets: executionTargets.map((target) => ({
            id: target.id,
            projectId: job.project_id,
            runId: target.id,
            runNumber: target.run_number,
            sourceKey: target.source_key,
            title: target.title,
            status: target.status,
          })),
          messages: safeMessages.map(channelReplyContextMessageJson),
        },
    };
  } catch (error) {
    await failChannelReply(db, {
      jobId: job.id,
      deviceId: principal.deviceId,
      workerId: binding.id,
      claimTokenHash,
      error: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    });
    scheduleChannelRealtimePublish(env, db, input.organizationId, context);
    throw error;
  }
}
