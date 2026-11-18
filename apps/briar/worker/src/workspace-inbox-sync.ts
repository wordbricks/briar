import { corsHeaders } from "./http-response";

export const organizationInboxSyncEtag = (
  workspaceId: string,
  version: number,
) => `W/"workspace-inbox:${workspaceId}:${version}"`;

export async function loadWorkspaceInboxConditionalSnapshot<T>(input: {
  workspaceId: string;
  ifNoneMatch: string | null;
  readVersion: () => Promise<number>;
  loadSnapshot: () => Promise<T>;
}) {
  const version = await input.readVersion();
  const etag = organizationInboxSyncEtag(input.workspaceId, version);
  if (input.ifNoneMatch === etag) {
    return { etag, snapshot: null };
  }
  return { etag, snapshot: await input.loadSnapshot() };
}

export const organizationInboxSyncJson = (body: unknown, etag: string) =>
  Response.json(body, {
    headers: {
      ...corsHeaders,
      "Cache-Control": "private, no-cache",
      ETag: etag,
    },
  });

