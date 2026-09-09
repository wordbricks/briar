import type { BriarAuth } from "./auth";
import { requireChannelAccess } from "./channel-route-access";
import { dmMemoryZipResponse } from "./dm-memory-export";
import {
  exportDmMemoryEntries,
  listDmMemorySpaces,
} from "./dm-memory-repository";
import { HttpError } from "./http-response";
import { getWorkspaceRole } from "./workspace-repository";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";

const decodeId = decodeRequestSync(UuidString);

/** Binary export remains ordinary HTTP; typed memory reads and writes use Connect. */
export async function handleDmMemoryRoute(input: {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
}): Promise<Response | undefined> {
  const { request, url, auth, db } = input;
  const match = url.pathname.match(
    /^\/workspaces\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/memory\/export$/u,
  );
  if (!match) return undefined;
  if (request.method !== "GET") {
    throw new HttpError(405, "Method not allowed");
  }

  const session = await requireSession(auth, request);
  const owner = {
    workspaceId: decodeId(match[1]).toLowerCase(),
    channelId: decodeId(match[2]).toLowerCase(),
    userId: session.user.id,
  };
  if (!await getWorkspaceRole(db, owner.workspaceId, owner.userId)) {
    throw new HttpError(404, "Workspace not found");
  }
  const spaces = await listDmMemorySpaces(db, owner);
  if (spaces.length === 0) {
    await requireChannelAccess(
      db,
      owner.workspaceId,
      owner.channelId,
      owner.userId,
    );
  }
  const spaceIdValue = url.searchParams.get("memorySpaceId");
  const spaceId = spaceIdValue === null
    ? spaces[0]?.id
    : decodeId(spaceIdValue).toLowerCase();
  const selected = spaces.find((space) => space.id === spaceId);
  if (!selected) {
    throw new HttpError(404, "Memory space not found", "memory_not_found");
  }
  return dmMemoryZipResponse(
    exportDmMemoryEntries(db, owner, selected.id),
    selected.id,
  );
}
