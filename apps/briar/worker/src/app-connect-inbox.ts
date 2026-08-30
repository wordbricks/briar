import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import {
  InboxService,
} from "@briar/contracts/gen/briar/app/v1/inbox_pb";
import * as Schema from "effect/Schema";
import type { BriarAuth } from "./auth";
import { buildInboxFeedMessages } from "./inbox-feed";
import {
  deleteInboxReadState,
  listInboxReadStates,
  upsertInboxReadStates,
} from "./inbox-read-state-repository";
import { listDashboardRuns } from "./hunt-run-read-repository";
import { HttpError } from "./http-response";
import {
  listChannelConversationNotifications,
  listIssueConversationNotifications,
  listOrganizationIssueSubscriptionRunIds,
} from "./issue-notification-repository";
import { issueSubscribers } from "./issue-subscribers";
import { withConnectErrors } from "./app-connect-errors";
import { appInboxFeedMessage } from "./app-connect-mappers";
import { hasOrganizationCapability } from "./organization-access";
import { getOrganizationInboxSyncVersion } from "./organization-inbox-outbox-repository";
import { getOrganizationRole } from "./organization-repository";
import { listProjectAgentSessionSummaries } from "./project-agent-session-repository";
import { listOrganizationInboxProjects } from "./project-repository";
import {
  decodeInboxReadStatesInput,
  decodeInboxUnreadStateInput,
} from "./account-organization-request-contract";
import { scheduleInboxRealtimeFlush } from "./realtime-scheduling";
import { decodeRequestSync } from "./request-schema";
import { trimmedText, UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";

export type AppConnectInboxInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
  readonly env: Env;
  readonly context?: ExecutionContext;
};

const decodeInboxFeedInput = decodeRequestSync(Schema.Struct({
  organizationId: UuidString,
  knownVersion: Schema.optional(trimmedText(1, 500)),
}));

const occurredAtOrAfter = (occurredAt: string, subscribedAt: string) => {
  const occurredTime = Date.parse(occurredAt);
  const subscribedTime = Date.parse(subscribedAt);
  return Number.isFinite(occurredTime) &&
    Number.isFinite(subscribedTime) &&
    occurredTime >= subscribedTime;
};

const readVersions = (
  rows: Awaited<ReturnType<typeof listInboxReadStates>>,
) => Object.fromEntries(rows.map((row) => [row.message_id, row.version]));

async function loadInboxFeed(
  db: D1Database,
  organizationId: string,
  userId: string,
) {
  const projects = await listOrganizationInboxProjects(
    db,
    organizationId,
    userId,
  );
  const [projectData, channelNotifications, subscribedIssueIds] =
    await Promise.all([
      Promise.all(projects.map(async (project) => {
        const [runs, conversationNotifications, sessionSummaries] =
          await Promise.all([
            listDashboardRuns(db, project.id),
            listIssueConversationNotifications(db, project.id, userId),
            listProjectAgentSessionSummaries(
              db,
              project.id,
              undefined,
              userId,
            ),
          ]);
        return {
          project,
          runs: runs.filter((run) => {
            const subscription = issueSubscribers(run).find(
              (subscriber) => subscriber.userId === userId,
            );
            return Boolean(
              subscription && occurredAtOrAfter(
                run.last_event_at,
                subscription.subscribedAt,
              ),
            );
          }),
          conversationNotifications,
          sessionSummaries,
        };
      })),
      listChannelConversationNotifications(db, organizationId, userId),
      listOrganizationIssueSubscriptionRunIds(db, organizationId, userId),
    ]);
  return {
    messages: buildInboxFeedMessages(
      projectData,
      channelNotifications,
      userId,
    ),
    subscribedIssueIds,
  };
}

export const createAppInboxService = (
  { request, auth, db, env, context }: AppConnectInboxInput,
): ServiceImpl<typeof InboxService> => ({
  getInboxFeed: async (rpcRequest) => withConnectErrors(async () => {
    const input = decodeInboxFeedInput({
      organizationId: rpcRequest.organizationId,
      knownVersion: rpcRequest.knownVersion,
    });
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      input.organizationId,
      session.user.id,
    );
    if (!hasOrganizationCapability(role, "organization:read")) {
      throw new HttpError(404, "Organization not found");
    }

    const version = String(
      await getOrganizationInboxSyncVersion(db, input.organizationId),
    );
    const generatedAt = timestampFromDate(new Date());
    if (input.knownVersion === version) {
      return {
        messages: [],
        subscribedIssueIds: [],
        generatedAt,
        version,
        unchanged: true,
      };
    }

    const feed = await loadInboxFeed(
      db,
      input.organizationId,
      session.user.id,
    );
    return {
      messages: feed.messages.map(appInboxFeedMessage),
      subscribedIssueIds: feed.subscribedIssueIds,
      generatedAt,
      version,
      unchanged: false,
    };
  }),

  getInboxReadStates: async () => withConnectErrors(async () => {
    const session = await requireSession(auth, request);
    return {
      readVersions: readVersions(
        await listInboxReadStates(db, session.user.id),
      ),
    };
  }),

  putInboxReadStates: async (rpcRequest) => withConnectErrors(async () => {
    const session = await requireSession(auth, request);
    const input = decodeInboxReadStatesInput({
      readVersions: rpcRequest.readVersions,
    });
    const rows = await upsertInboxReadStates(
      db,
      session.user.id,
      Object.entries(input.readVersions).map(([messageId, version]) => ({
        messageId,
        version,
      })),
      new Date().toISOString(),
    );
    scheduleInboxRealtimeFlush(env, db, context);
    return { readVersions: readVersions(rows) };
  }),

  deleteInboxReadState: async (rpcRequest) => withConnectErrors(async () => {
    const session = await requireSession(auth, request);
    const input = decodeInboxUnreadStateInput({
      messageId: rpcRequest.messageId,
    });
    const rows = await deleteInboxReadState(
      db,
      session.user.id,
      input.messageId,
    );
    scheduleInboxRealtimeFlush(env, db, context);
    return { readVersions: readVersions(rows) };
  }),
});

export function registerAppInboxService(
  router: ConnectRouter,
  input: AppConnectInboxInput,
) {
  router.service(InboxService, createAppInboxService(input));
}
