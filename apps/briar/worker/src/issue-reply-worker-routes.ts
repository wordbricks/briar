import { workLogEntryTranscriptEvent } from "./agent-worklog";
import { readLatestWorkLogForRunWithArchive } from "./agent-worklog-service";
import {
  agentSkillJson,
} from "./agent-skills";
import { sha256 } from "./crypto-digest";
import { dashboardEventJson, dashboardRunJson } from "./dashboard-json";
import {
  claimNextIssueAgentReply,
  getHuntRunForProject,
  getProjectAgent,
  listHuntRunEvents,
  listIssueAttachments,
  listRunEvidence,
} from "./db";
import { issueReplyExecutionConfig } from "./agent-execution-config";
import { HttpError } from "./http-response";
import { claimConversationJson } from "./issue-conversation-json";
import { listIssueMessagesWithArchive } from "./issue-conversation-service";
import {
  issueActivityCredential,
  scheduleProjectRealtimePublish,
} from "./realtime-scheduling";
import { type AuthenticatedWorkerProject } from "./worker-route-auth";
import { latestExecutionWorkerUpdateHandoff } from "./worker-update-repository";
import {
  executionWorkerProviders,
  leaseExpiryFrom,
  WORKER_STALE_AFTER_MS,
  workerStateAt,
} from "./workers";

export async function claimNextIssueReplyWork(input: {
  projectId: string;
  db: D1Database;
  env: Env;
  context?: ExecutionContext;
  authenticatedWorker: AuthenticatedWorkerProject;
}) {
  const {
    db,
    env,
    context,
    authenticatedWorker,
  } = input;
    const observedAt = new Date().toISOString();
    if (
      workerStateAt(
        authenticatedWorker.binding.last_heartbeat_at,
        observedAt,
        authenticatedWorker.binding.state,
      ) !== "online" ||
      authenticatedWorker.binding.accepting_work !== 1 ||
      authenticatedWorker.binding.readiness_state === "needs_attention"
    ) {
      throw new HttpError(409, "Worker is not ready to claim replies");
    }
    const providers = executionWorkerProviders(authenticatedWorker.binding);
    const defaultProvider = providers.includes(
      authenticatedWorker.binding.agent_provider,
    )
      ? authenticatedWorker.binding.agent_provider
      : providers[0];
    if (!defaultProvider) {
      throw new HttpError(409, "Worker has no available reply provider");
    }
    const claimToken = `briar_reply_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const job = await claimNextIssueAgentReply(db, input.projectId, {
      workerId: authenticatedWorker.binding.id,
      agentProvider: defaultProvider,
      agentProviders: providers,
      claimTokenHash: await sha256(claimToken),
      claimedAt: observedAt,
      leaseExpiresAt: leaseExpiryFrom(observedAt),
      staleBefore: new Date(
        Date.parse(observedAt) - WORKER_STALE_AFTER_MS,
      ).toISOString(),
    });
    if (!job) return null;
    scheduleProjectRealtimePublish(env, db, input.projectId, context);

    const [run, events, attachments, messages, evidence, transcript] =
      await Promise.all([
        getHuntRunForProject(db, input.projectId, job.run_id),
        listHuntRunEvents(db, input.projectId, job.run_id),
        listIssueAttachments(db, input.projectId, job.run_id),
        listIssueMessagesWithArchive(
          db,
          env.ARCHIVES,
          input.projectId,
          job.run_id,
        ),
        listRunEvidence(db, input.projectId, job.run_id),
        readLatestWorkLogForRunWithArchive(
          db,
          env.ARCHIVES,
          input.projectId,
          job.run_id,
          200,
        ),
      ]);
    if (!run || !job.agent_provider) {
      throw new HttpError(409, "Reply job lost its issue context");
    }
    const liveAgent = job.agent_id
      ? await getProjectAgent(db, input.projectId, job.agent_id)
      : run.agent_id
        ? await getProjectAgent(db, input.projectId, run.agent_id)
        : null;
    if (job.agent_id && !liveAgent) {
      throw new HttpError(409, "Reply job lost its Project Agent");
    }
    const triggerMessage = messages.find(
      (message) => message.id === job.trigger_message_id,
    ) ?? null;
    const selectedSkillId = job.skill_id ?? null;
    const selectedSkillSnapshotId = job.selected_skill_id_snapshot ?? null;
    const liveSelectedSkill = selectedSkillId && liveAgent
      ? liveAgent.skills.find((skill) => skill.id === selectedSkillId) ?? null
      : null;
    if (
      selectedSkillSnapshotId !== selectedSkillId ||
      (selectedSkillId !== null && (
        !liveSelectedSkill || !triggerMessage ||
        !job.selected_agent_name_snapshot ||
        !job.selected_agent_responsibility_snapshot ||
        !job.selected_skill_name_snapshot ||
        job.selected_skill_instructions_snapshot == null ||
        !job.selected_skill_provider_snapshot ||
        !job.skill_execution_request_snapshot ||
        job.skill_execution_request_snapshot !== triggerMessage.body
      ))
    ) {
      throw new HttpError(409, "Reply job lost its selected Agent Skill");
    }
    const selectedSkill = liveSelectedSkill
      ? {
          ...liveSelectedSkill,
          name: job.selected_skill_name_snapshot!,
          body: job.selected_skill_instructions_snapshot!,
          provider: job.selected_skill_provider_snapshot!,
          model: job.selected_skill_model_snapshot ?? null,
          effort: job.selected_skill_effort_snapshot ?? null,
        }
      : null;
    const agent = liveAgent
      ? {
          ...liveAgent,
          name: job.agent_name_snapshot ?? liveAgent.name,
          responsibility:
            job.agent_responsibility_snapshot ?? liveAgent.responsibility,
          skills: selectedSkill
            ? liveAgent.skills.map((skill) =>
                skill.id === selectedSkill.id ? selectedSkill : skill
              )
            : liveAgent.skills,
        }
      : null;
    const activeSkill = selectedSkill;
    const replyExecution = issueReplyExecutionConfig({
      provider: job.agent_provider,
      preferred: {
        provider: run.preferred_agent_provider,
        model: run.preferred_agent_model,
        effort: run.preferred_agent_effort,
      },
      requested: {
        provider: run.requested_agent_provider,
        model: run.requested_agent_model,
        effort: run.requested_agent_effort,
      },
      activeSkill,
      agent,
      prioritizeAgent: job.agent_id !== null,
    });
    const handoffContext = await latestExecutionWorkerUpdateHandoff(db, {
      deviceId: authenticatedWorker.principal.deviceId,
      workType: "issueReply",
      workId: job.id,
    });
    return {
        workType: "issueReply" as const,
        workId: job.id,
        runId: run.id,
        sourceKey: `${run.source_key}:reply:${job.trigger_message_id}`,
        title: run.title,
        triggerMessageId: job.trigger_message_id,
        parentMessageId: job.parent_message_id,
        provider: job.agent_provider,
        model: replyExecution.model,
        effort: replyExecution.effort,
        activeSkill: activeSkill ? agentSkillJson(activeSkill) : null,
        handoffContext,
        skillExecutionTarget: selectedSkill && agent && triggerMessage
          ? {
              projectId: input.projectId,
              agentId: agent.id,
              skillId: selectedSkill.id,
              skillName: selectedSkill.name,
              request: job.skill_execution_request_snapshot!,
              executionMode: selectedSkill.execution_mode,
              approvalPolicy: selectedSkill.approval_policy,
              approved: false,
            }
          : null,
        agent: agent
          ? {
              id: agent.id,
              name: agent.name,
              provider: job.agent_provider,
              model: replyExecution.model,
              effort: replyExecution.effort,
              responsibility: agent.responsibility,
              skills: agent.skills.map(agentSkillJson),
            }
          : null,
        branch: run.branch,
        requiresPreferredWorker: job.requires_preferred_worker === 1,
        claimToken,
        claimedAt: job.claimed_at,
        leaseExpiresAt: job.lease_expires_at,
        activity: env.CHANNEL_ACTIVITY_REALTIME
          ? await issueActivityCredential(
              env,
              authenticatedWorker.principal.organizationId,
              job,
              {
                workerId: authenticatedWorker.binding.id,
                deviceId: authenticatedWorker.principal.deviceId,
              },
            )
          : null,
        snapshot: {
          run: {
            ...dashboardRunJson(run, attachments),
            events: events.map((event) => dashboardEventJson(event)),
          },
          messages: claimConversationJson(messages, attachments),
          agentTranscript:
            transcript?.entries
              .filter((entry) =>
                entry.entry_type === "message" && entry.status !== "writing"
              )
              .map((entry) => ({
                sequence: entry.sequence,
                message: {
                  type: "event",
                  event: workLogEntryTranscriptEvent(entry),
                },
                recordedAt: entry.updated_at,
              })) ?? [],
          evidence: (evidence ?? []).map((item) => ({
            stage: item.workflow_stage,
            type: item.evidence_type,
            status: item.status,
            detail: item.detail,
            command: item.command,
            url: item.url,
            metadata: item.metadata_json
              ? JSON.parse(item.metadata_json)
              : null,
            observedAt: item.observed_at,
          })),
        },
    };
}
