import { create } from "@bufbuild/protobuf";
import {
  AgentChannelListResponseSchema,
  AgentChannelPostResponseSchema,
  AgentChannelReadResponseSchema,
  AgentIssueCreateResponseSchema,
  AgentIssueListResponseSchema,
  AgentIssueNoteResponseSchema,
  AgentIssueSetStatusResponseSchema,
  AgentIssueShowResponseSchema,
  AgentIssueUpdateResponseSchema,
  type AgentChannelListRequest,
  type AgentChannelPostRequest,
  type AgentChannelReadRequest,
  type AgentIssueCreateRequest,
  type AgentIssueListRequest,
  type AgentIssueNoteRequest,
  type AgentIssueSetStatusRequest,
  type AgentIssueShowRequest,
  type AgentIssueUpdateRequest,
  type AgentWorkspaceClaim,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { agentProviderFromProto } from "../../src/lib/agent-provider-proto";
import {
  listAgentChannels,
  postAgentChannelMessage,
  readAgentChannel,
  type AgentChannelSummary,
} from "./agent-workspace-tools/channels";
import { resolveAgentWorkspaceScope, type AgentWorkspaceWorkKind } from "./agent-workspace-tools/claim";
import { toolError } from "./agent-workspace-tools/errors";
import {
  createAgentIssue,
  listAgentIssues,
  noteAgentIssue,
  setAgentIssueStatus,
  showAgentIssue,
  updateAgentIssue,
  type AgentIssueSummary,
} from "./agent-workspace-tools/issues";
import { scheduleChannelRealtimePublish, scheduleProjectRealtimePublish } from "./realtime-scheduling";
import type { requireWorkerProjectBinding } from "./worker-route-auth";

/**
 * Connect handlers for `tools issue …` / `tools channel …`
 * (docs/plans/agent-workspace-tools.md). Requests are rebuilt into plain
 * objects field by field; protobuf messages never reach domain code.
 */
export type AgentWorkspaceConnectInput = {
  readonly request: Request;
  readonly db: D1Database;
  readonly env: Env;
  readonly context?: ExecutionContext;
};

export type AgentWorkspaceConnectServices = {
  readonly requireWorkerProjectBinding: typeof requireWorkerProjectBinding;
};

const workKind = (value: string | undefined): AgentWorkspaceWorkKind | null =>
  value === "issue" || value === "issueReply" || value === "channelReply" || value === "projectAgentTask"
    ? value
    : null;

async function scope(
  input: AgentWorkspaceConnectInput,
  claim: AgentWorkspaceClaim | undefined,
  services: AgentWorkspaceConnectServices,
) {
  const work = claim?.work;
  const kind = workKind(work?.work.case);
  if (!claim || !work || !kind || !work.workId || !work.runId || !work.claimToken) {
    throw toolError("claim_inactive", "Workspace tools require an active issue, reply or Agent task claim");
  }
  let provider: ReturnType<typeof agentProviderFromProto>;
  try {
    provider = agentProviderFromProto(claim.agentProvider);
  } catch {
    throw toolError("invalid_request", "The claim names no known agent provider");
  }
  const worker = await services.requireWorkerProjectBinding(input.db, input.request, claim.projectId, claim.workerId);
  return resolveAgentWorkspaceScope(input.db, {
    claim: {
      kind,
      workId: work.workId,
      runId: work.runId,
      claimToken: work.claimToken,
      workspaceId: work.work.case === "channelReply" ? work.work.value.workspaceId : null,
    },
    worker: {
      workspaceId: worker.principal.workspaceId,
      deviceId: worker.principal.deviceId,
      workerId: worker.binding.id,
      projectId: claim.projectId,
    },
    provider,
    observedAt: new Date().toISOString(),
  });
}

const issueMessage = (issue: AgentIssueSummary) => ({
  id: issue.id,
  key: issue.key,
  title: issue.title,
  status: issue.status,
  paused: issue.paused,
  priority: issue.priority ?? undefined,
  updatedAt: issue.updatedAt,
});

const channelMessage = (channel: AgentChannelSummary) => ({
  id: channel.id,
  name: channel.name,
  topic: channel.topic ?? undefined,
  current: channel.current,
});

const publishTeam = (input: AgentWorkspaceConnectInput, teamId: string) =>
  scheduleProjectRealtimePublish(input.env, input.db, teamId, input.context);

export async function agentIssueListRpc(input: AgentWorkspaceConnectInput, request: AgentIssueListRequest,
  services: AgentWorkspaceConnectServices) {
  const result = await listAgentIssues(input.db, await scope(input, request.claim, services), {
    statuses: [...request.statuses],
    text: request.text ?? null,
    cursor: request.cursor ?? null,
    limit: request.limit ?? null,
  });
  return create(AgentIssueListResponseSchema, {
    issues: result.issues.map(issueMessage),
    nextCursor: result.nextCursor ?? undefined,
  });
}

export async function agentIssueShowRpc(input: AgentWorkspaceConnectInput, request: AgentIssueShowRequest,
  services: AgentWorkspaceConnectServices) {
  const result = await showAgentIssue(input.db, await scope(input, request.claim, services), request.issue);
  return create(AgentIssueShowResponseSchema, {
    issue: issueMessage(result.issue),
    description: result.description ?? undefined,
    workflowStage: result.workflowStage ?? undefined,
    resultSummary: result.resultSummary ?? undefined,
    parentKey: result.parentKey ?? undefined,
    notes: result.notes.map((note) => ({
      id: note.id,
      parentMessageId: note.parentMessageId ?? undefined,
      authorName: note.authorName,
      authorIsAgent: note.authorIsAgent,
      body: note.body,
      createdAt: note.createdAt,
    })),
    notesTruncated: result.notesTruncated,
    pendingExecutionApprovalId: result.pendingExecutionApprovalId ?? undefined,
  });
}

export async function agentIssueCreateRpc(input: AgentWorkspaceConnectInput, request: AgentIssueCreateRequest,
  services: AgentWorkspaceConnectServices) {
  const resolved = await scope(input, request.claim, services);
  const result = await createAgentIssue(input.db, resolved, {
    requestKey: request.requestKey,
    title: request.title,
    description: request.description ?? null,
    priority: request.priority ?? null,
    parent: request.parent ?? null,
    requestExecution: request.requestExecution,
  });
  publishTeam(input, resolved.teamId);
  return create(AgentIssueCreateResponseSchema, {
    issue: issueMessage(result.issue),
    executionApprovalId: result.executionApprovalId ?? undefined,
    replayed: result.replayed,
  });
}

export async function agentIssueNoteRpc(input: AgentWorkspaceConnectInput, request: AgentIssueNoteRequest,
  services: AgentWorkspaceConnectServices) {
  const resolved = await scope(input, request.claim, services);
  const result = await noteAgentIssue(input.db, resolved, {
    requestKey: request.requestKey,
    issue: request.issue,
    body: request.body,
  });
  publishTeam(input, resolved.teamId);
  return create(AgentIssueNoteResponseSchema, {
    messageId: result.messageId,
    issue: issueMessage(result.issue),
    replayed: result.replayed,
  });
}

export async function agentIssueSetStatusRpc(input: AgentWorkspaceConnectInput, request: AgentIssueSetStatusRequest,
  services: AgentWorkspaceConnectServices) {
  const resolved = await scope(input, request.claim, services);
  const result = await setAgentIssueStatus(input.db, resolved, {
    requestKey: request.requestKey,
    issue: request.issue,
    status: request.status,
    reason: request.reason ?? null,
  });
  publishTeam(input, resolved.teamId);
  return create(AgentIssueSetStatusResponseSchema, {
    issue: issueMessage(result.issue),
    outcome: result.outcome,
    executionApprovalId: result.executionApprovalId ?? undefined,
    replayed: result.replayed,
  });
}

export async function agentIssueUpdateRpc(input: AgentWorkspaceConnectInput, request: AgentIssueUpdateRequest,
  services: AgentWorkspaceConnectServices) {
  const resolved = await scope(input, request.claim, services);
  const result = await updateAgentIssue(input.db, resolved, {
    requestKey: request.requestKey,
    issue: request.issue,
    title: request.title ?? null,
    description: request.description ?? null,
    priority: request.priority ?? null,
  });
  publishTeam(input, resolved.teamId);
  return create(AgentIssueUpdateResponseSchema, { issue: issueMessage(result.issue), replayed: result.replayed });
}

export async function agentChannelListRpc(input: AgentWorkspaceConnectInput, request: AgentChannelListRequest,
  services: AgentWorkspaceConnectServices) {
  const result = await listAgentChannels(input.db, await scope(input, request.claim, services));
  return create(AgentChannelListResponseSchema, { channels: result.channels.map(channelMessage) });
}

export async function agentChannelReadRpc(input: AgentWorkspaceConnectInput, request: AgentChannelReadRequest,
  services: AgentWorkspaceConnectServices) {
  const result = await readAgentChannel(input.db, await scope(input, request.claim, services), {
    channel: request.channel,
    thread: request.thread ?? null,
    cursor: request.cursor ?? null,
    limit: request.limit ?? null,
  });
  return create(AgentChannelReadResponseSchema, {
    channel: channelMessage(result.channel),
    messages: result.messages.map((message) => ({
      id: message.id,
      parentMessageId: message.parentMessageId ?? undefined,
      authorName: message.authorName,
      authorIsAgent: message.authorIsAgent,
      body: message.body,
      createdAt: message.createdAt,
    })),
    nextCursor: result.nextCursor ?? undefined,
  });
}

export async function agentChannelPostRpc(input: AgentWorkspaceConnectInput, request: AgentChannelPostRequest,
  services: AgentWorkspaceConnectServices) {
  const resolved = await scope(input, request.claim, services);
  const result = await postAgentChannelMessage(input.db, resolved, {
    requestKey: request.requestKey,
    channel: request.channel,
    thread: request.thread ?? null,
    body: request.body,
  });
  scheduleChannelRealtimePublish(input.env, input.db, resolved.organizationId, input.context);
  return create(AgentChannelPostResponseSchema, {
    messageId: result.messageId,
    channel: channelMessage(result.channel),
    replayed: result.replayed,
  });
}
