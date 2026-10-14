import { createClient } from "@connectrpc/connect";
import {
  DmMemoryClass as ProtoDmMemoryClass,
  type DmMemoryDocument as DmMemoryDocumentMessage,
  DmMemoryDocumentKind as ProtoDmMemoryDocumentKind,
  DmMemoryDocumentStatus as ProtoDmMemoryDocumentStatus,
  DmMemoryEvidenceType as ProtoDmMemoryEvidenceType,
  DmMemoryIndexState as ProtoDmMemoryIndexState,
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

const base = (workspaceId: string, channelId: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/channels/${encodeURIComponent(channelId)}/memory`;

export type DmMemoryApiScope = {
  token: string;
  workspaceId: string;
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

/**
 * The vault does not store a document's kind, status, conflict flag, evidence,
 * language, validity or index state; the server fills fixed values for shipped
 * clients (`dm_memory.proto`). The dialog no longer shows them, so they are
 * decoded leniently and never fail a page.
 */
const documentBaseFromProto = (
  document: DmMemoryDocumentMessage,
): DmMemoryDocument => ({
  id: document.id,
  memorySpaceId: document.memorySpaceId,
  kind: document.kind === ProtoDmMemoryDocumentKind.TOPIC ? "topic" : "observation",
  title: document.title,
  version: document.version,
  status: document.status === ProtoDmMemoryDocumentStatus.INVALIDATED
    ? "invalidated"
    : document.status === ProtoDmMemoryDocumentStatus.SUPERSEDED
    ? "superseded"
    : "active",
  conflicted: document.conflicted,
  memoryClass: memoryClassFromProto(document.memoryClass),
  evidenceType: document.evidenceType === ProtoDmMemoryEvidenceType.EXPLICIT_USER
    ? "explicit_user"
    : "observed",
  protectedByUser: document.protectedByUser,
  sourceLanguage: document.sourceLanguage,
  observedAt: optionalTimestamp(document.observedAt),
  validUntil: optionalTimestamp(document.validUntil),
  createdAt: requiredTimestamp(document.createdAt, "dmMemoryDocument.createdAt"),
  updatedAt: requiredTimestamp(document.updatedAt, "dmMemoryDocument.updatedAt"),
  indexState: document.indexState === ProtoDmMemoryIndexState.PENDING
    ? "pending"
    : document.indexState === ProtoDmMemoryIndexState.FAILED
    ? "failed"
    : "ready",
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

/** Legacy request fields (language, validity, source message) stay at their proto defaults. */
const writeInput = (input: DmMemoryCreateInput | DmMemoryEditInput) => ({
  requestId: input.requestId,
  memorySpaceId: input.memorySpaceId,
  title: input.title,
  body: input.body,
  memoryClass: memoryClassToProto(input.memoryClass),
});

export async function loadDmMemory(
  scope: DmMemoryApiScope,
  spaceId?: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<DmMemoryPage> {
  const response = await requireClient().listDmMemories({
    workspaceId: scope.workspaceId,
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
  };
}

export async function loadDmMemoryDocument(
  scope: DmMemoryApiScope,
  documentId: string,
  signal?: AbortSignal,
  version?: number,
): Promise<DmMemoryDocumentDetail> {
  const response = await requireClient().getDmMemoryDocument({
    workspaceId: scope.workspaceId,
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
    workspaceId: scope.workspaceId,
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
    workspaceId: scope.workspaceId,
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
    workspaceId: scope.workspaceId,
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
    workspaceId: scope.workspaceId,
    channelId: scope.channelId,
    documentId,
  }, appCallOptions(scope.token));
}

export async function exportDmMemory(scope: DmMemoryApiScope, spaceId: string) {
  const response = await fetch(
    `${briarApiUrl}${base(scope.workspaceId, scope.channelId)}/export?memorySpaceId=${encodeURIComponent(spaceId)}`,
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
  export: exportDmMemory,
};
export type DmMemoryClient = typeof dmMemoryApi;
