import type { BriarAuth } from "./auth";
import {
  subscribeToChannelActivity,
  subscribeToIssueActivity,
} from "./channel-activity-realtime";
import {
  createChannelActivitySocketTicket,
  createIssueActivitySocketTicket,
  verifyChannelActivitySocketTicket,
  verifyIssueActivitySocketTicket,
} from "./channel-activity-ticket";
import { subscribeToOrganizationRealtime } from "./channel-realtime";
import {
  createChannelRealtimeTicket,
  verifyChannelRealtimeTicket,
} from "./channel-realtime-ticket";
import { getChannel, getChannelSyncCursor } from "./channels";
import { getHuntRunForProject } from "./hunt-run-repository";
import { HttpError, privateNoStoreJson } from "./http-response";
import { getOrganizationInboxSyncVersion } from "./organization-inbox-outbox-repository";
import { hasOrganizationCapability } from "./organization-access";
import { getOrganizationRole } from "./organization-repository";
import { getProject } from "./project-command-repository";
import { requireSession } from "./session-auth";

export type RealtimeRouteInput = {
  request: Request;
  auth: BriarAuth;
  db: D1Database;
  env: Env;
};

const socketUrlWithTicket = (request: Request, ticket: string) => {
  const socketUrl = new URL(request.url);
  socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
  socketUrl.search = "";
  socketUrl.searchParams.set("ticket", ticket);
  return socketUrl.toString();
};

async function requireChannelAccess(
  db: D1Database,
  organizationId: string,
  channelId: string,
  userId: string,
) {
  const role = await getOrganizationRole(db, organizationId, userId);
  if (!hasOrganizationCapability(role, "organization:read")) {
    throw new HttpError(404, "Organization not found");
  }
  const channel = await getChannel(db, organizationId, channelId, userId);
  if (!channel) throw new HttpError(404, "Channel not found");
  return channel;
}

export async function handleRealtimeRoute(
  routeInput: RealtimeRouteInput,
): Promise<Response | undefined> {
  const { request, auth, db, env } = routeInput;
  const { pathname } = new URL(request.url);

  const channelEventsMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channel-events$/u,
  );
  if (channelEventsMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = channelEventsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!hasOrganizationCapability(role, "organization:read")) {
      throw new HttpError(404, "Organization not found");
    }
    const issued = await createChannelRealtimeTicket(env.BETTER_AUTH_SECRET, {
      organizationId,
      userId: session.user.id,
    });
    return privateNoStoreJson({
      url: socketUrlWithTicket(request, issued.ticket),
      expiresAt: issued.expiresAt,
    });
  }
  if (channelEventsMatch && request.method === "GET") {
    const organizationId = channelEventsMatch[1];
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      throw new HttpError(426, "WebSocket transport required");
    }
    const ticket = new URL(request.url).searchParams.get("ticket") ?? "";
    if (
      !(await verifyChannelRealtimeTicket(
        env.BETTER_AUTH_SECRET,
        ticket,
        organizationId,
      ))
    ) {
      throw new HttpError(401, "Invalid or expired realtime ticket");
    }
    const [channels, inbox] = await Promise.all([
      getChannelSyncCursor(db, organizationId),
      getOrganizationInboxSyncVersion(db, organizationId),
    ]);
    return subscribeToOrganizationRealtime(env, organizationId, {
      channels,
      inbox,
    });
  }

  const issueActivityEventsMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/agent-activity-events$/u,
  );
  if (issueActivityEventsMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const [projectId, runId] = issueActivityEventsMatch.slice(1);
    const project = await getProject(db, projectId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const run = await getHuntRunForProject(db, projectId, runId);
    if (!run) throw new HttpError(404, "Run not found");
    const issued = await createIssueActivitySocketTicket(
      env.BETTER_AUTH_SECRET,
      {
        organizationId: project.organization_id,
        projectId,
        runId,
        userId: session.user.id,
      },
    );
    return privateNoStoreJson({
      url: socketUrlWithTicket(request, issued.ticket),
      expiresAt: issued.expiresAt,
    });
  }
  if (issueActivityEventsMatch && request.method === "GET") {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      throw new HttpError(426, "WebSocket transport required");
    }
    const [projectId, runId] = issueActivityEventsMatch.slice(1);
    const ticket = new URL(request.url).searchParams.get("ticket") ?? "";
    const verified = await verifyIssueActivitySocketTicket(
      env.BETTER_AUTH_SECRET,
      ticket,
      projectId,
      runId,
    );
    if (!verified) {
      throw new HttpError(401, "Invalid or expired activity ticket");
    }
    return subscribeToIssueActivity(env, {
      organizationId: verified.organizationId,
      projectId,
      runId,
      userId: verified.userId,
      authorizationExpiresAt: verified.authorizationExpiresAt,
    });
  }

  const channelActivityEventsMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/agent-activity-events$/u,
  );
  if (channelActivityEventsMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const [organizationId, channelId] = channelActivityEventsMatch.slice(1);
    await requireChannelAccess(
      db,
      organizationId,
      channelId,
      session.user.id,
    );
    const issued = await createChannelActivitySocketTicket(
      env.BETTER_AUTH_SECRET,
      { organizationId, channelId, userId: session.user.id },
    );
    return privateNoStoreJson({
      url: socketUrlWithTicket(request, issued.ticket),
      expiresAt: issued.expiresAt,
    });
  }
  if (channelActivityEventsMatch && request.method === "GET") {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      throw new HttpError(426, "WebSocket transport required");
    }
    const [organizationId, channelId] = channelActivityEventsMatch.slice(1);
    const ticket = new URL(request.url).searchParams.get("ticket") ?? "";
    const verified = await verifyChannelActivitySocketTicket(
      env.BETTER_AUTH_SECRET,
      ticket,
      organizationId,
      channelId,
    );
    if (!verified) {
      throw new HttpError(401, "Invalid or expired activity ticket");
    }
    return subscribeToChannelActivity(env, {
      organizationId,
      channelId,
      userId: verified.userId,
      authorizationExpiresAt: verified.authorizationExpiresAt,
    });
  }

  return undefined;
}
