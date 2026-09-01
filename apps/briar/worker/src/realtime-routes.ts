import {
  subscribeToChannelActivity,
  subscribeToIssueActivity,
} from "./channel-activity-realtime";
import {
  verifyChannelActivitySocketTicket,
  verifyIssueActivitySocketTicket,
} from "./channel-activity-ticket";
import { subscribeToOrganizationRealtime } from "./channel-realtime";
import {
  verifyChannelRealtimeTicket,
} from "./channel-realtime-ticket";
import { getChannelSyncCursor } from "./channels";
import { HttpError } from "./http-response";
import { getOrganizationInboxSyncVersion } from "./organization-inbox-outbox-repository";

export type RealtimeRouteInput = {
  request: Request;
  db: D1Database;
  env: Env;
};

export async function handleRealtimeRoute(
  routeInput: RealtimeRouteInput,
): Promise<Response | undefined> {
  const { request, db, env } = routeInput;
  const { pathname } = new URL(request.url);

  const channelEventsMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channel-events$/u,
  );
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
