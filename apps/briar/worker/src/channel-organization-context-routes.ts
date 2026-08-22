import { channelReplyClaimTokenHeader } from "../../src/lib/channels-contract";
import {
  decodeOrganizationAgentContextAgentsPage,
  decodeOrganizationAgentContextIssuePullRequestsPage,
  decodeOrganizationAgentContextIssuesPage,
  decodeOrganizationAgentContextLookupInput,
  decodeOrganizationAgentContextLookupResponse,
  decodeOrganizationAgentContextManifest,
  decodeOrganizationAgentContextProjectsPage,
  decodeOrganizationAgentContextQuery,
  decodeOrganizationAgentContextSessionsPage,
} from "../../src/lib/organization-agent-context-contract";
import {
  getActiveOrganizationChannelReplyContextClaim,
  getOrganizationProject,
} from "./channels";
import { sha256 } from "./crypto-digest";
import {
  corsHeaders,
  HttpError,
  privateNoStoreJson,
} from "./http-response";
import {
  listOrganizationAgentContextAgentsPage,
  listOrganizationAgentContextIssuePullRequestsPage,
  listOrganizationAgentContextIssuesPage,
  listOrganizationAgentContextProjectsPage,
  listOrganizationAgentContextSessionsPage,
  lookupOrganizationAgentContext,
  organizationAgentContextManifest,
  organizationAgentContextMaxEncodedPageBytes,
  OrganizationAgentContextPageTooLargeError,
} from "./organization-agent-context";
import { readJson } from "./request-readers";
import { requireWorkerOrganization } from "./worker-route-auth";

async function requireActiveOrganizationContextClaim(input: {
  db: D1Database;
  request: Request;
  organizationId: string;
  workId: string;
  workerId: string;
}) {
  const principal = await requireWorkerOrganization(
    input.db,
    input.request,
    input.organizationId,
  );
  const claimToken = input.request.headers
    .get(channelReplyClaimTokenHeader)
    ?.trim();
  if (
    !claimToken?.startsWith("briar_channel_claim_") ||
    claimToken.length > 200
  ) {
    throw new HttpError(401, "Channel reply claim token required");
  }
  const job = await getActiveOrganizationChannelReplyContextClaim(input.db, {
    organizationId: input.organizationId,
    jobId: input.workId,
    deviceId: principal.deviceId,
    workerId: input.workerId,
    claimTokenHash: await sha256(claimToken),
    observedAt: new Date().toISOString(),
  });
  if (!job?.claimed_at) {
    throw new HttpError(409, "Organization Agent claim is no longer active");
  }
  return { ...job, claimed_at: job.claimed_at };
}

export type ChannelOrganizationContextRouteInput = {
  request: Request;
  url: URL;
  db: D1Database;
  env: Env;
};

export async function handleChannelOrganizationContextRoute(
  routeInput: ChannelOrganizationContextRouteInput,
): Promise<Response | undefined> {
  const { request, url, db, env } = routeInput;
  const { pathname } = url;

  const organizationContextManifestMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channel-reply-claims\/([0-9a-f-]+)\/organization-context\/manifest$/u,
  );
  if (organizationContextManifestMatch && request.method === "GET") {
    const organizationId = organizationContextManifestMatch[1];
    const workId = organizationContextManifestMatch[2];
    const query = decodeOrganizationAgentContextQuery(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const job = await requireActiveOrganizationContextClaim({
      db,
      request,
      organizationId,
      workId,
      workerId: query.workerId,
    });
    const manifest = decodeOrganizationAgentContextManifest(
      await organizationAgentContextManifest(db, {
        organizationId,
        workId,
        snapshotAt: job.claimed_at,
      }),
    );
    const etag = `"${manifest.revision}"`;
    const headers = {
      ...corsHeaders,
      "Cache-Control": "private, no-store",
      ETag: etag,
    };
    if (request.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304, headers });
    }
    return Response.json(manifest, { headers });
  }

  const organizationContextLookupMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channel-reply-claims\/([0-9a-f-]+)\/organization-context\/lookup$/u,
  );
  if (organizationContextLookupMatch && request.method === "POST") {
    const organizationId = organizationContextLookupMatch[1];
    const workId = organizationContextLookupMatch[2];
    const input = decodeOrganizationAgentContextLookupInput(
      await readJson(request),
    );
    const job = await requireActiveOrganizationContextClaim({
      db,
      request,
      organizationId,
      workId,
      workerId: input.workerId,
    });
    const projectIds = [...new Set(
      input.requests.map((item) => item.projectId),
    )];
    const projects = await Promise.all(
      projectIds.map((projectId) =>
        getOrganizationProject(db, organizationId, projectId)
      ),
    );
    if (projects.some((project) => !project)) {
      throw new HttpError(404, "Project not found");
    }
    const response = decodeOrganizationAgentContextLookupResponse(
      await lookupOrganizationAgentContext(db, env.ARCHIVES, {
        organizationId,
        workId,
        snapshotAt: job.claimed_at,
        requests: input.requests,
      }),
    );
    if (
      new TextEncoder().encode(JSON.stringify(response)).byteLength >
        organizationAgentContextMaxEncodedPageBytes
    ) {
      throw new OrganizationAgentContextPageTooLargeError();
    }
    return privateNoStoreJson(response);
  }

  const organizationContextMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channel-reply-claims\/([0-9a-f-]+)\/organization-context\/projects(?:\/([0-9a-f-]+)\/(agents|issues|issue-pull-requests|agent-sessions))?$/u,
  );
  if (organizationContextMatch && request.method === "GET") {
    const organizationId = organizationContextMatch[1];
    const workId = organizationContextMatch[2];
    const projectId = organizationContextMatch[3] ?? null;
    const resource = organizationContextMatch[4] ?? "projects";
    const query = decodeOrganizationAgentContextQuery(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const job = await requireActiveOrganizationContextClaim({
      db,
      request,
      organizationId,
      workId,
      workerId: query.workerId,
    });

    if (resource === "projects") {
      const page = await listOrganizationAgentContextProjectsPage(db, {
        organizationId,
        workId,
        snapshotAt: job.claimed_at,
        limit: query.limit,
        cursor: query.cursor,
      });
      return privateNoStoreJson(
        decodeOrganizationAgentContextProjectsPage(page),
      );
    }

    if (!projectId) throw new HttpError(404, "Project not found");
    const project = await getOrganizationProject(db, organizationId, projectId);
    if (!project) throw new HttpError(404, "Project not found");
    if (resource === "agents") {
      const page = await listOrganizationAgentContextAgentsPage(db, {
        organizationId,
        workId,
        projectId,
        snapshotAt: job.claimed_at,
        limit: query.limit,
        cursor: query.cursor,
      });
      return privateNoStoreJson(
        decodeOrganizationAgentContextAgentsPage(page),
      );
    }
    if (resource === "issues") {
      const page = await listOrganizationAgentContextIssuesPage(db, {
        organizationId,
        workId,
        projectId,
        snapshotAt: job.claimed_at,
        limit: query.limit,
        cursor: query.cursor,
      });
      return privateNoStoreJson(
        decodeOrganizationAgentContextIssuesPage(page),
      );
    }
    if (resource === "issue-pull-requests") {
      const page = await listOrganizationAgentContextIssuePullRequestsPage(db, {
        organizationId,
        workId,
        projectId,
        snapshotAt: job.claimed_at,
        limit: query.limit,
        cursor: query.cursor,
      });
      return privateNoStoreJson(
        decodeOrganizationAgentContextIssuePullRequestsPage(page),
      );
    }
    const page = await listOrganizationAgentContextSessionsPage(
      db,
      env.ARCHIVES,
      {
        organizationId,
        workId,
        projectId,
        snapshotAt: job.claimed_at,
        limit: query.limit,
        cursor: query.cursor,
      },
    );
    return privateNoStoreJson(
      decodeOrganizationAgentContextSessionsPage(page),
    );
  }

  return undefined;
}
