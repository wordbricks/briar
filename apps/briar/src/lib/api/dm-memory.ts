import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import {
  DmMemoryClass as ProtoDmMemoryClass,
  type DmMemoryDocument as DmMemoryDocumentMessage,
  DmMemoryDocumentKind as ProtoDmMemoryDocumentKind,
  DmMemoryDocumentStatus as ProtoDmMemoryDocumentStatus,
  DmMemoryEvidenceType as ProtoDmMemoryEvidenceType,
  DmMemoryIndexState as ProtoDmMemoryIndexState,
  DmMemoryLearningFailureCode as ProtoDmMemoryLearningFailureCode,
  DmMemoryLearningJobKind as ProtoDmMemoryLearningJobKind,
  DmMemoryLearningJobStage as ProtoDmMemoryLearningJobStage,
  DmMemoryLearningJobStatus as ProtoDmMemoryLearningJobStatus,
  type DmMemoryLearningStatus as DmMemoryLearningStatusMessage,
  DmMemoryService,
  DmMemoryRevisionOrigin as ProtoDmMemoryRevisionOrigin,
  DmMemorySourceType as ProtoDmMemorySourceType,
  type DmMemorySpace as DmMemorySpaceMessage,
  DmMemorySpaceStatus as ProtoDmMemorySpaceStatus,
} from "@briar/contracts/gen/briar/app/v1/dm_memory_pb";
import { briarApiUrl } from "../api-config";
import type {
  DmMemoryClass,
  DmMemoryCreateInput,
  DmMemoryDocument,
  DmMemoryDocumentDetail,
  DmMemoryEditInput,
  DmMemoryLearningStatus,
  DmMemoryPage,
  DmMemoryRevisionPage,
  DmMemorySettingsInput,
  DmMemorySpace,
} from "../dm-memory-contract";
import {
  appCallOptions,
  appTransport,
} from "../app-rpc/core";
import {
  optionalTimestamp,
  requiredMessage,
  requiredTimestamp,
  safeNumber,
} from "../app-rpc/mappers";
import { ApiError } from "./errors";
import { withSessionCredential } from "../session-credential";

const client = appTransport
  ? createClient(DmMemoryService, appTransport)
  : undefined;

const requireClient = () => {
  if (!client) throw new Error("Briar API URL이 설정되지 않았습니다.");
  return client;
};

const base = (organizationId: string, channelId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/channels/${encodeURIComponent(channelId)}/memory`;

export type DmMemoryApiScope = {
  token: string;
  organizationId: string;
  channelId: string;
};

const memoryClassFromProto = (value: ProtoDmMemoryClass): DmMemoryClass => {
  switch (value) {
    case ProtoDmMemoryClass.PROFILE: return "profile";
    case ProtoDmMemoryClass.LOG: return "log";
    case ProtoDmMemoryClass.NOTE: return "note";
    default: throw new Error(`Unknown memory class: ${value}`);
  }
};

const memoryClassToProto = (value: DmMemoryClass): ProtoDmMemoryClass => {
  switch (value) {
    case "profile": return ProtoDmMemoryClass.PROFILE;
    case "log": return ProtoDmMemoryClass.LOG;
    case "note": return ProtoDmMemoryClass.NOTE;
  }
};

const spaceFromProto = (space: DmMemorySpaceMessage): DmMemorySpace => ({
  id: space.id,
  channelId: space.channelId,
  agentId: space.agentId,
  rosterEpoch: safeNumber(space.rosterEpoch, "dmMemorySpace.rosterEpoch"),
  status: space.status === ProtoDmMemorySpaceStatus.ACTIVE
    ? "active"
    : space.status === ProtoDmMemorySpaceStatus.CLOSED
    ? "closed"
    : (() => { throw new Error(`Unknown memory space status: ${space.status}`); })(),
  useEnabled: space.useEnabled,
  autoEnabled: space.autoEnabled,
  memoryRevision: safeNumber(
    space.memoryRevision,
    "dmMemorySpace.memoryRevision",
  ),
  revocationEpoch: safeNumber(
    space.revocationEpoch,
    "dmMemorySpace.revocationEpoch",
  ),
  createdAt: requiredTimestamp(space.createdAt, "dmMemorySpace.createdAt"),
  updatedAt: requiredTimestamp(space.updatedAt, "dmMemorySpace.updatedAt"),
});

const documentBaseFromProto = (
  document: DmMemoryDocumentMessage,
): DmMemoryDocument => ({
  id: document.id,
  memorySpaceId: document.memorySpaceId,
  kind: document.kind === ProtoDmMemoryDocumentKind.OBSERVATION
    ? "observation"
    : document.kind === ProtoDmMemoryDocumentKind.TOPIC
    ? "topic"
    : (() => { throw new Error(`Unknown memory document kind: ${document.kind}`); })(),
  title: document.title,
  version: document.version,
  status: (() => {
    switch (document.status) {
      case ProtoDmMemoryDocumentStatus.ACTIVE: return "active" as const;
      case ProtoDmMemoryDocumentStatus.INVALIDATED: return "invalidated" as const;
      case ProtoDmMemoryDocumentStatus.SUPERSEDED: return "superseded" as const;
      default: throw new Error(`Unknown memory document status: ${document.status}`);
    }
  })(),
  conflicted: document.conflicted,
  memoryClass: memoryClassFromProto(document.memoryClass),
  evidenceType: document.evidenceType === ProtoDmMemoryEvidenceType.EXPLICIT_USER
    ? "explicit_user"
    : document.evidenceType === ProtoDmMemoryEvidenceType.OBSERVED
    ? "observed"
    : (() => { throw new Error(`Unknown memory evidence type: ${document.evidenceType}`); })(),
  protectedByUser: document.protectedByUser,
  sourceLanguage: document.sourceLanguage,
  observedAt: optionalTimestamp(document.observedAt),
  validUntil: optionalTimestamp(document.validUntil),
  createdAt: requiredTimestamp(document.createdAt, "dmMemoryDocument.createdAt"),
  updatedAt: requiredTimestamp(document.updatedAt, "dmMemoryDocument.updatedAt"),
  indexState: (() => {
    switch (document.indexState) {
      case ProtoDmMemoryIndexState.PENDING: return "pending" as const;
      case ProtoDmMemoryIndexState.READY: return "ready" as const;
      case ProtoDmMemoryIndexState.FAILED: return "failed" as const;
      default: throw new Error(`Unknown memory index state: ${document.indexState}`);
    }
  })(),
});

const documentDetailFromProto = (
  document: DmMemoryDocumentMessage,
): DmMemoryDocumentDetail => ({
  ...documentBaseFromProto(document),
  body: document.body ?? (() => { throw new Error("dmMemoryDocument.body is missing"); })(),
  sources: document.sources.map((source) => ({
    type: source.type === ProtoDmMemorySourceType.MESSAGE
      ? "message"
      : source.type === ProtoDmMemorySourceType.USER_EDIT_EVENT
      ? "user_edit_event"
      : (() => { throw new Error(`Unknown memory source type: ${source.type}`); })(),
    id: source.id,
    version: source.version,
  })),
});

const optionalInputTimestamp = (value: string | null) => value === null
  ? undefined
  : timestampFromDate(new Date(value));

const writeInput = (input: DmMemoryCreateInput | DmMemoryEditInput) => ({
  requestId: input.requestId,
  memorySpaceId: input.memorySpaceId,
  title: input.title,
  body: input.body,
  memoryClass: memoryClassToProto(input.memoryClass),
  sourceLanguage: input.sourceLanguage,
  observedAt: optionalInputTimestamp(input.observedAt),
  validUntil: optionalInputTimestamp(input.validUntil),
  sourceMessage: input.sourceMessage,
});

const learningModelFromProto = (
  value: { readonly transport: string; readonly model: string; readonly provider: string },
) => ({
  transport: value.transport === "agent"
    ? "agent" as const
    : value.transport === "openrouter" || value.transport === ""
    ? "openrouter" as const
    : (() => { throw new Error(`Unknown DM memory learning transport: ${value.transport}`); })(),
  model: value.model,
  provider: value.provider,
});

const learningStatusFromProto = (
  value: DmMemoryLearningStatusMessage,
): DmMemoryLearningStatus => {
  const configuration = value.configuration;
  const last = value.lastJob;
  return {
    configuration: configuration === undefined
      ? null
      : {
          proposer: learningModelFromProto(requiredMessage(
            configuration.proposer,
            "dmMemoryLearning.configuration.proposer",
          )),
          verifier: learningModelFromProto(requiredMessage(
            configuration.verifier,
            "dmMemoryLearning.configuration.verifier",
          )),
          costTracked: configuration.costTracked,
          spaceDailyCalls: configuration.spaceDailyCalls,
          spaceDailyMicroUsd: safeNumber(
            configuration.spaceDailyMicroUsd,
            "dmMemoryLearning.configuration.spaceDailyMicroUsd",
          ),
        },
    callsToday: value.callsToday,
    reservedMicroUsdToday: safeNumber(
      value.reservedMicroUsdToday,
      "dmMemoryLearning.reservedMicroUsdToday",
    ),
    pendingJobs: value.pendingJobs,
    failedJobs: value.failedJobs,
    retryableJob: value.retryableJob ?? null,
    lastJob: last === undefined
      ? null
      : {
          id: last.id,
          kind: (() => {
            switch (last.kind) {
              case ProtoDmMemoryLearningJobKind.EXTRACT: return "extract" as const;
              case ProtoDmMemoryLearningJobKind.EXPLICIT_REQUEST: return "explicit_request" as const;
              case ProtoDmMemoryLearningJobKind.CONSOLIDATE: return "consolidate" as const;
              default: throw new Error(`Unknown memory learning job kind: ${last.kind}`);
            }
          })(),
          status: (() => {
            switch (last.status) {
              case ProtoDmMemoryLearningJobStatus.PENDING: return "pending" as const;
              case ProtoDmMemoryLearningJobStatus.RUNNING: return "running" as const;
              case ProtoDmMemoryLearningJobStatus.RETRY_WAIT: return "retry_wait" as const;
              case ProtoDmMemoryLearningJobStatus.FAILED: return "failed" as const;
              case ProtoDmMemoryLearningJobStatus.CANCELLED: return "cancelled" as const;
              case ProtoDmMemoryLearningJobStatus.SUCCEEDED: return "succeeded" as const;
              case ProtoDmMemoryLearningJobStatus.NO_CHANGE: return "no_change" as const;
              default: throw new Error(`Unknown memory learning job status: ${last.status}`);
            }
          })(),
          stage: (() => {
            switch (last.stage) {
              case undefined: return null;
              case ProtoDmMemoryLearningJobStage.PROPOSING: return "proposing" as const;
              case ProtoDmMemoryLearningJobStage.VERIFYING: return "verifying" as const;
              case ProtoDmMemoryLearningJobStage.COMMITTING: return "committing" as const;
              default: throw new Error(`Unknown memory learning job stage: ${last.stage}`);
            }
          })(),
          errorCode: (() => {
            switch (last.errorCode) {
              case undefined: return null;
              case ProtoDmMemoryLearningFailureCode.INVALID_PROPOSAL: return "invalid_proposal" as const;
              case ProtoDmMemoryLearningFailureCode.VERIFICATION_REJECTED: return "verification_rejected" as const;
              case ProtoDmMemoryLearningFailureCode.STALE: return "stale" as const;
              case ProtoDmMemoryLearningFailureCode.SCOPE_REVOKED: return "scope_revoked" as const;
              case ProtoDmMemoryLearningFailureCode.BUDGET_EXHAUSTED: return "budget_exhausted" as const;
              case ProtoDmMemoryLearningFailureCode.MODEL_UNAVAILABLE: return "model_unavailable" as const;
              case ProtoDmMemoryLearningFailureCode.MODEL_TIMEOUT: return "model_timeout" as const;
              case ProtoDmMemoryLearningFailureCode.MODEL_CREDENTIALS: return "model_credentials" as const;
              case ProtoDmMemoryLearningFailureCode.MODEL_CONFIGURATION: return "model_configuration" as const;
              case ProtoDmMemoryLearningFailureCode.INPUT_CAPACITY: return "input_capacity" as const;
              default: throw new Error(`Unknown memory learning failure: ${last.errorCode}`);
            }
          })(),
          updatedAt: requiredTimestamp(last.updatedAt, "dmMemoryLearning.lastJob.updatedAt"),
        },
  };
};

export async function loadDmMemory(
  scope: DmMemoryApiScope,
  spaceId?: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<DmMemoryPage> {
  const response = await requireClient().listDmMemories({
    organizationId: scope.organizationId,
    channelId: scope.channelId,
    memorySpaceId: spaceId,
    cursor,
  }, appCallOptions(scope.token, signal));
  return {
    eligible: response.eligible,
    capabilities: requiredMessage(
      response.capabilities,
      "listDmMemories.capabilities",
    ),
    spaces: response.spaces.map(spaceFromProto),
    selectedSpaceId: response.selectedSpaceId ?? null,
    documents: response.documents.map(documentBaseFromProto),
    nextCursor: response.nextCursor ?? null,
    learning: response.learning
      ? learningStatusFromProto(response.learning)
      : null,
  };
}

export async function loadDmMemoryDocument(
  scope: DmMemoryApiScope,
  documentId: string,
  signal?: AbortSignal,
  version?: number,
): Promise<DmMemoryDocumentDetail> {
  const response = await requireClient().getDmMemoryDocument({
    organizationId: scope.organizationId,
    channelId: scope.channelId,
    documentId,
    version,
  }, appCallOptions(scope.token, signal));
  return documentDetailFromProto(requiredMessage(
    response.document,
    "getDmMemoryDocument.document",
  ));
}

const revisionOriginFromProto = (value: ProtoDmMemoryRevisionOrigin) => {
  switch (value) {
    case ProtoDmMemoryRevisionOrigin.USER_EDIT: return "user_edit" as const;
    case ProtoDmMemoryRevisionOrigin.EXPLICIT_REQUEST:
      return "explicit_request" as const;
    case ProtoDmMemoryRevisionOrigin.EXTRACT: return "extract" as const;
    case ProtoDmMemoryRevisionOrigin.CONSOLIDATE: return "consolidate" as const;
    default: throw new Error(`Unknown memory revision origin: ${value}`);
  }
};

export async function loadDmMemoryHistory(
  scope: DmMemoryApiScope,
  documentId: string,
  cursor?: number,
  signal?: AbortSignal,
): Promise<DmMemoryRevisionPage> {
  const response = await requireClient().listDmMemoryRevisions({
    organizationId: scope.organizationId,
    channelId: scope.channelId,
    documentId,
    cursor,
  }, appCallOptions(scope.token, signal));
  return {
    documentId: response.documentId,
    currentVersion: response.currentVersion,
    revisions: response.revisions.map((revision) => ({
      version: revision.version,
      createdAt: requiredTimestamp(revision.createdAt, "dmMemoryRevision.createdAt"),
      memoryClass: memoryClassFromProto(revision.memoryClass),
      protectedByUser: revision.protectedByUser,
      validUntil: optionalTimestamp(revision.validUntil),
      origin: revisionOriginFromProto(revision.origin),
    })),
    nextCursor: response.nextCursor ?? null,
  };
}

export async function saveDmMemoryDocument(
  scope: DmMemoryApiScope,
  input: DmMemoryCreateInput | DmMemoryEditInput,
  documentId?: string,
) {
  const common = {
    organizationId: scope.organizationId,
    channelId: scope.channelId,
    ...writeInput(input),
  };
  const response = documentId === undefined
    ? await requireClient().createDmMemoryDocument(common, appCallOptions(scope.token))
    : await requireClient().updateDmMemoryDocument({
      ...common,
      documentId,
      expectedVersion: "expectedVersion" in input ? input.expectedVersion : 0,
    }, appCallOptions(scope.token));
  return {
    documentId: response.documentId,
    version: response.version,
    replayed: response.replayed,
  };
}

export async function setDmMemorySettings(
  scope: DmMemoryApiScope,
  input: DmMemorySettingsInput,
) {
  const response = await requireClient().updateDmMemorySettings({
    organizationId: scope.organizationId,
    channelId: scope.channelId,
    requestId: input.requestId,
    memorySpaceId: input.memorySpaceId,
    expectedMemoryRevision: BigInt(input.expectedMemoryRevision),
    useEnabled: input.useEnabled,
    autoEnabled: input.autoEnabled,
  }, appCallOptions(scope.token));
  return spaceFromProto(requiredMessage(
    response.space,
    "updateDmMemorySettings.space",
  ));
}

export async function removeDmMemoryDocument(
  scope: DmMemoryApiScope,
  documentId: string,
) {
  return requireClient().deleteDmMemoryDocument({
    organizationId: scope.organizationId,
    channelId: scope.channelId,
    documentId,
  }, appCallOptions(scope.token));
}

export async function retryDmMemoryLearning(
  scope: DmMemoryApiScope,
  jobId: string,
  revocationEpoch: number,
) {
  const response = await requireClient().retryDmMemoryLearning({
    organizationId: scope.organizationId,
    channelId: scope.channelId,
    jobId,
    requestId: crypto.randomUUID(),
    revocationEpoch: BigInt(revocationEpoch),
  }, appCallOptions(scope.token));
  return { accepted: response.accepted, replayed: response.replayed };
}

export async function exportDmMemory(scope: DmMemoryApiScope, spaceId: string) {
  const response = await fetch(
    `${briarApiUrl}${base(scope.organizationId, scope.channelId)}/export?memorySpaceId=${encodeURIComponent(spaceId)}`,
    withSessionCredential(scope.token, { cache: "no-store" }),
  );
  if (!response.ok) throw new ApiError(response.status, "Memory export failed");
  return response.blob();
}

export const dmMemoryApi = {
  load: loadDmMemory,
  get: loadDmMemoryDocument,
  history: loadDmMemoryHistory,
  save: saveDmMemoryDocument,
  settings: setDmMemorySettings,
  remove: removeDmMemoryDocument,
  retryLearning: retryDmMemoryLearning,
  export: exportDmMemory,
};
export type DmMemoryClient = typeof dmMemoryApi;
