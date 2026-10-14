import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  DmMemoryClass as ProtoDmMemoryClass,
  DmMemoryDocumentKind as ProtoDmMemoryDocumentKind,
  DmMemoryDocumentSchema,
  DmMemoryDocumentStatus as ProtoDmMemoryDocumentStatus,
  DmMemoryEvidenceType as ProtoDmMemoryEvidenceType,
  DmMemoryIndexState as ProtoDmMemoryIndexState,
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
  dmMemorySpaceJson,
  dmMemorySpacePage,
  ensureWriteSpace,
  listDmMemorySpaces,
  updateDmMemorySettings,
  type DmMemoryOwner,
} from "./dm-memory-spaces";
import { HttpError } from "./http-response";
import { memoryVaultStoreFromEnv } from "./memory-vault/artifacts-git-store";
import type { VaultGitStore } from "./memory-vault/git-store";
import {
  forgetOwnerVaultRecord,
  getOwnerVaultDocument,
  listOwnerVaultDocuments,
  listOwnerVaultRevisions,
  saveOwnerVaultRecord,
  type OwnerVaultDeps,
} from "./memory-vault/owner";
import { getWorkspaceRole } from "./workspace-repository";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";

export type AppConnectDmMemoryInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
  readonly env: Env;
  /** Tests inject a store; production uses the `MEMORY_ARTIFACTS` binding. */
  readonly memoryVaultStore?: VaultGitStore | null;
};

/**
 * The owner's DM memory dialog, served from each space's vault (memory-vault
 * spec §9): record handles as document ids, owner writes as protected
 * `user:<id>` saves, deletes as forget. Authorization: `ownerFor`, then only
 * the owner's own spaces. Without the `MEMORY_ARTIFACTS` binding, reads of
 * the D1 index still work and anything touching Artifacts reports
 * `memory_unavailable`.
 */
const vaultDeps = (input: AppConnectDmMemoryInput): OwnerVaultDeps => ({
  db: input.db,
  store: input.memoryVaultStore === undefined ? memoryVaultStoreFromEnv(input.env) : input.memoryVaultStore,
});

/** Vault document ids are opaque to clients; bound them before they reach SQL. */
const opaqueDocumentId = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) throw new ConnectError("document_id is invalid", Code.InvalidArgument);
  return trimmed;
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
  workspaceIdValue: string,
  channelIdValue: string,
): Promise<DmMemoryOwner> => {
  const session = await requireSession(input.auth, input.request);
  const owner = {
    workspaceId: canonicalUuid(workspaceIdValue),
    channelId: canonicalUuid(channelIdValue),
    userId: session.user.id,
  };
  if (!await getWorkspaceRole(input.db, owner.workspaceId, owner.userId)) {
    throw new HttpError(404, "Workspace not found");
  }
  if ((await listDmMemorySpaces(input.db, owner)).length === 0) {
    await requireChannelAccess(
      input.db,
      owner.workspaceId,
      owner.channelId,
      owner.userId,
    );
  }
  return owner;
};

const createAppDmMemoryService = (
  input: AppConnectDmMemoryInput,
): ServiceImpl<typeof DmMemoryService> => ({
  // source_language, observed_at, valid_until and source_message on writes are
  // legacy fields older clients still send; the vault does not store them.
  listDmMemories: async (request) => {
    const owner = await ownerFor(input, request.workspaceId, request.channelId);
    const page = await dmMemorySpacePage(
      input.db,
      owner,
      request.memorySpaceId === undefined ? undefined : canonicalUuid(request.memorySpaceId),
    );
    const vaultPage = page.selected
      ? await listOwnerVaultDocuments(
          input.db,
          page.selected,
          request.cursor === undefined ? undefined : opaqueDocumentId(request.cursor),
        )
      : { documents: [], nextCursor: null };
    return create(DmMemoryService.method.listDmMemories.output, {
      eligible: page.eligible,
      capabilities: { recall: true, automaticLearning: true },
      spaces: page.spaces.map((space) => protoSpace(dmMemorySpaceJson(space))),
      selectedSpaceId: page.selected?.id,
      documents: vaultPage.documents.map(protoDocument),
      nextCursor: vaultPage.nextCursor ?? undefined,
    });
  },

  getDmMemoryDocument: async (request) => {
    const owner = await ownerFor(input, request.workspaceId, request.channelId);
    const document = await getOwnerVaultDocument(
      vaultDeps(input),
      await listDmMemorySpaces(input.db, owner),
      opaqueDocumentId(request.documentId),
      request.version,
    );
    return create(DmMemoryService.method.getDmMemoryDocument.output, { document: protoDocument(document) });
  },

  listDmMemoryRevisions: async (request) => {
    const owner = await ownerFor(input, request.workspaceId, request.channelId);
    const page = await listOwnerVaultRevisions(
      input.db,
      await listDmMemorySpaces(input.db, owner),
      opaqueDocumentId(request.documentId),
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
    const owner = await ownerFor(input, request.workspaceId, request.channelId);
    const decoded = decodeCreate({
      requestId: canonicalUuid(request.requestId),
      memorySpaceId: request.memorySpaceId === undefined ? undefined : canonicalUuid(request.memorySpaceId),
      title: request.title,
      body: request.body,
      memoryClass: domainMemoryClass(request.memoryClass),
    });
    const result = await saveOwnerVaultRecord(vaultDeps(input), {
      space: await ensureWriteSpace(input.db, owner, decoded.memorySpaceId),
      spaces: await listDmMemorySpaces(input.db, owner),
      userId: owner.userId,
      requestId: decoded.requestId,
      documentId: null,
      expectedVersion: null,
      title: decoded.title,
      body: decoded.body,
      memoryClass: decoded.memoryClass,
    });
    return create(DmMemoryService.method.createDmMemoryDocument.output, result);
  },

  updateDmMemoryDocument: async (request) => {
    const owner = await ownerFor(input, request.workspaceId, request.channelId);
    const decoded = decodeEdit({
      requestId: canonicalUuid(request.requestId),
      memorySpaceId: request.memorySpaceId === undefined ? undefined : canonicalUuid(request.memorySpaceId),
      expectedVersion: request.expectedVersion,
      title: request.title,
      body: request.body,
      memoryClass: domainMemoryClass(request.memoryClass),
    });
    const spaces = await listDmMemorySpaces(input.db, owner);
    const result = await saveOwnerVaultRecord(vaultDeps(input), {
      space: decoded.memorySpaceId === undefined
        ? null
        : spaces.find((space) => space.id === decoded.memorySpaceId) ?? null,
      spaces,
      userId: owner.userId,
      requestId: decoded.requestId,
      documentId: opaqueDocumentId(request.documentId),
      expectedVersion: decoded.expectedVersion,
      title: decoded.title,
      body: decoded.body,
      memoryClass: decoded.memoryClass,
    });
    return create(DmMemoryService.method.updateDmMemoryDocument.output, result);
  },

  deleteDmMemoryDocument: async (request) => {
    const owner = await ownerFor(input, request.workspaceId, request.channelId);
    const result = await forgetOwnerVaultRecord(
      vaultDeps(input),
      await listDmMemorySpaces(input.db, owner),
      owner.userId,
      opaqueDocumentId(request.documentId),
    );
    return create(DmMemoryService.method.deleteDmMemoryDocument.output, result);
  },

  updateDmMemorySettings: async (request) => {
    const owner = await ownerFor(input, request.workspaceId, request.channelId);
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
