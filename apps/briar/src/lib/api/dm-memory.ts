import * as Schema from "effect/Schema";
import { briarApiUrl } from "../api-config";
import {
  DmMemoryPage, DmMemoryDocumentDetail, DmMemorySpace, DmMemoryRevisionPage,
  type DmMemoryCreateInput, type DmMemoryEditInput, type DmMemorySettingsInput,
} from "../dm-memory-contract";
import { request } from "./request";
import { ApiError } from "./errors";

const base = (organizationId: string, channelId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/channels/${encodeURIComponent(channelId)}/memory`;
export type DmMemoryApiScope = { token: string; organizationId: string; channelId: string };

export async function loadDmMemory(scope: DmMemoryApiScope, spaceId?: string, cursor?: string, signal?: AbortSignal) {
  const query = new URLSearchParams();
  if (spaceId) query.set("memorySpaceId", spaceId);
  if (cursor) query.set("cursor", cursor);
  const raw = await request(`${base(scope.organizationId, scope.channelId)}?${query}`, scope.token, { signal });
  return Schema.decodeUnknownSync(DmMemoryPage)(raw);
}
export async function loadDmMemoryDocument(scope: DmMemoryApiScope, documentId: string, signal?: AbortSignal, version?: number) {
  const raw = await request(`${base(scope.organizationId, scope.channelId)}/documents/${encodeURIComponent(documentId)}${version ? `?version=${version}` : ""}`,
    scope.token, { signal });
  return Schema.decodeUnknownSync(Schema.Struct({ document: DmMemoryDocumentDetail }))(raw).document;
}
export async function loadDmMemoryRevisions(scope: DmMemoryApiScope, documentId: string, cursor?: number, signal?: AbortSignal) {
  const raw = await request(`${base(scope.organizationId, scope.channelId)}/documents/${encodeURIComponent(documentId)}/revisions${cursor ? `?cursor=${cursor}` : ""}`,
    scope.token, { signal });
  return Schema.decodeUnknownSync(DmMemoryRevisionPage)(raw);
}
export async function saveDmMemoryDocument(
  scope: DmMemoryApiScope, input: DmMemoryCreateInput | DmMemoryEditInput, documentId?: string,
) {
  const path = `${base(scope.organizationId, scope.channelId)}/documents${documentId ? `/${encodeURIComponent(documentId)}` : ""}`;
  const raw = await request(path, scope.token, { method: documentId ? "PATCH" : "POST", body: JSON.stringify(input) });
  return Schema.decodeUnknownSync(Schema.Struct({
    documentId: Schema.String, version: Schema.Int, replayed: Schema.Boolean,
  }))(raw);
}
export async function setDmMemorySettings(scope: DmMemoryApiScope, input: DmMemorySettingsInput) {
  const raw = await request(`${base(scope.organizationId, scope.channelId)}/settings`, scope.token,
    { method: "PATCH", body: JSON.stringify(input) });
  return Schema.decodeUnknownSync(Schema.Struct({ space: DmMemorySpace }))(raw).space;
}
export async function removeDmMemoryDocument(scope: DmMemoryApiScope, documentId: string) {
  const raw = await request(`${base(scope.organizationId, scope.channelId)}/documents/${encodeURIComponent(documentId)}`,
    scope.token, { method: "DELETE" });
  return Schema.decodeUnknownSync(Schema.Struct({ deleted: Schema.Boolean, purgeState: Schema.String }))(raw);
}
export async function exportDmMemory(scope: DmMemoryApiScope, spaceId: string) {
  const response = await fetch(`${briarApiUrl}${base(scope.organizationId, scope.channelId)}/export?memorySpaceId=${encodeURIComponent(spaceId)}`, {
    headers: { Authorization: `Bearer ${scope.token}` }, cache: "no-store",
  });
  if (!response.ok) throw new ApiError(response.status, "Memory export failed");
  return response.blob();
}
export async function retryDmMemoryLearning(scope: DmMemoryApiScope, jobId: string, revocationEpoch: number) {
  const raw = await request(`${base(scope.organizationId, scope.channelId)}/jobs/${encodeURIComponent(jobId)}/retry`,
    scope.token, { method: "POST", body: JSON.stringify({ requestId: crypto.randomUUID(), revocationEpoch }) });
  return Schema.decodeUnknownSync(Schema.Struct({ accepted: Schema.Boolean, replayed: Schema.Boolean }))(raw);
}

export const dmMemoryApi = {
  load: loadDmMemory, get: loadDmMemoryDocument, save: saveDmMemoryDocument,
  settings: setDmMemorySettings, remove: removeDmMemoryDocument, export: exportDmMemory,
  history: loadDmMemoryRevisions,
  retryLearning: retryDmMemoryLearning,
};
export type DmMemoryClient = typeof dmMemoryApi;
