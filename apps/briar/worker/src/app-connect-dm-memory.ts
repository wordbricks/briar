import { create } from "@bufbuild/protobuf";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  DmMemoryClass as ProtoDmMemoryClass,
  DmMemoryDocumentKind as ProtoDmMemoryDocumentKind,
  DmMemoryDocumentSchema,
  DmMemoryDocumentStatus as ProtoDmMemoryDocumentStatus,
  DmMemoryEvidenceType as ProtoDmMemoryEvidenceType,
  DmMemoryIndexState as ProtoDmMemoryIndexState,
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
  dmMemorySettingsInput,
  type DmMemoryClass,
  type DmMemoryDocument,
  type DmMemoryDocumentDetail,
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
  saveDmMemory,
  updateDmMemorySettings,
  type DmMemoryOwner,
} from "./dm-memory-repository";
import { HttpError } from "./http-response";
import { getOrganizationRole } from "./organization-repository";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";

export type AppConnectDmMemoryInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
};

const decodeUuid = decodeRequestSync(UuidString);
const canonicalUuid = (value: string) => decodeUuid(value).toLowerCase();
const decodeCreate = decodeRequestSync(dmMemoryCreateInput);
const decodeEdit = decodeRequestSync(dmMemoryEditInput);
const decodeSettings = decodeRequestSync(dmMemorySettingsInput);

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
    const page = await listDmMemories(
      input.db,
      owner,
      request.memorySpaceId === undefined
        ? undefined
        : canonicalUuid(request.memorySpaceId),
      request.cursor === undefined ? undefined : canonicalUuid(request.cursor),
    );
    return create(DmMemoryService.method.listDmMemories.output, {
      eligible: page.eligible,
      capabilities: page.capabilities,
      spaces: page.spaces.map(protoSpace),
      selectedSpaceId: page.selectedSpaceId ?? undefined,
      documents: page.documents.map(protoDocument),
      nextCursor: page.nextCursor ?? undefined,
    });
  },

  getDmMemoryDocument: async (request) => {
    const owner = await ownerFor(input, request.organizationId, request.channelId);
    const document = await getDmMemory(
      input.db,
      owner,
      canonicalUuid(request.documentId),
    );
    return create(DmMemoryService.method.getDmMemoryDocument.output, {
      document: protoDocument(document),
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
    }));
    return create(DmMemoryService.method.updateDmMemorySettings.output, {
      space: protoSpace(space),
    });
  },
});

export function registerAppDmMemoryService(
  router: ConnectRouter,
  input: AppConnectDmMemoryInput,
) {
  router.service(DmMemoryService, createAppDmMemoryService(input));
}

export { createAppDmMemoryService, DmMemoryService };
