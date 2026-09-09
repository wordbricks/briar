import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import {
  InboxService} from "@briar/contracts/gen/briar/app/v1/inbox_pb";
import * as Schema from "effect/Schema";
import type { BriarAuth } from "./auth";
import {
  deleteInboxReadState,
  listInboxReadStates,
  upsertInboxReadStates,
} from "./inbox-read-state-repository";
import { HttpError } from "./http-response";

import { appInboxFeedMessage } from "./app-connect-mappers";
import { hasWorkspaceCapability } from "./workspace-access";
import { loadWorkspaceInboxFeed } from "./workspace-inbox-feed";
import { getWorkspaceInboxSyncVersion } from "./workspace-inbox-outbox-repository";
import { getWorkspaceRole } from "./workspace-repository";
import {
  decodeInboxReadStatesInput,
  decodeInboxUnreadStateInput,
} from "./account-workspace-request-contract";
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
  workspaceId: UuidString,
  knownVersion: Schema.optional(trimmedText(1, 500)),
}));

const readVersions = (
  rows: Awaited<ReturnType<typeof listInboxReadStates>>,
) => Object.fromEntries(rows.map((row) => [row.message_id, row.version]));

export const createAppInboxService = (
  { request, auth, db, env, context }: AppConnectInboxInput,
): ServiceImpl<typeof InboxService> => ({
  getInboxFeed: async (rpcRequest) => {
    const input = decodeInboxFeedInput({
      workspaceId: rpcRequest.workspaceId,
      knownVersion: rpcRequest.knownVersion,
    });
    const session = await requireSession(auth, request);
    const role = await getWorkspaceRole(
      db,
      input.workspaceId,
      session.user.id,
    );
    if (!hasWorkspaceCapability(role, "workspace:read")) {
      throw new HttpError(404, "Workspace not found");
    }

    const version = String(
      await getWorkspaceInboxSyncVersion(db, input.workspaceId),
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

    const feed = await loadWorkspaceInboxFeed(
      db,
      input.workspaceId,
      session.user.id,
    );
    return {
      messages: feed.messages.map(appInboxFeedMessage),
      subscribedIssueIds: feed.subscribedIssueIds,
      generatedAt,
      version,
      unchanged: false,
    };
  },

  getInboxReadStates: async () => {
    const session = await requireSession(auth, request);
    return {
      readVersions: readVersions(
        await listInboxReadStates(db, session.user.id),
      ),
    };
  },

  putInboxReadStates: async (rpcRequest) => {
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
  },

  deleteInboxReadState: async (rpcRequest) => {
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
  },
});

export function registerAppInboxService(
  router: ConnectRouter,
  input: AppConnectInboxInput,
) {
  router.service(InboxService, createAppInboxService(input));
}
