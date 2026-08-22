import { corsHeaders } from "./http-response";

export const organizationInboxSyncEtag = (
  organizationId: string,
  version: number,
) => `W/"organization-inbox:${organizationId}:${version}"`;

export async function loadOrganizationInboxConditionalSnapshot<T>(input: {
  organizationId: string;
  ifNoneMatch: string | null;
  readVersion: () => Promise<number>;
  loadSnapshot: () => Promise<T>;
}) {
  const version = await input.readVersion();
  const etag = organizationInboxSyncEtag(input.organizationId, version);
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

