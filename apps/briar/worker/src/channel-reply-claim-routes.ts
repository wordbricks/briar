import { channelReplyContextMessageJson } from "../../src/lib/channels-contract";
import { agentReplyDisplayParentMessageId } from "../../src/lib/issue-reply-decision";
import {
  agentSkillJson,
  hydrateAgentSkills,
} from "./agent-skills";
import {
  channelExecutionProposalTablesAvailable,
  claimNextChannelAgentReply,
  failChannelReply,
  getChannelAgentReplyJob,
  getChannelById,
  getOrganizationProject,
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
  executionWorkerProviders,
  executionWorkerSupportsOrganizationAgentContext,
  leaseExpiryFrom,
  workerStateAt,
} from "./workers";
import { latestExecutionWorkerUpdateHandoff } from "./worker-update-repository";
import type { AuthenticatedWorkerProject } from "./worker-route-auth";

const DM_REPLY_CONTEXT_MESSAGE_LIMIT = 10;
const DM_REPLY_CONTEXT_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1_000;

export type AuthenticatedChannelWorkerProject = AuthenticatedWorkerProject;

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
  const providers = executionWorkerProviders(binding);
  if (providers.length === 0) {
    throw new HttpError(409, "Worker has no available reply provider");
  }
  const claimToken = `briar_channel_claim_${
    crypto.randomUUID().replaceAll("-", "")
  }${crypto.randomUUID().replaceAll("-", "")}`;
  const claimTokenHash = await sha256(claimToken);
  const job = await claimNextChannelAgentReply(db, input.organizationId, {
    deviceId: principal.deviceId,
    workerId: binding.id,
    providers,
    workerAgentProvider: binding.agent_provider,
    workerCapabilitiesJson: binding.capabilities_json,
    supportsOrganizationAgentContext:
      executionWorkerSupportsOrganizationAgentContext(binding),
    claimTokenHash,
    claimedAt: observedAt,
    leaseExpiresAt: leaseExpiryFrom(observedAt),
  });
  if (!job) return null;
  scheduleChannelRealtimePublish(env, db, input.organizationId, context);
  try {
    if (job.claimed_worker_id !== binding.id) {
      throw new HttpError(409, "Reply claim is bound to another Worker");
    }
    const [channel, liveAgent] = await Promise.all([
      getChannelById(db, job.organization_id, job.channel_id),
      getOrganizationAgent(db, job.organization_id, job.agent_id),
    ]);
    if (!channel || !liveAgent || !job.agent_provider) {
      throw new HttpError(409, "Reply job lost its channel context");
    }
    const contextParentMessageId = agentReplyDisplayParentMessageId(
      channel.kind,
      {
        id: job.trigger_message_id,
        parentMessageId: job.parent_message_id,
      },
    );
    const messages = contextParentMessageId
      ? await listChannelThreadMessages(
          db,
          job.channel_id,
          contextParentMessageId,
        )
      : await listChannelRootMessages(
          db,
          job.channel_id,
          channel.kind === "dm"
            ? {
                limit: DM_REPLY_CONTEXT_MESSAGE_LIMIT,
                createdAfter: new Date(
                  Date.parse(job.claimed_at ?? observedAt) -
                    DM_REPLY_CONTEXT_MAX_AGE_MS,
                ).toISOString(),
              }
            : {},
        );
    if (job.project_id !== liveAgent.project_id) {
      throw new HttpError(409, "Reply job no longer matches its Agent scope");
    }
    const triggerMessage = messages.find(
      (message) => message.id === job.trigger_message_id,
    ) ?? null;
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
    const executionTargets = job.project_id &&
        await channelExecutionProposalTablesAvailable(db)
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
    const delegationTargets = agent.project_id === null
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
          responsibility: agent.responsibility,
          skills: agent.skills.map(agentSkillJson),
        },
        claimToken,
        claimedAt: job.claimed_at,
        leaseExpiresAt: job.lease_expires_at,
        activity,
        handoffContext,
        session: {
          id: job.channel_reply_session.id,
          threadId: job.channel_reply_session.thread_root_message_id,
          conversationId: job.channel_reply_session.conversation_id,
          retainedUntil: job.channel_reply_session.retained_until,
          claimReason: job.session_claim_reason,
        },
        organizationContext: agent.project_id === null
          ? { snapshotAt: job.claimed_at }
          : null,
        delegation,
        delegationTargets,
        snapshot: {
          channel: {
            id: channel.id,
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
          messages: messages.map(channelReplyContextMessageJson),
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
