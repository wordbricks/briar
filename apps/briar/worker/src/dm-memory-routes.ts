import * as Schema from "effect/Schema";
import {
  dmMemoryCreateInput,
  dmMemoryEditInput,
  dmMemorySettingsInput,
} from "../../src/lib/dm-memory-contract";
import type { BriarAuth } from "./auth";
import { requireChannelAccess } from "./channel-route-access";
import { dmMemoryZipResponse } from "./dm-memory-export";
import {
  deleteDmMemory,
  exportDmMemoryEntries,
  getDmMemory,
  listDmMemories,
  listDmMemorySpaces,
  listDmMemoryRevisions,
  saveDmMemory,
  updateDmMemorySettings,
} from "./dm-memory-repository";
import { HttpError, privateNoStoreJson } from "./http-response";
import { getOrganizationRole } from "./organization-repository";
import { readJson } from "./request-readers";
import { decodeRequestSync } from "./request-schema";
import { requireSession } from "./session-auth";
import { UuidString } from "./schema-codecs";

const decodeCreate = decodeRequestSync(dmMemoryCreateInput);
const decodeEdit = decodeRequestSync(dmMemoryEditInput);
const decodeSettings = decodeRequestSync(dmMemorySettingsInput);
const decodeId = decodeRequestSync(UuidString);

export async function handleDmMemoryRoute(input: {
  request: Request; url: URL; auth: BriarAuth; db: D1Database; env?: Env;
}): Promise<Response | undefined> {
  const { request, url, auth, db } = input;
  const match = url.pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/memory(?:\/(settings|export|documents)(?:\/([0-9a-f-]+)(?:\/(revisions))?)?)?$/u,
  );
  if (!match) return undefined;
  const session = await requireSession(auth, request);
  const owner = { organizationId: match[1], channelId: match[2], userId: session.user.id };
  if (!await getOrganizationRole(db, owner.organizationId, owner.userId)) {
    throw new HttpError(404, "Organization not found");
  }
  const spaces = await listDmMemorySpaces(db, owner);
  if (spaces.length === 0) {
    await requireChannelAccess(db, owner.organizationId, owner.channelId, owner.userId);
  }
  const spaceParam = url.searchParams.get("memorySpaceId");
  const cursorParam = url.searchParams.get("cursor");
  const spaceId = spaceParam === null ? undefined : decodeId(spaceParam);
  const revisionNumber = decodeRequestSync(Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,9}$/u)));
  const cursor = cursorParam === null || match[5] ? undefined : decodeId(cursorParam);
  const resource = match[3];
  const documentId = match[4] === undefined ? undefined : decodeId(match[4]);
  if (!resource && request.method === "GET") {
    const page = await listDmMemories(db, owner, spaceId, cursor);
    return privateNoStoreJson({ ...page, capabilities: { ...page.capabilities,
      recall: String(input.env?.DM_MEMORY_RETRIEVAL_ENABLED) === "true" } });
  }
  if (resource === "export" && !documentId && request.method === "GET") {
    const selected = spaceId ? spaces.find((space) => space.id === spaceId) : spaces[0];
    if (!selected) throw new HttpError(404, "Memory space not found", "memory_not_found");
    return dmMemoryZipResponse(exportDmMemoryEntries(db, owner, selected.id), selected.id);
  }
  if (resource === "settings" && !documentId && request.method === "PATCH") {
    const body = decodeSettings(await readJson(request, 4096));
    return privateNoStoreJson({ space: await updateDmMemorySettings(db, owner, body) });
  }
  if (resource === "documents" && documentId && request.method === "GET") {
    if (match[5]) return privateNoStoreJson(await listDmMemoryRevisions(db, owner, documentId,
      cursorParam === null ? undefined : Number(revisionNumber(cursorParam))));
    const version = url.searchParams.get("version");
    return privateNoStoreJson({ document: await getDmMemory(db, owner, documentId,
      version === null ? undefined : Number(revisionNumber(version))) });
  }
  if (match[5]) throw new HttpError(405, "Method not allowed");
  if (resource === "documents" && !documentId && request.method === "POST") {
    const body = decodeCreate(await readJson(request, 160_000));
    return privateNoStoreJson(await saveDmMemory(db, owner, body));
  }
  if (resource === "documents" && documentId && request.method === "PATCH") {
    const body = decodeEdit(await readJson(request, 160_000));
    return privateNoStoreJson(await saveDmMemory(db, owner, body, documentId));
  }
  if (resource === "documents" && documentId && request.method === "DELETE") {
    return privateNoStoreJson(await deleteDmMemory(db, owner, documentId));
  }
  throw new HttpError(405, "Method not allowed");
}
