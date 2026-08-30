import {
  fromJson,
  type DescEnum,
  type DescField,
  type DescMessage,
  type JsonObject,
  type JsonValue,
} from "@bufbuild/protobuf";
import {
  Code,
  ConnectError,
  type ConnectRouter,
  type ServiceImpl,
} from "@connectrpc/connect";
import {
  IssueService,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/issue_pb";
import {
  AgentProvider,
  IssueDifficulty,
  RunStatus,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/common_pb";
import * as Predicate from "effect/Predicate";
import { agentSkillConflictMessage } from "./agent-skills";
import type { BriarAuth } from "./auth";
import {
  createIssueDependency,
  deleteIssueDependency,
  getProject,
} from "./db";
import { HttpError } from "./http-response";
import { handleIssueConversationRoute } from "./issue-conversation-routes";
import { handleIssueControlRoute } from "./issue-control-routes";
import { handleIssueCoreRoute } from "./issue-core-routes";
import { handleIssueProposalRoute } from "./issue-proposal-routes";
import { hasOrganizationCapability } from "./organization-access";
import {
  scheduleProjectAgentSessionRealtimePublish,
  scheduleProjectRealtimePublish,
} from "./realtime-scheduling";
import { RequestDecodeError, decodeRequestSync } from "./request-schema";
import { handleRunEvidenceRoute } from "./run-evidence-routes";
import { UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";
import { WorkerConflictError } from "./workers";

export type MobileConnectIssueRouteInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
  readonly env: Env;
  readonly context?: ExecutionContext;
  readonly routeHandlers?: Partial<MobileConnectIssueRouteHandlers>;
};

type LegacyRoute = "conversation" | "control" | "core" | "evidence" | "proposal";

export type MobileConnectIssueRouteHandlers = {
  readonly conversation: typeof handleIssueConversationRoute;
  readonly control: typeof handleIssueControlRoute;
  readonly core: typeof handleIssueCoreRoute;
  readonly evidence: typeof handleRunEvidenceRoute;
  readonly proposal: typeof handleIssueProposalRoute;
};

const decodeUuid = decodeRequestSync(UuidString);

const canonicalUuid = (value: string) => decodeUuid(value).toLowerCase();

const connectCodeFromHttpStatus = (status: number): Code => {
  switch (status) {
    case 400:
    case 411:
    case 422:
      return Code.InvalidArgument;
    case 401:
      return Code.Unauthenticated;
    case 403:
      return Code.PermissionDenied;
    case 404:
      return Code.NotFound;
    case 409:
    case 428:
      return Code.FailedPrecondition;
    case 410:
      return Code.OutOfRange;
    case 413:
    case 429:
      return Code.ResourceExhausted;
    case 501:
      return Code.Unimplemented;
    case 503:
      return Code.Unavailable;
    default:
      return Code.Internal;
  }
};

const toConnectError = (error: unknown): ConnectError => {
  if (error instanceof ConnectError) return error;
  if (error instanceof HttpError) {
    return new ConnectError(
      error.message,
      connectCodeFromHttpStatus(error.status),
      undefined,
      undefined,
      error,
    );
  }
  if (error instanceof RequestDecodeError) {
    return new ConnectError(
      "Invalid request",
      Code.InvalidArgument,
      undefined,
      undefined,
      error,
    );
  }
  if (error instanceof WorkerConflictError) {
    return new ConnectError(
      error.message,
      Code.FailedPrecondition,
      undefined,
      undefined,
      error,
    );
  }
  const skillConflict = agentSkillConflictMessage(error);
  if (skillConflict) {
    return new ConnectError(
      skillConflict,
      Code.FailedPrecondition,
      undefined,
      undefined,
      error,
    );
  }
  return new ConnectError(
    "Internal server error",
    Code.Internal,
    undefined,
    undefined,
    error,
  );
};

const rpc = async <A>(run: () => Promise<A>): Promise<A> => {
  try {
    return await run();
  } catch (error) {
    throw toConnectError(error);
  }
};

const enumJsonName = (descriptor: DescEnum, value: unknown): JsonValue => {
  if (typeof value === "number") return value;
  if (typeof value !== "string") {
    throw new Error(`Expected ${descriptor.typeName} to be a string`);
  }
  const normalized = value.trim().replaceAll("-", "_").toUpperCase();
  const matches = descriptor.values.filter((candidate) =>
    candidate.name === normalized || candidate.name.endsWith(`_${normalized}`)
  );
  if (matches.length !== 1) {
    throw new Error(`Unknown ${descriptor.typeName} value: ${value}`);
  }
  return matches[0].name;
};

const fieldValue = (field: DescField, value: unknown): JsonValue => {
  if (value === null) return null;
  switch (field.fieldKind) {
    case "scalar":
      if (
        typeof value === "string" || typeof value === "number" ||
        typeof value === "boolean"
      ) return value;
      throw new Error(`Invalid scalar value for ${field}`);
    case "enum":
      return enumJsonName(field.enum, value);
    case "message":
      return messageJson(field.message, value);
    case "list": {
      if (!Array.isArray(value)) throw new Error(`Expected an array for ${field}`);
      switch (field.listKind) {
        case "scalar":
          return value as JsonValue[];
        case "enum":
          return value.map((item) => enumJsonName(field.enum, item));
        case "message":
          return value.map((item) => messageJson(field.message, item));
      }
    }
    case "map": {
      if (!Predicate.isObject(value)) {
        throw new Error(`Expected an object for ${field}`);
      }
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          switch (field.mapKind) {
            case "scalar":
              return [key, item as JsonValue];
            case "enum":
              return [key, enumJsonName(field.enum, item)];
            case "message":
              return [key, messageJson(field.message, item)];
          }
        }),
      );
    }
  }
};

const sourceWithLegacyOneofs = (
  descriptor: DescMessage,
  source: { [x: PropertyKey]: unknown },
) => {
  const adapted = { ...source };
  if (descriptor.typeName === "briar.mobile.v1.IssueMessage") {
    const proposal = source.proposedAction;
    if (Predicate.isObject(proposal)) {
      switch (proposal.type) {
        case "request_issue_rework":
          adapted.reworkProposal = proposal;
          break;
        case "request_issue_update":
          adapted.updateProposal = proposal;
          break;
        case "request_issue_create":
          adapted.createProposal = proposal;
          break;
      }
    }
  }
  if (
    descriptor.typeName ===
      "briar.mobile.v1.AcceptIssueActionProposalResponse"
  ) {
    const proposal = source.proposal;
    if (Predicate.isObject(proposal)) {
      switch (proposal.type) {
        case "request_issue_update":
          adapted.update = proposal;
          break;
        case "request_issue_create":
          adapted.create = proposal;
          break;
      }
    }
  }
  return adapted;
};

function messageJson(descriptor: DescMessage, value: unknown): JsonValue {
  if (descriptor.typeName.startsWith("google.protobuf.")) {
    return value as JsonValue;
  }
  if (!Predicate.isObject(value)) {
    throw new Error(`Expected an object for ${descriptor.typeName}`);
  }
  const source = sourceWithLegacyOneofs(descriptor, value);
  const output: JsonObject = {};
  for (const field of descriptor.fields) {
    const key = [field.jsonName, field.localName, field.name].find((candidate) =>
      Object.hasOwn(source, candidate)
    );
    const requiredByContract = field.oneof === undefined && (
      ((field.fieldKind === "scalar" || field.fieldKind === "enum") &&
        field.presence === 2) ||
      (field.fieldKind === "message" && !field.proto.proto3Optional)
    );
    if (!key) {
      if (requiredByContract) {
        throw new Error(
          `Worker response omitted ${descriptor.typeName}.${field.localName}`,
        );
      }
      continue;
    }
    const fieldInput = source[key];
    if (fieldInput === undefined) continue;
    if (fieldInput === null && requiredByContract) {
      throw new Error(
        `Worker response returned null for ${descriptor.typeName}.${field.localName}`,
      );
    }
    output[field.jsonName] = fieldValue(field, fieldInput);
  }
  if (
    descriptor.typeName ===
      "briar.mobile.v1.AcceptIssueActionProposalResponse" &&
    !Object.hasOwn(output, "update") && !Object.hasOwn(output, "create")
  ) {
    throw new Error("Worker response omitted the accepted issue proposal");
  }
  return output;
}

const responseMessage = <Descriptor extends DescMessage>(
  descriptor: Descriptor,
  value: unknown,
) => fromJson(descriptor, messageJson(descriptor, value));

const providerJson = (provider: AgentProvider) => {
  switch (provider) {
    case AgentProvider.CODEX:
      return "codex";
    case AgentProvider.CLAUDE:
      return "claude";
    case AgentProvider.CURSOR:
      return "cursor";
    case AgentProvider.GROK:
      return "grok";
    case AgentProvider.AGY:
      return "agy";
    case AgentProvider.OPENCODE:
      return "opencode";
    case AgentProvider.OPENROUTER:
      return "openrouter";
    case AgentProvider.UNSPECIFIED:
      return undefined;
  }
};

const optionalProviderBody = (provider: AgentProvider): JsonObject => {
  const value = providerJson(provider);
  return value === undefined ? {} : { provider: value };
};

const requiredProviderJson = (provider: AgentProvider) => {
  const value = providerJson(provider);
  if (value === undefined) {
    throw new ConnectError("Agent provider is required", Code.InvalidArgument);
  }
  return value;
};

const runStatusJson = (status: RunStatus) => {
  switch (status) {
    case RunStatus.BACKLOG:
      return "backlog";
    case RunStatus.QUEUED:
      return "queued";
    case RunStatus.RUNNING:
      return "running";
    case RunStatus.PAUSED:
      return "paused";
    case RunStatus.BLOCKED:
      return "blocked";
    case RunStatus.FAILED:
      return "failed";
    case RunStatus.COMPLETED:
      return "completed";
    case RunStatus.CANCELLED:
      return "cancelled";
    case RunStatus.UNSPECIFIED:
      throw new ConnectError("Run status is required", Code.InvalidArgument);
  }
};

const difficultyJson = (difficulty: IssueDifficulty | undefined) => {
  switch (difficulty) {
    case IssueDifficulty.EASY:
      return "easy";
    case IssueDifficulty.NORMAL:
      return "normal";
    case IssueDifficulty.HARD:
      return "hard";
    case IssueDifficulty.UNSPECIFIED:
    case undefined:
      return null;
  }
};

const legacyRequest = (
  input: MobileConnectIssueRouteInput,
  path: string,
  method: string,
  body?: JsonObject,
) => {
  const headers = new Headers(input.request.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("connect-protocol-version");
  headers.delete("connect-timeout-ms");
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(new URL(path, input.request.url), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};

const parseLegacyResponse = async (response: Response | undefined) => {
  if (!response) {
    throw new ConnectError(
      "The RPC did not match its Worker route",
      Code.Internal,
    );
  }
  if (response.status === 204) return null;
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = Predicate.isObject(body) && typeof body.message === "string"
      ? body.message
      : `Worker route failed with status ${response.status}`;
    const code = Predicate.isObject(body) && typeof body.code === "string"
      ? body.code
      : undefined;
    throw new HttpError(response.status, message, code);
  }
  return body;
};

const callLegacyRoute = async (
  input: MobileConnectIssueRouteInput,
  route: LegacyRoute,
  path: string,
  method: string,
  body?: JsonObject,
) => {
  const request = legacyRequest(input, path, method, body);
  const url = new URL(request.url);
  switch (route) {
    case "core":
      return parseLegacyResponse(await (
        input.routeHandlers?.core ?? handleIssueCoreRoute
      )({
        request,
        url,
        auth: input.auth,
        db: input.db,
        attachmentsBucket: input.env.ATTACHMENTS,
        archivesBucket: input.env.ARCHIVES,
        context: input.context,
      }));
    case "control":
      return parseLegacyResponse(await (
        input.routeHandlers?.control ?? handleIssueControlRoute
      )({
        request,
        url,
        auth: input.auth,
        db: input.db,
        archivesBucket: input.env.ARCHIVES,
      }));
    case "proposal":
      return parseLegacyResponse(await (
        input.routeHandlers?.proposal ?? handleIssueProposalRoute
      )({
        request,
        url,
        auth: input.auth,
        db: input.db,
        attachmentsBucket: input.env.ATTACHMENTS,
        archivesBucket: input.env.ARCHIVES,
      }));
    case "conversation":
      return parseLegacyResponse(await (
        input.routeHandlers?.conversation ?? handleIssueConversationRoute
      )({
        request,
        url,
        auth: input.auth,
        db: input.db,
        attachmentsBucket: input.env.ATTACHMENTS,
        archivesBucket: input.env.ARCHIVES,
        requireRunExecutionProject: async () => {
          throw new ConnectError(
            "Binary issue attachments are not served by Connect",
            Code.Unimplemented,
          );
        },
        requireProjectAccess: async () => {
          throw new ConnectError(
            "Binary issue attachments are not served by Connect",
            Code.Unimplemented,
          );
        },
      }));
    case "evidence":
      return parseLegacyResponse(await (
        input.routeHandlers?.evidence ?? handleRunEvidenceRoute
      )({
        request,
        url,
        auth: input.auth,
        db: input.db,
        attachmentsBucket: input.env.ATTACHMENTS,
        archivesBucket: input.env.ARCHIVES,
        requireRunExecutionProject: async () => {
          throw new ConnectError(
            "Binary evidence images are not served by Connect",
            Code.Unimplemented,
          );
        },
        requireProjectAccess: async () => {
          throw new ConnectError(
            "Binary evidence images are not served by Connect",
            Code.Unimplemented,
          );
        },
      }));
  }
};

const projectPath = (projectId: string) =>
  `/projects/${canonicalUuid(projectId)}`;

const runPath = (projectId: string, runId: string) =>
  `${projectPath(projectId)}/runs/${canonicalUuid(runId)}`;

const mutated = async <A>(
  input: MobileConnectIssueRouteInput,
  projectIds: readonly string[],
  run: () => Promise<A>,
) => {
  const result = await run();
  for (const projectId of new Set(projectIds.map(canonicalUuid))) {
    scheduleProjectRealtimePublish(
      input.env,
      input.db,
      projectId,
      input.context,
    );
  }
  return result;
};

export const createMobileIssueService = (
  input: MobileConnectIssueRouteInput,
): ServiceImpl<typeof IssueService> => ({
  createIssue: (request) => rpc(async () => {
    const result = await mutated(input, [request.projectId], () =>
      callLegacyRoute(
        input,
        "core",
        `${projectPath(request.projectId)}/issues`,
        "POST",
        {
          title: request.title,
          description: request.description ?? null,
          priority: request.priority ?? null,
          difficulty: difficultyJson(request.difficulty),
          assigneeUserId: request.assigneeUserId ?? null,
          status: runStatusJson(request.status),
          preferredProvider: request.preferredProvider === undefined
            ? null
            : providerJson(request.preferredProvider) ?? null,
          preferredModel: request.preferredModel ?? null,
          preferredEffort: request.preferredEffort ?? null,
          fullAuto: request.fullAuto,
        },
      )
    );
    return responseMessage(IssueService.method.createIssue.output, result);
  }),

  updateIssue: (request) => rpc(async () => {
    const result = await mutated(input, [request.projectId], () =>
      callLegacyRoute(
        input,
        "core",
        runPath(request.projectId, request.runId),
        "PATCH",
        {
          title: request.title,
          description: request.description ?? null,
          priority: request.priority ?? null,
          difficulty: difficultyJson(request.difficulty),
          ...(request.assigneeUserId === undefined
            ? {}
            : { assigneeUserId: request.assigneeUserId }),
        },
      )
    );
    return responseMessage(IssueService.method.updateIssue.output, result);
  }),

  deleteIssue: (request) => rpc(async () => {
    await mutated(input, [request.projectId], () =>
      callLegacyRoute(
        input,
        "core",
        runPath(request.projectId, request.runId),
        "DELETE",
      )
    );
    return responseMessage(IssueService.method.deleteIssue.output, {
      deleted: true,
    });
  }),

  transferIssue: (request) => rpc(async () => {
    const targetProjectId = canonicalUuid(request.targetProjectId);
    const result = await mutated(
      input,
      [request.projectId, targetProjectId],
      () =>
        callLegacyRoute(
          input,
          "control",
          `${runPath(request.projectId, request.runId)}/transfer`,
          "POST",
          { targetProjectId },
        ),
    );
    return responseMessage(IssueService.method.transferIssue.output, result);
  }),

  setIssueSubscription: (request) => rpc(async () => {
    const result = await mutated(input, [request.projectId], () =>
      callLegacyRoute(
        input,
        "core",
        `${runPath(request.projectId, request.runId)}/subscription`,
        request.subscribed ? "PUT" : "DELETE",
      )
    );
    return responseMessage(
      IssueService.method.setIssueSubscription.output,
      result,
    );
  }),

  updateIssuePreferences: (request) => rpc(async () => {
    const result = await mutated(input, [request.projectId], () =>
      callLegacyRoute(
        input,
        "core",
        `${runPath(request.projectId, request.runId)}/preferences`,
        "PUT",
        {
          provider: request.provider === undefined
            ? null
            : providerJson(request.provider) ?? null,
          model: request.model ?? null,
          effort: request.effort ?? null,
        },
      )
    );
    return responseMessage(
      IssueService.method.updateIssuePreferences.output,
      result,
    );
  }),

  setIssueDependency: (request) => rpc(async () => {
    const projectId = canonicalUuid(request.projectId);
    const dependentRunId = canonicalUuid(request.runId);
    const prerequisiteRunId = canonicalUuid(request.prerequisiteRunId);
    const result = await mutated(input, [projectId], async () => {
      const session = await requireSession(input.auth, input.request);
      const project = await getProject(input.db, projectId, session.user.id);
      if (!project) throw new HttpError(404, "Project not found");
      if (!hasOrganizationCapability(project.member_role, "issues:write")) {
        throw new HttpError(403, "Issue editing permission required");
      }
      if (!request.enabled) {
        const deleted = await deleteIssueDependency(
          input.db,
          project.id,
          prerequisiteRunId,
          dependentRunId,
        );
        return {
          prerequisiteRunId,
          dependentRunId,
          outcome: deleted ? "removed" : "already_removed",
        };
      }
      const outcome = await createIssueDependency(input.db, project.id, {
        prerequisiteRunId,
        dependentRunId,
        createdByUserId: session.user.id,
        createdAt: new Date().toISOString(),
      });
      if (outcome === "not_found") {
        throw new HttpError(404, "Dependency issue not found");
      }
      if (outcome === "cycle") {
        throw new HttpError(409, "Dependency would create a cycle");
      }
      if (outcome === "ineligible") {
        throw new HttpError(
          409,
          "Dependencies cannot be added after an issue starts executing",
        );
      }
      return { prerequisiteRunId, dependentRunId, outcome };
    });
    return responseMessage(
      IssueService.method.setIssueDependency.output,
      result,
    );
  }),

  moveRun: (request) => rpc(async () => {
    const result = await mutated(input, [request.projectId], () =>
      callLegacyRoute(
        input,
        "control",
        `${runPath(request.projectId, request.runId)}/status`,
        "PUT",
        {
          requestId: canonicalUuid(request.requestId),
          status: runStatusJson(request.status),
          workflowStage: request.workflowStage ?? null,
        },
      )
    );
    return responseMessage(IssueService.method.moveRun.output, result);
  }),

  retryRun: (request) => rpc(async () => {
    const result = await mutated(input, [request.projectId], () =>
      callLegacyRoute(
        input,
        "control",
        `${runPath(request.projectId, request.runId)}/retry`,
        "POST",
        {
          requestId: canonicalUuid(request.requestId),
          reason: request.reason ?? null,
        },
      )
    );
    if (!Predicate.isObject(result)) {
      throw new Error("Retry response is invalid");
    }
    return responseMessage(IssueService.method.retryRun.output, {
      ...result,
      // The recovery repository returns the resulting dashboard stage. A
      // successful user retry always persists the run status as queued.
      status: "queued",
    });
  }),

  cancelRun: (request) => rpc(async () => {
    const result = await mutated(input, [request.projectId], () =>
      callLegacyRoute(
        input,
        "control",
        `${runPath(request.projectId, request.runId)}/cancel`,
        "POST",
        {
          requestId: canonicalUuid(request.requestId),
          reason: request.reason ?? null,
        },
      )
    );
    if (!Predicate.isObject(result)) {
      throw new Error("Cancellation response is invalid");
    }
    return responseMessage(IssueService.method.cancelRun.output, {
      ...result,
      // The recovery repository returns the resulting dashboard stage. A
      // successful user cancellation always persists the run as cancelled.
      status: "cancelled",
    });
  }),

  resumeRun: (request) => rpc(async () => {
    const result = await mutated(input, [request.projectId], () =>
      callLegacyRoute(
        input,
        "control",
        `${runPath(request.projectId, request.runId)}/resume`,
        "POST",
        {
          requestId: canonicalUuid(request.requestId),
          checkpointKey: request.checkpointKey,
          attempt: request.attempt,
          revision: request.revision,
        },
      )
    );
    return responseMessage(IssueService.method.resumeRun.output, result);
  }),

  dispatchRun: (request) => rpc(async () => {
    if (!request.dispatch) {
      throw new ConnectError("Dispatch input is required", Code.InvalidArgument);
    }
    const dispatch = request.dispatch;
    const result = await mutated(input, [request.projectId], () =>
      callLegacyRoute(
        input,
        "control",
        `${runPath(request.projectId, request.runId)}/dispatch`,
        "POST",
        {
          requestId: canonicalUuid(dispatch.requestId),
          agentId: dispatch.agentId
            ? canonicalUuid(dispatch.agentId)
            : null,
          ...optionalProviderBody(dispatch.provider),
          model: dispatch.model ?? null,
          effort: dispatch.effort ?? null,
          persistPreferences: dispatch.persistPreferences,
          workerId: dispatch.workerId ?? null,
        },
      )
    );
    return responseMessage(IssueService.method.dispatchRun.output, {
      dispatch: result,
    });
  }),

  reassignRun: (request) => rpc(async () => {
    if (!request.dispatch) {
      throw new ConnectError("Dispatch input is required", Code.InvalidArgument);
    }
    const dispatch = request.dispatch;
    const result = await mutated(input, [request.projectId], () =>
      callLegacyRoute(
        input,
        "control",
        `${runPath(request.projectId, request.runId)}/reassign`,
        "POST",
        {
          requestId: canonicalUuid(dispatch.requestId),
          agentId: dispatch.agentId
            ? canonicalUuid(dispatch.agentId)
            : null,
          ...optionalProviderBody(dispatch.provider),
          model: dispatch.model ?? null,
          effort: dispatch.effort ?? null,
          persistPreferences: dispatch.persistPreferences,
          workerId: dispatch.workerId ?? null,
        },
      )
    );
    return responseMessage(IssueService.method.reassignRun.output, {
      dispatch: result,
    });
  }),

  completeResultReview: (request) => rpc(async () => {
    const result = await mutated(input, [request.projectId], () =>
      callLegacyRoute(
        input,
        "core",
        `${runPath(request.projectId, request.runId)}/result-reviews`,
        "POST",
      )
    );
    return responseMessage(
      IssueService.method.completeResultReview.output,
      { review: result },
    );
  }),

  listIssueMessages: (request) => rpc(async () => {
    const result = await callLegacyRoute(
      input,
      "conversation",
      `${runPath(request.projectId, request.runId)}/messages`,
      "GET",
    );
    return responseMessage(
      IssueService.method.listIssueMessages.output,
      result,
    );
  }),

  syncIssueMessages: (request) => rpc(async () => {
    try {
      const result = await callLegacyRoute(
        input,
        "conversation",
        `${runPath(request.projectId, request.runId)}/messages/delta?cursor=${request.cursor.toString()}`,
        "GET",
      );
      return responseMessage(
        IssueService.method.syncIssueMessages.output,
        result,
      );
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 410) throw error;
      const snapshot = await callLegacyRoute(
        input,
        "conversation",
        `${runPath(request.projectId, request.runId)}/messages`,
        "GET",
      );
      if (!Predicate.isObject(snapshot)) {
        throw new Error("Issue conversation snapshot is invalid");
      }
      return responseMessage(
        IssueService.method.syncIssueMessages.output,
        {
          ...snapshot,
          hasMore: false,
          changed: true,
          reset: true,
        },
      );
    }
  }),

  createIssueMessage: (request) => rpc(async () => {
    const result = await mutated(input, [request.projectId], () =>
      callLegacyRoute(
        input,
        "conversation",
        `${runPath(request.projectId, request.runId)}/messages`,
        "POST",
        {
          clientMessageId: canonicalUuid(request.clientMessageId),
          body: request.body,
          parentMessageId: request.parentMessageId
            ? canonicalUuid(request.parentMessageId)
            : null,
          mentionedUserIds: request.mentionedUserIds,
          mentionedAgentIds: request.mentionedAgentIds.map(canonicalUuid),
          agentConversationId: request.agentConversationId ?? null,
        },
      )
    );
    return responseMessage(
      IssueService.method.createIssueMessage.output,
      result,
    );
  }),

  getIssueAgentReply: (request) => rpc(async () => {
    const result = await callLegacyRoute(
      input,
      "conversation",
      `${runPath(request.projectId, request.runId)}/messages/${canonicalUuid(request.triggerMessageId)}/agent-reply`,
      "GET",
    );
    return responseMessage(
      IssueService.method.getIssueAgentReply.output,
      result,
    );
  }),

  listRunEvidence: (request) => rpc(async () => {
    const result = await callLegacyRoute(
      input,
      "evidence",
      `${runPath(request.projectId, request.runId)}/evidence`,
      "GET",
    );
    return responseMessage(IssueService.method.listRunEvidence.output, result);
  }),

  acceptIssueReworkProposal: (request) => rpc(async () => {
    const result = await mutated(input, [request.projectId], () =>
      callLegacyRoute(
        input,
        "proposal",
        `${runPath(request.projectId, request.runId)}/rework-proposals/${canonicalUuid(request.proposalId)}/accept`,
        "POST",
      )
    );
    return responseMessage(
      IssueService.method.acceptIssueReworkProposal.output,
      result,
    );
  }),

  acceptIssueActionProposal: (request) => rpc(async () => {
    const result = await mutated(input, [request.projectId], () =>
      callLegacyRoute(
        input,
        "proposal",
        `${runPath(request.projectId, request.runId)}/issue-action-proposals/${canonicalUuid(request.proposalId)}/accept`,
        "POST",
      )
    );
    return responseMessage(
      IssueService.method.acceptIssueActionProposal.output,
      result,
    );
  }),

  acceptIssueExecutionProposal: (request) => rpc(async () => {
    if (!request.approval) {
      throw new ConnectError("Execution approval is required", Code.InvalidArgument);
    }
    const approval = request.approval;
    const result = await mutated(input, [request.projectId], () =>
      callLegacyRoute(
        input,
        "proposal",
        `${runPath(request.projectId, request.conversationRunId)}/issue-execution-proposals/${canonicalUuid(request.proposalId)}/accept`,
        "POST",
        {
          provider: requiredProviderJson(approval.provider),
          model: approval.model ?? null,
          effort: approval.effort ?? null,
          workerId: approval.workerId ?? null,
        },
      )
    );
    return responseMessage(
      IssueService.method.acceptIssueExecutionProposal.output,
      result,
    );
  }),

  acceptIssueSkillExecutionProposal: (request) => rpc(async () => {
    const result = await mutated(input, [request.projectId], () =>
      callLegacyRoute(
        input,
        "proposal",
        `${runPath(request.projectId, request.conversationRunId)}/skill-execution-proposals/${canonicalUuid(request.proposalId)}/accept`,
        "POST",
        { workerId: request.workerId ?? null },
      )
    );
    if (
      Predicate.isObject(result) && result.session !== null &&
      result.session !== undefined
    ) {
      scheduleProjectAgentSessionRealtimePublish(
        input.env,
        input.db,
        canonicalUuid(request.projectId),
        input.context,
      );
    }
    return responseMessage(
      IssueService.method.acceptIssueSkillExecutionProposal.output,
      result,
    );
  }),
});

export function registerMobileIssueService(
  router: ConnectRouter,
  input: MobileConnectIssueRouteInput,
) {
  router.service(IssueService, createMobileIssueService(input));
}

export { IssueService };
