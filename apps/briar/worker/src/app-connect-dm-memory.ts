import { create } from "@bufbuild/protobuf";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  DmMemoryClass as ProtoDmMemoryClass,
  DmMemoryDocumentKind as ProtoDmMemoryDocumentKind,
  DmMemoryDocumentSchema,
  DmMemoryDocumentStatus as ProtoDmMemoryDocumentStatus,
  DmMemoryEvidenceType as ProtoDmMemoryEvidenceType,
  DmMemoryIndexState as ProtoDmMemoryIndexState,
  DmMemoryLearningFailureCode as ProtoDmMemoryLearningFailureCode,
  DmMemoryLearningConfigurationSchema,
  DmMemoryLearningJobKind as ProtoDmMemoryLearningJobKind,
  DmMemoryLearningJobSchema,
  DmMemoryLearningJobStage as ProtoDmMemoryLearningJobStage,
  DmMemoryLearningJobStatus as ProtoDmMemoryLearningJobStatus,
  DmMemoryLearningStatusSchema,
  DmMemoryLearningModelSchema,
  DmMemoryLearningRetryableJobSchema,
  DmMemoryRevisionOrigin as ProtoDmMemoryRevisionOrigin,
  DmMemoryRevisionSchema,
  DmMemoryService,
  DmMemorySourceSchema,
  DmMemorySourceType as ProtoDmMemorySourceType,
  DmMemorySpaceSchema,
  DmMemorySpaceStatus as ProtoDmMemorySpaceStatus,
} from "@briar/contracts/gen/briar/app/v1/dm_memory_pb";
import {
  Code,
  ConnectError,
  type ConnectRouter,
  type ServiceImpl,
} from "@connectrpc/connect";
import {
  dmMemoryCreateInput,
  dmMemoryEditInput,
  dmMemoryLearningRetryInput,
  dmMemorySettingsInput,
  type DmMemoryClass,
  type DmMemoryDocument,
  type DmMemoryDocumentDetail,
  type DmMemoryLearningStatus,
  type DmMemorySource,
  type DmMemorySpace,
} from "../../src/lib/dm-memory-contract";
import type { BriarAuth } from "./auth";
import { requireChannelAccess } from "./channel-route-access";
import {
  deleteDmMemory,
  getDmMemory,
  listDmMemories,
  listDmMemorySpaces,
  listDmMemoryRevisions,
  saveDmMemory,
  updateDmMemorySettings,
  type DmMemoryOwner,
} from "./dm-memory-repository";
import { dmLearningPolicy } from "./dm-memory-learning-policy";
import { retryDmLearningJob } from "./dm-memory-learning-retry";
import { readDmLearningStatus } from "./dm-memory-learning-status";
import { HttpError } from "./http-response";
import { getOrganizationRole } from "./organization-repository";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";

export type AppConnectDmMemoryInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
  readonly env: Env;
};

const decodeUuid = decodeRequestSync(UuidString);
const canonicalUuid = (value: string) => decodeUuid(value).toLowerCase();
const decodeCreate = decodeRequestSync(dmMemoryCreateInput);
const decodeEdit = decodeRequestSync(dmMemoryEditInput);
const decodeSettings = decodeRequestSync(dmMemorySettingsInput);
const decodeLearningRetry = decodeRequestSync(dmMemoryLearningRetryInput);

const domainMemoryClass = (value: ProtoDmMemoryClass): DmMemoryClass => {
  switch (value) {
    case ProtoDmMemoryClass.PROFILE:
      return "profile";
    case ProtoDmMemoryClass.LOG:
      return "log";
    case ProtoDmMemoryClass.NOTE:
      return "note";
    case ProtoDmMemoryClass.UNSPECIFIED:
    default:
      throw new ConnectError("memory_class is required", Code.InvalidArgument);
  }
};

const protoMemoryClass = (value: DmMemoryClass) => {
  switch (value) {
    case "profile": return ProtoDmMemoryClass.PROFILE;
    case "log": return ProtoDmMemoryClass.LOG;
    case "note": return ProtoDmMemoryClass.NOTE;
  }
};

const protoSpaceStatus = (value: DmMemorySpace["status"]) => value === "active"
  ? ProtoDmMemorySpaceStatus.ACTIVE
  : ProtoDmMemorySpaceStatus.CLOSED;

const protoDocumentKind = (value: DmMemoryDocument["kind"]) =>
  value === "observation"
    ? ProtoDmMemoryDocumentKind.OBSERVATION
    : ProtoDmMemoryDocumentKind.TOPIC;

const protoDocumentStatus = (value: DmMemoryDocument["status"]) => {
  switch (value) {
    case "active": return ProtoDmMemoryDocumentStatus.ACTIVE;
    case "invalidated": return ProtoDmMemoryDocumentStatus.INVALIDATED;
    case "superseded": return ProtoDmMemoryDocumentStatus.SUPERSEDED;
  }
};

const protoEvidenceType = (value: DmMemoryDocument["evidenceType"]) =>
  value === "explicit_user"
    ? ProtoDmMemoryEvidenceType.EXPLICIT_USER
    : ProtoDmMemoryEvidenceType.OBSERVED;

const protoIndexState = (value: DmMemoryDocument["indexState"]) => {
  switch (value) {
    case "pending": return ProtoDmMemoryIndexState.PENDING;
    case "ready": return ProtoDmMemoryIndexState.READY;
    case "failed": return ProtoDmMemoryIndexState.FAILED;
  }
};

const protoSourceType = (value: DmMemorySource["type"]) => value === "message"
  ? ProtoDmMemorySourceType.MESSAGE
  : ProtoDmMemorySourceType.USER_EDIT_EVENT;

const protoRevisionOrigin = (
  value: "user_edit" | "explicit_request" | "extract" | "consolidate",
) => {
  switch (value) {
    case "user_edit": return ProtoDmMemoryRevisionOrigin.USER_EDIT;
    case "explicit_request": return ProtoDmMemoryRevisionOrigin.EXPLICIT_REQUEST;
    case "extract": return ProtoDmMemoryRevisionOrigin.EXTRACT;
    case "consolidate": return ProtoDmMemoryRevisionOrigin.CONSOLIDATE;
  }
};

const protoLearningJobKind = (value: "extract" | "explicit_request" | "consolidate") => {
  switch (value) {
    case "extract": return ProtoDmMemoryLearningJobKind.EXTRACT;
    case "explicit_request": return ProtoDmMemoryLearningJobKind.EXPLICIT_REQUEST;
    case "consolidate": return ProtoDmMemoryLearningJobKind.CONSOLIDATE;
  }
};

const protoLearningJobStatus = (value: DmMemoryLearningStatus["lastJob"] extends infer T
  ? NonNullable<T> extends { status: infer S } ? S : never
  : never) => {
  switch (value) {
    case "pending": return ProtoDmMemoryLearningJobStatus.PENDING;
    case "running": return ProtoDmMemoryLearningJobStatus.RUNNING;
    case "retry_wait": return ProtoDmMemoryLearningJobStatus.RETRY_WAIT;
    case "failed": return ProtoDmMemoryLearningJobStatus.FAILED;
    case "cancelled": return ProtoDmMemoryLearningJobStatus.CANCELLED;
    case "succeeded": return ProtoDmMemoryLearningJobStatus.SUCCEEDED;
    case "no_change": return ProtoDmMemoryLearningJobStatus.NO_CHANGE;
  }
};

const protoLearningJobStage = (value: "proposing" | "verifying" | "committing") => {
  switch (value) {
    case "proposing": return ProtoDmMemoryLearningJobStage.PROPOSING;
    case "verifying": return ProtoDmMemoryLearningJobStage.VERIFYING;
    case "committing": return ProtoDmMemoryLearningJobStage.COMMITTING;
  }
};

const protoLearningFailureCode = (value: NonNullable<NonNullable<DmMemoryLearningStatus["lastJob"]>["errorCode"]>) => {
  switch (value) {
    case "invalid_proposal": return ProtoDmMemoryLearningFailureCode.INVALID_PROPOSAL;
    case "verification_rejected": return ProtoDmMemoryLearningFailureCode.VERIFICATION_REJECTED;
    case "stale": return ProtoDmMemoryLearningFailureCode.STALE;
    case "scope_revoked": return ProtoDmMemoryLearningFailureCode.SCOPE_REVOKED;
    case "budget_exhausted": return ProtoDmMemoryLearningFailureCode.BUDGET_EXHAUSTED;
    case "model_unavailable": return ProtoDmMemoryLearningFailureCode.MODEL_UNAVAILABLE;
    case "model_timeout": return ProtoDmMemoryLearningFailureCode.MODEL_TIMEOUT;
    case "model_credentials": return ProtoDmMemoryLearningFailureCode.MODEL_CREDENTIALS;
    case "model_configuration": return ProtoDmMemoryLearningFailureCode.MODEL_CONFIGURATION;
    case "input_capacity": return ProtoDmMemoryLearningFailureCode.INPUT_CAPACITY;
  }
};

const protoLearningStatus = (status: DmMemoryLearningStatus | null) => status === null
  ? undefined
  : create(DmMemoryLearningStatusSchema, {
    configuration: status.configuration === null
      ? undefined
      : create(DmMemoryLearningConfigurationSchema, {
          proposer: create(DmMemoryLearningModelSchema, status.configuration.proposer),
          verifier: create(DmMemoryLearningModelSchema, status.configuration.verifier),
          spaceDailyCalls: status.configuration.spaceDailyCalls,
          spaceDailyMicroUsd: BigInt(status.configuration.spaceDailyMicroUsd),
        }),
    callsToday: status.callsToday,
    reservedMicroUsdToday: BigInt(status.reservedMicroUsdToday),
    pendingJobs: status.pendingJobs,
    failedJobs: status.failedJobs,
    lastJob: status.lastJob === null ? undefined : create(DmMemoryLearningJobSchema, {
      id: status.lastJob.id,
      kind: protoLearningJobKind(status.lastJob.kind),
      status: protoLearningJobStatus(status.lastJob.status),
      stage: status.lastJob.stage === null ? undefined : protoLearningJobStage(status.lastJob.stage),
      errorCode: status.lastJob.errorCode === null ? undefined : protoLearningFailureCode(status.lastJob.errorCode),
      updatedAt: timestamp(status.lastJob.updatedAt),
    }),
    retryableJob: status.retryableJob == null
      ? undefined
      : create(DmMemoryLearningRetryableJobSchema, status.retryableJob),
  });

const timestamp = (value: string) => timestampFromDate(new Date(value));
const optionalTimestamp = (value: string | null) => value === null
  ? undefined
  : timestamp(value);

const protoSpace = (space: DmMemorySpace) => create(DmMemorySpaceSchema, {
  id: space.id,
  channelId: space.channelId,
  agentId: space.agentId,
  rosterEpoch: BigInt(space.rosterEpoch),
  status: protoSpaceStatus(space.status),
  useEnabled: space.useEnabled,
  autoEnabled: space.autoEnabled,
  memoryRevision: BigInt(space.memoryRevision),
  revocationEpoch: BigInt(space.revocationEpoch),
  createdAt: timestamp(space.createdAt),
  updatedAt: timestamp(space.updatedAt),
});

const protoDocument = (
  document: DmMemoryDocument | DmMemoryDocumentDetail,
) => create(DmMemoryDocumentSchema, {
  id: document.id,
  memorySpaceId: document.memorySpaceId,
  kind: protoDocumentKind(document.kind),
  title: document.title,
  version: document.version,
  status: protoDocumentStatus(document.status),
  conflicted: document.conflicted,
  memoryClass: protoMemoryClass(document.memoryClass),
  evidenceType: protoEvidenceType(document.evidenceType),
  protectedByUser: document.protectedByUser,
  sourceLanguage: document.sourceLanguage,
  observedAt: optionalTimestamp(document.observedAt),
  validUntil: optionalTimestamp(document.validUntil),
  createdAt: timestamp(document.createdAt),
  updatedAt: timestamp(document.updatedAt),
  indexState: protoIndexState(document.indexState),
  body: "body" in document ? document.body : undefined,
  sources: "sources" in document
    ? document.sources.map((source) => create(DmMemorySourceSchema, {
      type: protoSourceType(source.type),
      id: source.id,
      version: source.version,
    }))
    : [],
});

const checkedNumber = (value: bigint, field: string) => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ConnectError(`${field} is too large`, Code.InvalidArgument);
  }
  return Number(value);
};

const ownerFor = async (
  input: AppConnectDmMemoryInput,
  organizationIdValue: string,
  channelIdValue: string,
): Promise<DmMemoryOwner> => {
  const session = await requireSession(input.auth, input.request);
  const owner = {
    organizationId: canonicalUuid(organizationIdValue),
    channelId: canonicalUuid(channelIdValue),
    userId: session.user.id,
  };
  if (!await getOrganizationRole(input.db, owner.organizationId, owner.userId)) {
    throw new HttpError(404, "Organization not found");
  }
  if ((await listDmMemorySpaces(input.db, owner)).length === 0) {
    await requireChannelAccess(
      input.db,
      owner.organizationId,
      owner.channelId,
      owner.userId,
    );
  }
  return owner;
};

const optionalIso = (value: Parameters<typeof timestampDate>[0] | undefined) =>
  value === undefined ? null : timestampDate(value).toISOString();

const sourceMessage = (value: { id: string; version: number } | undefined) =>
  value === undefined
    ? undefined
    : { id: canonicalUuid(value.id), version: value.version };

const createAppDmMemoryService = (
  input: AppConnectDmMemoryInput,
): ServiceImpl<typeof DmMemoryService> => ({
  listDmMemories: async (request) => {
    const owner = await ownerFor(input, request.organizationId, request.channelId);
    const policy = dmLearningPolicy(input.env, owner.organizationId);
    const page = await listDmMemories(
      input.db,
      owner,
      request.memorySpaceId === undefined
        ? undefined
        : canonicalUuid(request.memorySpaceId),
      request.cursor === undefined ? undefined : canonicalUuid(request.cursor),
    );
    const learning = await readDmLearningStatus(
      input.db,
      owner,
      page.selectedSpaceId,
      policy,
    );
    return create(DmMemoryService.method.listDmMemories.output, {
      eligible: page.eligible,
      capabilities: {
        ...page.capabilities,
        recall: String(input.env.DM_MEMORY_RETRIEVAL_ENABLED) === "true",
        automaticLearning: learning?.configuration !== null && learning?.configuration !== undefined,
      },
      spaces: page.spaces.map(protoSpace),
      selectedSpaceId: page.selectedSpaceId ?? undefined,
      documents: page.documents.map(protoDocument),
      nextCursor: page.nextCursor ?? undefined,
      learning: protoLearningStatus(learning),
    });
  },

  getDmMemoryDocument: async (request) => {
    const owner = await ownerFor(input, request.organizationId, request.channelId);
    const document = await getDmMemory(
      input.db,
      owner,
      canonicalUuid(request.documentId),
      request.version,
    );
    return create(DmMemoryService.method.getDmMemoryDocument.output, {
      document: protoDocument(document),
    });
  },

  listDmMemoryRevisions: async (request) => {
    const owner = await ownerFor(input, request.organizationId, request.channelId);
    const page = await listDmMemoryRevisions(
      input.db,
      owner,
      canonicalUuid(request.documentId),
      request.cursor,
    );
    return create(DmMemoryService.method.listDmMemoryRevisions.output, {
      documentId: page.documentId,
      currentVersion: page.currentVersion,
      revisions: page.revisions.map((revision) => create(DmMemoryRevisionSchema, {
        version: revision.version,
        createdAt: timestamp(revision.createdAt),
        memoryClass: protoMemoryClass(revision.memoryClass),
        protectedByUser: revision.protectedByUser,
        validUntil: optionalTimestamp(revision.validUntil),
        origin: protoRevisionOrigin(revision.origin),
      })),
      nextCursor: page.nextCursor ?? undefined,
    });
  },

  createDmMemoryDocument: async (request) => {
    const owner = await ownerFor(input, request.organizationId, request.channelId);
    const result = await saveDmMemory(input.db, owner, decodeCreate({
      requestId: canonicalUuid(request.requestId),
      memorySpaceId: request.memorySpaceId === undefined
        ? undefined
        : canonicalUuid(request.memorySpaceId),
      title: request.title,
      body: request.body,
      memoryClass: domainMemoryClass(request.memoryClass),
      sourceLanguage: request.sourceLanguage,
      observedAt: optionalIso(request.observedAt),
      validUntil: optionalIso(request.validUntil),
      sourceMessage: sourceMessage(request.sourceMessage),
    }));
    return create(DmMemoryService.method.createDmMemoryDocument.output, {
      documentId: result.documentId,
      version: result.version,
      replayed: result.replayed,
    });
  },

  updateDmMemoryDocument: async (request) => {
    const owner = await ownerFor(input, request.organizationId, request.channelId);
    const documentId = canonicalUuid(request.documentId);
    const result = await saveDmMemory(input.db, owner, decodeEdit({
      requestId: canonicalUuid(request.requestId),
      memorySpaceId: request.memorySpaceId === undefined
        ? undefined
        : canonicalUuid(request.memorySpaceId),
      expectedVersion: request.expectedVersion,
      title: request.title,
      body: request.body,
      memoryClass: domainMemoryClass(request.memoryClass),
      sourceLanguage: request.sourceLanguage,
      observedAt: optionalIso(request.observedAt),
      validUntil: optionalIso(request.validUntil),
      sourceMessage: sourceMessage(request.sourceMessage),
    }), documentId);
    return create(DmMemoryService.method.updateDmMemoryDocument.output, {
      documentId: result.documentId,
      version: result.version,
      replayed: result.replayed,
    });
  },

  deleteDmMemoryDocument: async (request) => {
    const owner = await ownerFor(input, request.organizationId, request.channelId);
    const result = await deleteDmMemory(
      input.db,
      owner,
      canonicalUuid(request.documentId),
    );
    return create(DmMemoryService.method.deleteDmMemoryDocument.output, result);
  },

  updateDmMemorySettings: async (request) => {
    const owner = await ownerFor(input, request.organizationId, request.channelId);
    const space = await updateDmMemorySettings(input.db, owner, decodeSettings({
      requestId: canonicalUuid(request.requestId),
      memorySpaceId: request.memorySpaceId === undefined
        ? undefined
        : canonicalUuid(request.memorySpaceId),
      expectedMemoryRevision: checkedNumber(
        request.expectedMemoryRevision,
        "expected_memory_revision",
      ),
      useEnabled: request.useEnabled,
      autoEnabled: request.autoEnabled,
    }), {
      learningAvailable: dmLearningPolicy(input.env, owner.organizationId) !== null,
    });
    return create(DmMemoryService.method.updateDmMemorySettings.output, {
      space: protoSpace(space),
    });
  },

  retryDmMemoryLearning: async (request) => {
    const owner = await ownerFor(input, request.organizationId, request.channelId);
    const result = await retryDmLearningJob(
      input.db,
      owner,
      canonicalUuid(request.jobId),
      decodeLearningRetry({
        requestId: canonicalUuid(request.requestId),
        revocationEpoch: checkedNumber(request.revocationEpoch, "revocation_epoch"),
      }),
      dmLearningPolicy(input.env, owner.organizationId),
    );
    return create(DmMemoryService.method.retryDmMemoryLearning.output, result);
  },
});

export function registerAppDmMemoryService(
  router: ConnectRouter,
  input: AppConnectDmMemoryInput,
) {
  router.service(DmMemoryService, createAppDmMemoryService(input));
}

export { createAppDmMemoryService, DmMemoryService };
