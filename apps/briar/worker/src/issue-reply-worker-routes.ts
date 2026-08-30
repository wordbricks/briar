import { ChannelAgentActivityPublishInput } from "../../src/lib/channel-agent-activity";
import { issueAttachmentMarkdown } from "../../src/lib/issue-markdown";
import { workLogEntryTranscriptEvent } from "./agent-worklog";
import { readLatestWorkLogForRunWithArchive } from "./agent-worklog-service";
import {
  agentSkillJson,
} from "./agent-skills";
import {
  prepareStoredAttachments,
  uploadStoredAttachments,
} from "./attachment-storage";
import { publishIssueActivity } from "./channel-activity-realtime";
import { verifyIssueActivityPublishToken } from "./channel-activity-ticket";
import { sha256 } from "./crypto-digest";
import { dashboardEventJson, dashboardRunJson } from "./dashboard-json";
import {
  agentSkillExecutionApprovalTablesAvailable,
  claimNextIssueAgentReply,
  completeIssueAgentReplyOutput,
  failIssueAgentReply,
  getClaimedIssueAgentReply,
  getHuntRunForProject,
  getProjectAgent,
  issueExecutionApprovalTablesAvailable,
  listHuntRunEvents,
  listIssueActionProposals,
  listIssueAgentSkillExecutionProposals,
  listIssueAttachments,
  listIssueExecutionProposals,
  listIssueReworkProposals,
  listRunEvidence,
  type AgentSkillExecutionProposalRow,
  type IssueExecutionProposalRow,
} from "./db";
import {
  issueReplyExecutionConfig,
  legacyAgentSkillInstructions,
} from "./agent-execution-config";
import { HttpError, json } from "./http-response";
import {
  deleteUnreferencedUploadedIssueObjects,
} from "./issue-attachment-service";
import {
  claimConversationJson,
  issueAgentReplyJson,
  issueMessageJson,
  type IssueProposalRow,
} from "./issue-conversation-json";
import { listIssueMessagesWithArchive } from "./issue-conversation-service";
import {
  readIssueReplyCompleteRequest,
  readJson,
} from "./request-readers";
import { decodeRequestSync } from "./request-schema";
import {
  issueActivityCredential,
  issueActivityFrame,
  scheduleIssueActivityClear,
  scheduleProjectRealtimePublish,
} from "./realtime-scheduling";
import {
  type AuthenticatedWorkerProject,
  requireWorkerProjectBinding,
} from "./worker-route-auth";
import { latestExecutionWorkerUpdateHandoff } from "./worker-update-repository";
import {
  executionWorkerProviders,
  leaseExpiryFrom,
  WORKER_STALE_AFTER_MS,
  workerStateAt,
} from "./workers";

const decodeChannelAgentActivityPublishInput = decodeRequestSync(
  ChannelAgentActivityPublishInput,
);

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
              skill: legacyAgentSkillInstructions(
                activeSkill,
                agent.skill_markdown,
              ),
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
            // Workers from before first-class Agent Skills ignore work.agent,
            // but retain arbitrary fields inside snapshot.run. Keep the saved
            // profile here as read-only context during a rolling upgrade.
            agentProfile: agent
              ? {
                  id: agent.id,
                  name: agent.name,
                  responsibility: agent.responsibility,
                  skill: legacyAgentSkillInstructions(
                    activeSkill,
                    agent.skill_markdown,
                  ),
                  skills: agent.skills.map(agentSkillJson),
                }
              : null,
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

export async function handleIssueReplyWorkerRoute(input: {
  request: Request;
  url: URL;
  db: D1Database;
  attachmentsBucket: R2Bucket;
  env: Env;
  context?: ExecutionContext;
}): Promise<Response | undefined> {
  const { request, url, db, attachmentsBucket, env, context } = input;


  const issueReplyActivityMatch = url.pathname.match(
    /^\/issue-reply-claims\/([0-9a-f-]+)\/activity$/u,
  );
  if (issueReplyActivityMatch && request.method === "POST") {
    const token = request.headers.get("X-Briar-Channel-Activity-Token") ?? "";
    const verified = await verifyIssueActivityPublishToken(
      env.BETTER_AUTH_SECRET,
      token,
      issueReplyActivityMatch[1],
    );
    if (!verified) {
      throw new HttpError(401, "Invalid or expired activity token");
    }
    const input = decodeChannelAgentActivityPublishInput(
      await readJson(request),
    );
    const frame = issueActivityFrame(
      {
        id: verified.replyJobId,
        project_id: verified.projectId,
        run_id: verified.runId,
        trigger_message_id: verified.triggerMessageId,
        parent_message_id: verified.parentMessageId,
        attempts: verified.attempt,
      },
      input,
    );
    await publishIssueActivity(env, verified.organizationId, frame);
    return new Response(null, { status: 204 });
  }

  const issueReplyClaimMatch = url.pathname.match(
    /^\/issue-reply-claims\/([0-9a-f-]+)\/complete$/u,
  );
  if (issueReplyClaimMatch && request.method === "POST") {
    const { input, attachments } = await readIssueReplyCompleteRequest(request);
    if (
      (input.executionProposal ||
        (input.proposedAction?.type === "request_issue_create" &&
          input.proposedAction.executeAfterCreate)) &&
      !(await issueExecutionApprovalTablesAvailable(db))
    ) {
      throw new HttpError(
        503,
        "Issue execution approval is not available during this upgrade",
        "ISSUE_EXECUTION_APPROVAL_UNAVAILABLE",
      );
    }
    if (
      input.skillExecutionProposal &&
      !(await agentSkillExecutionApprovalTablesAvailable(db))
    ) {
      throw new HttpError(
        503,
        "Agent Skill execution approval is not available during this upgrade",
        "AGENT_SKILL_EXECUTION_APPROVAL_UNAVAILABLE",
      );
    }
    const worker = await requireWorkerProjectBinding(
      db,
      request,
      input.projectId,
      input.workerId,
    );
    const claimTokenHash = await sha256(input.claimToken);
    const observedAt = new Date().toISOString();
    const job = await getClaimedIssueAgentReply(
      db,
      input.projectId,
      issueReplyClaimMatch[1],
      { workerId: worker.binding.id, claimTokenHash, observedAt },
    );
    if (!job) throw new HttpError(409, "Reply claim is no longer active");
    if (input.error) {
      const failed = await failIssueAgentReply(
        db,
        input.projectId,
        job.id,
        {
          workerId: worker.binding.id,
          claimTokenHash,
          error: input.error,
          updatedAt: observedAt,
        },
      );
      if (!failed) throw new HttpError(409, "Reply claim is no longer active");
      scheduleProjectRealtimePublish(env, db, input.projectId, context);
      scheduleIssueActivityClear(
        env,
        worker.principal.organizationId,
        failed,
        context,
      );
      return json({ agentReply: issueAgentReplyJson(failed) });
    }
    if (
      input.skillExecutionProposal &&
      (!job.skill_id || job.selected_skill_id_snapshot !== job.skill_id)
    ) {
      throw new HttpError(
        409,
        "Agent Skill execution requires the server-selected Skill",
        "ISSUE_SKILL_EXECUTION_PROPOSAL_STALE",
      );
    }

    const storedAttachments = prepareStoredAttachments(attachments, () => {
      const id = crypto.randomUUID();
      return {
        id,
        object_key: `issue-attachments/${input.projectId}/${job.run_id}/${id}`,
      };
    });
    const completedAt = new Date().toISOString();
    const replyBody = [
      input.body!,
      ...storedAttachments.map((attachment) =>
        issueAttachmentMarkdown(attachment.id, attachment.filename)
      ),
    ].filter(Boolean).join("\n\n");
    const uploadedKeys: string[] = [];
    const discardUploadedReplyAttachments = () =>
      deleteUnreferencedUploadedIssueObjects(
        db,
        attachmentsBucket,
        uploadedKeys,
      );
    let completed: Awaited<ReturnType<typeof completeIssueAgentReplyOutput>> =
      null;
    try {
      await uploadStoredAttachments(
        attachmentsBucket,
        storedAttachments,
        uploadedKeys,
        (attachment) => ({
          attachmentId: attachment.id,
          projectId: input.projectId,
          runId: job.run_id,
          messageId: job.reply_message_id,
        }),
      );
      completed = await completeIssueAgentReplyOutput(
        db,
        input.projectId,
        job.id,
        {
          workerId: worker.binding.id,
          claimTokenHash,
          completedAt,
          output: {
            body: replyBody,
            proposedAction: input.proposedAction ?? null,
            executionProposal: Boolean(input.executionProposal),
            skillExecutionProposal: Boolean(input.skillExecutionProposal),
            attachments: storedAttachments.map(
              ({ file: _file, ...attachment }) => attachment,
            ),
          },
        },
      );
    } catch (error) {
      await discardUploadedReplyAttachments().catch(() => undefined);
      throw error;
    }
    if (!completed) {
      await discardUploadedReplyAttachments().catch(() => undefined);
      throw new HttpError(409, "Reply claim is no longer active");
    }
    scheduleProjectRealtimePublish(env, db, input.projectId, context);
    scheduleIssueActivityClear(
      env,
      worker.principal.organizationId,
      completed,
      context,
    );
    const [
      messages,
      reworkProposals,
      actionProposals,
      executionProposals,
      skillExecutionProposals,
    ] =
      await Promise.all([
        listIssueMessagesWithArchive(
          db,
          env.ARCHIVES,
          input.projectId,
          job.run_id,
        ),
        listIssueReworkProposals(db, input.projectId, job.run_id),
        listIssueActionProposals(db, input.projectId, job.run_id),
        listIssueExecutionProposals(db, input.projectId, job.run_id),
        listIssueAgentSkillExecutionProposals(
          db,
          input.projectId,
          job.run_id,
        ),
      ]);
    const reply = messages.find(
      (message) => message.id === job.reply_message_id,
    ) ?? null;
    if (!reply) throw new HttpError(409, "Agent reply could not be persisted");
    const proposal: IssueProposalRow | null =
      reworkProposals.find(
        (candidate) => candidate.trigger_message_id === job.trigger_message_id,
      ) ?? actionProposals.find(
        (candidate) => candidate.trigger_message_id === job.trigger_message_id,
      ) ?? null;
    const executionProposal: IssueExecutionProposalRow | null =
      executionProposals.find(
        (candidate) => candidate.trigger_message_id === job.trigger_message_id,
      ) ?? null;
    const skillExecutionProposal: AgentSkillExecutionProposalRow | null =
      skillExecutionProposals.find(
        (candidate) => candidate.trigger_message_id === job.trigger_message_id,
      ) ?? null;
    return json({
      agentReply: issueAgentReplyJson(completed),
      message: issueMessageJson(
        reply,
        storedAttachments.map(({ file: _file, ...attachment }) => ({
          ...attachment,
          project_id: input.projectId,
          run_id: job.run_id,
          created_at: completedAt,
        })),
        proposal,
        executionProposal,
        skillExecutionProposal,
      ),
    });
  }


  return undefined;
}
